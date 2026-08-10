/**
 * AM Proto 2.0
 * Security Upgrades: Obfuscation Layer and E2EE Preparation
 */
const crypto = require('crypto');

class AMProto {
    static CMD_AUTH = 0x01;
    static CMD_DH_INIT = 0x04;
    static CMD_DH_REPLY = 0x05;
    static CMD_ENC_MSG = 0x06;
    static CMD_TYPING = 0x09;
    static CMD_READ = 0x0A;
    
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
module.exports = AMProto;
