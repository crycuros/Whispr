const WebSocket = require('ws');
const AMProto = require('../core/amproto');

exports.handleVaultUpload = (ws, packet, clients, db) => {
    const payload = JSON.parse(packet.payloadString);
    const userId = packet.senderId;
    const { encName, encMime, size, encData } = payload;
    
    // encData is base64
    const blobBuffer = Buffer.from(encData, 'base64');
    
    // 10MB size limit
    if (blobBuffer.length > 10 * 1024 * 1024) {
        const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'File exceeds 10MB limit' }));
        ws.send(AMProto.obfuscate(errPacket));
        return;
    }
    
    db.run(
        `INSERT INTO file_vault (user_id, filename_enc, mime_enc, size_enc, blob_data) VALUES (?, ?, ?, ?, ?)`,
        [userId, encName, encMime, size, blobBuffer],
        function(err) {
            if (err) {
                console.error("Error saving vault file", err);
                const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Vault upload failed' }));
                ws.send(AMProto.obfuscate(errPacket));
            } else {
                const okPacket = AMProto.buildPacket(AMProto.CMD_VAULT_UPLOAD_OK, 0, 0, JSON.stringify({ id: this.lastID }));
                ws.send(AMProto.obfuscate(okPacket));
            }
        }
    );
};

exports.handleVaultList = (ws, packet, clients, db) => {
    const userId = packet.senderId;
    
    db.all(`SELECT id, filename_enc, mime_enc, size_enc, created_at FROM file_vault WHERE user_id = ?`, [userId], (err, rows) => {
        if (err) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Vault list failed' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            const okPacket = AMProto.buildPacket(AMProto.CMD_VAULT_LIST_OK, 0, 0, JSON.stringify({ files: rows || [] }));
            ws.send(AMProto.obfuscate(okPacket));
        }
    });
};

exports.handleVaultDownload = (ws, packet, clients, db) => {
    const payload = JSON.parse(packet.payloadString);
    const userId = packet.senderId;
    const { id } = payload;
    
    db.get(`SELECT * FROM file_vault WHERE id = ? AND user_id = ?`, [id, userId], (err, row) => {
        if (err || !row) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'File not found' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            const base64Data = row.blob_data.toString('base64');
            const okPacket = AMProto.buildPacket(AMProto.CMD_VAULT_DOWNLOAD_OK, 0, 0, JSON.stringify({ 
                id: row.id,
                encName: row.filename_enc,
                encMime: row.mime_enc,
                encData: base64Data
            }));
            ws.send(AMProto.obfuscate(okPacket));
        }
    });
};
