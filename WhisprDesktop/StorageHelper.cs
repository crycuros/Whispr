using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Collections.Generic;
using System.ComponentModel;
using System.Threading.Tasks;

namespace WhisprDesktop
{
    public class ChatData : INotifyPropertyChanged
    {
        public string Username { get; set; }
        public bool IsSecure { get; set; }
        public uint TargetId { get; set; }
        
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public byte[] SharedSecretKey { get; set; }
        
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public DhKeyPair DhKeyPair { get; set; }
        
        public List<MessageData> Messages { get; set; } = new List<MessageData>();

        [JsonIgnore]
        public int UnreadCount
        {
            get => _unreadCount;
            set
            {
                if (_unreadCount != value)
                {
                    _unreadCount = value;
                    PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(UnreadCount)));
                }
            }
        }
        private int _unreadCount;

        [JsonIgnore]
        public string LastMessagePreview => Messages.Count > 0 ? Messages[^1].Text : "Start messaging";

        public event PropertyChangedEventHandler PropertyChanged;

        public void NotifyMessagesChanged()
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(LastMessagePreview)));
        }
    }

    public class DhKeyPair
    {
        public byte[] Priv { get; set; }
        public byte[] Pub { get; set; }
    }

    public class MessageData
    {
        public string Text { get; set; }
        public string Type { get; set; } // 'sent', 'received', 'system'
        public bool IsRead { get; set; }
        public DateTime Timestamp { get; set; }
    }

    public class StorageHelper
    {
        private const string FilePath = "whispr_keys.enc";
        private static byte[] _wrappingKey;

        public static void SetWrappingKey(string password)
        {
            _wrappingKey = CryptoHelper.DerivePBKDF2Key(password, "whispr-salt-123");
        }

        public static async Task SaveChatsAsync(Dictionary<string, ChatData> chats)
        {
            if (_wrappingKey == null) return;
            
            var json = JsonSerializer.Serialize(chats);
            var plaintext = System.Text.Encoding.UTF8.GetBytes(json);
            
            byte[] iv = new byte[12];
            System.Security.Cryptography.RandomNumberGenerator.Fill(iv);
            byte[] tag = new byte[16];
            byte[] ciphertext = new byte[plaintext.Length];
            using (var aes = new System.Security.Cryptography.AesGcm(_wrappingKey, 16))
            {
                aes.Encrypt(iv, plaintext, ciphertext, tag);
            }
            // Store as IV(12) + ciphertext + tag(16)
            var blob = new byte[12 + ciphertext.Length + 16];
            Buffer.BlockCopy(iv, 0, blob, 0, 12);
            Buffer.BlockCopy(ciphertext, 0, blob, 12, ciphertext.Length);
            Buffer.BlockCopy(tag, 0, blob, 12 + ciphertext.Length, 16);
            
            await File.WriteAllBytesAsync(FilePath, blob);
        }

        public static async Task<Dictionary<string, ChatData>> LoadChatsAsync()
        {
            if (_wrappingKey == null || !File.Exists(FilePath)) 
                return new Dictionary<string, ChatData>();
            
            try 
            {
                var blob = await File.ReadAllBytesAsync(FilePath);
                var decrypted = CryptoHelper.DecryptAESGCM(blob, _wrappingKey);
                var json = System.Text.Encoding.UTF8.GetString(decrypted);
                
                return JsonSerializer.Deserialize<Dictionary<string, ChatData>>(json) ?? new Dictionary<string, ChatData>();
            } 
            catch 
            {
                return new Dictionary<string, ChatData>();
            }
        }
    }
}
