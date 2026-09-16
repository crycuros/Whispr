# Whispr Windows

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-chardiii0330-orange?style=flat-square&logo=buy-me-a-coffee)](https://www.buymeacoffee.com/chardiii0330)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

Whispr Windows is the official native Windows desktop client for Whispr, built with WPF and .NET. It implements the AMProto v3.0 zero-knowledge protocol with Continuous Double Ratchet encryption, post-quantum hybrid handshake support, and Windows DPAPI encrypted local storage.

Looking for the web client? Visit the [Whispr-Web](https://github.com/crycuros/Whispr-Web) repository.

---

## Key Security Features

- **100% Zero-Knowledge End-to-End Encryption**: All messages and sessions are encrypted locally on the device before transmission.
- **Continuous Double Ratchet**: Implements the Double Ratchet state machine with HKDF-SHA256 and AEAD (AES-256-GCM / ChaCha20-Poly1305) for forward secrecy and post-compromise security.
- **Post-Quantum Hybrid Readiness**: Protocol framing designed for hybrid classical and post-quantum key encapsulation (X25519 + Kyber768/ML-KEM).
- **Anti-DPI Dynamic Traffic Padding**: Randomized padding insertion on transport packets to prevent traffic analysis and fingerprinting by firewalls and ISPs.
- **DPAPI Storage Protection**: Local credentials and message history are secured using the Windows Data Protection API (CurrentUser scope).
- **Auto-Reconnection**: Resilient WebSocket client with exponential backoff connection recovery.

---

## Project Structure

```
Whispr-Windows/
├── Core/                # AMProto protocol engines and serialization
│   ├── AMProto.cs       # Protocol framing and commands
│   └── AMProtoV3.cs     # AMProto v3.0 next-gen protocol engine
├── Crypto/              # Cryptographic algorithms & helpers
│   └── CryptoHelper.cs  # ECDH, AES-GCM, PBKDF2 implementations
├── Network/             # Real-time networking layer
│   └── WebSocketManager.cs # Resilient WebSocket transport
├── Storage/             # Local database & state management
│   └── StorageHelper.cs # DPAPI encrypted local storage
├── UI/                  # UI helpers and converters
│   ├── AvatarHelper.cs  # User avatar rendering
│   └── Converters.cs    # XAML value converters
├── .github/             # GitHub workflow & funding configuration
│   └── FUNDING.yml      # Sponsorship configuration
├── App.xaml             # Application resources and entry point
├── App.xaml.cs          # Application startup logic
├── MainWindow.xaml      # Main user interface layout
├── MainWindow.xaml.cs   # UI logic and event dispatcher
├── WhisprDesktop.csproj # .NET project file
├── Whispr.sln           # Visual Studio solution file
├── icon.png             # Application brand icon
├── LICENSE              # MIT License
└── README.md            # Documentation
```

---

## Building and Running

### Prerequisites
- .NET 8.0 / .NET 9.0 SDK or later
- Windows 10 (Build 19041+) or Windows 11
- Visual Studio 2022, JetBrains Rider, or VS Code (optional)

### Build Instructions

1. Clone the repository:
```powershell
git clone https://github.com/crycuros/Whispr-Windows.git
cd Whispr-Windows
```

2. Build the solution:
```powershell
dotnet build Whispr.sln -c Release
```

3. Run the application:
```powershell
dotnet run --project WhisprDesktop.csproj
```

---

## AMProto v3 Wire Format

AMProto v3 utilizes a compact 24-byte binary header followed by an authenticated payload and pseudo-random padding:

- **Magic Byte (1 byte)**: `0xA3`
- **Version (1 byte)**: `0x03`
- **Flags (2 bytes)**: Bitmask for encrypted payload, sealed sender, and post-quantum mode.
- **Padding Length (2 bytes)**: Dynamic anti-DPI byte count.
- **Command (2 bytes)**: Action identifier.
- **Payload Length (2 bytes)**: Big-endian size of the encrypted payload.
- **Sequence ID (4 bytes)**: Transport message sequence number.
- **Target Session ID (4 bytes)**: Recipient identifier.
- **Sender Token (4 bytes)**: Sender token or blinded identifier.
- **Reserved (2 bytes)**: Future extensions.

---

## Support and Funding

If you find Whispr Desktop useful and would like to support ongoing development:

- **Buy Me a Coffee**: [buymeacoffee.com/chardiii0330](https://www.buymeacoffee.com/chardiii0330)

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
