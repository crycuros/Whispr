const AMProto = require('../core/amproto');

exports.handleSavedSave = (ws, packet, clients, db) => {
    const payload = JSON.parse(packet.payloadString);
    const userId = packet.senderId;
    const { msgType, contentEnc, metaEnc } = payload;

    if (!contentEnc) {
        const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Saved message content missing' }));
        ws.send(AMProto.obfuscate(errPacket));
        return;
    }

    db.run(
        `INSERT INTO saved_messages (user_id, msg_type, content_enc, meta_enc) VALUES (?, ?, ?, ?)`,
        [userId, msgType || 'text', contentEnc, metaEnc || null],
        function(err) {
            if (err) {
                console.error("Error saving message", err);
                const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Save failed' }));
                ws.send(AMProto.obfuscate(errPacket));
            } else {
                const okPacket = AMProto.buildPacket(AMProto.CMD_SAVED_SAVE_OK, 0, 0, JSON.stringify({ id: this.lastID }));
                ws.send(AMProto.obfuscate(okPacket));
            }
        }
    );
};

exports.handleSavedList = (ws, packet, clients, db) => {
    const userId = packet.senderId;

    db.all(`SELECT id, msg_type, content_enc, meta_enc, created_at FROM saved_messages WHERE user_id = ? ORDER BY id DESC`, [userId], (err, rows) => {
        if (err) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Saved list failed' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            const okPacket = AMProto.buildPacket(AMProto.CMD_SAVED_LIST_OK, 0, 0, JSON.stringify({ items: rows || [] }));
            ws.send(AMProto.obfuscate(okPacket));
        }
    });
};

exports.handleSavedDelete = (ws, packet, clients, db) => {
    const payload = JSON.parse(packet.payloadString);
    const userId = packet.senderId;
    const { id } = payload;

    db.run(`DELETE FROM saved_messages WHERE id = ? AND user_id = ?`, [id, userId], function(err) {
        if (err) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Delete failed' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            const okPacket = AMProto.buildPacket(AMProto.CMD_SAVED_DELETE_OK, 0, 0, JSON.stringify({ id, deleted: this.changes > 0 }));
            ws.send(AMProto.obfuscate(okPacket));
        }
    });
};
