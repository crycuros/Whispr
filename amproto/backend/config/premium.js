const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Server-only secret used to HMAC-sign subscription tokens and purchase
// receipts. It is generated on first boot and stored OUTSIDE the frontend
// folder, so it can never be downloaded by a client. Forging premium status
// would require this secret, which the server alone holds.
const SECRET_FILE = path.join(__dirname, '..', '..', '.premium_secret');

let secret = null;
function getSecret() {
    if (secret) return secret;
    try {
        secret = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
    } catch (e) {
        secret = crypto.randomBytes(48).toString('hex');
        fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    }
    return secret;
}

function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signPayload(payload) {
    const body = b64url(Buffer.from(JSON.stringify(payload)));
    const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64');
    return `${body}.${b64url(sig)}`;
}

function verifySigned(signed) {
    try {
        const [body, sig] = String(signed).split('.');
        if (!body || !sig) return null;
        const expected = b64url(crypto.createHmac('sha256', getSecret()).update(body).digest());
        if (sig !== expected) return null;
        return JSON.parse(Buffer.from(body, 'base64').toString('utf-8'));
    } catch (e) {
        return null;
    }
}

// Builds an HMAC-signed subscription token: { userId, premiumUntil, plan }.
// Any tampered token fails signature verification server-side.
function createSubscriptionToken(userId, premiumUntil, plan) {
    return signPayload({ v: 1, userId, premiumUntil, plan, ts: Date.now() });
}

function verifySubscriptionToken(token) {
    const payload = verifySigned(token);
    if (!payload) return null;
    if (!payload.premiumUntil || payload.premiumUntil < Date.now()) return null;
    return payload;
}

const PLANS = {
    monthly: { months: 1, amount: 149, label: 'Mensayo Plus Monthly' },
    yearly: { months: 12, amount: 1499, label: 'Mensayo Plus Yearly' }
};

function isPremium(row) {
    return !!(row && row.premium_until && row.premium_until > Date.now());
}

const FREE_LIMIT = 2 * 1024 * 1024 * 1024;      // 2 GB
const PREMIUM_LIMIT = 4 * 1024 * 1024 * 1024;   // 4 GB

function fileLimit(premium) {
    return premium ? PREMIUM_LIMIT : FREE_LIMIT;
}

module.exports = {
    getSecret,
    signPayload,
    verifySigned,
    createSubscriptionToken,
    verifySubscriptionToken,
    PLANS,
    isPremium,
    fileLimit,
    FREE_LIMIT,
    PREMIUM_LIMIT
};
