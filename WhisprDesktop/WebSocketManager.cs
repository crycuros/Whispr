using System;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;

namespace WhisprDesktop
{
    public class WebSocketManager
    {
        private ClientWebSocket _ws;
        private readonly Uri _serverUri;
        public Action<AMProto.Packet> OnPacketReceived;
        public Action OnConnected;
        public Action<string> OnDisconnected;

        public WebSocketManager(string url)
        {
            _serverUri = new Uri(url);
        }

        public async Task ConnectAsync()
        {
            // Force TLS 1.2 ONLY and HTTP/1.1 to bypass Windows LSA bugs with Cloudflare
            System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12;
            _ws = new ClientWebSocket();
            _ws.Options.Proxy = null; // Bypass local proxy issues
            _ws.Options.RemoteCertificateValidationCallback = (sender, certificate, chain, sslPolicyErrors) => true; // Bypass SSL validation for Render
            _ws.Options.HttpVersion = new Version(1, 1);
            _ws.Options.HttpVersionPolicy = System.Net.Http.HttpVersionPolicy.RequestVersionExact;
            try
            {
                // Remove trailing slash if user typed it, just in case
                var cleanUrl = _serverUri.ToString().TrimEnd('/');
                await _ws.ConnectAsync(new Uri(cleanUrl), CancellationToken.None);
                OnConnected?.Invoke();
                _ = ReceiveLoopAsync();
            }
            catch (Exception ex)
            {
                string errMsg = ex.Message;
                Exception inner = ex.InnerException;
                while (inner != null)
                {
                    errMsg += " -> " + inner.Message;
                    inner = inner.InnerException;
                }
                Console.WriteLine($"Connection failed: {errMsg}");
                OnDisconnected?.Invoke(errMsg);
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

        private async Task ReceiveLoopAsync()
        {
            var buffer = new byte[8192];
            try
            {
                while (_ws.State == WebSocketState.Open)
                {
                    var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, string.Empty, CancellationToken.None);
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
            catch (Exception ex)
            {
                OnDisconnected?.Invoke("Receive error: " + ex.Message);
            }
            finally
            {
                OnDisconnected?.Invoke("Connection closed.");
            }
        }
    }
}
