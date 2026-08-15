import { state } from '../core/store.js';
import * as AMProto from '../core/amproto.js';

const VAULT_SET_FLAG = 'whispr_vault_has_password';
const VAULT_CHECK_FLAG = 'whispr_vault_check';
const SALT = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88, 99, 10, 11, 12, 13, 14, 15, 16]); // Fixed salt for now
let vaultKey = null;
let savedItems = [];
let categories = [];
let savedCatFilter = null;
let pendingSave = null;

export function showVaultToast(message) {
    let t = document.getElementById('app-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'app-toast';
        document.body.appendChild(t);
    }
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

async function deriveKey(password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );
    return await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: SALT,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

async function encryptData(data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        vaultKey,
        data
    );
    
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return combined;
}

async function decryptData(encryptedBuffer) {
    const iv = encryptedBuffer.slice(0, 12);
    const data = encryptedBuffer.slice(12);
    return await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        vaultKey,
        data
    );
}

function bytesToB64(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
}

function b64ToBytes(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

export function isVaultUnlocked() {
    return !!vaultKey;
}

export async function encryptForVault(bytes) {
    const enc = await encryptData(bytes);
    return bytesToB64(enc);
}

export async function decryptFromVault(b64) {
    const dec = await decryptData(b64ToBytes(b64).buffer);
    return new Uint8Array(dec);
}

export function openVaultPanel() {
    const btnFiles = document.getElementById('btn-files');
    if (btnFiles) btnFiles.click();
    showVaultAuth();
}

function showVaultAuth() {
    const welcome = document.getElementById('vault-welcome');
    const lockedState = document.getElementById('vault-locked-state');
    const lockedText = document.getElementById('vault-locked-text');
    const setupLaterBtn = document.getElementById('btn-vault-setup-later');
    const authForm = document.getElementById('vault-auth-form');
    const pwdConfirm = document.getElementById('vault-password-confirm');
    const btnSet = document.getElementById('btn-set-vault');
    const btnUnlock = document.getElementById('btn-unlock-vault');
    if (!welcome || !authForm) return;
    if (localStorage.getItem(VAULT_SET_FLAG)) {
        welcome.style.display = 'none';
        lockedState.style.display = '';
        setupLaterBtn.style.display = 'none';
        lockedText.textContent = 'Enter your master password to unlock.';
        authForm.style.display = 'flex';
        pwdConfirm.style.display = 'none';
        btnSet.style.display = 'none';
        btnUnlock.style.display = '';
    } else {
        welcome.style.display = '';
        lockedState.style.display = 'none';
        authForm.style.display = 'none';
    }
}

function sendSavedSave(msgType, contentEnc, metaEnc) {
    const payload = JSON.stringify({ msgType, contentEnc, metaEnc, categoryId: savedCatFilter });
    if (payload.length > 65000) {
        alert('Message too large to save (limit reached).');
        return;
    }
    const packet = AMProto.buildPacket(AMProto.CMD_SAVED_SAVE, 0, state.myId, payload);
    if (state.ws) state.ws.send(AMProto.obfuscate(packet));
}

export function saveToVault(msgType, contentBytes, meta) {
    return new Promise((resolve) => {
        const doSave = async () => {
            try {
                const contentEnc = await encryptForVault(contentBytes);
                const metaEnc = await encryptForVault(new TextEncoder().encode(JSON.stringify(meta)));
                sendSavedSave(msgType, contentEnc, metaEnc);
                resolve(true);
            } catch (e) {
                console.error('vault save error:', e);
                resolve(false);
            }
        };
        if (vaultKey) {
            doSave();
            return;
        }
        pendingSave = { resolve, save: doSave };
        openVaultPanel();
        setTimeout(() => {
            if (localStorage.getItem(VAULT_SET_FLAG)) {
                const pwd = document.getElementById('vault-password');
                if (pwd) pwd.focus();
            } else {
                const create = document.getElementById('btn-vault-create');
                if (create) create.focus();
            }
        }, 50);
    });
}

export function loadSavedMessages() {
    if (!vaultKey || !state.myId) return;
    const packet = AMProto.buildPacket(AMProto.CMD_SAVED_LIST, 0, state.myId, JSON.stringify({}));
    if (state.ws) state.ws.send(AMProto.obfuscate(packet));
}

export function handleSavedSaveOk(payload) {
    loadSavedMessages();
}

export function handleSavedDeleteOk(payload) {
    savedItems = savedItems.filter(i => i.id !== payload.id);
    renderSavedList();
}

export async function handleSavedListOk(payload) {
    savedItems = [];
    for (const item of payload.items || []) {
        try {
            const metaB64 = item.meta_enc;
            let meta = { type: item.msg_type };
            if (metaB64) {
                const metaBytes = await decryptFromVault(metaB64);
                meta = JSON.parse(new TextDecoder().decode(metaBytes));
            }
            const entry = { id: item.id, meta, contentEnc: item.content_enc, createdAt: item.created_at, categoryId: item.category_id || null };
            if (meta.type === 'text' || meta.type === 'link') {
                const content = await loadSavedContent(entry);
                entry.text = content.text || '';
                entry.link = content.url || null;
            }
            savedItems.push(entry);
        } catch (e) {
            console.error('saved item decrypt error:', e);
        }
    }
    renderSavedList();
    loadCategories();
}

export async function loadSavedContent(item) {
    const bytes = await decryptFromVault(item.contentEnc);
    if (item.meta.type === 'text' || item.meta.type === 'link') {
        return JSON.parse(new TextDecoder().decode(bytes));
    }
    return bytes;
}

function formatSavedTime(createdAt) {
    if (!createdAt) return '';
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function savedVoiceHTML(item) {
    return `
        <div class="saved-item" data-saved-id="${item.id}">
            <div class="saved-item-meta">
                <span class="saved-badge">${escapeHtml(item.meta.type)}</span>
                ${savedCategoryBadge(item)}
                <span class="saved-source">${escapeHtml(item.meta.source || '')}</span>
                <span class="saved-time">${formatSavedTime(item.createdAt)}</span>
                <button type="button" class="saved-move" data-saved-id="${item.id}" title="Move to category">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                </button>
            </div>
            ${savedMoveMenuHTML()}
            <div class="saved-voice">
                <button class="play-btn saved-voice-play" data-saved-id="${item.id}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </button>
                <div class="waveform">
                    ${Array.from({ length: 24 }, (_, i) => `<span style="height:${6 + Math.abs(Math.sin(i * 0.7)) * 14}px;--i:${i}"></span>`).join('')}
                </div>
                <span class="duration">${Math.ceil(item.meta.duration || 0)}s</span>
            </div>
            <button class="saved-delete" data-saved-id="${item.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        </div>`;
}

function savedTextHTML(item) {
    return `
        <div class="saved-item" data-saved-id="${item.id}">
            <div class="saved-item-meta">
                <span class="saved-badge">${escapeHtml(item.meta.type)}</span>
                ${savedCategoryBadge(item)}
                <span class="saved-source">${escapeHtml(item.meta.source || '')}</span>
                <span class="saved-time">${formatSavedTime(item.createdAt)}</span>
                <button type="button" class="saved-move" data-saved-id="${item.id}" title="Move to category">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                </button>
            </div>
            ${savedMoveMenuHTML()}
            <div class="saved-text"></div>
            <button class="saved-delete" data-saved-id="${item.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        </div>`;
}

function savedFileHTML(item, name, sizeLabel) {
    return `
        <div class="saved-item" data-saved-id="${item.id}">
            <div class="saved-item-meta">
                <span class="saved-badge">${escapeHtml(item.meta.type)}</span>
                ${savedCategoryBadge(item)}
                <span class="saved-source">${escapeHtml(item.meta.source || '')}</span>
                <span class="saved-time">${formatSavedTime(item.createdAt)}</span>
                <button type="button" class="saved-move" data-saved-id="${item.id}" title="Move to category">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                </button>
            </div>
            ${savedMoveMenuHTML()}
            <div class="saved-file">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                <div class="saved-file-info">
                    <span class="saved-file-name">${escapeHtml(name)}</span>
                    <span class="saved-file-size">${sizeLabel}</span>
                </div>
                <button class="saved-file-dl" data-saved-id="${item.id}">Download</button>
            </div>
            <button class="saved-delete" data-saved-id="${item.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        </div>`;
}

function renderSavedList() {
    const list = document.getElementById('saved-list');
    if (!list) return;
    const search = (document.getElementById('saved-search') || {}).value || '';
    const q = search.trim().toLowerCase();
    list.innerHTML = '';

    const visible = savedItems.filter(i => {
        if (savedCatFilter !== null && i.categoryId !== savedCatFilter) return false;
        if (!q) return true;
        if ((i.meta.source || '').toLowerCase().includes(q)) return true;
        if ((i.meta.type || '').toLowerCase().includes(q)) return true;
        if ((i.meta.name || '').toLowerCase().includes(q)) return true;
        if ((i.text || '').toLowerCase().includes(q)) return true;
        return false;
    });

    if (visible.length === 0) {
        list.innerHTML = `<p style="color: var(--text-secondary); font-size: 13px; text-align: center; padding: 24px 0;">${savedItems.length === 0 ? 'No saved messages yet. Tap the save icon on any message to keep it here.' : 'No matches.'}</p>`;
        return;
    }

    for (const item of visible) {
        const type = item.meta.type;
        if (type === 'voice') {
            list.insertAdjacentHTML('beforeend', savedVoiceHTML(item));
        } else if (type === 'file') {
            const sizeLabel = item.meta.size ? (item.meta.size / 1024).toFixed(1) + ' KB' : '';
            list.insertAdjacentHTML('beforeend', savedFileHTML(item, item.meta.name || 'file', sizeLabel));
        } else {
            list.insertAdjacentHTML('beforeend', savedTextHTML(item));
        }
    }

    // fill text/link content
    for (const item of visible) {
        if (item.meta.type === 'text' || item.meta.type === 'link') {
            const el = list.querySelector(`.saved-item[data-saved-id="${item.id}"] .saved-text`);
            if (!el) continue;
            let html = escapeHtml(item.text || '');
            if (item.meta.type === 'link' && item.link) {
                html += `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener" style="color: var(--accent); font-size: 13px; display:block; margin-top:6px;">${escapeHtml(item.link)}</a>`;
            }
            el.innerHTML = html;
        }
    }
}

export function deleteSavedItem(id) {
    const packet = AMProto.buildPacket(AMProto.CMD_SAVED_DELETE, 0, state.myId, JSON.stringify({ id }));
    if (state.ws) state.ws.send(AMProto.obfuscate(packet));
}

export function loadCategories() {
    if (!vaultKey || !state.myId) return;
    const packet = AMProto.buildPacket(AMProto.CMD_VAULT_CAT_LIST, 0, state.myId, JSON.stringify({}));
    if (state.ws) state.ws.send(AMProto.obfuscate(packet));
}

export async function handleCatListOk(payload) {
    categories = [];
    for (const c of payload.categories || []) {
        try {
            const bytes = await decryptFromVault(c.name_enc);
            categories.push({ id: c.id, name: new TextDecoder().decode(bytes) });
        } catch (e) {
            console.error('category decrypt error:', e);
        }
    }
    if (!categories.some(c => c.id === savedCatFilter)) savedCatFilter = null;
    renderCategoryChips();
    renderSavedList();
}

export async function createCategory(name) {
    name = (name || '').trim();
    if (!name || !vaultKey) return;
    const nameEnc = await encryptForVault(new TextEncoder().encode(name.slice(0, 40)));
    const packet = AMProto.buildPacket(AMProto.CMD_VAULT_CAT_CREATE, 0, state.myId, JSON.stringify({ nameEnc }));
    if (state.ws) state.ws.send(AMProto.obfuscate(packet));
}

export function handleCatCreateOk(payload) {
    loadCategories();
}

export function handleCatDeleteOk(payload) {
    if (savedCatFilter === payload.id) savedCatFilter = null;
    loadCategories();
    loadSavedMessages();
}

export function deleteCategory(id) {
    const packet = AMProto.buildPacket(AMProto.CMD_VAULT_CAT_DELETE, 0, state.myId, JSON.stringify({ id }));
    if (state.ws) state.ws.send(AMProto.obfuscate(packet));
}

export function moveSavedItem(id, categoryId) {
    const packet = AMProto.buildPacket(AMProto.CMD_SAVED_MOVE, 0, state.myId, JSON.stringify({ id, categoryId: categoryId || null }));
    if (state.ws) state.ws.send(AMProto.obfuscate(packet));
}

export function handleSavedMoveOk(payload) {
    const item = savedItems.find(i => i.id === payload.id);
    if (item) item.categoryId = payload.categoryId || null;
    renderSavedList();
}

function renderCategoryChips() {
    const bar = document.getElementById('saved-categories');
    if (!bar) return;
    bar.innerHTML = '';

    const mkChip = (id, label, active, removable) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'saved-cat-chip' + (active ? ' active' : '');
        chip.dataset.catId = id;
        const span = document.createElement('span');
        span.textContent = label;
        chip.appendChild(span);
        if (removable) {
            const x = document.createElement('span');
            x.className = 'saved-cat-remove';
            x.textContent = '\u00d7';
            x.onclick = (e) => { e.stopPropagation(); deleteCategory(id); };
            chip.appendChild(x);
        }
        chip.onclick = () => {
            savedCatFilter = (id === '') ? null : id;
            renderCategoryChips();
            renderSavedList();
        };
        return chip;
    };

    bar.appendChild(mkChip('', 'All', savedCatFilter === null, false));
    for (const c of categories) {
        bar.appendChild(mkChip(c.id, c.name, savedCatFilter === c.id, true));
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'saved-cat-add';
    add.textContent = '+';
    add.title = 'New category';
    add.onclick = () => {
        const input = document.getElementById('new-cat-input');
        if (input) {
            input.style.display = 'block';
            input.focus();
        }
    };
    bar.appendChild(add);
}

function setupNewCategoryInput() {
    const input = document.getElementById('new-cat-input');
    if (!input) return;
    const submit = () => {
        const name = input.value.trim();
        if (name) createCategory(name);
        input.value = '';
        input.style.display = 'none';
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        else if (e.key === 'Escape') { input.value = ''; input.style.display = 'none'; }
    });
    input.addEventListener('blur', () => {
        if (input.value.trim()) submit();
        else input.style.display = 'none';
    });
}

function savedCategoryBadge(item) {
    const cat = categories.find(c => c.id === item.categoryId);
    return cat ? `<span class="saved-cat-badge">${escapeHtml(cat.name)}</span>` : '';
}

function savedMoveMenuHTML() {
    let opts = '<button type="button" class="saved-move-item" data-cat-id="">No folder</button>';
    for (const c of categories) {
        opts += `<button type="button" class="saved-move-item" data-cat-id="${c.id}">${escapeHtml(c.name)}</button>`;
    }
    return `<div class="saved-move-menu">${opts}</div>`;
}

let savedAudioCtx = null;
async function playSavedVoice(item) {
    const bytes = await decryptFromVault(item.contentEnc);
    const mime = item.meta.mime || 'audio/webm';
    const blob = new Blob([bytes.buffer], { type: mime });
    const url = URL.createObjectURL(blob);

    if (!savedAudioCtx) savedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = savedAudioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const resp = await fetch(url);
    const ab = await resp.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(ab);
    const bars = document.querySelector(`.saved-item[data-saved-id="${item.id}"] .waveform span`);
    if (bars) {
        const data = audioBuf.getChannelData(0);
        const heights = [];
        const step = Math.floor(data.length / 24);
        const rmsArr = [];
        for (let i = 0; i < 24; i++) {
            const start = i * step;
            const end = (i === 23) ? data.length : start + step;
            let sum = 0, count = 0;
            for (let j = start; j < end; j += 8) { sum += Math.abs(data[j]); count++; }
            rmsArr.push(count ? sum / count : 0);
        }
        const maxRms = Math.max(...rmsArr);
        rmsArr.forEach((r, i) => {
            const v = maxRms > 0.001 ? (r / maxRms) * 24 : r * 160;
            const el = document.querySelector(`.saved-item[data-saved-id="${item.id}"] .waveform span:nth-child(${i + 1})`);
            if (el) el.style.height = Math.round(Math.max(3, Math.min(24, v))) + 'px';
        });
    }

    const audio = new Audio(url);
    const bubble = document.querySelector(`.saved-item[data-saved-id="${item.id}"] .saved-voice`);
    const setPlaying = (on) => {
        if (bubble) bubble.classList.toggle('playing', on);
    };
    audio.onended = () => setPlaying(false);
    audio.onpause = () => setPlaying(false);
    audio.onplay = () => setPlaying(true);
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
}

function initVaultUI() {
    const btnUnlock = document.getElementById('btn-unlock-vault');
    const btnSet = document.getElementById('btn-set-vault');
    const pwdInput = document.getElementById('vault-password');
    const pwdConfirm = document.getElementById('vault-password-confirm');
    const authArea = document.getElementById('vault-auth');
    const welcome = document.getElementById('vault-welcome');
    const lockedState = document.getElementById('vault-locked-state');
    const lockedText = document.getElementById('vault-locked-text');
    const setupLaterBtn = document.getElementById('btn-vault-setup-later');
    const authForm = document.getElementById('vault-auth-form');
    const btnCreate = document.getElementById('btn-vault-create');
    const btnLater = document.getElementById('btn-vault-later');
    const unlockedState = document.getElementById('vault-unlocked-state');
    const uploadInput = document.getElementById('vault-upload-input');

    const hasPassword = () => !!localStorage.getItem(VAULT_SET_FLAG);

    const showSetupForm = () => {
        welcome.style.display = 'none';
        lockedState.style.display = 'none';
        authForm.style.display = 'flex';
        pwdConfirm.style.display = '';
        btnSet.style.display = '';
        btnUnlock.style.display = 'none';
        pwdInput.focus();
    };

    const abortPendingSave = () => {
        const p = pendingSave; pendingSave = null;
        if (p) p.resolve(false);
    };

    if (btnCreate) {
        btnCreate.onclick = () => showSetupForm();
    }
    if (btnLater) {
        btnLater.onclick = () => {
            welcome.style.display = 'none';
            lockedState.style.display = '';
            setupLaterBtn.style.display = '';
            lockedText.textContent = 'No vault yet. You can set one up anytime from here.';
            abortPendingSave();
        };
    }
    if (setupLaterBtn) {
        setupLaterBtn.onclick = () => showSetupForm();
    }

    const doUnlock = () => {
        authArea.style.display = 'none';
        unlockedState.style.display = 'block';
        loadVaultFiles();
        loadSavedMessages();
        loadCategories();
        const p = pendingSave; pendingSave = null;
        if (p) p.save();
    };

    const validateUnlock = async (password) => {
        vaultKey = await deriveKey(password);
        const checkB64 = localStorage.getItem(VAULT_CHECK_FLAG);
        if (!checkB64) return true;
        try {
            await decryptData(b64ToBytes(checkB64).buffer);
            return true;
        } catch (e) {
            vaultKey = null;
            return false;
        }
    };

    if (btnSet) {
        btnSet.onclick = async () => {
            if (!pwdInput.value) return;
            if (pwdInput.value.length < 4) { alert('Password must be at least 4 characters.'); return; }
            if (pwdInput.value !== pwdConfirm.value) { alert('Passwords do not match.'); return; }
            localStorage.setItem(VAULT_SET_FLAG, '1');
            vaultKey = await deriveKey(pwdInput.value);
            const check = await encryptData(new TextEncoder().encode('vault-check'));
            localStorage.setItem(VAULT_CHECK_FLAG, bytesToB64(check));
            doUnlock();
        };
    }

    if (btnUnlock) {
        btnUnlock.onclick = async () => {
            if (!pwdInput.value) return;
            const ok = await validateUnlock(pwdInput.value);
            if (!ok) {
                showVaultToast('Incorrect password');
                return;
            }
            doUnlock();
        };
    }

    showVaultAuth();
    setupNewCategoryInput();

    if (uploadInput) {
        uploadInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file || !vaultKey) return;
            
            const arrayBuffer = await file.arrayBuffer();
            
            const encName = await encryptData(new TextEncoder().encode(file.name));
            const encMime = await encryptData(new TextEncoder().encode(file.type));
            const encData = await encryptData(arrayBuffer);
            
            const encNameBase64 = bytesToB64(new Uint8Array(encName));
            const encMimeBase64 = bytesToB64(new Uint8Array(encMime));
            const encDataBase64 = bytesToB64(new Uint8Array(encData));
            
            const payload = JSON.stringify({
                encName: encNameBase64,
                encMime: encMimeBase64,
                size: file.size,
                encData: encDataBase64
            });
            
            const packet = AMProto.buildPacket(AMProto.CMD_VAULT_UPLOAD, 0, state.myId, payload);
            if (state.ws) state.ws.send(AMProto.obfuscate(packet));
        };
    }

    const tabFiles = document.getElementById('vault-tab-files');
    const tabSaved = document.getElementById('vault-tab-saved');
    const filesSection = document.getElementById('vault-files-section');
    const savedSection = document.getElementById('vault-saved-section');
    if (tabFiles && tabSaved) {
        const switchTab = (which) => {
            tabFiles.classList.toggle('active', which === 'files');
            tabSaved.classList.toggle('active', which === 'saved');
            filesSection.style.display = which === 'files' ? 'block' : 'none';
            savedSection.style.display = which === 'saved' ? 'block' : 'none';
            if (which === 'saved') loadSavedMessages();
        };
        tabFiles.onclick = () => switchTab('files');
        tabSaved.onclick = () => switchTab('saved');
    }

    const searchInput = document.getElementById('saved-search');
    if (searchInput) {
        searchInput.oninput = () => renderSavedList();
    }

    document.addEventListener('click', async (e) => {
        const closeMoveMenus = () => {
            document.querySelectorAll('.saved-item .saved-move-menu.show').forEach(m => m.classList.remove('show'));
        };
        const moveBtn = e.target.closest('.saved-move');
        if (moveBtn) {
            e.stopPropagation();
            closeMoveMenus();
            const menu = moveBtn.closest('.saved-item').querySelector('.saved-move-menu');
            if (menu) menu.classList.add('show');
            return;
        }
        const moveItem = e.target.closest('.saved-move-item');
        if (moveItem) {
            e.stopPropagation();
            const itemEl = moveItem.closest('.saved-item');
            moveSavedItem(Number(itemEl.dataset.savedId), moveItem.dataset.catId === '' ? null : Number(moveItem.dataset.catId));
            closeMoveMenus();
            return;
        }
        if (!e.target.closest('.saved-move-menu')) closeMoveMenus();

        const delBtn = e.target.closest('.saved-delete');
        if (delBtn) {
            deleteSavedItem(Number(delBtn.dataset.savedId));
            return;
        }
        const playBtn = e.target.closest('.saved-voice-play');
        if (playBtn) {
            const item = savedItems.find(i => i.id === Number(playBtn.dataset.savedId));
            if (item) playSavedVoice(item);
            return;
        }
        const dlBtn = e.target.closest('.saved-file-dl');
        if (dlBtn) {
            const item = savedItems.find(i => i.id === Number(dlBtn.dataset.savedId));
            if (!item) return;
            const bytes = await decryptFromVault(item.contentEnc);
            const blob = new Blob([bytes.buffer], { type: item.meta.mime || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = item.meta.name || 'saved-file';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return;
        }
    });
}

export function handleVaultUploadOk(payload) {
    loadVaultFiles();
}

export function loadVaultFiles() {
    if (!vaultKey || !state.myId) return;
    const packet = AMProto.buildPacket(AMProto.CMD_VAULT_LIST, 0, state.myId, JSON.stringify({}));
    if (state.ws) state.ws.send(AMProto.obfuscate(packet));
}

export async function handleVaultListOk(payload) {
    const list = document.getElementById('vault-file-list');
    list.innerHTML = '';
    
    for (const f of payload.files) {
        const nameBytes = b64ToBytes(f.filename_enc);
        const decryptedName = new TextDecoder().decode(await decryptData(nameBytes.buffer));
        
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.background = 'var(--bg-secondary)';
        div.style.padding = '8px';
        div.style.borderRadius = '4px';
        
        div.innerHTML = `
            <span style="color:var(--text-primary); font-size:14px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(decryptedName)}</span>
            <button class="btn-primary" style="padding:4px 8px; font-size:12px;">Download</button>
        `;
        
        div.querySelector('button').onclick = () => {
            const packet = AMProto.buildPacket(AMProto.CMD_VAULT_DOWNLOAD, 0, state.myId, JSON.stringify({ id: f.id }));
            if (state.ws) state.ws.send(AMProto.obfuscate(packet));
        };
        
        list.appendChild(div);
    }
}

export async function handleVaultDownloadOk(payload) {
    const { encName, encMime, encData } = payload;
    
    const encDataBytes = b64ToBytes(encData);
    const decData = await decryptData(encDataBytes.buffer);
    
    const nameBytes = b64ToBytes(encName);
    const decryptedName = new TextDecoder().decode(await decryptData(nameBytes.buffer));

    const mimeBytes = b64ToBytes(encMime);
    const decryptedMime = new TextDecoder().decode(await decryptData(mimeBytes.buffer));
    
    const decBlob = new Blob([decData], { type: decryptedMime });
    const url = URL.createObjectURL(decBlob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = decryptedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(unsafe) {
    return (unsafe || '').toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

document.addEventListener('DOMContentLoaded', initVaultUI);
