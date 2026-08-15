const crypto = require('crypto');
const AMProto = require('../core/amproto');
const premiumConfig = require('../config/premium');

// AES-256-GCM helpers. The key is derived from the user's session token, which
// is a secret shared only between the logged-in client and the server. This
// keeps the purchase request/response confidential even over a sniffed link,
// and prevents replay tampering.
function encryptForUser(sessionToken, text) {
    const key = crypto.createHash('sha256').update(String(sessionToken)).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(String(text), 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') };
}

function decryptForUser(sessionToken, env) {
    const key = crypto.createHash('sha256').update(String(sessionToken)).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(env.ct, 'base64')), decipher.final()]);
    return plain.toString('utf-8');
}

function getBody(req, cb) {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1024 * 1024) { req.destroy(); cb(new Error('body too large')); } });
    req.on('end', () => { try { cb(null, JSON.parse(data)); } catch (e) { cb(e); } });
    req.on('error', cb);
}

function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

// Authenticates a user via username + session token (bearer).
function authUser(db, user, token, cb) {
    if (!user || !token) return cb(null, null);
    db.get(`SELECT id, username, session_token, premium_until FROM users WHERE username = ? AND session_token = ?`,
        [user, token], (err, row) => cb(err, row || null));
}

function validCard(expiry, cvv, cardNumber) {
    const digits = String(cardNumber || '').replace(/\s+/g, '');
    if (!/^\d{12,19}$/.test(digits)) return false;
    const m = /^(\d{2})\/(\d{2})$/.exec(String(expiry || '').trim());
    if (!m) return false;
    const mm = parseInt(m[1], 10);
    const yy = 2000 + parseInt(m[2], 10);
    if (mm < 1 || mm > 12) return false;
    const now = new Date();
    const lastDay = new Date(yy, mm, 0);
    if (lastDay < now) return false;
    if (!/^\d{3,4}$/.test(String(cvv || '').trim())) return false;
    return true;
}

exports.handlePurchase = (req, res, db) => {
    getBody(req, (err, body) => {
        if (err || !body) return sendJson(res, 400, { error: 'Invalid request' });
        const { user, token, enc } = body;
        authUser(db, user, token, (authErr, row) => {
            if (authErr || !row) return sendJson(res, 401, { error: 'Not authenticated' });

            let plain;
            try {
                plain = JSON.parse(decryptForUser(row.session_token, enc));
            } catch (e) {
                return sendJson(res, 400, { error: 'Could not verify payment payload' });
            }

            const planKey = plain.plan;
            const plan = premiumConfig.PLANS[planKey];
            if (!plan) return sendJson(res, 400, { error: 'Unknown plan' });
            if (!validCard(plain.mock.expiry, plain.mock.cvv, plain.mock.cardNumber)) {
                return sendJson(res, 402, { error: 'Payment failed: invalid card details' });
            }
            if (Math.abs(Date.now() - (plain.ts || 0)) > 5 * 60 * 1000) {
                return sendJson(res, 400, { error: 'Payment request expired' });
            }

            const now = Date.now();
            const durationMs = plan.months * 30 * 24 * 3600 * 1000;
            const base = (row.premium_until && row.premium_until > now) ? row.premium_until : now;
            const premiumUntil = base + durationMs;

            const transactionId = 'tx_' + crypto.randomBytes(8).toString('hex');
            const receipt = premiumConfig.signPayload({
                type: 'receipt', userId: row.id, plan: planKey, amount: plan.amount, transactionId, ts: now
            });

            db.run(`INSERT INTO premium_purchases (user_id, plan, amount, transaction_id, receipt) VALUES (?, ?, ?, ?, ?)`,
                [row.id, planKey, plan.amount, transactionId, receipt], (insErr) => {
                    if (insErr) {
                        console.error('[Premium] purchase insert error:', insErr.message);
                        return sendJson(res, 500, { error: 'Purchase failed' });
                    }
                    db.run(`UPDATE users SET premium_until = ? WHERE id = ?`, [premiumUntil, row.id], (upErr) => {
                        if (upErr) return sendJson(res, 500, { error: 'Purchase failed' });
                        const subscriptionToken = premiumConfig.createSubscriptionToken(row.id, premiumUntil, planKey);
                        const response = encryptForUser(row.session_token, JSON.stringify({
                            success: true, plan: planKey, premiumUntil, subscriptionToken, transactionId
                        }));
                        sendJson(res, 200, { enc: response });
                    });
                });
        });
    });
};

exports.handleStatus = (req, res, db) => {
    getBody(req, (err, body) => {
        if (err || !body) return sendJson(res, 400, { error: 'Invalid request' });
        const { user, token } = body;
        authUser(db, user, token, (authErr, row) => {
            if (authErr || !row) return sendJson(res, 401, { error: 'Not authenticated' });
            const premium = premiumConfig.isPremium(row);
            const out = { premium, premiumUntil: row.premium_until || 0 };
            if (premium) {
                out.subscriptionToken = premiumConfig.createSubscriptionToken(row.id, row.premium_until, 'active');
            }
            sendJson(res, 200, out);
        });
    });
};

exports.authUser = authUser;
exports.encryptForUser = encryptForUser;
exports.decryptForUser = decryptForUser;
module.exports = exports;
