export const OBFUSCATION_KEY = 0xAB;
export const CMD_AUTH = 0x01;
export const CMD_LOGIN = 0x02;
export const CMD_LOGIN_OK = 0x03;
export const CMD_DH_INIT = 0x04;
export const CMD_DH_REPLY = 0x05;
export const CMD_ENC_MSG = 0x06;
export const CMD_REGISTER = 0x07;
export const CMD_REGISTER_OK = 0x08;
export const CMD_TYPING = 0x09;
export const CMD_READ = 0x0A;
export const CMD_SYNC = 0x0B;
export const CMD_ERROR = 0x0C;
export const CMD_RESOLVE = 0x0D;
export const CMD_RESOLVE_OK = 0x0E;
export const CMD_GROUP_CREATE = 0x10;
export const CMD_GROUP_CREATE_OK = 0x11;
export const CMD_GROUP_MSG = 0x13;
export const CMD_GROUP_MSG_RELAY = 0x14;
export const CMD_GROUP_INFO_OK = 0x16;
export const CMD_GROUP_READ = 0x19;
export const CMD_MSG_DELETE = 0x1A;
export const CMD_PRESENCE = 0x1B;

// E2E group encryption
export const CMD_IDENTITY_KEY = 0x1C;
export const CMD_IDENTITY_KEY_REQ = 0x1D;
export const CMD_IDENTITY_KEY_RES = 0x1E;
export const CMD_GROUP_KEY_GET = 0x1F;
export const CMD_GROUP_KEY_GET_OK = 0x12;
export const CMD_USER_UPDATE = 0x20;
export const CMD_USER_UPDATE_OK = 0x21;

// Friend request commands
export const CMD_REQ_SEND = 0x22;
export const CMD_REQ_SEND_OK = 0x23;
export const CMD_REQ_RECEIVED = 0x24;
export const CMD_REQ_ACCEPT = 0x25;
export const CMD_REQ_DECLINE = 0x26;
export const CMD_REQ_ACCEPTED = 0x27;
export const CMD_REQ_DECLINED = 0x28;
export const CMD_REQ_LIST = 0x29;
export const CMD_REQ_LIST_OK = 0x2A;

// WebRTC Signaling
export const CMD_RTC_CALL = 0x30;
export const CMD_RTC_ANSWER = 0x31;
export const CMD_RTC_REJECT = 0x32;
export const CMD_RTC_END = 0x33;
export const CMD_RTC_ICE = 0x34;

// Vault Commands
export const CMD_VAULT_UPLOAD = 0x40;
export const CMD_VAULT_UPLOAD_OK = 0x41;
export const CMD_VAULT_LIST = 0x42;
export const CMD_VAULT_LIST_OK = 0x43;
export const CMD_VAULT_DOWNLOAD = 0x44;
export const CMD_VAULT_DOWNLOAD_OK = 0x45;

// Saved Messages Commands
export const CMD_SAVED_SAVE = 0x4A;
export const CMD_SAVED_SAVE_OK = 0x4B;
export const CMD_SAVED_LIST = 0x4C;
export const CMD_SAVED_LIST_OK = 0x4D;
export const CMD_SAVED_DELETE = 0x4E;
export const CMD_SAVED_DELETE_OK = 0x4F;

// Vault Category Commands
export const CMD_VAULT_CAT_CREATE = 0x50;
export const CMD_VAULT_CAT_CREATE_OK = 0x51;
export const CMD_VAULT_CAT_LIST = 0x52;
export const CMD_VAULT_CAT_LIST_OK = 0x53;
export const CMD_VAULT_CAT_DELETE = 0x54;
export const CMD_VAULT_CAT_DELETE_OK = 0x55;
export const CMD_SAVED_MOVE = 0x56;
export const CMD_SAVED_MOVE_OK = 0x57;

// Voice Message Commands
export const CMD_VOICE_UPLOAD = 0x46;
export const CMD_VOICE_UPLOAD_OK = 0x47;
export const CMD_VOICE_GET = 0x48;
export const CMD_VOICE_GET_OK = 0x49;

export const CMD_LINK_PREVIEW_REQ = 0x60;
export const CMD_LINK_PREVIEW_RES = 0x61;

export const CMD_GET_CHAT_HISTORY = 0x62;
export const CMD_CHAT_HISTORY_RES = 0x63;

export function buildPacket(command, target, sender, payloadString) {
    const payloadBuffer = new TextEncoder().encode(payloadString);
    const payloadLength = payloadBuffer.length;
    const buffer = new ArrayBuffer(16 + payloadLength);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    view.setUint8(0, 2);
    view.setUint8(1, command);
    view.setUint16(2, payloadLength, false);
    view.setUint32(4, Math.floor(Math.random() * 0xFFFFFFFF), false);
    view.setUint32(8, target, false);
    view.setUint32(12, sender, false);

    u8.set(payloadBuffer, 16);
    return u8;
}
export function parsePacket(u8) {
    const view = new DataView(u8.buffer);
    return {
        command: view.getUint8(1),
        targetId: view.getUint32(8, false),
        senderId: view.getUint32(12, false),
        payloadString: new TextDecoder().decode(u8.slice(16))
    };
}
export function obfuscate(u8) {
    const obf = new Uint8Array(u8.length);
    for (let i = 0; i < u8.length; i++) obf[i] = u8[i] ^ OBFUSCATION_KEY;
    return obf;
}
export function deobfuscate(u8) { return obfuscate(u8); }

export async function sha256(str) {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function deriveSharedSecret(keyPair, peerPublicKey) {
    return await crypto.subtle.deriveKey(
        { name: "ECDH", public: peerPublicKey },
        keyPair.privateKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}
export async function encryptPayload(secretKey, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, secretKey, encoded);
    return { iv: Array.from(iv), encryptedData: Array.from(new Uint8Array(cipher)) };
}
export async function decryptPayload(secretKey, payload) {
    const iv = new Uint8Array(payload.iv);
    const cipher = new Uint8Array(payload.encryptedData);
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, secretKey, cipher);
    return new TextDecoder().decode(dec);
}
