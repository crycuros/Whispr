using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;

namespace WhisprDesktop
{
    public partial class MainWindow : Window
    {
        private WebSocketManager _ws;
        private uint _myId = 0;
        private string _myUsername = "";
        
        private Dictionary<string, ChatData> _chats = new Dictionary<string, ChatData>();
        private string _currentChatUsername = null;
        private uint _currentChatId = 0;

        public MainWindow()
        {
            InitializeComponent();
        }

        // ── Window Chrome ──────────────────────────────────────
        private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ClickCount == 2)
                WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
            else
                DragMove();
        }
        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
        private void BtnMaximize_Click(object sender, RoutedEventArgs e) =>
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();

        private void TxtAddPeer_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter) BtnAddPeer_Click(sender, e);
        }

        private async Task EnsureConnectedAsync()
        {
            if (_ws != null) return;
            
            var url = TxtServerUrl.Text.Trim();
            _ws = new WebSocketManager(url);
            _ws.OnConnected = () => Dispatcher.Invoke(() => TxtAuthStatus.Text = "Connected! Logging in...");
            _ws.OnDisconnected = (err) => Dispatcher.Invoke(() => { TxtAuthStatus.Text = $"Disconnected: {err}"; _ws = null; });
            _ws.OnPacketReceived = OnPacketReceived;
            
            await _ws.ConnectAsync();
        }

        private async void BtnLogin_Click(object sender, RoutedEventArgs e)
        {
            await EnsureConnectedAsync();
            if (_ws == null) return;
            var user = TxtUsername.Text.Trim();
            var pass = TxtPassword.Password;
            if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass)) return;
            
            StorageHelper.SetWrappingKey(pass);
            
            var payload = JsonSerializer.Serialize(new { username = user, password = pass });
            var packet = AMProto.BuildPacket(AMProto.CMD_LOGIN, 0, 0, payload);
            await _ws.SendPacketAsync(packet);
        }

        private async void BtnRegister_Click(object sender, RoutedEventArgs e)
        {
            await EnsureConnectedAsync();
            if (_ws == null) return;
            var user = TxtUsername.Text.Trim();
            var pass = TxtPassword.Password;
            if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass)) return;
            
            var payload = JsonSerializer.Serialize(new { username = user, password = pass });
            var packet = AMProto.BuildPacket(AMProto.CMD_REGISTER, 0, 0, payload);
            await _ws.SendPacketAsync(packet);
        }

        private void OnPacketReceived(AMProto.Packet packet)
        {
            Dispatcher.Invoke(async () =>
            {
                try
                {
                    if (packet.Command == AMProto.CMD_LOGIN_OK)
                    {
                        var data = JsonSerializer.Deserialize<JsonElement>(packet.PayloadString);
                        _myId = data.GetProperty("userId").GetUInt32();
                        _myUsername = data.GetProperty("username").GetString();
                        LoginPanel.Visibility = Visibility.Hidden;
                        MainAppPanel.Visibility = Visibility.Visible;
                        TxtMyUsername.Text = _myUsername;
                        MyAvatarBorder.Background = AvatarHelper.GetBrush(_myUsername);
                        MyAvatarTextSide.Text = AvatarHelper.GetInitial(_myUsername);
                        MyAvatarText.Text = AvatarHelper.GetInitial(_myUsername);
                        EmptyState.Visibility = Visibility.Visible;

                        _chats = await StorageHelper.LoadChatsAsync();
                        // Always reset E2EE state on login — must do fresh handshake each session
                        foreach (var c in _chats.Values) { c.IsSecure = false; c.SharedSecretKey = null; }
                        UpdateChatList();

                        // Auto-reconnect all existing contacts — no need to re-add manually each session
                        foreach (var username in _chats.Keys.ToList())
                        {
                            var resolvePacket = AMProto.BuildPacket(AMProto.CMD_RESOLVE, 0, _myId, username);
                            await _ws.SendPacketAsync(resolvePacket);
                        }
                    }
                    else if (packet.Command == AMProto.CMD_REGISTER_OK)
                    {
                        TxtAuthStatus.Text = "Account created! You can now login.";
                        TxtAuthStatus.Foreground = new SolidColorBrush(Colors.Green);
                    }
                    else if (packet.Command == AMProto.CMD_ERROR)
                    {
                        var data = JsonSerializer.Deserialize<JsonElement>(packet.PayloadString);
                        TxtAuthStatus.Text = data.GetProperty("message").GetString();
                        TxtAuthStatus.Foreground = new SolidColorBrush(Colors.Red);
                    }
                    else if (packet.Command == AMProto.CMD_RESOLVE_OK)
                    {
                        var data = JsonSerializer.Deserialize<JsonElement>(packet.PayloadString);
                        uint targetId = data.GetProperty("userId").GetUInt32();
                        string targetUsername = data.GetProperty("username").GetString();

                        // Always generate FRESH DH keypair — never reuse old keys from storage
                        var ecdh = CryptoHelper.GenerateECDHKeyPair();
                        var newDhPair = new DhKeyPair { Priv = ecdh.ExportECPrivateKey(), Pub = CryptoHelper.ExportPublicKey(ecdh) };

                        if (!_chats.ContainsKey(targetUsername))
                            _chats[targetUsername] = new ChatData { Username = targetUsername };

                        _chats[targetUsername].TargetId = targetId;
                        _chats[targetUsername].IsSecure = false;
                        _chats[targetUsername].SharedSecretKey = null;
                        _chats[targetUsername].DhKeyPair = newDhPair;

                        var pubInts = newDhPair.Pub.Select(b => (int)b).ToArray();
                        var dhInit = AMProto.BuildPacket(AMProto.CMD_DH_INIT, targetId, _myId,
                            JsonSerializer.Serialize(new { publicKey = pubInts, username = _myUsername }));
                        await _ws.SendPacketAsync(dhInit);

                        UpdateChatList();
                        await StorageHelper.SaveChatsAsync(_chats);
                    }
                    else if (packet.Command == AMProto.CMD_DH_INIT)
                    {
                        var data = JsonSerializer.Deserialize<JsonElement>(packet.PayloadString);
                        var otherPub = data.GetProperty("publicKey").EnumerateArray().Select(x => x.GetByte()).ToArray();
                        var senderUsername = data.GetProperty("username").GetString();

                        if (!_chats.ContainsKey(senderUsername))
                            _chats[senderUsername] = new ChatData { Username = senderUsername };

                        // Fresh ECDH keypair every time we receive DH_INIT
                        var myEcdh = CryptoHelper.GenerateECDHKeyPair();
                        var shared = CryptoHelper.DeriveSharedSecret(myEcdh, otherPub);

                        _chats[senderUsername].TargetId = packet.SenderId;
                        _chats[senderUsername].IsSecure = true;
                        _chats[senderUsername].SharedSecretKey = shared;
                        _chats[senderUsername].DhKeyPair = new DhKeyPair { Priv = myEcdh.ExportECPrivateKey(), Pub = CryptoHelper.ExportPublicKey(myEcdh) };

                        var replyPubInts = _chats[senderUsername].DhKeyPair.Pub.Select(b => (int)b).ToArray();
                        var dhReply = AMProto.BuildPacket(AMProto.CMD_DH_REPLY, packet.SenderId, _myId,
                            JsonSerializer.Serialize(new { publicKey = replyPubInts, username = _myUsername }));
                        await _ws.SendPacketAsync(dhReply);

                        UpdateChatList();
                        if (_currentChatUsername == senderUsername) ListChats_SelectionChanged(null, null);
                        await StorageHelper.SaveChatsAsync(_chats);
                    }
                    else if (packet.Command == AMProto.CMD_DH_REPLY)
                    {
                        var data = JsonSerializer.Deserialize<JsonElement>(packet.PayloadString);
                        var otherPub = data.GetProperty("publicKey").EnumerateArray().Select(x => x.GetByte()).ToArray();
                        var senderUsername = data.GetProperty("username").GetString();

                        if (_chats.ContainsKey(senderUsername) && _chats[senderUsername].DhKeyPair != null)
                        {
                            var chat = _chats[senderUsername];
                            using var myEcdh = System.Security.Cryptography.ECDiffieHellman.Create();
                            myEcdh.ImportECPrivateKey(chat.DhKeyPair.Priv, out _);
                            chat.SharedSecretKey = CryptoHelper.DeriveSharedSecret(myEcdh, otherPub);
                            chat.IsSecure = true;
                            UpdateChatList();
                            if (_currentChatUsername == senderUsername) ListChats_SelectionChanged(null, null);
                            await StorageHelper.SaveChatsAsync(_chats);
                        }
                    }
                    else if (packet.Command == AMProto.CMD_ENC_MSG)
                    {
                        // Lookup chat by sender's ID
                        var chat = _chats.Values.FirstOrDefault(c => c.TargetId == packet.SenderId && c.IsSecure);
                        if (chat == null) return;

                        var payload = JsonSerializer.Deserialize<JsonElement>(packet.PayloadString);
                        var iv = payload.GetProperty("iv").EnumerateArray().Select(x => x.GetByte()).ToArray();
                        var encData = payload.GetProperty("encryptedData").EnumerateArray().Select(x => x.GetByte()).ToArray();

                        byte[] decrypted;
                        try { decrypted = CryptoHelper.DecryptAESGCM(encData, chat.SharedSecretKey, iv); }
                        catch (System.Security.Cryptography.CryptographicException) { return; } // old key, skip

                        chat.Messages.Add(new MessageData { Text = System.Text.Encoding.UTF8.GetString(decrypted), Type = "received", IsRead = true, Timestamp = DateTime.Now });
                        chat.NotifyMessagesChanged();
                        await StorageHelper.SaveChatsAsync(_chats);

                        if (_currentChatUsername == chat.Username)
                        {
                            // Acknowledge read so the peer sees the "seen" indicator
                            var readPacket = AMProto.BuildPacket(AMProto.CMD_READ, packet.SenderId, _myId, "");
                            await _ws.SendPacketAsync(readPacket);
                            RenderMessages();
                        }
                        else
                        {
                            chat.UnreadCount++;
                        }
                    }
                    else if (packet.Command == AMProto.CMD_READ)
                    {
                        // Peer read our messages -> mark all sent messages in that chat as seen
                        var chat = _chats.Values.FirstOrDefault(c => c.TargetId == packet.SenderId);
                        if (chat == null) return;

                        foreach (var m in chat.Messages)
                        {
                            if (m.Type == "sent" && !m.IsRead)
                            {
                                m.IsRead = true;
                                m.JustRead = true;
                            }
                        }

                        await StorageHelper.SaveChatsAsync(_chats);
                        if (_currentChatUsername == chat.Username) RenderMessages();
                    }
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Error:\n\n" + ex.ToString(), "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                }
            });
        }

        private async void BtnAddPeer_Click(object sender, RoutedEventArgs e)
        {
            var peerUsername = TxtAddPeer.Text.Trim();
            if (string.IsNullOrEmpty(peerUsername)) return;

            // Always send RESOLVE — triggers fresh DH handshake even for existing contacts
            var packet = AMProto.BuildPacket(AMProto.CMD_RESOLVE, 0, _myId, peerUsername);
            await _ws.SendPacketAsync(packet);
            TxtAddPeer.Text = "";
        }

        private async void ListChats_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (ListChats.SelectedItem is ChatData chat)
            {
                _currentChatUsername = chat.Username;
                EmptyState.Visibility = Visibility.Collapsed;
                ChatAreaPanel.Visibility = Visibility.Visible;
                TxtCurrentChat.Text = chat.IsGroup ? $"{chat.Username}  ·  👥 {chat.Members.Count}" : chat.Username;
                ChatAvatarBorder.Child = AvatarHelper.BuildAvatarElement(chat, 40);

                if (chat.IsGroup)
                {
                    TxtE2EEStatus.Text = "Group chat  ·  End-to-end encrypted";
                    TxtE2EEStatus.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#22C55E"));
                }
                else
                {
                    TxtE2EEStatus.Text = chat.IsSecure ? "End-to-end encrypted" : "Establishing secure connection...";
                    TxtE2EEStatus.Foreground = new SolidColorBrush(chat.IsSecure
                        ? (Color)ColorConverter.ConvertFromString("#22C55E")
                        : (Color)ColorConverter.ConvertFromString("#9BA3AF"));
                }

                // Opening the chat marks the peer's messages as seen
                if (_ws != null && _myId != 0 && chat.TargetId != 0 && chat.UnreadCount > 0)
                {
                    var readPacket = AMProto.BuildPacket(AMProto.CMD_READ, chat.TargetId, _myId, "");
                    await _ws.SendPacketAsync(readPacket);
                    chat.UnreadCount = 0;
                }

                RenderMessages();
            }
        }

        private void RenderMessages()
        {
            MessagesPanel.Children.Clear();
            if (_currentChatUsername == null) return;
            
            var chat = _chats[_currentChatUsername];
            // Yellow theme: sent bubbles are yellow with dark text, received are white cards with shadow
            var sentTextBrush  = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1A1A1A"));
            var recvTextBrush  = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1A1A1A"));
            var sentBubbleBg   = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FFB800"));
            var recvBubbleBg   = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FFFFFF"));
            var bubbleShadow   = new DropShadowEffect
            {
                Color = (Color)ColorConverter.ConvertFromString("#000000"),
                BlurRadius = 12,
                ShadowDepth = 2,
                Direction = 270,
                Opacity = 0.12
            };

            foreach (var msg in chat.Messages)
            {
                var wrapper = new StackPanel
                {
                    MaxWidth = 440,
                    Margin = new Thickness(6, 3, 6, 3),
                    HorizontalAlignment = msg.Type == "sent" ? HorizontalAlignment.Right : HorizontalAlignment.Left
                };

                var tb = new TextBlock
                {
                    Text = msg.Text,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = msg.Type == "sent" ? sentTextBrush : recvTextBrush,
                    FontSize = 14,
                    LineHeight = 20
                };

                if (msg.Type == "sent")
                {
                    // Use a Grid to allow the badge to overlap the bubble
                    var sentGroup = new Grid
                    {
                        Margin = new Thickness(0, 0, 10, 10) // Leave space for overlapping badge
                    };

                    var bubble = new Border
                    {
                        Padding = new Thickness(12, 8, 12, 8),
                        CornerRadius = new CornerRadius(18, 18, 4, 18),
                        Background = sentBubbleBg
                    };

                    var inner = new StackPanel();
                    inner.Children.Add(tb);

                    var time = new TextBlock
                    {
                        Text = FormatTime(msg.Timestamp),
                        FontSize = 11,
                        Foreground = new SolidColorBrush(Color.FromArgb(115, 0, 0, 0)), // rgba(0,0,0,0.45)
                        HorizontalAlignment = HorizontalAlignment.Right,
                        Margin = new Thickness(0, 4, 0, 0)
                    };
                    inner.Children.Add(time);
                    bubble.Child = inner;
                    
                    sentGroup.Children.Add(bubble);

                    // Add the seen badge overlapping the bottom-left corner
                    var badge = BuildReadStatusIcon(msg);
                    badge.HorizontalAlignment = HorizontalAlignment.Left;
                    badge.VerticalAlignment = VerticalAlignment.Bottom;
                    badge.Margin = new Thickness(-8, 0, 0, -8); // Offset to overlap on left
                    
                    sentGroup.Children.Add(badge);
                    wrapper.Children.Add(sentGroup);
                }
                else if (msg.Type == "received")
                {
                    var inner = new StackPanel();

                    if (chat.IsGroup && !string.IsNullOrEmpty(msg.Sender))
                    {
                        var senderLabel = new TextBlock
                        {
                            Text = msg.Sender,
                            FontSize = 11,
                            FontWeight = FontWeights.SemiBold,
                            Foreground = AvatarHelper.GetBrush(msg.Sender),
                            Margin = new Thickness(2, 0, 0, 3)
                        };
                        inner.Children.Add(senderLabel);
                    }

                    var bubble = new Border
                    {
                        Padding = new Thickness(12, 8, 12, 8),
                        CornerRadius = new CornerRadius(4, 18, 18, 18),
                        Background = recvBubbleBg,
                        Effect = bubbleShadow
                    };
                    inner.Children.Add(tb);
                    var time = new TextBlock
                    {
                        Text = FormatTime(msg.Timestamp),
                        FontSize = 11,
                        Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#9BA3AF")),
                        HorizontalAlignment = HorizontalAlignment.Right,
                        Margin = new Thickness(0, 4, 0, 0)
                    };
                    inner.Children.Add(time);
                    bubble.Child = inner;
                    wrapper.Children.Add(bubble);
                }

                MessagesPanel.Children.Add(wrapper);
            }
            ScrollMessages.ScrollToBottom();
        }

        private static string FormatTime(DateTime t)
        {
            if (t == default) return "";
            return t.ToString("h:mm tt").ToLowerInvariant();
        }

        // Matches the whisper SVG badge used in the web frontend
        private FrameworkElement BuildReadStatusIcon(MessageData msg)
        {
            var isRead = msg.IsRead;
            var iconColor = isRead
                ? (Color)ColorConverter.ConvertFromString("#FFB800")
                : Color.FromArgb(115, 255, 255, 255); // rgba(255,255,255,0.45)

            var badgeBgColor = isRead
                ? Colors.White
                : Color.FromArgb(64, 200, 200, 200); // rgba(200,200,200,0.25)

            var badgeBorderColor = isRead
                ? Color.FromArgb(153, 255, 255, 255) // rgba(255,255,255,0.6)
                : Color.FromArgb(51, 255, 255, 255); // rgba(255,255,255,0.2)

            var path = new Path
            {
                Data = Geometry.Parse("M 6,9 C 8,11 8,13 6,15 M 11,5 C 15,9 15,15 11,19 M 16,1 C 22,7 22,17 16,23"),
                Stroke = new SolidColorBrush(iconColor),
                StrokeThickness = 2.8,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                Stretch = Stretch.Uniform,
                Width = 10,
                Height = 10,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };

            var badge = new Border
            {
                Width = 20,
                Height = 20,
                CornerRadius = new CornerRadius(10),
                Background = new SolidColorBrush(badgeBgColor),
                BorderBrush = new SolidColorBrush(badgeBorderColor),
                BorderThickness = new Thickness(1),
                RenderTransformOrigin = new Point(0.5, 0.5),
                RenderTransform = new ScaleTransform(1, 1),
                Child = path
            };

            if (isRead)
            {
                // Match Photoshop shadow: Opacity 57%, Distance 1, Spread 2, Size 2
                var shadow = new System.Windows.Media.Effects.DropShadowEffect
                {
                    Color = Colors.Black,
                    BlurRadius = 2,
                    ShadowDepth = 1,
                    Direction = -30, // 30 degrees angle
                    Opacity = 0.57
                };
                badge.Effect = shadow;
            }

            if (msg.JustRead)
            {
                var sb = new System.Windows.Media.Animation.Storyboard();
                var ease = new System.Windows.Media.Animation.BackEase { EasingMode = System.Windows.Media.Animation.EasingMode.EaseOut, Amplitude = 0.8 };
                
                var scaleX = new System.Windows.Media.Animation.DoubleAnimation { From = 0.6, To = 1.05, Duration = TimeSpan.FromMilliseconds(300), EasingFunction = ease };
                var scaleY = new System.Windows.Media.Animation.DoubleAnimation { From = 0.6, To = 1.05, Duration = TimeSpan.FromMilliseconds(300), EasingFunction = ease };
                
                System.Windows.Media.Animation.Storyboard.SetTarget(scaleX, badge);
                System.Windows.Media.Animation.Storyboard.SetTargetProperty(scaleX, new PropertyPath("(UIElement.RenderTransform).(ScaleTransform.ScaleX)"));
                System.Windows.Media.Animation.Storyboard.SetTarget(scaleY, badge);
                System.Windows.Media.Animation.Storyboard.SetTargetProperty(scaleY, new PropertyPath("(UIElement.RenderTransform).(ScaleTransform.ScaleY)"));
                
                sb.Children.Add(scaleX);
                sb.Children.Add(scaleY);
                
                badge.Loaded += (s, e) => sb.Begin();
                msg.JustRead = false;
            }
            else if (isRead)
            {
                // If it was already read before, set it to the resting scaled state
                ((ScaleTransform)badge.RenderTransform).ScaleX = 1.05;
                ((ScaleTransform)badge.RenderTransform).ScaleY = 1.05;
            }

            return badge;
        }

        private void UpdateChatList()
        {
            var items = _chats.Values.ToList();
            ListChats.ItemsSource = items;

            // Preserve the selected chat across rebinds
            if (_currentChatUsername != null)
            {
                var match = items.FirstOrDefault(c => c.Username == _currentChatUsername);
                if (match != null) ListChats.SelectedItem = match;
            }
        }

        private void BtnSend_Click(object sender, RoutedEventArgs e)
        {
            SendMessage();
        }

        private void TxtMessage_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                SendMessage();
            }
        }

        private async void SendMessage()
        {
            if (_currentChatUsername == null) return;
            var chat = _chats[_currentChatUsername];
            if (!chat.IsSecure) return;

            var text = TxtMessage.Text.Trim();
            if (string.IsNullOrEmpty(text)) return;
            TxtMessage.Text = "";

            chat.Messages.Add(new MessageData { Text = text, Type = "sent", IsRead = false, Timestamp = DateTime.Now });
            RenderMessages();
            await StorageHelper.SaveChatsAsync(_chats);

            // Fetch target ID (since we only have Username in UI, we'd normally store TargetId in ChatData. 
            // For this mockup, we'll extract it if we had it, but for now we'll hardcode or rely on the server handling if we send TargetId 0?
            // Actually, we must have the target ID. Let's assume we store it or use a default for testing.
            // Let's get the peer ID from the UI or state. (This needs a proper map of username -> id).
            // For now, let's use TargetId = 0 if unknown, which might fail on server. 
            // In app.js we had currentActiveChat which was the ID!
            
            var plaintext = System.Text.Encoding.UTF8.GetBytes(text);
            
            // Encrypt matching browser's encryptPayload() format
            byte[] iv = new byte[12];
            RandomNumberGenerator.Fill(iv);
            byte[] tag = new byte[16];
            byte[] ciphertext = new byte[plaintext.Length];
            using (var aes = new System.Security.Cryptography.AesGcm(chat.SharedSecretKey, 16))
            {
                aes.Encrypt(iv, plaintext, ciphertext, tag);
            }
            // WebCrypto output = ciphertext + tag appended
            byte[] encryptedData = new byte[ciphertext.Length + tag.Length];
            Buffer.BlockCopy(ciphertext, 0, encryptedData, 0, ciphertext.Length);
            Buffer.BlockCopy(tag, 0, encryptedData, ciphertext.Length, tag.Length);

            // Send as JSON matching browser format: {iv: [...], encryptedData: [...]}
            var ivInts = iv.Select(b => (int)b).ToArray();
            var encInts = encryptedData.Select(b => (int)b).ToArray();
            var jsonPayload = JsonSerializer.Serialize(new { iv = ivInts, encryptedData = encInts });

            // Build packet with target ID stored in ChatData
            var targetId = chat.TargetId;
            var encPacket = AMProto.BuildPacket(AMProto.CMD_ENC_MSG, targetId, _myId, jsonPayload);
            await _ws.SendPacketAsync(encPacket);
        }
    }
}