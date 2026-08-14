import { state } from '../core/store.js';
import * as AMProto from '../core/amproto.js';

const SALT = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88, 99, 10, 11, 12, 13, 14, 15, 16]); // Fixed salt for now
let vaultKey = null;

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

function initVaultUI() {
    const btnUnlock = document.getElementById('btn-unlock-vault');
    const pwdInput = document.getElementById('vault-password');
    const lockedState = document.getElementById('vault-locked-state');
    const unlockedState = document.getElementById('vault-unlocked-state');
    const uploadInput = document.getElementById('vault-upload-input');

    if (btnUnlock) {
        btnUnlock.onclick = async () => {
            if (!pwdInput.value) return;
            vaultKey = await deriveKey(pwdInput.value);
            lockedState.style.display = 'none';
            pwdInput.parentElement.style.display = 'none';
            unlockedState.style.display = 'block';
            loadVaultFiles();
        };
    }

    if (uploadInput) {
        uploadInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file || !vaultKey) return;
            
            const arrayBuffer = await file.arrayBuffer();
            
            const encName = await encryptData(new TextEncoder().encode(file.name));
            const encMime = await encryptData(new TextEncoder().encode(file.type));
            const encData = await encryptData(arrayBuffer);
            
            const encNameBase64 = btoa(String.fromCharCode(...new Uint8Array(encName)));
            const encMimeBase64 = btoa(String.fromCharCode(...new Uint8Array(encMime)));
            const encDataBase64 = btoa(String.fromCharCode(...new Uint8Array(encData)));
            
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
        const nameBytes = Uint8Array.from(atob(f.filename_enc), c => c.charCodeAt(0));
        const decryptedName = new TextDecoder().decode(await decryptData(nameBytes));
        
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
    
    const encDataBytes = Uint8Array.from(atob(encData), c => c.charCodeAt(0));
    const decData = await decryptData(encDataBytes.buffer);
    
    const nameBytes = Uint8Array.from(atob(encName), c => c.charCodeAt(0));
    const decryptedName = new TextDecoder().decode(await decryptData(nameBytes));

    const mimeBytes = Uint8Array.from(atob(encMime), c => c.charCodeAt(0));
    const decryptedMime = new TextDecoder().decode(await decryptData(mimeBytes));
    
    const decBlob = new Blob([decData], { type: decryptedMime });
    const url = URL.createObjectURL(decBlob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = decryptedName;
    a.click();
    URL.revokeObjectURL(url);
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
