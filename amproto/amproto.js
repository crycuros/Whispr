/**
 * AM Proto (Advanced Mobile Protocol) - Phase 1
 * Basic binary serialization for our custom protocol.
 */

class AMProto {
    // Commands
    static CMD_AUTH = 0x01;
    static CMD_SEND_MSG = 0x02;
    static CMD_PING = 0x03;

    /**
     * Builds a binary packet for AM Proto
     * Header (8 bytes):
     * [0] Version (1 byte)
     * [1] Command (1 byte)
     * [2-3] Payload Length (2 bytes, UInt16)
     * [4-7] Message ID (4 bytes, UInt32)
     */
    static buildPacket(command, payloadString) {
        const version = 1;
        const msgId = Math.floor(Math.random() * 0xFFFFFFFF);
        const payloadBuffer = Buffer.from(payloadString, 'utf-8');
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
}

module.exports = AMProto;
