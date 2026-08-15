import { state } from '../core/store.js';

export function getSession() {
    try {
        const s = localStorage.getItem('whispr_session');
        return s ? JSON.parse(s) : null;
    } catch (e) {
        return null;
    }
}

export function isPremium() {
    return !!(state.premiumUntil && state.premiumUntil > Date.now());
}

export function formatPremiumDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function b64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}

export function b64ToBytes(b64str) {
    const bin = atob(b64str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function authHeaders() {
    const s = getSession();
    return s ? { 'x-user': s.user, 'x-token': s.token } : {};
}

function updatePremiumUI() {
    const btn = document.getElementById('btn-premium');
    if (btn) {
        btn.classList.remove('premium');
        btn.title = 'Mensayo Plus (coming soon)';
    }
    const status = document.getElementById('premium-status');
    if (status) {
        status.textContent = "Mensayo Plus is coming soon! We're working on bigger file sharing limits and exclusive perks for you.";
        status.className = 'premium-status coming-soon';
    }
}

export function savePremium(premiumUntil, subscriptionToken) {
    state.premiumUntil = premiumUntil || 0;
    state.subscriptionToken = subscriptionToken || null;
    try {
        localStorage.setItem('whispr_premium', JSON.stringify({ premiumUntil: state.premiumUntil, subscriptionToken: state.subscriptionToken }));
    } catch (e) {}
    updatePremiumUI();
}

export function applyPremiumState(premiumUntil) {
    state.premiumUntil = premiumUntil || 0;
    try {
        const stored = JSON.parse(localStorage.getItem('whispr_premium') || '{}');
        state.subscriptionToken = stored.subscriptionToken || null;
    } catch (e) {}
    updatePremiumUI();
}

async function makeUserKey(token) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function userEnc(token, obj) {
    const key = await makeUserKey(token);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    const full = new Uint8Array(ct);
    return { iv: b64(iv), tag: b64(full.slice(full.length - 16)), ct: b64(full.slice(0, full.length - 16)) };
}

export async function userDec(token, env) {
    const key = await makeUserKey(token);
    const iv = b64ToBytes(env.iv);
    const ct = b64ToBytes(env.ct);
    const tag = b64ToBytes(env.tag);
    const combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct, 0);
    combined.set(tag, ct.length);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
    return JSON.parse(new TextDecoder().decode(plain));
}

async function apiPost(path, obj) {
    const resp = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(obj)
    });
    let body = null;
    try { body = await resp.json(); } catch (e) {}
    return { status: resp.status, body };
}

export async function refreshPremiumStatus() {
    try {
        const s = getSession();
        if (!s) return;
        const r = await apiPost('/api/premium/status', { user: s.user, token: s.token });
        if (r.status === 200 && r.body) {
            savePremium(r.body.premiumUntil || 0, r.body.subscriptionToken || null);
        }
    } catch (e) {}
}

async function submitPurchase() {
    const s = getSession();
    if (!s) return;
    const msg = document.getElementById('premium-msg');
    const btn = document.getElementById('btn-premium-pay');
    const planKey = state.selectedPlan || 'monthly';
    const cardholder = document.getElementById('premium-cardholder').value.trim();
    const cardNumber = document.getElementById('premium-card-number').value.trim();
    const expiry = document.getElementById('premium-expiry').value.trim();
    const cvv = document.getElementById('premium-cvv').value.trim();
    if (!cardholder || !cardNumber || !expiry || !cvv) {
        msg.textContent = 'Please fill in all card details.';
        return;
    }
    msg.textContent = 'Processing payment...';
    if (btn) btn.disabled = true;
    try {
        const enc = await userEnc(s.token, { plan: planKey, mock: { cardholder, cardNumber, expiry, cvv }, ts: Date.now() });
        const r = await apiPost('/api/premium/purchase', { user: s.user, token: s.token, enc });
        if (r.status === 200 && r.body && r.body.enc) {
            const dec = await userDec(s.token, r.body.enc);
            savePremium(dec.premiumUntil, dec.subscriptionToken);
            msg.textContent = `Payment approved! Mensayo Plus active until ${formatPremiumDate(dec.premiumUntil)}.`;
            msg.className = 'premium-msg ok';
            document.getElementById('premium-modal').style.display = 'none';
        } else if (r.status === 402) {
            msg.textContent = 'Payment failed: invalid card details.';
        } else if (r.body && r.body.error) {
            msg.textContent = r.body.error;
        } else {
            msg.textContent = 'Payment failed. Please try again.';
        }
    } catch (e) {
        console.error('purchase error:', e);
        msg.textContent = 'Payment failed. Please try again.';
    }
    if (btn) btn.disabled = false;
}

export function setupPremium() {
    const btn = document.getElementById('btn-premium');
    if (!btn) return;
    btn.onclick = () => {
        updatePremiumUI();
        document.getElementById('premium-modal').style.display = 'flex';
    };
    document.getElementById('btn-premium-close').onclick = () => {
        document.getElementById('premium-modal').style.display = 'none';
    };
    document.getElementById('btn-premium-cancel').onclick = () => {
        document.getElementById('premium-modal').style.display = 'none';
    };
    document.querySelectorAll('.premium-plan').forEach(card => {
        card.onclick = () => {
            state.selectedPlan = card.dataset.plan;
            document.querySelectorAll('.premium-plan').forEach(c => c.classList.toggle('selected', c === card));
        };
    });
    document.getElementById('btn-premium-pay').onclick = submitPurchase;
    const pm = document.getElementById('premium-modal');
    pm.addEventListener('click', (e) => { if (e.target === pm) pm.style.display = 'none'; });
}
