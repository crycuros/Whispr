const OBFUSCATION_KEY = 0xAB;
const CMD_AUTH = 0x01;
const CMD_LOGIN = 0x02;
const CMD_LOGIN_OK = 0x03;
const CMD_DH_INIT = 0x04;
const CMD_DH_REPLY = 0x05;
const CMD_ENC_MSG = 0x06;
const CMD_REGISTER = 0x07;
const CMD_REGISTER_OK = 0x08;
const CMD_TYPING = 0x09;
const CMD_READ = 0x0A;
const CMD_SYNC = 0x0B;
const CMD_ERROR = 0x0C;
const CMD_RESOLVE = 0x0D;
const CMD_RESOLVE_OK = 0x0E;

let myId = null;
let myUsername = null;
let myPasswordHash = null; // Just SHA-256 for local key derivation

// State Management
const chats = new Map(); // peerId -> Chat Object
let currentActiveChat = null; 

// Theme Toggle
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

const sunSVG = `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
const moonSVG = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;

if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
    themeIcon.innerHTML = sunSVG;
} else {
    themeIcon.innerHTML = moonSVG;
}

themeToggle.onclick = () => {
    document.body.classList.toggle('dark-theme');
    const isDark = document.body.classList.contains('dark-theme');
    themeIcon.innerHTML = isDark ? sunSVG : moonSVG;
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
};

// WebSocket Connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${window.location.host}`);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
    console.log("Connected to Relay Server");
};

function showError(msg) {
    const errDiv = document.getElementById('auth-error');
    errDiv.innerText = msg;
    errDiv.style.display = 'block';
    setTimeout(() => { errDiv.style.display = 'none'; }, 3000);
}

document.getElementById('btn-login').onclick = async () => {
    const user = document.getElementById('auth-username').value.trim();
    const pass = document.getElementById('auth-password').value.trim();
    if (!user || !pass) return showError("Please enter credentials");
    
    // Simple hash for local key wrapping (not true bcrypt for prototype)
    const encoder = new TextEncoder();
    const data = encoder.encode(pass);
    const hash = await crypto.subtle.digest('SHA-256', data);
    myPasswordHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Load persisted keys BEFORE sending login packet to avoid race conditions with offline messages!
    myUsername = user; // Needed to construct localStorage key name
    await loadPersistedKeys();
    
    const payload = JSON.stringify({ username: user, password: myPasswordHash });
    const packet = buildPacket(CMD_LOGIN, 0, 0, payload);
    ws.send(obfuscate(packet));
};

document.getElementById('btn-register').onclick = async () => {
    const user = document.getElementById('auth-username').value.trim();
    const pass = document.getElementById('auth-password').value.trim();
    if (!user || !pass) return showError("Please enter credentials");
    
    const encoder = new TextEncoder();
    const data = encoder.encode(pass);
    const hash = await crypto.subtle.digest('SHA-256', data);
    myPasswordHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const payload = JSON.stringify({ username: user, password: myPasswordHash });
    const packet = buildPacket(CMD_REGISTER, 0, 0, payload);
    ws.send(obfuscate(packet));
};

ws.onmessage = async (event) => {
    const rawData = new Uint8Array(event.data);
    const cleanData = deobfuscate(rawData);
    const packet = parsePacket(cleanData);
    
    const sender = packet.senderId;

    try {
        if (packet.command === CMD_REGISTER_OK) {
            showError("Registration successful! Please log in.");
            document.getElementById('auth-error').style.color = '#10b981';
            document.getElementById('auth-error').style.background = 'rgba(16,185,129,0.1)';
        }
        else if (packet.command === CMD_ERROR) {
            showError(packet.payloadString);
        }
        else if (packet.command === CMD_LOGIN_OK) {
            const data = JSON.parse(packet.payloadString);
            myId = data.userId;
            myUsername = data.username;
            
            document.getElementById('my-id').innerText = `${myUsername} (${myId})`;
            
            // Hide Auth, Show App
            document.getElementById('auth-modal').style.opacity = '0';
            setTimeout(() => {
                document.getElementById('auth-modal').style.display = 'none';
                document.getElementById('app-container').style.display = 'flex';
                setTimeout(() => { document.getElementById('app-container').style.opacity = '1'; }, 50);
            }, 500);
        }
        else if (packet.command === CMD_RESOLVE_OK) {
            const data = JSON.parse(packet.payloadString);
            const peerId = data.userId;
            
            let chat = getOrCreateChat(peerId);
            chat.username = data.username;
            
            openChat(peerId);
            
            if (!chat.isSecure && !chat.dhKeyPair) {
                document.getElementById('crypto-status').innerText = 'Initiating E2EE...';
                chat.dhKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
                await persistKeys();
                
                const myPub = await crypto.subtle.exportKey("raw", chat.dhKeyPair.publicKey);
                const initPacket = buildPacket(CMD_DH_INIT, peerId, myId, JSON.stringify({ publicKey: Array.from(new Uint8Array(myPub)), username: myUsername }));
                ws.send(obfuscate(initPacket));
            }
        }
        else if (packet.command === CMD_DH_INIT) {
            let chat = getOrCreateChat(sender);
            
            const payload = JSON.parse(packet.payloadString);
            if (payload.username) chat.username = payload.username;
            
            const peerPublicKeyData = new Uint8Array(payload.publicKey);
            
            if (!chat.dhKeyPair) {
                chat.dhKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
                await persistKeys();
            }
            const myPublicKeyBuffer = await crypto.subtle.exportKey("raw", chat.dhKeyPair.publicKey);
            
            const peerKey = await crypto.subtle.importKey("raw", peerPublicKeyData, { name: "ECDH", namedCurve: "P-256" }, true, []);
            chat.sharedSecretKey = await deriveSharedSecret(chat.dhKeyPair, peerKey);
            chat.isSecure = true;
            await persistKeys(); // Save new shared secret
            
            const replyPayload = { publicKey: Array.from(new Uint8Array(myPublicKeyBuffer)), username: myUsername };
            const replyPacket = buildPacket(CMD_DH_REPLY, sender, myId, JSON.stringify(replyPayload));
            ws.send(obfuscate(replyPacket));
            
            renderChatList();
            if (currentActiveChat === sender) openChat(sender);
        }
        else if (packet.command === CMD_DH_REPLY) {
            let chat = getOrCreateChat(sender);
            const payload = JSON.parse(packet.payloadString);
            if (payload.username) chat.username = payload.username;
            const peerPublicKeyData = new Uint8Array(payload.publicKey);
            
            const peerKey = await crypto.subtle.importKey("raw", peerPublicKeyData, { name: "ECDH", namedCurve: "P-256" }, true, []);
            chat.sharedSecretKey = await deriveSharedSecret(chat.dhKeyPair, peerKey);
            chat.isSecure = true;
            await persistKeys(); // Save new shared secret
            
            renderChatList();
            if (currentActiveChat === sender) openChat(sender);
        }
        else if (packet.command === CMD_ENC_MSG) {
            let chat = getOrCreateChat(sender);
            if (!chat.sharedSecretKey) return; 
            
            const payload = JSON.parse(packet.payloadString);
            const decryptedMsg = await decryptPayload(chat.sharedSecretKey, payload);
            
            chat.messages.push({ text: decryptedMsg, type: 'received', isRead: true });
            
            if (currentActiveChat === sender) {
                const readPacket = buildPacket(CMD_READ, sender, myId, "");
                ws.send(obfuscate(readPacket));
                renderMessages(sender);
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
            chat.messages.forEach(m => {
                if (m.type === 'sent') m.isRead = true;
            });
            if (currentActiveChat === sender) renderMessages(sender);
        }
    } catch (err) {
        console.error("Protocol Error:", err);
    }
};

// --- Persistent Key Management ---
async function persistKeys() {
    const exportableKeys = {};
    for (const [peerId, chat] of chats.entries()) {
        let exportable = { username: chat.username, isSecure: chat.isSecure };
        if (chat.dhKeyPair) {
            const priv = await crypto.subtle.exportKey("pkcs8", chat.dhKeyPair.privateKey);
            const pub = await crypto.subtle.exportKey("raw", chat.dhKeyPair.publicKey);
            exportable.dhKeyPair = {
                priv: Array.from(new Uint8Array(priv)),
                pub: Array.from(new Uint8Array(pub))
            };
        }
        if (chat.sharedSecretKey) {
            const secret = await crypto.subtle.exportKey("raw", chat.sharedSecretKey);
            exportable.sharedSecret = Array.from(new Uint8Array(secret));
        }
        exportableKeys[peerId] = exportable;
    }
    // Using password hash as AES key to encrypt the local storage keys for security
    const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(myPasswordHash), {name: "PBKDF2"}, false, ["deriveBits", "deriveKey"]);
    const wrappingKey = await crypto.subtle.deriveKey(
        { "name": "PBKDF2", salt: new Uint8Array(16), iterations: 1000, hash: "SHA-256" },
        keyMaterial, { "name": "AES-GCM", "length": 256 }, false, [ "encrypt", "decrypt" ]
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedStore = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, new TextEncoder().encode(JSON.stringify(exportableKeys)));
    
    localStorage.setItem(`whispr_keys_${myUsername}`, JSON.stringify({
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encryptedStore))
    }));
}

async function loadPersistedKeys() {
    const stored = localStorage.getItem(`whispr_keys_${myUsername}`);
    if (!stored) return;
    
    try {
        const { iv, data } = JSON.parse(stored);
        const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(myPasswordHash), {name: "PBKDF2"}, false, ["deriveBits", "deriveKey"]);
        const wrappingKey = await crypto.subtle.deriveKey(
            { "name": "PBKDF2", salt: new Uint8Array(16), iterations: 1000, hash: "SHA-256" },
            keyMaterial, { "name": "AES-GCM", "length": 256 }, false, [ "encrypt", "decrypt" ]
        );
        
        const decryptedStore = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, wrappingKey, new Uint8Array(data));
        const exportableKeys = JSON.parse(new TextDecoder().decode(decryptedStore));
        
        for (const [peerIdStr, dataObj] of Object.entries(exportableKeys)) {
            const peerId = parseInt(peerIdStr);
            const chat = getOrCreateChat(peerId);
            
            chat.username = dataObj.username || `User ${peerId}`;
            chat.isSecure = dataObj.isSecure || false;
            
            if (dataObj.dhKeyPair) {
                const privKey = await crypto.subtle.importKey("pkcs8", new Uint8Array(dataObj.dhKeyPair.priv), { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
                const pubKey = await crypto.subtle.importKey("raw", new Uint8Array(dataObj.dhKeyPair.pub), { name: "ECDH", namedCurve: "P-256" }, true, []);
                chat.dhKeyPair = { privateKey: privKey, publicKey: pubKey };
            }
            if (dataObj.sharedSecret) {
                chat.sharedSecretKey = await crypto.subtle.importKey("raw", new Uint8Array(dataObj.sharedSecret), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
            }
        }
        console.log("Loaded persisted keys.");
        renderChatList();
    } catch (err) {
        console.error("Failed to load keys:", err);
        localStorage.removeItem(`whispr_keys_${myUsername}`);
    }
}

// --- WebCrypto ---
async function deriveSharedSecret(keyPair, peerPublicKey) {
    return await crypto.subtle.deriveKey(
        { name: "ECDH", public: peerPublicKey },
        keyPair.privateKey,
        { name: "AES-GCM", length: 256 },
        true, // Allow extraction to save to localStorage
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
function buildPacket(command, target, sender, payloadString) {
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
    view.setUint32(12, sender, false);
    
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
            username: `User ${peerId}`, // fallback
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
    const username = document.getElementById('new-chat-input').value.trim();
    if (!username || username === myUsername) return;
    document.getElementById('new-chat-input').value = '';
    
    // Send resolve request to server
    const resolvePacket = buildPacket(CMD_RESOLVE, 0, myId, username);
    ws.send(obfuscate(resolvePacket));
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
                <h4>${chat.username}</h4>
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
    document.getElementById('chat-title').innerText = `${chat.username}`;
    
    if (chat.unreadCount > 0) {
        const readPacket = buildPacket(CMD_READ, peerId, myId, "");
        ws.send(obfuscate(readPacket));
        chat.unreadCount = 0;
    }
    
    renderChatList(); 
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
    const chat = chats.get(peerId);
    container.innerHTML = chat.isSecure ? `<div class="message-wrapper system"><div class="message system"><span class="msg-content">End-to-End Encryption established with ${chat.username}</span></div></div>` : '';
    
    chat.messages.forEach(msg => {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${msg.type}`;

        const div = document.createElement('div');
        div.className = `message`; 
        if(msg.type === 'system') div.classList.add('system');
        else if (msg.type === 'sent') div.classList.add('sent');
        else if (msg.type === 'received') div.classList.add('received');
        
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
    
    chat.messages.push({ text, type: 'sent', isRead: false });
    renderMessages(currentActiveChat);
    renderChatList();
    
    const encryptedPayload = await encryptPayload(chat.sharedSecretKey, text);
    const encPacket = buildPacket(CMD_ENC_MSG, currentActiveChat, myId, JSON.stringify(encryptedPayload));
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
        const typingPacket = buildPacket(CMD_TYPING, currentActiveChat, myId, "");
        ws.send(obfuscate(typingPacket));
    }
});
