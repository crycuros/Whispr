using System;
using System.Buffers.Binary;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WhisprDesktop
{
    /// <summary>
    /// AMProto v3.0 Protocol Engine for .NET
    /// Next-Gen Zero-Knowledge & Quantum-Resistant Messaging Frame
    /// </summary>
    public static class AMProtoV3
    {
        public const byte MagicByte = 0xA3;
        public const byte Version = 3;
        public const int HeaderSize = 24;

        // Flags
        public const ushort FlagEncrypted       = 0x0001;
        public const ushort FlagSealedSender   = 0x0002;
        public const ushort FlagHybridPQ       = 0x0004;
        public const ushort FlagGroupMLS       = 0x0008;
        public const ushort FlagAckRequired    = 0x0010;
        public const ushort FlagCompressed      = 0x0020;
        public const ushort FlagPaddingPresent = 0x0040;

        // Commands
        public const ushort CmdHello          = 0x0100;
        public const ushort CmdPrekeyPublish  = 0x0101;
        public const ushort CmdPrekeyReq      = 0x0102;
        public const ushort CmdPrekeyRes      = 0x0103;
        public const ushort CmdInitPQ         = 0x0104;
        public const ushort CmdInitPQOk       = 0x0105;

        public const ushort CmdMsg            = 0x0200;
        public const ushort CmdMsgRelay      = 0x0201;
        public const ushort CmdMsgAck        = 0x0202;
        public const ushort CmdMsgEdit       = 0x0203;
        public const ushort CmdMsgDelete     = 0x0204;
        public const ushort CmdTyping         = 0x0205;
        public const ushort CmdReadReceipt   = 0x0206;

        public const ushort CmdGroupCreate   = 0x0300;
        public const ushort CmdGroupJoin     = 0x0301;
        public const ushort CmdGroupCommit   = 0x0302;
        public const ushort CmdGroupMsg      = 0x0304;

        public const ushort CmdSyncPts       = 0x0400;
        public const ushort CmdSyncRes       = 0x0401;

        public const ushort CmdError          = 0x0E00;

        public class Packet
        {
            public byte Magic { get; set; }
            public byte Version { get; set; }
            public ushort Flags { get; set; }
            public ushort PaddingLength { get; set; }
            public ushort Command { get; set; }
            public ushort PayloadLength { get; set; }
            public uint SequenceId { get; set; }
            public uint TargetId { get; set; }
            public uint SenderId { get; set; }
            public byte[] Payload { get; set; } = Array.Empty<byte>();

            public string PayloadString => Encoding.UTF8.GetString(Payload);
        }

        public static byte[] BuildPacket(
            ushort command,
            uint targetId = 0,
            uint senderId = 0,
            uint sequenceId = 0,
            ushort flags = 0,
            byte[]? payload = null,
            bool addPadding = true,
            int maxPaddingBytes = 64)
        {
            payload ??= Array.Empty<byte>();
            ushort payloadLength = (ushort)payload.Length;

            ushort paddingLength = 0;
            byte[] paddingBytes = Array.Empty<byte>();

            if (addPadding)
            {
                flags |= FlagPaddingPresent;
                paddingLength = (ushort)RandomNumberGenerator.GetInt32(16, Math.Max(17, maxPaddingBytes + 1));
                paddingBytes = new byte[paddingLength];
                RandomNumberGenerator.Fill(paddingBytes);
            }

            int totalSize = HeaderSize + payloadLength + paddingLength;
            byte[] packet = new byte[totalSize];

            packet[0] = MagicByte;
            packet[1] = Version;
            BinaryPrimitives.WriteUInt16BigEndian(packet.AsSpan(2, 2), flags);
            BinaryPrimitives.WriteUInt16BigEndian(packet.AsSpan(4, 2), paddingLength);
            BinaryPrimitives.WriteUInt16BigEndian(packet.AsSpan(6, 2), command);
            BinaryPrimitives.WriteUInt16BigEndian(packet.AsSpan(8, 2), payloadLength);
            BinaryPrimitives.WriteUInt32BigEndian(packet.AsSpan(10, 4), sequenceId);
            BinaryPrimitives.WriteUInt32BigEndian(packet.AsSpan(14, 4), targetId);
            BinaryPrimitives.WriteUInt32BigEndian(packet.AsSpan(18, 4), senderId);
            BinaryPrimitives.WriteUInt16BigEndian(packet.AsSpan(22, 2), 0); // Reserved

            if (payloadLength > 0)
            {
                Buffer.BlockCopy(payload, 0, packet, HeaderSize, payloadLength);
            }

            if (paddingLength > 0)
            {
                Buffer.BlockCopy(paddingBytes, 0, packet, HeaderSize + payloadLength, paddingLength);
            }

            return packet;
        }

        public static byte[] BuildPacket(
            ushort command,
            uint targetId,
            uint senderId,
            string jsonPayload,
            uint sequenceId = 0,
            ushort flags = 0)
        {
            var payload = Encoding.UTF8.GetBytes(jsonPayload);
            return BuildPacket(command, targetId, senderId, sequenceId, flags, payload);
        }

        public static Packet ParsePacket(byte[] buffer)
        {
            if (buffer == null || buffer.Length < HeaderSize)
                throw new ArgumentException($"Packet too small for AMProto v3 (minimum {HeaderSize} bytes)");

            if (buffer[0] != MagicByte)
                throw new InvalidDataException($"Invalid magic byte: 0x{buffer[0]:X2}");

            if (buffer[1] != Version)
                throw new InvalidDataException($"Unsupported version: {buffer[1]}");

            ushort flags = BinaryPrimitives.ReadUInt16BigEndian(buffer.AsSpan(2, 2));
            ushort paddingLength = BinaryPrimitives.ReadUInt16BigEndian(buffer.AsSpan(4, 2));
            ushort command = BinaryPrimitives.ReadUInt16BigEndian(buffer.AsSpan(6, 2));
            ushort payloadLength = BinaryPrimitives.ReadUInt16BigEndian(buffer.AsSpan(8, 2));
            uint sequenceId = BinaryPrimitives.ReadUInt32BigEndian(buffer.AsSpan(10, 4));
            uint targetId = BinaryPrimitives.ReadUInt32BigEndian(buffer.AsSpan(14, 4));
            uint senderId = BinaryPrimitives.ReadUInt32BigEndian(buffer.AsSpan(18, 4));

            int totalExpected = HeaderSize + payloadLength + paddingLength;
            if (buffer.Length < totalExpected)
                throw new InvalidDataException($"Truncated packet: expected {totalExpected}, got {buffer.Length}");

            byte[] payload = new byte[payloadLength];
            if (payloadLength > 0)
            {
                Buffer.BlockCopy(buffer, HeaderSize, payload, 0, payloadLength);
            }

            return new Packet
            {
                Magic = MagicByte,
                Version = Version,
                Flags = flags,
                PaddingLength = paddingLength,
                Command = command,
                PayloadLength = payloadLength,
                SequenceId = sequenceId,
                TargetId = targetId,
                SenderId = senderId,
                Payload = payload
            };
        }
    }
}
