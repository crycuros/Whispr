const OBFUSCATION_KEY = 0xAB;
const CMD_AUTH = 0x01;
const CMD_DH_INIT = 0x04;
const CMD_DH_REPLY = 0x05;
const CMD_ENC_MSG = 0x06;
const CMD_TYPING = 0x09;
const CMD_READ = 0x0A;

const myId = Math.floor(Math.random() * 9000) + 1000;
document.getElementById('my-id').innerText = myId;

// State Management
const chats = new Map(); // peerId -> Chat Object
let currentActiveChat = null; // currently focused peerId

// Theme Toggle
const themeToggle = document.getElementById('theme-toggle');
if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-theme');
    themeToggle.innerText = '🌙';
}
themeToggle.onclick = () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    themeToggle.innerText = isLight ? '🌙' : '☀️';
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
};

// WebSocket Connection
const ws = new WebSocket(`ws://${window.location.host}`);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
    console.log("Connected to Relay");
    const authPacket = buildPacket(CMD_AUTH, 0, myId.toString());
    ws.send(obfuscate(authPacket));
};

ws.onmessage = async (event) => {
    const rawData = new Uint8Array(event.data);
    const cleanData = deobfuscate(rawData);
    const packet = parsePacket(cleanData);
    
    const sender = packet.senderId;
    if (!sender && packet.command !== CMD_AUTH) return;

    try {
        if (packet.command === CMD_DH_INIT) {
            let chat = getOrCreateChat(sender);
            
            const payload = JSON.parse(packet.payloadString);
            const peerPublicKeyData = new Uint8Array(payload.publicKey);
            
            // Generate our ECDH keys
            chat.dhKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
            const myPublicKeyBuffer = await crypto.subtle.exportKey("raw", chat.dhKeyPair.publicKey);
            
            // Import peer's key
            const peerKey = await crypto.subtle.importKey("raw", peerPublicKeyData, { name: "ECDH", namedCurve: "P-256" }, true, []);
            chat.sharedSecretKey = await deriveSharedSecret(chat.dhKeyPair, peerKey);
            chat.isSecure = true;
            
            // Send Reply
            const replyPayload = { publicKey: Array.from(new Uint8Array(myPublicKeyBuffer)) };
            const replyPacket = buildPacket(CMD_DH_REPLY, sender, JSON.stringify(replyPayload));
            ws.send(obfuscate(replyPacket));
            
            renderChatList();
            if (currentActiveChat === sender) openChat(sender);
        }
        else if (packet.command === CMD_DH_REPLY) {
            let chat = getOrCreateChat(sender);
            const payload = JSON.parse(packet.payloadString);
            const peerPublicKeyData = new Uint8Array(payload.publicKey);
            
            const peerKey = await crypto.subtle.importKey("raw", peerPublicKeyData, { name: "ECDH", namedCurve: "P-256" }, true, []);
            chat.sharedSecretKey = await deriveSharedSecret(chat.dhKeyPair, peerKey);
            chat.isSecure = true;
            
            renderChatList();
            if (currentActiveChat === sender) openChat(sender);
        }
        else if (packet.command === CMD_ENC_MSG) {
            let chat = getOrCreateChat(sender);
            if (!chat.sharedSecretKey) return; // Ignore if not secure
            
            const payload = JSON.parse(packet.payloadString);
            const decryptedMsg = await decryptPayload(chat.sharedSecretKey, payload);
            
            chat.messages.push({ text: decryptedMsg, type: 'received', isRead: true });
            
            if (currentActiveChat === sender) {
                // Instantly send read receipt if we are looking at it
                const readPacket = buildPacket(CMD_READ, sender, "");
                ws.send(obfuscate(readPacket));
                renderMessages(sender); // re-render to show new msg
            } else {
                chat.unreadCount++;
                renderChatList();
            }
        }
        else if (packet.command === CMD_TYPING) {
            if (currentActiveChat === sender) showTypingIndicator();
        }
        else if (packet.command === CMD_READ) {
            let chat = getOrCreateChat(sender);
            // Mark all sent messages as read
            chat.messages.forEach(m => {
                if (m.type === 'sent') m.isRead = true;
            });
            if (currentActiveChat === sender) renderMessages(sender);
        }
    } catch (err) {
        console.error("Protocol Error:", err);
    }
};

// --- WebCrypto ---
async function deriveSharedSecret(keyPair, peerPublicKey) {
    return await crypto.subtle.deriveKey(
        { name: "ECDH", public: peerPublicKey },
        keyPair.privateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}
async function encryptPayload(secretKey, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, secretKey, encoded);
    return { iv: Array.from(iv), encryptedData: Array.from(new Uint8Array(cipher)) };
}
async function decryptPayload(secretKey, payload) {
    const iv = new Uint8Array(payload.iv);
    const cipher = new Uint8Array(payload.encryptedData);
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, secretKey, cipher);
    return new TextDecoder().decode(dec);
}

// --- AM Proto ---
function buildPacket(command, target, payloadString) {
    const payloadBuffer = new TextEncoder().encode(payloadString);
    const payloadLength = payloadBuffer.length;
    const buffer = new ArrayBuffer(16 + payloadLength);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    
    view.setUint8(0, 2);
    view.setUint8(1, command);
    view.setUint16(2, payloadLength, false);
    view.setUint32(4, Math.floor(Math.random() * 0xFFFFFFFF), false);
    view.setUint32(8, target, false);
    view.setUint32(12, myId, false);
    
    u8.set(payloadBuffer, 16);
    return u8;
}
function parsePacket(u8) {
    const view = new DataView(u8.buffer);
    return {
        command: view.getUint8(1),
        targetId: view.getUint32(8, false),
        senderId: view.getUint32(12, false),
        payloadString: new TextDecoder().decode(u8.slice(16))
    };
}
function obfuscate(u8) {
    const obf = new Uint8Array(u8.length);
    for (let i = 0; i < u8.length; i++) obf[i] = u8[i] ^ OBFUSCATION_KEY;
    return obf;
}
function deobfuscate(u8) { return obfuscate(u8); }

// --- State Management ---
function getOrCreateChat(peerId) {
    if (!chats.has(peerId)) {
        chats.set(peerId, {
            peerId: peerId,
            dhKeyPair: null,
            sharedSecretKey: null,
            messages: [],
            unreadCount: 0,
            isSecure: false
        });
        renderChatList();
    }
    return chats.get(peerId);
}

// --- UI Logic ---
document.getElementById('btn-new-chat').onclick = async () => {
    const peerId = parseInt(document.getElementById('new-chat-input').value);
    if (!peerId || peerId === myId) return;
    document.getElementById('new-chat-input').value = '';
    
    let chat = getOrCreateChat(peerId);
    openChat(peerId);
    
    if (!chat.isSecure && !chat.dhKeyPair) {
        // Init E2EE
        document.getElementById('crypto-status').innerText = 'Initiating E2EE...';
        chat.dhKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
        const myPub = await crypto.subtle.exportKey("raw", chat.dhKeyPair.publicKey);
        const packet = buildPacket(CMD_DH_INIT, peerId, JSON.stringify({ publicKey: Array.from(new Uint8Array(myPub)) }));
        ws.send(obfuscate(packet));
    }
};

function renderChatList() {
    const list = document.getElementById('chat-list');
    list.innerHTML = '';
    
    chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = `chat-item ${currentActiveChat === chat.peerId ? 'active' : ''}`;
        
        let lastMsg = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1].text : (chat.isSecure ? 'Secure Tunnel Ready' : 'Connecting...');
        
        item.innerHTML = `
            <div class="chat-info">
                <h4>Peer ${chat.peerId}</h4>
                <p>${lastMsg}</p>
            </div>
            ${chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : ''}
        `;
        
        item.onclick = () => openChat(chat.peerId);
        list.appendChild(item);
    });
}

function openChat(peerId) {
    currentActiveChat = peerId;
    const chat = chats.get(peerId);
    
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('main-chat-area').style.display = 'flex';
    document.getElementById('chat-title').innerText = `Peer ${peerId}`;
    
    if (chat.unreadCount > 0) {
        // Send Read Receipts for unread messages!
        const readPacket = buildPacket(CMD_READ, peerId, "");
        ws.send(obfuscate(readPacket));
        chat.unreadCount = 0;
    }
    
    renderChatList(); // update active class & clear badge
    renderMessages(peerId);
    
    const input = document.getElementById('msg-input');
    const btn = document.getElementById('btn-send');
    if (chat.isSecure) {
        document.getElementById('crypto-status').innerText = 'Secure E2EE Tunnel';
        document.getElementById('crypto-status').className = 'status-text text-success';
        document.getElementById('e2e-badge').style.opacity = '1';
        input.disabled = false;
        btn.disabled = false;
        input.focus();
    } else {
        document.getElementById('crypto-status').innerText = 'Waiting for peer...';
        document.getElementById('crypto-status').className = 'status-text text-muted';
        document.getElementById('e2e-badge').style.opacity = '0.5';
        input.disabled = true;
        btn.disabled = true;
    }
}

const whisperIconSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9 C 8 11, 8 13, 6 15" /><path d="M11 5 C 15 9, 15 15, 11 19" /><path d="M16 1 C 22 7, 22 17, 16 23" /></svg>`;

function renderMessages(peerId) {
    const container = document.getElementById('messages');
    container.innerHTML = `<div class="message-wrapper system"><div class="message system"><span class="msg-content">End-to-End Encryption established with ${peerId}</span></div></div>`;
    
    const chat = chats.get(peerId);
    chat.messages.forEach(msg => {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${msg.type}`;

        const div = document.createElement('div');
        div.className = `message ${msg.type}`;
        
        const contentSpan = document.createElement('span');
        contentSpan.className = 'msg-content';
        contentSpan.innerText = msg.text;
        div.appendChild(contentSpan);
        
        wrapper.appendChild(div);

        if (msg.type === 'sent') {
            const statusSpan = document.createElement('span');
            statusSpan.className = 'read-status' + (msg.isRead ? ' seen' : '');
            statusSpan.innerHTML = whisperIconSVG;
            wrapper.appendChild(statusSpan);
        }
        
        container.appendChild(wrapper);
    });
    
    container.scrollTop = container.scrollHeight;
}

// Typing Indicator
let typingTimeout = null;
function showTypingIndicator() {
    let indicator = document.getElementById('typing-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'typing-indicator';
        indicator.className = 'typing-indicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';
    }
    
    const container = document.getElementById('messages');
    indicator.style.display = 'flex';
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        indicator.style.display = 'none';
    }, 1500);
}

document.getElementById('btn-send').onclick = async () => {
    if (!currentActiveChat) return;
    const chat = chats.get(currentActiveChat);
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !chat.isSecure) return;
    
    input.value = '';
    
    // Add to state and render immediately
    chat.messages.push({ text, type: 'sent', isRead: false });
    renderMessages(currentActiveChat);
    renderChatList();
    
    // Encrypt and send
    const encryptedPayload = await encryptPayload(chat.sharedSecretKey, text);
    const encPacket = buildPacket(CMD_ENC_MSG, currentActiveChat, JSON.stringify(encryptedPayload));
    ws.send(obfuscate(encPacket));
};

document.getElementById('msg-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-send').click();
});

let lastTypingSent = 0;
document.getElementById('msg-input').addEventListener('input', () => {
    if (!currentActiveChat) return;
    const chat = chats.get(currentActiveChat);
    if (!chat.isSecure) return;
    
    const now = Date.now();
    if (now - lastTypingSent > 500) {
        lastTypingSent = now;
        const typingPacket = buildPacket(CMD_TYPING, currentActiveChat, "");
        ws.send(obfuscate(typingPacket));
    }
});
