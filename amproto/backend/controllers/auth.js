const AMProto = require('../core/amproto');

exports.handleRegister = (ws, packet, clients, db) => {
    try {
        const { username, password } = JSON.parse(packet.payloadString);
        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, password], function(err) {
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
        const { username, password } = JSON.parse(packet.payloadString);
        db.get(`SELECT id, username, avatar_url, bio, theme_color, preferences FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
            if (err || !row) {
                const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Login failed' }));
                ws.send(AMProto.obfuscate(errPacket));
            } else {
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
                    preferences: prefs
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

                // Send unread group messages
                db.all(`
                    SELECT gm.id, gm.group_id, gm.sender_id, gm.payload
                    FROM group_messages gm
                    JOIN group_members mem ON gm.group_id = mem.group_id
                    LEFT JOIN group_read gr ON gr.group_id = mem.group_id AND gr.user_id = mem.user_id
                    WHERE mem.user_id = ? 
                    AND gm.created_at >= mem.joined_at
                    AND gm.id > IFNULL(gr.last_read, 0)
                `, [myId], (err, rows) => {
                    if (!err && rows && rows.length > 0) {
                        rows.forEach(msgRow => {
                            const payload = JSON.stringify({
                                groupId: msgRow.group_id,
                                senderId: msgRow.sender_id,
                                text: msgRow.payload,
                                messageId: msgRow.id
                            });
                            const groupMsgPacket = AMProto.buildPacket(AMProto.CMD_GROUP_MSG_RELAY, myId, msgRow.sender_id, payload);
                            ws.send(AMProto.obfuscate(groupMsgPacket));
                        });
                    }
                });
            }
        });
    } catch (e) {
        console.error("Login parsing error", e);
    }
};
