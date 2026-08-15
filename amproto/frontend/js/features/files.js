import { state } from '../core/store.js';
import { escapeHtml } from '../ui/chatList.js';
import { authHeaders, b64, b64ToBytes } from './premium.js';

const CHUNK_SIZE = 1024 * 1024;
const GCM_TAG = 16;

export function formatBytes(n) {
    if (n >= 1024 ** 3) return (n / (1024 ** 3)).toFixed(2) + ' GB';
    if (n >= 1024 ** 2) return (n / (1024 ** 2)).toFixed(2) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
}

function chatKey(chat) {
    return chat ? (chat.isGroup ? chat.groupKey : chat.sharedSecretKey) : null;
}

async function encryptChunk(key, plain, baseIV, index) {
    const iv = new Uint8Array(12);
    iv.set(baseIV, 0);
    new DataView(iv.buffer).setUint32(8, index, false);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    return new Uint8Array(ct);
}

async function decryptChunk(key, cipher, baseIV, index) {
    const iv = new Uint8Array(12);
    iv.set(baseIV, 0);
    new DataView(iv.buffer).setUint32(8, index, false);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return new Uint8Array(plain);
}

async function readSlice(file, start, end) {
    const buf = await file.slice(start, end).arrayBuffer();
    return new Uint8Array(buf);
}

function setProgress(uploadId, pct, label) {
    const row = document.querySelector(`.message-row[data-upload-id="${uploadId}"]`);
    if (!row) return;
    const fill = row.querySelector('.progress-fill');
    const lbl = row.querySelector('.progress-label');
    if (fill) fill.style.width = pct + '%';
    if (lbl) lbl.textContent = label;
}

export async function uploadFile(file) {
    const chat = state.chats.get(state.currentActiveChat);
    const key = chatKey(chat);
    if (!chat || !key) { alert('Start a secure chat to send files.'); return false; }
    if (file.size <= 0) { alert('Cannot send an empty file.'); return false; }

    const limit = (state.premiumUntil && state.premiumUntil > Date.now()) ? 4 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
    if (file.size > limit) {
        const tag = (state.premiumUntil && state.premiumUntil > Date.now()) ? 'Premium' : 'Free';
        alert(`File too large. ${tag} limit is ${limit / (1024 ** 3)} GB.`);
        return false;
    }

    const chunkSize = CHUNK_SIZE;
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
    const baseIV = crypto.getRandomValues(new Uint8Array(8));
    const baseIVB64 = b64(baseIV);

    const initRes = await fetch('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: file.name, size: file.size, mime: file.type || 'application/octet-stream', totalChunks, chunkSize, baseIV: baseIVB64 })
    });
    const init = await initRes.json();
    if (!initRes.ok || !init.uploadId) {
        alert((init && init.error) || 'Upload not allowed.');
        return false;
    }
    const uploadId = init.uploadId;

    const localId = 'upl_' + Date.now();
    const container = document.getElementById('messages');
    const row = document.createElement('div');
    row.className = 'message-row sent';
    row.dataset.uploadId = localId;
    row.innerHTML = `<div class="sent-group"><div class="bubble sent file-upload-progress"><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div><span class="progress-label">Uploading 0%</span></div></div>`;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;

    try {
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(file.size, start + chunkSize);
            const plain = await readSlice(file, start, end);
            const cipher = await encryptChunk(key, plain, baseIV, i);
            const cRes = await fetch(`/api/upload/chunk/${uploadId}/${i}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
                body: cipher
            });
            if (!cRes.ok) throw new Error('Chunk upload failed');
            const pct = Math.round(((i + 1) / totalChunks) * 100);
            setProgress(localId, pct, `Uploading ${formatBytes(end)} / ${formatBytes(file.size)} (${pct}%)`);
        }

        const fRes = await fetch(`/api/upload/finish/${uploadId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: '{}'
        });
        const fin = await fRes.json();
        if (!fRes.ok || !fin.fileId) throw new Error('Upload finalize failed');

        row.remove();
        if (window.sendMessageData) {
            await window.sendMessageData({ type: 'file', file: { fileId: fin.fileId, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', chunkSize, totalChunks, baseIV: baseIVB64 } });
        }
        return fin.fileId;
    } catch (e) {
        console.error('upload error:', e);
        row.remove();
        alert('Upload failed. Please try again.');
        return false;
    }
}

export async function downloadFile(msg, chat) {
    const file = msg.file;
    if (!file) return;
    const key = chatKey(chat);
    if (!key) { alert('Cannot decrypt: secure key missing.'); return; }
    try {
        const mRes = await fetch(`/api/file/${file.fileId}/meta`, { headers: { ...authHeaders() } });
        const meta = await mRes.json();
        if (!mRes.ok) { alert('File not found.'); return; }
        const chunkSize = meta.chunkSize || file.chunkSize;
        const totalChunks = meta.totalChunks || file.totalChunks;
        const baseIV = b64ToBytes(meta.baseIV);
        const parts = [];
        for (let i = 0; i < totalChunks; i++) {
            const plainLen = (i === totalChunks - 1) ? (meta.size - (totalChunks - 1) * chunkSize) : chunkSize;
            const start = i * (chunkSize + GCM_TAG);
            const end = start + plainLen + GCM_TAG - 1;
            const cRes = await fetch(`/api/file/${file.fileId}`, { headers: { ...authHeaders(), 'Range': `bytes=${start}-${end}` } });
            const cipher = new Uint8Array(await cRes.arrayBuffer());
            const plain = await decryptChunk(key, cipher, baseIV, i);
            parts.push(plain);
        }
        const blob = new Blob(parts, { type: meta.mime || file.mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name || 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
        console.error('download error:', e);
        alert('Download failed. The file may be corrupted.');
    }
}

export function fileBubbleHTML(file) {
    return `<div class="file-bubble">
        <div class="file-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div>
        <div class="file-info">
            <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
            <div class="file-size">${formatBytes(file.size)}</div>
        </div>
        <button class="file-download" data-file-id="${escapeHtml(String(file.fileId))}" title="Download"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>
    </div>`;
}

export function setupFileHandlers() {
    const attach = document.getElementById('btn-attach');
    const input = document.getElementById('file-input');
    if (attach && input) {
        attach.onclick = () => input.click();
        input.onchange = () => {
            const f = input.files && input.files[0];
            if (f) uploadFile(f);
            input.value = '';
        };
    }
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.file-download');
        if (!btn || !state.currentActiveChat) return;
        const chat = state.chats.get(state.currentActiveChat);
        if (!chat) return;
        const fileId = btn.dataset.fileId;
        const msg = chat.messages.find(m => m.file && String(m.file.fileId) === String(fileId));
        if (msg) downloadFile(msg, chat);
    });
}
