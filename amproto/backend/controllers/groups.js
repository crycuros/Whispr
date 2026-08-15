const AMProto = require('../core/amproto');
const WebSocket = require('ws');

exports.handleGroupCreate = (ws, packet, clients, db) => {
    const { name, members, isFeed, description, avatarUrl, groupKeys } = JSON.parse(packet.payloadString);
    db.run(`INSERT INTO groups (name, created_by, is_feed, description, avatar_url) VALUES (?, ?, ?, ?, ?)`, [name, packet.senderId, isFeed ? 1 : 0, description, avatarUrl], function(err) {
        if (err) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Group creation failed' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            const groupId = this.lastID;
            const allMembers = Array.from(new Set([packet.senderId, ...members]));
            
            const stmt = db.prepare(`INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)`);
            allMembers.forEach(userId => {
                stmt.run(groupId, userId, userId === packet.senderId ? 'admin' : 'member');
            });
            stmt.finalize(() => {
                const keyEntries = Object.entries(groupKeys || {}).filter(([uid, keyData]) => {
                    const uidN = parseInt(uid, 10);
                    return allMembers.includes(uidN) && keyData && keyData.wrappedKey && keyData.iv;
                });
                const insertKeys = () => new Promise((resolve) => {
                    if (keyEntries.length === 0) return resolve();
                    let remaining = keyEntries.length;
                    keyEntries.forEach(([uid, keyData]) => {
                        db.run(`INSERT INTO group_keys (group_id, user_id, wrapped_key, iv) VALUES (?, ?, ?, ?)`, [groupId, parseInt(uid, 10), JSON.stringify(keyData.wrappedKey), JSON.stringify(keyData.iv)], (err) => {
                            if (err) console.error('[Group] group_keys insert error:', err.message);
                            if (--remaining === 0) resolve();
                        });
                    });
                });
                insertKeys().then(() => {
                const placeholders = allMembers.map(() => '?').join(',');
                db.all(`SELECT id, username FROM users WHERE id IN (${placeholders})`, allMembers, (e, users) => {
                    const memberNames = {};
                    if (!e && users) users.forEach(u => memberNames[u.id] = u.username);

                    const okPacket = AMProto.buildPacket(AMProto.CMD_GROUP_CREATE_OK, packet.senderId, 0, JSON.stringify({ groupId, name, members: allMembers, memberNames, isFeed: !!isFeed, description, avatarUrl, creatorId: packet.senderId }));
                    ws.send(AMProto.obfuscate(okPacket));

                    const infoPacketStr = JSON.stringify({ groupId, name, members: allMembers, memberNames, isFeed: !!isFeed, description, avatarUrl, creatorId: packet.senderId });
                    allMembers.forEach(userId => {
                        if (userId !== packet.senderId && clients.has(userId)) {
                            const targetWs = clients.get(userId);
                            if (targetWs.readyState === WebSocket.OPEN) {
                                const infoPacket = AMProto.buildPacket(AMProto.CMD_GROUP_INFO_OK, userId, 0, infoPacketStr);
                                targetWs.send(AMProto.obfuscate(infoPacket));
                            }
                        }
                    });

                    exports.syncGroupPresence(db, allMembers, clients);
                });
            });
        });
        }
    });
};

exports.handleGroupMsg = (ws, packet, clients, db) => {
    const { groupId, text } = JSON.parse(packet.payloadString);
    const senderId = packet.senderId;
    
    db.get(`SELECT g.is_feed, gm.role FROM groups g JOIN group_members gm ON g.id = gm.group_id WHERE g.id = ? AND gm.user_id = ?`, [groupId, senderId], (err, row) => {
        if (err || !row) {
            console.log(`[Group] ${senderId} not member of ${groupId}`);
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, senderId, 0, JSON.stringify({ message: 'Not a member of group' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else if (row.is_feed === 1 && row.role !== 'admin') {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, senderId, 0, JSON.stringify({ message: 'Only admins can post in feeds' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            console.log(`[Group] Insert msg from ${senderId} in ${groupId}`);
            db.run(`INSERT INTO group_messages (group_id, sender_id, text) VALUES (?, ?, ?)`, [groupId, senderId, text], function(err) {
                if (err) console.error('[Group] INSERT error:', err.message);
                if (!err) {
                    const messageId = this.lastID;
                    
                    db.all(`SELECT user_id FROM group_members WHERE group_id = ?`, [groupId], (err, rows) => {
                        if (!err && rows) {
                            const payload = JSON.stringify({ groupId, senderId, text, messageId });
                            const connectedClients = [...clients.keys()];
                            console.log(`[Group] Relay to members of ${groupId}:`, rows.map(r=>r.user_id), '| Online:', connectedClients);
                            
                            rows.forEach(memberRow => {
                                const memberId = memberRow.user_id;
                                if (clients.has(memberId)) {
                                    const targetWs = clients.get(memberId);
                                    if (targetWs.readyState === WebSocket.OPEN) {
                                        console.log(`[Group] Relaying to ${memberId}`);
                                        const relayPacket = AMProto.buildPacket(AMProto.CMD_GROUP_MSG_RELAY, memberId, senderId, payload);
                                        targetWs.send(AMProto.obfuscate(relayPacket));
                                    } else {
                                        console.log(`[Group] Socket for ${memberId} not open`);
                                    }
                                } else {
                                    console.log(`[Group] Member ${memberId} is offline`);
                                }
                            });
                        }
                    });
                }
            });
        }
    });
};

exports.handleGroupRead = (ws, packet, db) => {
    const { groupId, lastReadMsgId } = JSON.parse(packet.payloadString);
    const numericId = parseInt(lastReadMsgId, 10);
    if (isNaN(numericId) || numericId <= 0) return;
    db.run(`
        INSERT INTO group_read (group_id, user_id, last_read) 
        VALUES (?, ?, ?) 
        ON CONFLICT(group_id, user_id) DO UPDATE SET last_read = excluded.last_read
    `, [groupId, packet.senderId, numericId], (err) => {
        if (err) console.error("Error upserting group_read", err);
    });
};

exports.getGroupMemberIds = (db, userId, cb) => {
    db.all(`SELECT DISTINCT gm.user_id FROM group_members gm
            JOIN group_members me ON me.group_id = gm.group_id
            WHERE me.user_id = ? AND gm.user_id != ?`, [userId, userId], (err, rows) => {
        cb(err, rows ? rows.map(r => r.user_id) : []);
    });
};

exports.syncGroupPresence = (db, memberIds, clients) => {
    const ids = Array.from(new Set(memberIds));
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    db.all(`SELECT id, last_seen FROM users WHERE id IN (${placeholders})`, ids, (err, users) => {
        if (err) return;
        const lastSeen = {};
        users.forEach(u => lastSeen[u.id] = u.last_seen);
        ids.forEach(subjectId => {
            const online = clients.has(subjectId);
            const payload = JSON.stringify({ userId: subjectId, online, lastSeen: online ? null : (lastSeen[subjectId] || null) });
            ids.forEach(targetId => {
                if (targetId === subjectId) return;
                if (clients.has(targetId)) {
                    const tws = clients.get(targetId);
                    if (tws.readyState === WebSocket.OPEN) {
                        tws.send(AMProto.obfuscate(AMProto.buildPacket(AMProto.CMD_PRESENCE, targetId, subjectId, payload)));
                    }
                }
            });
        });
    });
};

exports.broadcastPresenceToGroupMembers = (clients, db, userId, online, lastSeen) => {
    exports.getGroupMemberIds(db, userId, (err, ids) => {
        if (err) return;
        const payload = JSON.stringify({ userId, online, lastSeen });
        ids.forEach(mid => {
            if (clients.has(mid)) {
                const tws = clients.get(mid);
                if (tws.readyState === WebSocket.OPEN) {
                    tws.send(AMProto.obfuscate(AMProto.buildPacket(AMProto.CMD_PRESENCE, mid, userId, payload)));
                }
            }
        });
    });
};

exports.sendGroupMemberPresence = (ws, myId, clients, db) => {
    exports.getGroupMemberIds(db, myId, (err, ids) => {
        if (err) return;
        const placeholders = ids.map(() => '?').join(',');
        if (ids.length === 0) return;
        db.all(`SELECT id, last_seen FROM users WHERE id IN (${placeholders})`, ids, (e, users) => {
            if (e) return;
            const lastSeen = {};
            users.forEach(u => lastSeen[u.id] = u.last_seen);
            ids.forEach(mid => {
                const online = clients.has(mid);
                const p = AMProto.buildPacket(AMProto.CMD_PRESENCE, myId, mid, JSON.stringify({ userId: mid, online, lastSeen: online ? null : (lastSeen[mid] || null) }));
                ws.send(AMProto.obfuscate(p));
            });
        });
    });
};
