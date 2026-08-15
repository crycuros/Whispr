const AMProto = require('../core/amproto');

exports.handleSavedSave = (ws, packet, clients, db) => {
    const payload = JSON.parse(packet.payloadString);
    const userId = packet.senderId;
    const { msgType, contentEnc, metaEnc, categoryId } = payload;

    if (!contentEnc) {
        const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Saved message content missing' }));
        ws.send(AMProto.obfuscate(errPacket));
        return;
    }

    db.run(
        `INSERT INTO saved_messages (user_id, msg_type, content_enc, meta_enc, category_id) VALUES (?, ?, ?, ?, ?)`,
        [userId, msgType || 'text', contentEnc, metaEnc || null, categoryId || null],
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

    db.all(`SELECT id, msg_type, content_enc, meta_enc, category_id, created_at FROM saved_messages WHERE user_id = ? ORDER BY id DESC`, [userId], (err, rows) => {
        if (err) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Saved list failed' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            const okPacket = AMProto.buildPacket(AMProto.CMD_SAVED_LIST_OK, 0, 0, JSON.stringify({ items: rows || [] }));
            ws.send(AMProto.obfuscate(okPacket));
        }
    });
};

exports.handleSavedMove = (ws, packet, clients, db) => {
    const payload = JSON.parse(packet.payloadString);
    const userId = packet.senderId;
    const { id, categoryId } = payload;

    db.run(`UPDATE saved_messages SET category_id = ? WHERE id = ? AND user_id = ?`, [categoryId || null, id, userId], function(err) {
        if (err) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Move failed' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            const okPacket = AMProto.buildPacket(AMProto.CMD_SAVED_MOVE_OK, 0, 0, JSON.stringify({ id, categoryId: categoryId || null, changed: this.changes > 0 }));
            ws.send(AMProto.obfuscate(okPacket));
        }
    });
};

exports.handleCatCreate = (ws, packet, clients, db) => {
    const payload = JSON.parse(packet.payloadString);
    const userId = packet.senderId;
    const { nameEnc } = payload;

    if (!nameEnc) {
        const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Category name missing' }));
        ws.send(AMProto.obfuscate(errPacket));
        return;
    }

    db.run(`INSERT INTO vault_categories (user_id, name_enc) VALUES (?, ?)`, [userId, nameEnc], function(err) {
        if (err) {
            console.error("Error creating category", err);
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Category create failed' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            const okPacket = AMProto.buildPacket(AMProto.CMD_VAULT_CAT_CREATE_OK, 0, 0, JSON.stringify({ id: this.lastID }));
            ws.send(AMProto.obfuscate(okPacket));
        }
    });
};

exports.handleCatList = (ws, packet, clients, db) => {
    const userId = packet.senderId;

    db.all(`SELECT id, name_enc FROM vault_categories WHERE user_id = ? ORDER BY id`, [userId], (err, rows) => {
        if (err) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Category list failed' }));
            ws.send(AMProto.obfuscate(errPacket));
        } else {
            const okPacket = AMProto.buildPacket(AMProto.CMD_VAULT_CAT_LIST_OK, 0, 0, JSON.stringify({ categories: rows || [] }));
            ws.send(AMProto.obfuscate(okPacket));
        }
    });
};

exports.handleCatDelete = (ws, packet, clients, db) => {
    const payload = JSON.parse(packet.payloadString);
    const userId = packet.senderId;
    const { id } = payload;

    db.run(`DELETE FROM vault_categories WHERE id = ? AND user_id = ?`, [id, userId], function(err) {
        if (err) {
            const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Category delete failed' }));
            ws.send(AMProto.obfuscate(errPacket));
            return;
        }
        db.run(`UPDATE saved_messages SET category_id = NULL WHERE category_id = ? AND user_id = ?`, [id, userId], function(err2) {
            if (err2) {
                const errPacket = AMProto.buildPacket(AMProto.CMD_ERROR, 0, 0, JSON.stringify({ message: 'Category delete failed' }));
                ws.send(AMProto.obfuscate(errPacket));
                return;
            }
            const okPacket = AMProto.buildPacket(AMProto.CMD_VAULT_CAT_DELETE_OK, 0, 0, JSON.stringify({ id, deleted: this.changes > 0 }));
            ws.send(AMProto.obfuscate(okPacket));
        });
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
