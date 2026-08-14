const AMProto = require('../core/amproto');
const crypto = require('crypto');

exports.handleRegister = (ws, packet, clients, db) => {
    try {
        const { username, password } = JSON.parse(packet.payloadString);
        
        // Generate a random salt
        const salt = crypto.randomBytes(16).toString('hex');
        // Hash the password with scrypt
        const hash = crypto.scryptSync(password, salt, 64).toString('hex');
        const storedPassword = `${salt}:${hash}`;

        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, storedPassword], function(err) {
            if (err) {
                const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Registration failed' }));
                ws.send(AMProto.obfuscate(errPacket));
            } else {
                const okPacket = AMProto.buildPacket(AMProto.CMD_REGISTER_OK, packet.senderId, 0, JSON.stringify({ userId: this.lastID, username }));
                ws.send(AMProto.obfuscate(okPacket));
            }
        });
    } catch (e) {
        console.error("Register parsing error", e);
    }
};

exports.handleLogin = (ws, packet, clients, db, setMyIdCallback) => {
    try {
        const { username, password, sessionToken } = JSON.parse(packet.payloadString);
        
        if (sessionToken) {
            // Login via session token
            db.get(`SELECT id, username, avatar_url, bio, theme_color, preferences FROM users WHERE username = ? AND session_token = ?`, [username, sessionToken], (err, row) => {
                if (err || !row) {
                    const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Invalid session' }));
                    ws.send(AMProto.obfuscate(errPacket));
                } else {
                    completeLogin(ws, packet, clients, db, setMyIdCallback, row, sessionToken);
                }
            });
        } else {
            // Login via password
            db.get(`SELECT id, username, password, avatar_url, bio, theme_color, preferences FROM users WHERE username = ?`, [username], (err, row) => {
                if (err || !row) {
                    const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Login failed' }));
                    ws.send(AMProto.obfuscate(errPacket));
                    return;
                }
                
                const parts = row.password.split(':');
                let isValid = false;

                if (parts.length === 2) {
                    const [salt, storedHash] = parts;
                    const hashBuffer = crypto.scryptSync(password, salt, 64);
                    isValid = (hashBuffer.toString('hex') === storedHash);
                } else {
                    // Fallback for old accounts before the security patch
                    if (row.password === password) {
                        isValid = true; // Plaintext (e.g. user2)
                    } else if (row.password === crypto.createHash('sha256').update(password).digest('hex')) {
                        isValid = true; // Legacy SHA256 (e.g. cyberplays)
                    }
                }
                
                if (!isValid) {
                    const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Login failed' }));
                    ws.send(AMProto.obfuscate(errPacket));
                } else {
                    // Generate new session token
                    const newSessionToken = crypto.randomBytes(32).toString('hex');
                    db.run(`UPDATE users SET session_token = ? WHERE id = ?`, [newSessionToken, row.id], (updateErr) => {
                        completeLogin(ws, packet, clients, db, setMyIdCallback, row, newSessionToken);
                    });
                }
            });
        }
    } catch (e) {
        console.error("Login parsing error", e);
    }
};

function completeLogin(ws, packet, clients, db, setMyIdCallback, row, sessionToken) {
    const myId = row.id;
    setMyIdCallback(myId);
    clients.set(myId, ws);
    console.log(`[Server] Web Client ID ${myId} logged in`);
    
    let prefs = {};
    if (row.preferences) {
        try { prefs = JSON.parse(row.preferences); } catch (e) {}
    }
    
    const okPacket = AMProto.buildPacket(AMProto.CMD_LOGIN_OK, packet.senderId, 0, JSON.stringify({ 
        userId: myId, 
        username: row.username,
        avatarUrl: row.avatar_url,
        bio: row.bio,
        themeColor: row.theme_color,
        preferences: prefs,
        sessionToken: sessionToken
    }));
    ws.send(AMProto.obfuscate(okPacket));
    
    // Send unread messages
    db.all(`SELECT id, sender_id, payload FROM messages WHERE receiver_id = ? AND is_read = 0`, [myId], (err, rows) => {
        if (!err && rows && rows.length > 0) {
            rows.forEach(msgRow => {
                const encMsgPacket = AMProto.buildPacket(AMProto.CMD_ENC_MSG, myId, msgRow.sender_id, msgRow.payload);
                ws.send(AMProto.obfuscate(encMsgPacket));
                db.run(`UPDATE messages SET is_read = 1 WHERE id = ?`, [msgRow.id]);
            });
        }
    });

    // Sync groups: send CMD_GROUP_INFO_OK for all groups this user belongs to
    db.all(`
        SELECT g.id, g.name, g.description, g.avatar_url, g.is_feed, g.created_by,
               (SELECT GROUP_CONCAT(user_id) FROM group_members WHERE group_id = g.id) as member_ids
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ?`, [myId], (err, groupList) => {
        if (!err && groupList) {
            groupList.forEach(g => {
                const members = g.member_ids ? g.member_ids.split(',').map(Number) : [];
                const infoPayload = JSON.stringify({
                    groupId: g.id,
                    name: g.name,
                    description: g.description,
                    avatarUrl: g.avatar_url,
                    members: members,
                    isFeed: !!g.is_feed,
                    creatorId: g.created_by
                });
                const infoPacket = AMProto.buildPacket(AMProto.CMD_GROUP_INFO_OK, myId, 0, infoPayload);
                ws.send(AMProto.obfuscate(infoPacket));
            });
        }

        // Send unread group messages
        db.all(`SELECT gm.id, gm.group_id, gm.sender_id, gm.text as payload FROM group_messages gm 
                JOIN group_members mem ON gm.group_id = mem.group_id 
                LEFT JOIN group_read gr ON gm.group_id = gr.group_id AND gr.user_id = ?
                WHERE mem.user_id = ? AND gm.sent_at >= mem.joined_at 
                AND (gr.last_read IS NULL OR gm.id > gr.last_read)`, [myId, myId], (err, groupRows) => {
            if (!err && groupRows && groupRows.length > 0) {
                groupRows.forEach(gMsg => {
                    const payload = JSON.stringify({ groupId: gMsg.group_id, senderId: gMsg.sender_id, text: gMsg.payload, messageId: gMsg.id });
                    const relayPacket = AMProto.buildPacket(AMProto.CMD_GROUP_MSG_RELAY, myId, gMsg.sender_id, payload);
                    ws.send(AMProto.obfuscate(relayPacket));
                });
            }
        });
    });
}
