const AMProto = require('../core/amproto');
const WebSocket = require('ws');

exports.handleGroupCreate = (ws, packet, clients, db) => {
    const { name, members, isFeed, description, avatarUrl } = JSON.parse(packet.payloadString);
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
            stmt.finalize();
            
            const okPacket = AMProto.buildPacket(AMProto.CMD_GROUP_CREATE_OK, packet.senderId, 0, JSON.stringify({ groupId, name, members: allMembers, isFeed: !!isFeed, description, avatarUrl, creatorId: packet.senderId }));
            ws.send(AMProto.obfuscate(okPacket));
            
            const infoPacketStr = JSON.stringify({ groupId, name, members: allMembers, isFeed: !!isFeed, description, avatarUrl, creatorId: packet.senderId });
            allMembers.forEach(userId => {
                if (userId !== packet.senderId && clients.has(userId)) {
                    const targetWs = clients.get(userId);
                    if (targetWs.readyState === WebSocket.OPEN) {
                        const infoPacket = AMProto.buildPacket(AMProto.CMD_GROUP_INFO_OK, userId, 0, infoPacketStr);
                        targetWs.send(AMProto.obfuscate(infoPacket));
                    }
                }
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
                                if (memberId !== senderId && clients.has(memberId)) {
                                    const targetWs = clients.get(memberId);
                                    if (targetWs.readyState === WebSocket.OPEN) {
                                        console.log(`[Group] Relaying to ${memberId}`);
                                        const relayPacket = AMProto.buildPacket(AMProto.CMD_GROUP_MSG_RELAY, memberId, senderId, payload);
                                        targetWs.send(AMProto.obfuscate(relayPacket));
                                    } else {
                                        console.log(`[Group] Socket for ${memberId} not open`);
                                    }
                                } else if (memberId !== senderId) {
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
    db.run(`
        INSERT INTO group_read (group_id, user_id, last_read) 
        VALUES (?, ?, ?) 
        ON CONFLICT(group_id, user_id) DO UPDATE SET last_read = max(last_read, excluded.last_read)
    `, [groupId, packet.senderId, lastReadMsgId], (err) => {
        if (err) console.error("Error upserting group_read", err);
    });
};
