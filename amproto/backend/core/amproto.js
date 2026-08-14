/**
 * AM Proto 2.0
 * Security Upgrades: Obfuscation Layer and E2EE Preparation
 */
const crypto = require('crypto');

class AMProto {
    static CMD_AUTH = 0x01;
    static CMD_LOGIN = 0x02;
    static CMD_LOGIN_OK = 0x03;
    static CMD_DH_INIT = 0x04;
    static CMD_DH_REPLY = 0x05;
    static CMD_ENC_MSG = 0x06;
    static CMD_REGISTER = 0x07;
    static CMD_REGISTER_OK = 0x08;
    static CMD_TYPING = 0x09;
    static CMD_READ = 0x0A;
    static CMD_SYNC = 0x0B;
    static CMD_ERROR = 0x0C;
    static CMD_RESOLVE = 0x0D;
    static CMD_RESOLVE_OK = 0x0E;
    
    // Group commands
    static CMD_GROUP_CREATE = 0x10;
    static CMD_GROUP_CREATE_OK = 0x11;
    static CMD_GROUP_MSG = 0x13;
    static CMD_GROUP_MSG_RELAY = 0x14;
    static CMD_GROUP_INFO_OK = 0x16;
    static CMD_GROUP_READ = 0x19;
    static CMD_MSG_DELETE = 0x1A;
    
    // User commands
    static CMD_USER_UPDATE = 0x20;
    static CMD_USER_UPDATE_OK = 0x21;
    
    // Friend request commands
    static CMD_REQ_SEND = 0x22;
    static CMD_REQ_SEND_OK = 0x23;
    static CMD_REQ_RECEIVED = 0x24;
    static CMD_REQ_ACCEPT = 0x25;
    static CMD_REQ_DECLINE = 0x26;
    static CMD_REQ_ACCEPTED = 0x27;
    static CMD_REQ_DECLINED = 0x28;
    static CMD_REQ_LIST = 0x29;
    static CMD_REQ_LIST_OK = 0x2A;
    
    // WebRTC Signaling
    static CMD_RTC_CALL = 0x30;
    static CMD_RTC_ANSWER = 0x31;
    static CMD_RTC_REJECT = 0x32;
    static CMD_RTC_END = 0x33;
    static CMD_RTC_ICE = 0x34;

    // Vault Commands
    static CMD_VAULT_UPLOAD = 0x40;
    static CMD_VAULT_UPLOAD_OK = 0x41;
    static CMD_VAULT_LIST = 0x42;
    static CMD_VAULT_LIST_OK = 0x43;
    static CMD_VAULT_DOWNLOAD = 0x44;
    static CMD_VAULT_DOWNLOAD_OK = 0x45;
    
    // Link Previews
    static CMD_LINK_PREVIEW_REQ = 0x60;
    static CMD_LINK_PREVIEW_RES = 0x61;
    
    // Obfuscation Mask (Simple XOR to hide the header from DPI)
    // In production, this would be a dynamic AES-CTR stream like MTProto FakeTLS.
    static OBFUSCATION_KEY = 0xAB;

    /**
     * Builds a binary packet for AM Proto
     * Header (16 bytes):
     * [0] Version (1 byte)
     * [1] Command (1 byte)
     * [2-3] Payload Length (2 bytes, UInt16)
     * [4-7] Message ID (4 bytes, UInt32)
     * [8-11] Target Client ID (4 bytes, UInt32)
     * [12-15] Sender Client ID (4 bytes, UInt32)
     */
    static buildPacket(command, targetId, senderId, payload) {
        const version = 2; // Upgraded to v2
        const msgId = Math.floor(Math.random() * 0xFFFFFFFF);
        
        let payloadBuffer;
        if (Buffer.isBuffer(payload)) {
            payloadBuffer = payload;
        } else if (typeof payload === 'object') {
            payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf-8');
        } else {
            payloadBuffer = Buffer.from(payload, 'utf-8');
        }
        const payloadLength = payloadBuffer.length;

        // Allocate buffer: 16 bytes header + payload length
        const packet = Buffer.alloc(16 + payloadLength);

        packet.writeUInt8(version, 0);
        packet.writeUInt8(command, 1);
        packet.writeUInt16BE(payloadLength, 2);
        packet.writeUInt32BE(msgId, 4);
        packet.writeUInt32BE(targetId, 8); 
        packet.writeUInt32BE(senderId, 12); 

        payloadBuffer.copy(packet, 16);
        return packet;
    }

    /**
     * Parses an incoming binary packet
     */
    static parsePacket(buffer) {
        if (buffer.length < 16) {
            throw new Error("Packet too small to be valid AM Proto 2.0");
        }

        const version = buffer.readUInt8(0);
        const command = buffer.readUInt8(1);
        const payloadLength = buffer.readUInt16BE(2);
        const msgId = buffer.readUInt32BE(4);
        const targetId = buffer.readUInt32BE(8);
        const senderId = buffer.readUInt32BE(12);

        const payloadBuffer = buffer.slice(16, 16 + payloadLength);
        const payloadString = payloadBuffer.toString('utf-8');

        return { version, command, payloadLength, msgId, targetId, senderId, payloadString, rawPayload: payloadBuffer };
    }

    /**
     * Anti-DPI Obfuscation: XOR masks the entire packet
     * This ensures the packet looks like random noise to firewalls.
     */
    static obfuscate(buffer) {
        const obf = Buffer.alloc(buffer.length);
        for (let i = 0; i < buffer.length; i++) {
            obf[i] = buffer[i] ^ AMProto.OBFUSCATION_KEY;
        }
        // In reality, we'd also append random length padding here to hide traffic signatures.
        return obf;
    }

    /**
     * Anti-DPI Deobfuscation
     */
    static deobfuscate(buffer) {
        // XOR is symmetric
        return AMProto.obfuscate(buffer);
    }

    static encryptPayload(text, sharedSecret) {
        const iv = crypto.randomBytes(16);
        const key = crypto.createHash('sha256').update(sharedSecret).digest();
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf-8', 'hex');
        encrypted += cipher.final('hex');
        return { iv: iv.toString('hex'), encryptedData: encrypted };
    }

    static decryptPayload(encryptedPayload, sharedSecret) {
        const iv = Buffer.from(encryptedPayload.iv, 'hex');
        const key = crypto.createHash('sha256').update(sharedSecret).digest();
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedPayload.encryptedData, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        return decrypted;
    }
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AMProto;
}
if (typeof window !== 'undefined') {
    window.AMProto = AMProto;
}
