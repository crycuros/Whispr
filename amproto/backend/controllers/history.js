const AMProto = require('../core/amproto');
const friendsController = require('./friends');

const MAX_LIMIT = 50;
const MAX_RESPONSE_BYTES = 60000;

exports.handleGetChatHistory = (ws, packet, clients, db) => {
    let req;
    try {
        req = JSON.parse(packet.payloadString);
    } catch (e) {
        return;
    }

    const senderId = packet.senderId;
    const chatType = req.chatType;
    const chatId = req.chatId;
    const limit = Math.min(Math.max(parseInt(req.limit, 10) || 30, 1), MAX_LIMIT);
    const beforeId = parseInt(req.beforeId, 10) || 0;
    const beforeTime = parseInt(req.beforeTime, 10) || 0;

    const respond = (messages, hasMore) => {
        const res = AMProto.buildPacket(AMProto.CMD_CHAT_HISTORY_RES, senderId, 0, JSON.stringify({ chatType, chatId, messages, hasMore }));
        ws.send(AMProto.obfuscate(res));
    };

    const collect = (rows, mapRow) => {
        const messages = [];
        let totalBytes = 0;
        for (const r of rows) {
            if (messages.length >= limit) break;
            const m = mapRow(r);
            const len = JSON.stringify(m).length;
            if (totalBytes + len > MAX_RESPONSE_BYTES && messages.length > 0) break;
            totalBytes += len;
            messages.push(m);
        }
        messages.reverse();
        respond(messages, rows.length > messages.length);
    };

    if (chatType === 'group') {
        const gid = parseInt(chatId, 10);
        if (isNaN(gid)) return respond([], false);
        db.get(`SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?`, [gid, senderId], (err, row) => {
            if (err || !row) return respond([], false);
            const cursor = beforeId > 0 ? beforeId : Number.MAX_SAFE_INTEGER;
            db.all(
                `SELECT id, sender_id, text, sent_at FROM group_messages WHERE group_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
                [gid, cursor, limit + 1],
                (e2, rows) => {
                    if (e2) return respond([], false);
                    collect(rows, (r) => ({
                        id: r.id,
                        senderId: r.sender_id,
                        text: r.text,
                        sentAt: (r.sent_at || 0) * 1000
                    }));
                }
            );
        });
    } else if (chatType === 'dm') {
        const peerId = parseInt(chatId, 10);
        if (isNaN(peerId)) return respond([], false);
        friendsController.canMessage(db, senderId, peerId, (allowed) => {
            if (!allowed) return respond([], false);
            const where = [`((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`];
            const params = [senderId, peerId, peerId, senderId];
            if (beforeId > 0) { where.push(`id < ?`); params.push(beforeId); }
            if (beforeTime > 0) { where.push(`sent_at < ?`); params.push(beforeTime); }
            params.push(limit + 1);
            db.all(
                `SELECT id, sender_id, payload, sent_at FROM messages WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
                params,
                (e2, rows) => {
                    if (e2) return respond([], false);
                    collect(rows, (r) => ({
                        id: r.id,
                        senderId: r.sender_id,
                        payload: r.payload,
                        sentAt: r.sent_at || 0
                    }));
                }
            );
        });
    } else {
        respond([], false);
    }
};
