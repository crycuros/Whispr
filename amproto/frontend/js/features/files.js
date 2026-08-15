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

async function generateThumbnail(file) {
    return new Promise((resolve) => {
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return resolve(null);
        const url = URL.createObjectURL(file);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_SIZE = 350;

        const processFrame = (videoOrImg) => {
            let w = videoOrImg.videoWidth || videoOrImg.naturalWidth || MAX_SIZE;
            let h = videoOrImg.videoHeight || videoOrImg.naturalHeight || MAX_SIZE;
            if (w > MAX_SIZE || h > MAX_SIZE) {
                if (w > h) { h = Math.floor(h * (MAX_SIZE / w)); w = MAX_SIZE; }
                else { w = Math.floor(w * (MAX_SIZE / h)); h = MAX_SIZE; }
            }
            canvas.width = w; canvas.height = h;
            ctx.drawImage(videoOrImg, 0, 0, w, h);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.6));
        };

        if (file.type.startsWith('image/')) {
            const img = new Image();
            img.onload = () => processFrame(img);
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        } else {
            const vid = document.createElement('video');
            vid.muted = true; vid.playsInline = true;
            vid.onloadeddata = () => {
                vid.currentTime = Math.min(1, vid.duration / 2);
            };
            vid.onseeked = () => processFrame(vid);
            vid.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            vid.src = url;
        }
    });
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

    const thumbnail = await generateThumbnail(file);
    const chunkSize = CHUNK_SIZE;
    const localId = 'up_' + Date.now();
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
            await window.sendMessageData({ type: 'file', file: { fileId: fin.fileId, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', chunkSize, totalChunks, baseIV: baseIVB64, thumbnail } });
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
        const mimeType = meta.mime || file.mime || '';
        
        if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
            openMediaViewer(url, mimeType, file.name);
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name || 'download';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
    } catch (e) {
        console.error('download error:', e);
        alert('Download failed.');
    }
}

function openMediaViewer(url, mimeType, filename) {
    let modal = document.getElementById('media-viewer-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'media-viewer-modal';
        modal.className = 'modal-overlay media-viewer';
        modal.innerHTML = `
            <div class="media-viewer-content" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,0,0,0.9); position:relative;">
                <button class="icon-btn close-btn" style="position:absolute; top:20px; right:20px; color:white; z-index:100; background:rgba(255,255,255,0.2); padding:8px; border-radius:50%;" onclick="const p = this.closest('.modal-overlay'); const v = p.querySelector('video'); if(v) v.pause(); p.remove();">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
                <div id="media-viewer-container" style="max-width:90%; max-height:80vh; display:flex; justify-content:center; align-items:center;"></div>
                <a id="media-download-btn" class="primary-btn" style="position:absolute; bottom:30px; z-index:100; text-decoration:none;" download>Download Original</a>
            </div>
        `;
        document.body.appendChild(modal);
    }
    const container = document.getElementById('media-viewer-container');
    const dlBtn = document.getElementById('media-download-btn');
    dlBtn.href = url;
    dlBtn.download = filename || 'media';
    
    if (mimeType.startsWith('image/')) {
        container.innerHTML = `<img src="${url}" class="media-full" style="max-width:100%; max-height:80vh; object-fit:contain;">`;
    } else {
        container.innerHTML = `<video src="${url}" class="media-full" style="max-width:100%; max-height:80vh;" controls autoplay playsinline></video>`;
    }
}

export function fileBubbleHTML(file) {
    if (file.thumbnail) {
        const isVideo = file.mime && file.mime.startsWith('video/');
        const playIcon = isVideo ? `<div class="play-icon-overlay" style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.5); border-radius:50%; padding:12px; display:flex;"><svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>` : '';
        return `<div class="file-preview-bubble" data-file-id="${escapeHtml(String(file.fileId))}" title="Click to view" style="position:relative; cursor:pointer; overflow:hidden; display:inline-block;">
            <img src="${file.thumbnail}" class="file-thumbnail" style="max-width: 350px; max-height: 400px; width: auto; height: auto; border-radius: var(--bubble-radius);">
            ${playIcon}
        </div>`;
    }
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
        const btn = e.target.closest('.file-download') || e.target.closest('.file-preview-bubble');
        if (!btn || !state.currentActiveChat) return;
        const chat = state.chats.get(state.currentActiveChat);
        if (!chat) return;
        const fileId = btn.dataset.fileId;
        const msg = chat.messages.find(m => m.file && String(m.file.fileId) === String(fileId));
        if (msg) downloadFile(msg, chat);
    });
}
