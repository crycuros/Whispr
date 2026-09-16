using System;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace WhisprDesktop
{
    public class AMProto
    {
        public const byte CMD_AUTH = 0x01;
        public const byte CMD_LOGIN = 0x02;
        public const byte CMD_LOGIN_OK = 0x03;
        public const byte CMD_DH_INIT = 0x04;
        public const byte CMD_DH_REPLY = 0x05;
        public const byte CMD_ENC_MSG = 0x06;
        public const byte CMD_REGISTER = 0x07;
        public const byte CMD_REGISTER_OK = 0x08;
        public const byte CMD_TYPING = 0x09;
        public const byte CMD_READ = 0x0A;
        public const byte CMD_SYNC = 0x0B;
        public const byte CMD_ERROR = 0x0C;
        public const byte CMD_RESOLVE = 0x0D;
        public const byte CMD_RESOLVE_OK = 0x0E;

        public const byte OBFUSCATION_KEY = 0xAB;

        public class Packet
        {
            public byte Version { get; set; }
            public byte Command { get; set; }
            public ushort PayloadLength { get; set; }
            public uint MsgId { get; set; }
            public uint TargetId { get; set; }
            public uint SenderId { get; set; }
            public string PayloadString { get; set; }
            public byte[] RawPayload { get; set; }
        }

        public static byte[] BuildPacket(byte command, uint targetId, uint senderId, string payload)
        {
            byte version = 2;
            uint msgId = (uint)new Random().Next();
            
            byte[] payloadBuffer = Encoding.UTF8.GetBytes(payload);
            ushort payloadLength = (ushort)payloadBuffer.Length;

            byte[] packet = new byte[16 + payloadLength];
            
            packet[0] = version;
            packet[1] = command;
            BinaryPrimitives.WriteUInt16BigEndian(packet.AsSpan(2, 2), payloadLength);
            BinaryPrimitives.WriteUInt32BigEndian(packet.AsSpan(4, 4), msgId);
            BinaryPrimitives.WriteUInt32BigEndian(packet.AsSpan(8, 4), targetId);
            BinaryPrimitives.WriteUInt32BigEndian(packet.AsSpan(12, 4), senderId);
            
            Buffer.BlockCopy(payloadBuffer, 0, packet, 16, payloadLength);

            return packet;
        }

        public static Packet ParsePacket(byte[] buffer)
        {
            if (buffer.Length < 16)
                throw new Exception("Packet too small to be valid AM Proto 2.0");

            Packet p = new Packet();
            p.Version = buffer[0];
            p.Command = buffer[1];
            p.PayloadLength = BinaryPrimitives.ReadUInt16BigEndian(buffer.AsSpan(2, 2));
            p.MsgId = BinaryPrimitives.ReadUInt32BigEndian(buffer.AsSpan(4, 4));
            p.TargetId = BinaryPrimitives.ReadUInt32BigEndian(buffer.AsSpan(8, 4));
            p.SenderId = BinaryPrimitives.ReadUInt32BigEndian(buffer.AsSpan(12, 4));

            p.RawPayload = new byte[p.PayloadLength];
            Buffer.BlockCopy(buffer, 16, p.RawPayload, 0, p.PayloadLength);
            p.PayloadString = Encoding.UTF8.GetString(p.RawPayload);

            return p;
        }

        public static byte[] Obfuscate(byte[] buffer)
        {
            byte[] obf = new byte[buffer.Length];
            for (int i = 0; i < buffer.Length; i++)
            {
                obf[i] = (byte)(buffer[i] ^ OBFUSCATION_KEY);
            }
            return obf;
        }

        public static byte[] Deobfuscate(byte[] buffer)
        {
            return Obfuscate(buffer);
        }
    }
}
