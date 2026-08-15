const WebSocket = require('ws');
const friendsController = require('./friends');
// Note: We don't need to require AMProto here unless we build packets. We don't build one, just relay. 

exports.handleEncMsg = (ws, packet, rawData, clients, db) => {
    const targetId = packet.targetId;
    const senderId = packet.senderId;
    const payloadStr = packet.payloadString;

    let clientMsgId = null;
    try {
        const parsed = JSON.parse(payloadStr);
        if (parsed && typeof parsed.clientMsgId === 'string') clientMsgId = parsed.clientMsgId;
    } catch (e) { /* not JSON, ignore */ }

    friendsController.canMessage(db, senderId, targetId, (allowed) => {
        if (!allowed) {
            const AMProto = require('../core/amproto');
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, senderId, 0, JSON.stringify({ message: 'Only friends can message you. Add this user as a friend first.' }));
            ws.send(AMProto.obfuscate(errPacket));
            return;
        }

        db.run(`INSERT INTO messages (sender_id, receiver_id, payload, is_read, sent_at, client_msg_id) VALUES (?, ?, ?, ?, ?, ?)`, 
            [senderId, targetId, payloadStr, clients.has(targetId) ? 1 : 0, Date.now(), clientMsgId], 
            function(err) {
                if (err) console.error("Error saving message", err);
            }
        );
        
        if (clients.has(targetId)) {
            console.log(`[Server] Relaying CMD_ENC_MSG from ${senderId} to ${targetId}`);
            const targetWs = clients.get(targetId);
            if (targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(rawData);
            }
        } else {
            console.log(`[Server] Target ${targetId} offline. Message saved.`);
        }
    });
};

exports.handleMsgDelete = (ws, packet, rawData, clients, db) => {
    const payload = JSON.parse(packet.payloadString);
    const { msgId, isGroup, groupId } = payload;
    const senderId = packet.senderId;

    if (isGroup) {
        db.run(`DELETE FROM group_messages WHERE id = ?`, [msgId], (err) => {
            if (err) console.error("Error deleting group message:", err);
        });
        
        db.all(`SELECT user_id FROM group_members WHERE group_id = ?`, [groupId], (err, rows) => {
            if (err || !rows) return;
            rows.forEach(row => {
                if (row.user_id !== senderId && clients.has(row.user_id)) {
                    const targetWs = clients.get(row.user_id);
                    if (targetWs.readyState === WebSocket.OPEN) {
                        targetWs.send(rawData);
                    }
                }
            });
        });
    } else {
        db.run(`DELETE FROM messages WHERE (sender_id = ? OR receiver_id = ?) AND client_msg_id = ?`, [senderId, senderId, msgId], (err) => {
            if (err) console.error("Error deleting message:", err);
        });

        const targetId = packet.targetId;
        if (clients.has(targetId)) {
            const targetWs = clients.get(targetId);
            if (targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(rawData);
            }
        }
    }
};
