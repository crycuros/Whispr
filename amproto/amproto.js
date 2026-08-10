/**
 * AM Proto (Advanced Mobile Protocol) - Phase 3
 * Adding AES-256-CBC Encryption
 */
const crypto = require('crypto');

class AMProto {
    // Commands
    static CMD_AUTH = 0x01;
    static CMD_SEND_MSG = 0x02;
    static CMD_PING = 0x03;
    static CMD_DH_INIT = 0x04;
    static CMD_DH_REPLY = 0x05;
    static CMD_ENC_MSG = 0x06;

    /**
     * Builds a binary packet for AM Proto
     * Header (8 bytes):
     * [0] Version (1 byte)
     * [1] Command (1 byte)
     * [2-3] Payload Length (2 bytes, UInt16)
     * [4-7] Message ID (4 bytes, UInt32)
     */
    static buildPacket(command, payload) {
        const version = 1;
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

        // Allocate buffer: 8 bytes header + payload length
        const packet = Buffer.alloc(8 + payloadLength);

        // Write Header
        packet.writeUInt8(version, 0);
        packet.writeUInt8(command, 1);
        packet.writeUInt16BE(payloadLength, 2);
        packet.writeUInt32BE(msgId, 4);

        // Write Payload
        payloadBuffer.copy(packet, 8);

        return packet;
    }

    /**
     * Parses an incoming binary packet
     */
    static parsePacket(buffer) {
        if (buffer.length < 8) {
            throw new Error("Packet too small to be valid AM Proto");
        }

        const version = buffer.readUInt8(0);
        const command = buffer.readUInt8(1);
        const payloadLength = buffer.readUInt16BE(2);
        const msgId = buffer.readUInt32BE(4);

        // Extract Payload
        const payloadBuffer = buffer.slice(8, 8 + payloadLength);
        const payloadString = payloadBuffer.toString('utf-8');

        return {
            version,
            command,
            payloadLength,
            msgId,
            payloadString,
            rawPayload: payloadBuffer
        };
    }

    /**
     * Encrypts a string using AES-256-CBC and the shared secret
     * Returns an object containing the IV and the encrypted Hex
     */
    static encryptPayload(text, sharedSecret) {
        const iv = crypto.randomBytes(16);
        // Ensure secret is 32 bytes for AES-256
        const key = crypto.createHash('sha256').update(sharedSecret).digest();
        
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf-8', 'hex');
        encrypted += cipher.final('hex');

        return {
            iv: iv.toString('hex'),
            encryptedData: encrypted
        };
    }

    /**
     * Decrypts an encrypted payload using AES-256-CBC and the shared secret
     */
    static decryptPayload(encryptedPayload, sharedSecret) {
        const iv = Buffer.from(encryptedPayload.iv, 'hex');
        // Ensure secret is 32 bytes for AES-256
        const key = crypto.createHash('sha256').update(sharedSecret).digest();
        
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedPayload.encryptedData, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        
        return decrypted;
    }
}

module.exports = AMProto;
