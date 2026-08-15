import { state } from './store.js';
import { buildPacket, obfuscate, deriveSharedSecret, encryptPayload, decryptPayload, CMD_IDENTITY_KEY_REQ, CMD_IDENTITY_KEY, CMD_GROUP_KEY_GET } from './amproto.js';

let idKeyResolve = null;
let gkResolve = null;

export function handleIdentityKeyRes(data) {
    if (idKeyResolve) { const r = idKeyResolve; idKeyResolve = null; r((data && data.keys) || {}); }
}
export function handleGroupKeyGetOk(data) {
    if (gkResolve) { const r = gkResolve; gkResolve = null; r(data); }
}

export async function ensureIdentityKeyPair() {
    if (state.identityKeyPair) return state.identityKeyPair;
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
    state.identityKeyPair = kp;
    return kp;
}

export async function exportIdentityPublicKey() {
    const kp = await ensureIdentityKeyPair();
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    return Array.from(new Uint8Array(pub));
}

export async function uploadIdentityKey() {
    const pub = await exportIdentityPublicKey();
    const pkt = buildPacket(CMD_IDENTITY_KEY, 0, state.myId, JSON.stringify({ publicKey: pub }));
    if (state.ws) state.ws.send(obfuscate(pkt));
}

export function requestIdentityKeys(userIds) {
    return new Promise((resolve) => {
        idKeyResolve = (data) => resolve(data || {});
        const pkt = buildPacket(CMD_IDENTITY_KEY_REQ, 0, state.myId, JSON.stringify({ userIds }));
        if (state.ws) state.ws.send(obfuscate(pkt));
        setTimeout(() => { if (idKeyResolve) { idKeyResolve = null; resolve({}); } }, 5000);
    });
}

export function fetchGroupKey(groupId) {
    return new Promise((resolve) => {
        gkResolve = (data) => resolve(data || null);
        const pkt = buildPacket(CMD_GROUP_KEY_GET, 0, state.myId, JSON.stringify({ groupId }));
        if (state.ws) state.ws.send(obfuscate(pkt));
        setTimeout(() => { if (gkResolve) { gkResolve = null; resolve(null); } }, 5000);
    });
}

export async function generateGroupKey() {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

async function encryptBytes(secretKey, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, secretKey, bytes);
    return { iv: Array.from(iv), ct: Array.from(new Uint8Array(ct)) };
}

async function decryptBytes(secretKey, env) {
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(env.iv) }, secretKey, new Uint8Array(env.ct));
    return new Uint8Array(dec);
}

export { encryptBytes, decryptBytes };

export async function wrapGroupKeyForMember(groupKey, memberPublicKeyBytes) {
    const peerKey = await crypto.subtle.importKey("raw", new Uint8Array(memberPublicKeyBytes), { name: "ECDH", namedCurve: "P-256" }, true, []);
    const secret = await deriveSharedSecret(state.identityKeyPair, peerKey);
    const raw = await crypto.subtle.exportKey("raw", groupKey);
    const { iv, ct } = await encryptBytes(secret, raw);
    return { iv, wrappedKey: ct };
}

export async function unwrapGroupKey(wrappedKeyObj, creatorPublicKeyBytes) {
    const creatorKey = await crypto.subtle.importKey("raw", new Uint8Array(creatorPublicKeyBytes), { name: "ECDH", namedCurve: "P-256" }, true, []);
    const secret = await deriveSharedSecret(state.identityKeyPair, creatorKey);
    const raw = await decryptBytes(secret, wrappedKeyObj);
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

export async function ensureGroupKey(chat) {
    if (chat.groupKey) return chat.groupKey;
    if (chat._keyPromise) return chat._keyPromise;
    chat._keyPromise = (async () => {
        try {
            const data = await fetchGroupKey(chat.groupId);
            if (data && data.wrappedKey) {
                chat.groupKey = await unwrapGroupKey({ iv: data.iv, ct: data.wrappedKey }, data.creatorPublicKey);
                chat.isEncrypted = true;
            }
        } catch (e) {
            chat.groupKey = null;
        }
        chat.groupKeyFetched = true;
        return chat.groupKey;
    })();
    return chat._keyPromise;
}

export async function encryptGroupText(groupKey, payloadObj) {
    const env = await encryptPayload(groupKey, JSON.stringify(payloadObj));
    return JSON.stringify({ v: 1, ...env });
}

export async function decryptGroupText(groupKey, wireText) {
    const plain = await decryptPayload(groupKey, JSON.parse(wireText));
    return JSON.parse(plain);
}
