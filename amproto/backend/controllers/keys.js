const AMProto = require('../core/amproto');

exports.handleIdentityKeyUpload = (ws, packet, db) => {
    try {
        const { publicKey } = JSON.parse(packet.payloadString);
        if (!publicKey || !Array.isArray(publicKey)) return;
        db.run(`UPDATE users SET identity_public_key = ? WHERE id = ?`, [JSON.stringify(publicKey), packet.senderId], (err) => {
            if (err) console.error('[Keys] identity key upload error:', err.message);
        });
    } catch (e) {
        console.error('[Keys] upload parsing error', e);
    }
};

exports.handleIdentityKeyReq = (ws, packet, db) => {
    try {
        const { userIds } = JSON.parse(packet.payloadString);
        const ids = Array.from(new Set((userIds || []).map(Number).filter(n => !isNaN(n))));
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        db.all(`SELECT id, identity_public_key FROM users WHERE id IN (${placeholders})`, ids, (err, rows) => {
            const keys = {};
            if (!err && rows) {
                rows.forEach(r => {
                    if (r.identity_public_key) {
                        try { keys[r.id] = JSON.parse(r.identity_public_key); } catch (e) {}
                    }
                });
            }
            const resPacket = AMProto.buildPacket(AMProto.CMD_IDENTITY_KEY_RES, packet.senderId, 0, JSON.stringify({ keys }));
            ws.send(AMProto.obfuscate(resPacket));
        });
    } catch (e) {
        console.error('[Keys] req parsing error', e);
    }
};

exports.handleGroupKeyGet = (ws, packet, db) => {
    try {
        const { groupId } = JSON.parse(packet.payloadString);
        db.get(`SELECT g.created_by, gk.wrapped_key, gk.iv FROM group_keys gk JOIN groups g ON g.id = gk.group_id WHERE gk.group_id = ? AND gk.user_id = ?`, [groupId, packet.senderId], (err, row) => {
            if (err || !row) return;
            db.get(`SELECT identity_public_key FROM users WHERE id = ?`, [row.created_by], (e2, u) => {
                if (e2 || !u || !u.identity_public_key) return;
                let wrappedKey, iv;
                try { wrappedKey = JSON.parse(row.wrapped_key); iv = JSON.parse(row.iv); } catch (e) { return; }
                const resPacket = AMProto.buildPacket(AMProto.CMD_GROUP_KEY_GET_OK, packet.senderId, 0, JSON.stringify({
                    groupId, wrappedKey, iv, creatorPublicKey: JSON.parse(u.identity_public_key)
                }));
                ws.send(AMProto.obfuscate(resPacket));
            });
        });
    } catch (e) {
        console.error('[Keys] group key get parsing error', e);
    }
};
