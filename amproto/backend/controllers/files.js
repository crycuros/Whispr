const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const premiumController = require('./premium');
const premiumConfig = require('../config/premium');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const TMP_DIR = path.join(UPLOAD_DIR, '.tmp');
const GCM_TAG = 16;

function ensureDirs() {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}
ensureDirs();

function getRawBody(req, cb) {
    const chunks = [];
    let size = 0;
    const MAX = 16 * 1024 * 1024;
    req.on('data', (c) => {
        size += c.length;
        if (size > MAX) { req.destroy(); return; }
        chunks.push(c);
    });
    req.on('end', () => cb(null, Buffer.concat(chunks)));
    req.on('error', cb);
}

function getBody(req, cb) {
    getRawBody(req, (err, buf) => {
        if (err) return cb(err);
        try { cb(null, JSON.parse(buf.toString('utf-8'))); } catch (e) { cb(e); }
    });
}

function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

function authHeaders(req, res, db, cb) {
    const user = req.headers['x-user'];
    const token = req.headers['x-token'];
    premiumController.authUser(db, user, token, (err, row) => {
        if (err || !row) {
            sendJson(res, 401, { error: 'Not authenticated' });
            return cb(null, null);
        }
        cb(null, row);
    });
}

// POST /api/upload/init  { name, size, mime, totalChunks, chunkSize, baseIV }
// Enforces the premium size limit SERVER-SIDE: 2GB free / 4GB Mensayo Plus.
exports.handleUploadInit = (req, res, db) => {
    getBody(req, (err, body) => {
        if (err || !body) return sendJson(res, 400, { error: 'Invalid request' });
        authHeaders(req, res, db, (authErr, row) => {
            if (!row) return;

            const size = Number(body.size);
            const chunkSize = Number(body.chunkSize);
            const totalChunks = Number(body.totalChunks);
            if (!size || !chunkSize || !totalChunks || !body.name || !body.baseIV) {
                return sendJson(res, 400, { error: 'Missing upload metadata' });
            }
            if (chunkSize < 64 * 1024 || chunkSize > 4 * 1024 * 1024) {
                return sendJson(res, 400, { error: 'Invalid chunk size' });
            }
            if (Math.ceil(size / chunkSize) !== totalChunks) {
                return sendJson(res, 400, { error: 'Chunk count mismatch' });
            }

            const premium = premiumConfig.isPremium(row);
            const limit = premiumConfig.fileLimit(premium);
            if (size > limit) {
                return sendJson(res, 413, {
                    error: `File too large. ${premium ? 'Premium' : 'Free'} limit is ${(limit / (1024 ** 3)).toFixed(0)} GB.`
                });
            }

            const uploadId = crypto.randomBytes(12).toString('hex');
            const tmpPath = path.join(TMP_DIR, uploadId + '.enc');
            fs.closeSync(fs.openSync(tmpPath, 'w'));

            const meta = { user_id: row.id, name: body.name, mime: body.mime || 'application/octet-stream', size, chunkSize, totalChunks, baseIV: body.baseIV, tmpPath };
            pendingUploads.set(uploadId, meta);

            sendJson(res, 200, { uploadId });
        });
    });
};

const pendingUploads = new Map();

// POST /api/upload/chunk/:uploadId/:index  (raw encrypted chunk body)
exports.handleUploadChunk = (req, res, db, uploadId, indexStr) => {
    const meta = pendingUploads.get(uploadId);
    if (!meta) return sendJson(res, 404, { error: 'Upload session not found' });
    authHeaders(req, res, db, (authErr, row) => {
        if (!row) return;
        if (row.id !== meta.user_id) return sendJson(res, 403, { error: 'Not allowed' });

        const index = Number(indexStr);
        if (index < 0 || index >= meta.totalChunks) return sendJson(res, 400, { error: 'Bad chunk index' });

        getRawBody(req, (err, buf) => {
            if (err) return sendJson(res, 400, { error: 'Chunk read failed' });
            const maxLen = meta.chunkSize + GCM_TAG + 64;
            if (buf.length === 0 || buf.length > maxLen) return sendJson(res, 400, { error: 'Bad chunk size' });

            const offset = index * (meta.chunkSize + GCM_TAG);
            fs.open(meta.tmpPath, 'r+', (openErr, fd) => {
                if (openErr) return sendJson(res, 500, { error: 'Chunk write failed' });
                fs.write(fd, buf, 0, buf.length, offset, (wErr) => {
                    fs.close(fd, () => {});
                    if (wErr) return sendJson(res, 500, { error: 'Chunk write failed' });
                    sendJson(res, 200, { ok: true, index });
                });
            });
        });
    });
};

// POST /api/upload/finish/:uploadId
exports.handleUploadFinish = (req, res, db, uploadId) => {
    const meta = pendingUploads.get(uploadId);
    if (!meta) return sendJson(res, 404, { error: 'Upload session not found' });
    authHeaders(req, res, db, (authErr, row) => {
        if (!row) return;
        if (row.id !== meta.user_id) return sendJson(res, 403, { error: 'Not allowed' });

        const expectedLen = (meta.totalChunks - 1) * (meta.chunkSize + GCM_TAG) + (meta.size - (meta.totalChunks - 1) * meta.chunkSize) + GCM_TAG;
        fs.stat(meta.tmpPath, (sErr, stat) => {
            if (sErr || stat.size !== expectedLen) {
                fs.unlink(meta.tmpPath, () => {});
                pendingUploads.delete(uploadId);
                return sendJson(res, 400, { error: 'Upload incomplete or corrupted' });
            }

            const fileId = crypto.randomBytes(8).toString('hex');
            const finalPath = path.join(UPLOAD_DIR, fileId + '.enc');
            fs.rename(meta.tmpPath, finalPath, (rErr) => {
                if (rErr) {
                    fs.copyFileSync(meta.tmpPath, finalPath);
                    fs.unlinkSync(meta.tmpPath);
                }
                pendingUploads.delete(uploadId);

                const metaJson = JSON.stringify({ size: meta.size, chunkSize: meta.chunkSize, totalChunks: meta.totalChunks, baseIV: meta.baseIV });
                db.run(`INSERT INTO files (owner_id, name, mime, size, total_chunks, chunk_size, base_iv, meta, stored_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [row.id, meta.name, meta.mime, meta.size, meta.totalChunks, meta.chunkSize, meta.baseIV, metaJson, finalPath],
                    function (insErr) {
                        if (insErr) {
                            console.error('[Files] insert error:', insErr.message);
                            return sendJson(res, 500, { error: 'Upload finalize failed' });
                        }
                        sendJson(res, 200, { fileId: this.lastID, name: meta.name, size: meta.size, mime: meta.mime });
                    });
            });
        });
    });
};

// GET /api/file/:id/meta
exports.handleFileMeta = (req, res, db, fileIdStr) => {
    authHeaders(req, res, db, (authErr, row) => {
        if (!row) return;
        const fileId = Number(fileIdStr);
        if (!fileId) return sendJson(res, 400, { error: 'Bad file id' });
        db.get(`SELECT id, owner_id, name, mime, size, total_chunks, chunk_size, base_iv, meta FROM files WHERE id = ?`, [fileId], (err, f) => {
            if (err || !f) return sendJson(res, 404, { error: 'File not found' });
            sendJson(res, 200, { id: f.id, name: f.name, mime: f.mime, size: f.size, totalChunks: f.total_chunks, chunkSize: f.chunk_size, baseIV: f.base_iv });
        });
    });
};

// GET /api/file/:id  — streams the ENCRYPTED bytes (client decrypts with its
// chat key). Supports Range to let the client fetch one ciphertext chunk at a
// time and keep memory bounded for multi-GB files.
exports.handleFileDownload = (req, res, db, fileIdStr) => {
    authHeaders(req, res, db, (authErr, row) => {
        if (!row) return;
        const fileId = Number(fileIdStr);
        if (!fileId) return sendJson(res, 400, { error: 'Bad file id' });
        db.get(`SELECT id, stored_path, size, total_chunks, chunk_size FROM files WHERE id = ?`, [fileId], (err, f) => {
            if (err || !f) return sendJson(res, 404, { error: 'File not found' });
            const totalEnc = (f.total_chunks - 1) * (f.chunk_size + GCM_TAG) + (f.size - (f.total_chunks - 1) * f.chunk_size) + GCM_TAG;

            const range = /bytes=(\d+)-(\d*)/.exec(req.headers['range'] || '');
            if (!range) {
                res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': totalEnc, 'Accept-Ranges': 'bytes' });
                fs.createReadStream(f.stored_path).pipe(res);
                return;
            }
            const start = parseInt(range[1], 10);
            const end = range[2] ? parseInt(range[2], 10) : totalEnc - 1;
            if (start >= totalEnc || end < start) {
                res.writeHead(416, { 'Content-Range': `bytes */${totalEnc}` });
                res.end();
                return;
            }
            const length = end - start + 1;
            res.writeHead(206, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': length,
                'Content-Range': `bytes ${start}-${end}/${totalEnc}`,
                'Accept-Ranges': 'bytes'
            });
            fs.createReadStream(f.stored_path, { start, end }).pipe(res);
        });
    });
};
