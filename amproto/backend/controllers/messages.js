const WebSocket = require('ws');
// Note: We don't need to require AMProto here unless we build packets. We don't build one, just relay. 

exports.handleEncMsg = (ws, packet, rawData, clients, db) => {
    const targetId = packet.targetId;
    const senderId = packet.senderId;
    const payloadStr = packet.payloadString;
    
    db.run(`INSERT INTO messages (sender_id, receiver_id, payload, is_read) VALUES (?, ?, ?, ?)`, 
        [senderId, targetId, payloadStr, clients.has(targetId) ? 1 : 0], 
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
};
