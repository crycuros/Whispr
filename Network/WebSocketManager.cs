using System;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;

namespace WhisprDesktop
{
    public class WebSocketManager
    {
        private ClientWebSocket? _ws;
        private readonly Uri _serverUri;
        private CancellationTokenSource? _cts;
        private bool _isExplicitlyClosed;
        private int _reconnectAttempts;

        public Action<AMProto.Packet>? OnPacketReceived;
        public Action? OnConnected;
        public Action<string>? OnDisconnected;
        public Action<int>? OnReconnecting;

        public bool IsConnected => _ws != null && _ws.State == WebSocketState.Open;

        public WebSocketManager(string url)
        {
            _serverUri = new Uri(url);
        }

        public async Task ConnectAsync()
        {
            _isExplicitlyClosed = false;
            _cts = new CancellationTokenSource();

            // Force TLS 1.2 / 1.3
            System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12 | System.Net.SecurityProtocolType.Tls13;

            _ws = new ClientWebSocket();
            _ws.Options.Proxy = null; // Bypass local proxy issues
            _ws.Options.HttpVersion = new Version(1, 1);
            _ws.Options.HttpVersionPolicy = System.Net.Http.HttpVersionPolicy.RequestVersionExact;

            // Secure certificate validation
            _ws.Options.RemoteCertificateValidationCallback = (sender, certificate, chain, sslPolicyErrors) =>
            {
                // Allow loopback/local development connections
                if (_serverUri.IsLoopback || _serverUri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
                    return true;

                // Production servers must have valid certificates
                return sslPolicyErrors == System.Net.Security.SslPolicyErrors.None;
            };

            try
            {
                var cleanUrl = _serverUri.ToString().TrimEnd('/');
                await _ws.ConnectAsync(new Uri(cleanUrl), _cts.Token);
                _reconnectAttempts = 0;
                OnConnected?.Invoke();
                _ = ReceiveLoopAsync(_cts.Token);
            }
            catch (Exception ex)
            {
                string errMsg = GetFullErrorMessage(ex);
                Console.WriteLine($"Connection failed: {errMsg}");
                OnDisconnected?.Invoke(errMsg);
                _ = ScheduleReconnectAsync();
            }
        }

        public async Task SendPacketAsync(byte[] packet)
        {
            if (_ws != null && _ws.State == WebSocketState.Open)
            {
                var obf = AMProto.Obfuscate(packet);
                await _ws.SendAsync(new ArraySegment<byte>(obf), WebSocketMessageType.Binary, true, CancellationToken.None);
            }
        }

        public async Task DisconnectAsync()
        {
            _isExplicitlyClosed = true;
            _cts?.Cancel();
            if (_ws != null && (_ws.State == WebSocketState.Open || _ws.State == WebSocketState.Connecting))
            {
                try
                {
                    await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
                }
                catch { }
            }
            _ws?.Dispose();
            _ws = null;
        }

        private async Task ReceiveLoopAsync(CancellationToken ct)
        {
            var buffer = new byte[16384];
            try
            {
                while (_ws != null && _ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, string.Empty, CancellationToken.None);
                        break;
                    }
                    else
                    {
                        var packetData = new byte[result.Count];
                        Buffer.BlockCopy(buffer, 0, packetData, 0, result.Count);
                        
                        var deobf = AMProto.Deobfuscate(packetData);
                        var packet = AMProto.ParsePacket(deobf);
                        OnPacketReceived?.Invoke(packet);
                    }
                }
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                OnDisconnected?.Invoke("Receive error: " + ex.Message);
            }
            finally
            {
                if (!_isExplicitlyClosed)
                {
                    OnDisconnected?.Invoke("Connection lost. Reconnecting...");
                    _ = ScheduleReconnectAsync();
                }
            }
        }

        private async Task ScheduleReconnectAsync()
        {
            if (_isExplicitlyClosed) return;

            _reconnectAttempts++;
            // Exponential backoff: 2s, 4s, 8s, up to max 30s
            int delaySeconds = Math.Min(30, (int)Math.Pow(2, Math.Min(_reconnectAttempts, 5)));
            OnReconnecting?.Invoke(delaySeconds);

            await Task.Delay(TimeSpan.FromSeconds(delaySeconds));

            if (!_isExplicitlyClosed)
            {
                await ConnectAsync();
            }
        }

        private static string GetFullErrorMessage(Exception ex)
        {
            string errMsg = ex.Message;
            Exception? inner = ex.InnerException;
            while (inner != null)
            {
                errMsg += " -> " + inner.Message;
                inner = inner.InnerException;
            }
            return errMsg;
        }
    }
}
