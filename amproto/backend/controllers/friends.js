const AMProto = require('../core/amproto');

const WebSocket = require('ws');

function sendPacket(ws, command, targetId, senderId, payloadObj) {
    const packet = AMProto.buildPacket(command, targetId, senderId, JSON.stringify(payloadObj));
    ws.send(AMProto.obfuscate(packet));
}

function getPreferences(row) {
    let prefs = {};
    if (row.preferences) {
        try { prefs = JSON.parse(row.preferences); } catch (e) {}
    }
    return prefs;
}

exports.handleReqSend = (ws, packet, clients, db) => {
    const senderId = packet.senderId;
    let toUsername, note;
    try {
        const payload = JSON.parse(packet.payloadString);
        toUsername = (payload.toUsername || '').trim();
        note = (payload.note || '').trim();
    } catch (e) {
        sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Invalid request' });
        return;
    }
    if (!toUsername) {
        sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Enter a username' });
        return;
    }

    db.get(`SELECT id, username, bio, avatar_url, preferences FROM users WHERE username = ?`, [toUsername], (err, target) => {
        if (err || !target) {
            sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'User not found' });
            return;
        }
        if (target.id === senderId) {
            sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'You cannot add yourself' });
            return;
        }

        const targetPrefs = getPreferences(target);
        if (targetPrefs.privacy === 'nobody') {
            sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'This user is not accepting friend requests' });
            return;
        }

        db.get(`SELECT status FROM friend_requests WHERE user_id = ? AND target_id = ?`, [senderId, target.id], (err, row) => {
            if (err) {
                sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Request failed' });
                return;
            }
            if (row) {
                if (row.status === 'accepted') sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'You are already friends' });
                else if (row.status === 'pending') sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Request already sent' });
                else sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Request not sent' });
                return;
            }
            // Was this user blocked by the target (from an earlier decline)?
            db.get(`SELECT status FROM friend_requests WHERE user_id = ? AND target_id = ? AND status = 'blocked'`, [target.id, senderId], (err, blocked) => {
                if (blocked) {
                    sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Request not sent' });
                    return;
                }

                db.run(`INSERT INTO friend_requests (user_id, target_id, status, note) VALUES (?, ?, 'pending', ?)`, [senderId, target.id, note], (insErr) => {
                    if (insErr) {
                        sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Request failed' });
                        return;
                    }
                    db.get(`SELECT username FROM users WHERE id = ?`, [senderId], (e2, senderRow) => {
                        const senderUsername = senderRow ? senderRow.username : `User ${senderId}`;
                        sendPacket(ws, AMProto.CMD_REQ_SEND_OK, packet.senderId, 0, { userId: target.id, username: target.username });
                        if (clients.has(target.id)) {
                            const targetWs = clients.get(target.id);
                            if (targetWs.readyState === WebSocket.OPEN) {
                                sendPacket(targetWs, AMProto.CMD_REQ_RECEIVED, target.id, senderId, {
                                    requestId: senderId,
                                    fromId: senderId,
                                    fromUsername: senderUsername,
                                    note: note
                                });
                            }
                        }
                    });
                });
            });
        });
    });
};

exports.handleReqList = (ws, packet, db) => {
    db.all(`SELECT fr.user_id AS fromId, fr.note, u.username, u.avatar_url, u.bio
            FROM friend_requests fr
            JOIN users u ON u.id = fr.user_id
            WHERE fr.target_id = ? AND fr.status = 'pending'
            ORDER BY fr.created_at DESC`, [packet.senderId], (err, rows) => {
        if (err) {
            sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Failed to load requests' });
            return;
        }
        const pending = (rows || []).map(r => ({ requestId: r.fromId, fromId: r.fromId, fromUsername: r.username, avatarUrl: r.avatar_url, bio: r.bio, note: r.note || '' }));
        sendPacket(ws, AMProto.CMD_REQ_LIST_OK, packet.senderId, 0, { pending });
    });
};

exports.handleReqAccept = (ws, packet, clients, db) => {
    const myId = packet.senderId;
    let requestId;
    try {
        requestId = JSON.parse(packet.payloadString).requestId;
    } catch (e) {
        sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Invalid request' });
        return;
    }

    db.run(`UPDATE friend_requests SET status = 'accepted' WHERE user_id = ? AND target_id = ? AND status = 'pending'`, [requestId, myId], function(err) {
        if (err || this.changes === 0) {
            sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Request not found' });
            return;
        }
        db.get(`SELECT username, bio, avatar_url FROM users WHERE id = ?`, [requestId], (e, requester) => {
            const requesterName = requester ? requester.username : `User ${requestId}`;
            sendPacket(ws, AMProto.CMD_REQ_ACCEPTED, myId, requestId, { userId: requestId, username: requesterName });
            exports.sendPresenceTo(ws, myId, requestId, clients, db);

            db.get(`SELECT username FROM users WHERE id = ?`, [myId], (e2, me) => {
                const myUsername = me ? me.username : `User ${myId}`;
                if (clients.has(requestId)) {
                    const reqWs = clients.get(requestId);
                    if (reqWs.readyState === WebSocket.OPEN) {
                        sendPacket(reqWs, AMProto.CMD_REQ_ACCEPTED, requestId, myId, { userId: myId, username: myUsername });
                        exports.sendPresenceTo(reqWs, requestId, myId, clients, db);
                    }
                }
            });
        });
    });
};

exports.handleReqDecline = (ws, packet, clients, db) => {
    const myId = packet.senderId;
    let requestId;
    try {
        requestId = JSON.parse(packet.payloadString).requestId;
    } catch (e) {
        sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Invalid request' });
        return;
    }

    db.run(`UPDATE friend_requests SET status = 'declined' WHERE user_id = ? AND target_id = ? AND status = 'pending'`, [requestId, myId], function(err) {
        if (err || this.changes === 0) {
            sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Request not found' });
            return;
        }
        // Block further requests from this user
        db.run(`INSERT OR IGNORE INTO friend_requests (user_id, target_id, status, note) VALUES (?, ?, 'blocked', '')`, [myId, requestId], () => {
            db.get(`SELECT username FROM users WHERE id = ?`, [myId], (e, me) => {
                const myUsername = me ? me.username : `User ${myId}`;
                if (clients.has(requestId)) {
                    const reqWs = clients.get(requestId);
                    if (reqWs.readyState === WebSocket.OPEN) {
                        sendPacket(reqWs, AMProto.CMD_REQ_DECLINED, requestId, myId, { requestId: myId, username: myUsername });
                    }
                }
            });
        });
    });
};

exports.canMessage = (db, a, b, cb) => {
    db.get(`SELECT
                (SELECT COUNT(*) FROM friend_requests
                 WHERE status = 'accepted' AND ((user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?))) AS friends,
                (SELECT COUNT(*) FROM friend_requests
                 WHERE status = 'blocked' AND ((user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?))) AS blocked,
                (SELECT COUNT(*) FROM messages
                 WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AS history`,
        [a, b, b, a, a, b, b, a, a, b, b, a], (err, row) => {
            if (err) return cb(false);
            if (row && row.blocked > 0) return cb(false);
            cb((row && (row.friends > 0 || row.history > 0)) || false);
        });
};

exports.getFriends = (db, userId, cb) => {
    db.all(`SELECT CASE WHEN user_id = ? THEN target_id ELSE user_id END AS friend_id
            FROM friend_requests
            WHERE status = 'accepted' AND (user_id = ? OR target_id = ?)`,
        [userId, userId, userId], (err, rows) => {
            cb(err, rows ? rows.map(r => r.friend_id) : []);
        });
};

exports.sendPresenceTo = (ws, targetId, subjectId, clients, db) => {
    const online = clients.has(subjectId);
    const send = (lastSeen) => {
        const p = AMProto.buildPacket(AMProto.CMD_PRESENCE, targetId, subjectId, JSON.stringify({ userId: subjectId, online, lastSeen }));
        ws.send(AMProto.obfuscate(p));
    };
    if (online) {
        send(null);
    } else {
        db.get(`SELECT last_seen FROM users WHERE id = ?`, [subjectId], (e, row) => send(row && row.last_seen ? row.last_seen : null));
    }
};

exports.broadcastPresence = (clients, db, userId, online, lastSeen) => {
    exports.getFriends(db, userId, (err, friendIds) => {
        if (err) return;
        const payload = JSON.stringify({ userId, online, lastSeen });
        friendIds.forEach(fid => {
            if (clients.has(fid)) {
                const tws = clients.get(fid);
                if (tws.readyState === WebSocket.OPEN) {
                    const p = AMProto.buildPacket(AMProto.CMD_PRESENCE, fid, userId, payload);
                    tws.send(AMProto.obfuscate(p));
                }
            }
        });
    });
};

exports.sendMyFriendPresence = (ws, myId, clients, db) => {
    exports.getFriends(db, myId, (err, friendIds) => {
        if (err) return;
        friendIds.forEach(fid => {
            exports.sendPresenceTo(ws, myId, fid, clients, db);
        });
    });
};

function lookupUsers(db, ids, cb) {
    if (!ids || ids.length === 0) return cb(null, []);
    const placeholders = ids.map(() => '?').join(',');
    db.all(`SELECT id, username, avatar_url, bio, last_seen FROM users WHERE id IN (${placeholders})`, ids, (err, rows) => {
        if (err) return cb(err, null);
        cb(null, rows || []);
    });
}

exports.handleContactList = (ws, packet, clients, db) => {
    const myId = packet.senderId;
    exports.getFriends(db, myId, (err, friendIds) => {
        if (err) return;
        lookupUsers(db, friendIds, (err2, users) => {
            const contacts = (users || []).map(u => ({
                userId: u.id,
                username: u.username,
                avatarUrl: u.avatar_url || null,
                bio: u.bio || '',
                online: clients.has(u.id),
                lastSeen: clients.has(u.id) ? null : (u.last_seen || null)
            }));
            db.all(`SELECT target_id FROM friend_requests WHERE user_id = ? AND status = 'blocked'`, [myId], (err3, blockedRows) => {
                const blockedIds = (blockedRows || []).map(r => r.target_id);
                lookupUsers(db, blockedIds, (err4, bUsers) => {
                    const blocked = (bUsers || []).map(u => ({
                        userId: u.id,
                        username: u.username,
                        avatarUrl: u.avatar_url || null,
                        bio: u.bio || ''
                    }));
                    sendPacket(ws, AMProto.CMD_CONTACT_LIST_OK, myId, 0, { contacts, blocked });
                });
            });
        });
    });
};

exports.handleContactRemove = (ws, packet, db) => {
    const myId = packet.senderId;
    let targetId;
    try {
        targetId = JSON.parse(packet.payloadString).userId;
    } catch (e) {
        sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Invalid request' });
        return;
    }
    db.run(`DELETE FROM friend_requests
            WHERE status = 'accepted' AND ((user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?))`,
        [myId, targetId, targetId, myId], (err) => {
            if (err) {
                sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Failed to remove contact' });
                return;
            }
            sendPacket(ws, AMProto.CMD_CONTACT_REMOVE_OK, myId, 0, { userId: targetId });
        });
};

exports.handleContactBlock = (ws, packet, clients, db) => {
    const myId = packet.senderId;
    let targetId;
    try {
        targetId = JSON.parse(packet.payloadString).userId;
    } catch (e) {
        sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Invalid request' });
        return;
    }
    if (targetId === myId) {
        sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'You cannot block yourself' });
        return;
    }
    db.run(`DELETE FROM friend_requests WHERE status = 'accepted' AND ((user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?))`,
        [myId, targetId, targetId, myId], () => {
            db.run(`INSERT OR REPLACE INTO friend_requests (user_id, target_id, status, note) VALUES (?, ?, 'blocked', '')`,
                [myId, targetId], (err) => {
                    if (err) {
                        sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Failed to block contact' });
                        return;
                    }
                    sendPacket(ws, AMProto.CMD_CONTACT_BLOCK_OK, myId, 0, { userId: targetId });
                    // Drop any chat presence subscription the other side has on us
                    if (clients.has(targetId)) {
                        const tws = clients.get(targetId);
                        if (tws.readyState === WebSocket.OPEN) {
                            sendPacket(tws, AMProto.CMD_PRESENCE, targetId, myId, { userId: myId, online: false, lastSeen: null });
                        }
                    }
                });
        });
};

exports.handleContactUnblock = (ws, packet, db) => {
    const myId = packet.senderId;
    let targetId;
    try {
        targetId = JSON.parse(packet.payloadString).userId;
    } catch (e) {
        sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Invalid request' });
        return;
    }
    db.run(`DELETE FROM friend_requests WHERE user_id = ? AND target_id = ? AND status = 'blocked'`,
        [myId, targetId], (err) => {
            if (err) {
                sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Failed to unblock contact' });
                return;
            }
            sendPacket(ws, AMProto.CMD_CONTACT_UNBLOCK_OK, myId, 0, { userId: targetId });
        });
};

exports.handleContactSuggest = (ws, packet, db) => {
    const myId = packet.senderId;
    // Candidates: users who are not me, not already friends/pending, and not blocked in either direction.
    // Prefer people sharing a Space with me, then newest accounts.
    db.all(`SELECT u.id, u.username, u.avatar_url, u.bio
            FROM users u
            WHERE u.id != ?
              AND NOT EXISTS (SELECT 1 FROM friend_requests fr
                              WHERE fr.status IN ('accepted','pending')
                                AND ((fr.user_id = ? AND fr.target_id = u.id) OR (fr.user_id = u.id AND fr.target_id = ?)))
              AND NOT EXISTS (SELECT 1 FROM friend_requests fr2
                              WHERE fr2.status = 'blocked'
                                AND ((fr2.user_id = ? AND fr2.target_id = u.id) OR (fr2.user_id = u.id AND fr2.target_id = ?)))
            ORDER BY (SELECT COUNT(*) FROM group_members gm
                      WHERE gm.user_id = u.id
                        AND gm.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)) DESC,
                     u.id DESC
            LIMIT 12`, [myId, myId, myId, myId, myId, myId], (err, rows) => {
        if (err) {
            sendPacket(ws, AMProto.CMD_ERROR, packet.senderId, 0, { message: 'Failed to load suggestions' });
            return;
        }
        const suggestions = (rows || []).map(u => ({
            userId: u.id,
            username: u.username,
            avatarUrl: u.avatar_url || null,
            bio: u.bio || ''
        }));
        sendPacket(ws, AMProto.CMD_CONTACT_SUGGEST_OK, myId, 0, { suggestions });
    });
};
