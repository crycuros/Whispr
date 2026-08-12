const AMProto = require('../core/amproto');

exports.handleResolve = (ws, packet, db) => {
    const targetUsername = packet.payloadString.trim();
    db.get(`SELECT id, username FROM users WHERE username = ?`, [targetUsername], (err, row) => {
        if (err || !row) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, packet.senderId, 0, JSON.stringify({ message: 'User not found' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            const okPacket = AMProto.buildPacket(AMProto.CMD_RESOLVE_OK, packet.senderId, 0, JSON.stringify({ userId: row.id, username: row.username }));
            ws.send(AMProto.obfuscate(okPacket));
        }
    });
};

exports.handleUserUpdate = (ws, packet, db) => {
    const { avatarUrl, bio, themeColor, preferences } = JSON.parse(packet.payloadString);
    
    // If fields are undefined, keep existing data (for partial updates like just color)
    const updates = [];
    const params = [];
    if (avatarUrl !== undefined) { updates.push('avatar_url = ?'); params.push(avatarUrl); }
    if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
    if (themeColor !== undefined) { updates.push('theme_color = ?'); params.push(themeColor); }
    if (preferences !== undefined) { updates.push('preferences = ?'); params.push(JSON.stringify(preferences)); }
    
    if (updates.length > 0) {
        params.push(packet.senderId);
        db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, (err) => {
            if (err) {
                console.error("Error updating user", err);
            } else {
                const okPacket = AMProto.buildPacket(AMProto.CMD_USER_UPDATE_OK, packet.senderId, 0, JSON.stringify({ success: true, avatarUrl, bio, themeColor, preferences }));
                ws.send(AMProto.obfuscate(okPacket));
            }
        });
    } else {
        const okPacket = AMProto.buildPacket(AMProto.CMD_USER_UPDATE_OK, packet.senderId, 0, JSON.stringify({ success: true }));
        ws.send(AMProto.obfuscate(okPacket));
    }
};
