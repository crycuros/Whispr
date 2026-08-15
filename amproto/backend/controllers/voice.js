const AMProto = require('../core/amproto');

// Voice clips are E2E-encrypted by the client before upload, so the
// server only ever stores ciphertext and never holds decryption keys.
// 192KB of ciphertext comfortably fits a 15s opus clip (~90KB) plus overhead.
const MAX_CLIP_BYTES = 192 * 1024;

exports.handleVoiceUpload = (ws, packet, db) => {
    try {
        const { encData, mime, duration } = JSON.parse(packet.payloadString);
        if (!encData || typeof encData !== 'string') return;
        const blobBuffer = Buffer.from(encData, 'base64');
        if (blobBuffer.length === 0 || blobBuffer.length > MAX_CLIP_BYTES) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Voice clip exceeds size limit' }));
            ws.send(AMProto.obfuscate(errPacket));
            return;
        }
        db.run(`INSERT INTO voice_clips (owner_id, mime, duration, clip_data) VALUES (?, ?, ?, ?)`,
            [packet.senderId, mime || 'audio/webm', duration || 0, blobBuffer],
            function (err) {
                if (err) {
                    console.error('[Voice] upload error:', err.message);
                    return;
                }
                const okPacket = AMProto.buildPacket(AMProto.CMD_VOICE_UPLOAD_OK, packet.senderId, 0, JSON.stringify({ id: this.lastID }));
                ws.send(AMProto.obfuscate(okPacket));
            }
        );
    } catch (e) {
        console.error('[Voice] upload parsing error', e);
    }
};

exports.handleVoiceGet = (ws, packet, db) => {
    try {
        const { id } = JSON.parse(packet.payloadString);
        if (!id) return;
        db.get(`SELECT id, owner_id, mime, duration, clip_data FROM voice_clips WHERE id = ?`, [id], (err, row) => {
            if (err || !row) {
                const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'Voice clip not found' }));
                ws.send(AMProto.obfuscate(errPacket));
                return;
            }
            const okPacket = AMProto.buildPacket(AMProto.CMD_VOICE_GET_OK, packet.senderId, 0, JSON.stringify({
                id: row.id,
                mime: row.mime || 'audio/webm',
                duration: row.duration || 0,
                encData: row.clip_data.toString('base64')
            }));
            ws.send(AMProto.obfuscate(okPacket));
        });
    } catch (e) {
        console.error('[Voice] get parsing error', e);
    }
};
