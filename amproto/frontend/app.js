// AM Proto WebClient Implementation
const OBFUSCATION_KEY = 0xAB;
const CMD_AUTH = 0x01;
const CMD_DH_INIT = 0x04;
const CMD_DH_REPLY = 0x05;
const CMD_ENC_MSG = 0x06;
const CMD_TYPING = 0x09;
const CMD_READ = 0x0A;

// Random user ID between 1000 and 9999
const myId = Math.floor(Math.random() * 9000) + 1000;
let targetId = null;
let sharedSecretKey = null; // CryptoKey object
let dhKeyPair = null; // ECDH keys (WebCrypto doesn't do pure DH easily, we use ECDH for the browser)

document.getElementById('my-id').innerText = myId;

// Connect to Server via WebSocket
const ws = new WebSocket(`ws://${window.location.host}`);
ws.binaryType = 'arraybuffer'; // Crucial for reading raw bytes!

ws.onopen = () => {
    console.log("Connected to Zero-Knowledge Relay");
    // Register
    const authPacket = buildPacket(CMD_AUTH, 0, myId.toString());
    ws.send(obfuscate(authPacket));
};

ws.onmessage = async (event) => {
    const rawData = new Uint8Array(event.data);
    const cleanData = deobfuscate(rawData);
    const packet = parsePacket(cleanData);

    try {
        if (packet.command === CMD_DH_INIT) {
            targetId = packet.senderId; // FIXED: Set target to the sender's ID, not our own!
            updateCryptoStatus(`Received handshake from ${targetId}...`, false);
            
            const payload = JSON.parse(packet.payloadString);
            const peerPublicKeyData = new Uint8Array(payload.publicKey);
            
            // Generate our ECDH keys
            dhKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
            const myPublicKeyBuffer = await crypto.subtle.exportKey("raw", dhKeyPair.publicKey);
            
            // Import peer's key
            const peerKey = await crypto.subtle.importKey(
                "raw", peerPublicKeyData, { name: "ECDH", namedCurve: "P-256" }, true, []
            );
            
            // Derive shared secret
            await deriveSharedSecret(peerKey);
            
            // Send Reply
            const replyPayload = { publicKey: Array.from(new Uint8Array(myPublicKeyBuffer)) };
            const replyPacket = buildPacket(CMD_DH_REPLY, packet.senderId || targetId, JSON.stringify(replyPayload));
            ws.send(obfuscate(replyPacket));
            
            enableChat();
        }
        else if (packet.command === CMD_DH_REPLY) {
            updateCryptoStatus(`Keys established with ${targetId}!`, true);
            const payload = JSON.parse(packet.payloadString);
            const peerPublicKeyData = new Uint8Array(payload.publicKey);
            
            const peerKey = await crypto.subtle.importKey(
                "raw", peerPublicKeyData, { name: "ECDH", namedCurve: "P-256" }, true, []
            );
            
            await deriveSharedSecret(peerKey);
            enableChat();
        }
        else if (packet.command === CMD_ENC_MSG) {
            const payload = JSON.parse(packet.payloadString);
            const decryptedMsg = await decryptPayload(payload);
            hideTypingIndicator(); // Hide instantly when message arrives
            appendMessage(decryptedMsg, 'received');
            
            // Send Read Receipt back!
            if (targetId) {
                const readPacket = buildPacket(CMD_READ, targetId, "");
                ws.send(obfuscate(readPacket));
            }
        }
        else if (packet.command === CMD_TYPING) {
            showTypingIndicator();
        }
        else if (packet.command === CMD_READ) {
            markMessagesAsRead();
        }
    } catch (err) {
        console.error("Protocol Error:", err);
    }
};

// --- WebCrypto E2EE (ECDH + AES-GCM) --- //
// Note: Web Crypto uses ECDH which is faster and safer than classic DH for browsers
async function deriveSharedSecret(peerPublicKey) {
    sharedSecretKey = await crypto.subtle.deriveKey(
        { name: "ECDH", public: peerPublicKey },
        dhKeyPair.privateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
    console.log("Shared Secret Derived!");
}

async function encryptPayload(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedText = new TextEncoder().encode(text);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, sharedSecretKey, encodedText);
    
    return {
        iv: Array.from(iv),
        encryptedData: Array.from(new Uint8Array(ciphertext))
    };
}

async function decryptPayload(payload) {
    const iv = new Uint8Array(payload.iv);
    const ciphertext = new Uint8Array(payload.encryptedData);
    
    const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, sharedSecretKey, ciphertext);
    return new TextDecoder().decode(decryptedBuffer);
}

// --- AM Proto Formatters --- //
function buildPacket(command, target, payloadString) {
    const payloadBuffer = new TextEncoder().encode(payloadString);
    const payloadLength = payloadBuffer.length;
    
    // 16 bytes header: Version(1), Cmd(1), Len(2), MsgId(4), TargetId(4), SenderId(4)
    const buffer = new ArrayBuffer(16 + payloadLength);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    
    view.setUint8(0, 2); // v2
    view.setUint8(1, command);
    view.setUint16(2, payloadLength, false);
    view.setUint32(4, Math.floor(Math.random() * 0xFFFFFFFF), false);
    view.setUint32(8, target, false);
    view.setUint32(12, myId, false); // Add Sender ID so receiver knows who sent it
    
    u8.set(payloadBuffer, 16);
    return u8;
}

function parsePacket(u8) {
    const view = new DataView(u8.buffer);
    const payloadBuffer = u8.slice(16);
    return {
        version: view.getUint8(0),
        command: view.getUint8(1),
        payloadLength: view.getUint16(2, false),
        msgId: view.getUint32(4, false),
        targetId: view.getUint32(8, false),
        senderId: view.getUint32(12, false),
        payloadString: new TextDecoder().decode(payloadBuffer)
    };
}

function obfuscate(u8) {
    const obf = new Uint8Array(u8.length);
    for (let i = 0; i < u8.length; i++) obf[i] = u8[i] ^ OBFUSCATION_KEY;
    return obf;
}
function deobfuscate(u8) { return obfuscate(u8); } // XOR is symmetric

// --- UI Logic --- //
document.getElementById('btn-connect').onclick = async () => {
    targetId = parseInt(document.getElementById('target-id').value);
    if (!targetId) return;
    
    updateCryptoStatus(`Initiating E2EE with ${targetId}...`, false);
    
    // Generate ECDH keys
    dhKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
    const myPublicKeyBuffer = await crypto.subtle.exportKey("raw", dhKeyPair.publicKey);
    
    const payload = { publicKey: Array.from(new Uint8Array(myPublicKeyBuffer)) };
    const initPacket = buildPacket(CMD_DH_INIT, targetId, JSON.stringify(payload));
    ws.send(obfuscate(initPacket));
};

function updateCryptoStatus(msg, success) {
    const el = document.getElementById('crypto-status');
    el.innerText = msg;
    if (success) {
        el.className = 'status-text text-success';
        document.getElementById('e2e-badge').style.opacity = '1';
        document.getElementById('e2e-badge').innerText = 'End-to-End Encrypted';
    }
}

function enableChat() {
    updateCryptoStatus(`E2EE Secured with ${targetId}`, true);
    document.getElementById('msg-input').disabled = false;
    document.getElementById('btn-send').disabled = false;
    
    // Check if we already printed the success message to prevent spam
    if (!window.chatEnabled) {
        appendMessage(`Secure E2E tunnel established with ID: ${targetId}`, 'system');
        window.chatEnabled = true;
    }
}

function appendMessage(text, type) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    
    // Create a container for text and read status
    const contentSpan = document.createElement('span');
    contentSpan.className = 'msg-content';
    contentSpan.innerText = text;
    div.appendChild(contentSpan);
    
    // Add read status for sent messages (Single Checkmark initially)
    if (type === 'sent') {
        const statusSpan = document.createElement('span');
        statusSpan.className = 'read-status';
        statusSpan.innerText = '✓';
        div.appendChild(statusSpan);
    }
    
    const messagesContainer = document.getElementById('messages');
    const indicator = document.getElementById('typing-indicator');
    
    // Insert before typing indicator if it exists
    if (indicator) {
        messagesContainer.insertBefore(div, indicator);
    } else {
        messagesContainer.appendChild(div);
    }
    
    div.scrollIntoView({ behavior: 'smooth' });
}

let typingTimeout = null;
function showTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (!indicator) return;
    
    indicator.style.display = 'flex';
    document.getElementById('messages').appendChild(indicator); // move to bottom
    indicator.scrollIntoView({ behavior: 'smooth' });
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        hideTypingIndicator();
    }, 1500); // Reduced from 2000ms to 1500ms for faster hide
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
        indicator.style.display = 'none';
        clearTimeout(typingTimeout);
    }
}

function markMessagesAsRead() {
    // Change all single checks to blue double checks
    const statuses = document.querySelectorAll('.read-status:not(.seen)');
    statuses.forEach(span => {
        span.innerText = '✓✓';
        span.classList.add('seen');
    });
}

document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;
    
    input.value = '';
    appendMessage(text, 'sent');
    
    // Encrypt and send
    const encryptedPayload = await encryptPayload(text);
    const encPacket = buildPacket(CMD_ENC_MSG, targetId, JSON.stringify(encryptedPayload));
    ws.send(obfuscate(encPacket));
};

document.getElementById('msg-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-send').click();
});

let lastTypingSent = 0;
document.getElementById('msg-input').addEventListener('input', () => {
    if (!targetId || !window.chatEnabled) return;
    
    const now = Date.now();
    // Throttle typing packet to 500ms for snappier response
    if (now - lastTypingSent > 500) {
        lastTypingSent = now;
        const typingPacket = buildPacket(CMD_TYPING, targetId, "");
        ws.send(obfuscate(typingPacket));
    }
});
