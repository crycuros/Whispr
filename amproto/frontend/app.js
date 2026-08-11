if (localStorage.getItem('whispr_session')) {
    document.getElementById('auth-modal').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('app-container').style.opacity = '1';
    document.getElementById('update-toast').style.display = 'flex';
}

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
const CMD_GROUP_CREATE = 0x10;
const CMD_GROUP_CREATE_OK = 0x11;
const CMD_GROUP_MSG = 0x13;
const CMD_GROUP_MSG_RELAY = 0x14;
const CMD_GROUP_INFO_OK = 0x16;
const CMD_GROUP_READ = 0x19;
const CMD_USER_UPDATE = 0x20;
const CMD_USER_UPDATE_OK = 0x21;

const AVATAR_PALETTE = ['#3390EC', '#297A4A', '#E06C75', '#8E6CD6', '#F08C3A', '#43A09E', '#7090C6', '#B76CE8'];

let myId = null;
let myUsername = null;
let myPasswordHash = null;
let myAvatarUrl = null;
let myBio = '';

const chats = new Map(); // peerId -> Chat Object
let currentActiveChat = null;
let groupSeq = 1;

// ============ Helpers ============
function initials(name) {
    if (!name) return '?';
    return String(name).trim().charAt(0).toUpperCase();
}
function avatarColor(name) {
    const key = String(name || '?');
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) & 0x7FFFFFFF;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function formatListTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return formatTime(ts);
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function dateLabel(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
const whisperIconSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M6 9 C 8 11, 8 13, 6 15" /><path d="M11 5 C 15 9, 15 15, 11 19" /><path d="M16 1 C 22 7, 22 17, 16 23" /></svg>`;

// ============ WebSocket ============
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${window.location.host}`);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
    console.log("Connected to Relay Server");
    const session = localStorage.getItem('whispr_session');
    if (session) {
        const { user, hash } = JSON.parse(session);
        myUsername = user;
        myPasswordHash = hash;
        loadPersistedKeys().then(() => {
            const payload = JSON.stringify({ username: user, password: hash });
            const packet = buildPacket(CMD_LOGIN, 0, 0, payload);
            ws.send(obfuscate(packet));
        });
    }
};

function showError(msg) {
    const errDiv = document.getElementById('auth-error');
    errDiv.innerText = msg;
    errDiv.style.display = 'block';
    errDiv.style.color = '#ef4444';
    errDiv.style.background = 'rgba(239,68,68,0.1)';
    setTimeout(() => { errDiv.style.display = 'none'; }, 3000);
}

document.getElementById('btn-login').onclick = async () => {
    if (ws.readyState !== WebSocket.OPEN) {
        alert("Connecting to server... Please try again in a second.");
        return;
    }
    const user = document.getElementById('auth-username').value.trim();
    const pass = document.getElementById('auth-password').value.trim();
    if (!user || !pass) return showError("Please enter credentials");

    const hash = await sha256(pass);
    myPasswordHash = hash;
    myUsername = user;
    localStorage.setItem('whispr_session', JSON.stringify({ user, hash }));
    await loadPersistedKeys();

    const payload = JSON.stringify({ username: user, password: myPasswordHash });
    const packet = buildPacket(CMD_LOGIN, 0, 0, payload);
    ws.send(obfuscate(packet));
};

document.getElementById('btn-register').onclick = async () => {
    const user = document.getElementById('auth-username').value.trim();
    const pass = document.getElementById('auth-password').value.trim();
    if (!user || !pass) return showError("Please enter credentials");

    const hash = await sha256(pass);
    myPasswordHash = hash;

    const payload = JSON.stringify({ username: user, password: myPasswordHash });
    const packet = buildPacket(CMD_REGISTER, 0, 0, payload);
    ws.send(obfuscate(packet));
};

async function sha256(str) {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
            myAvatarUrl = data.avatarUrl;
            myBio = data.bio || '';
            
            // Sync theme color from DB
            if (data.themeColor) {
                applyThemeColor(data.themeColor);
            }
            
            // Sync all preferences
            myPreferences = data.preferences || {};
            applyPreferences(myPreferences);

            const avatar = document.getElementById('my-avatar');
            if (myAvatarUrl) {
                avatar.innerHTML = `<img src="${myAvatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                avatar.style.background = 'transparent';
            } else {
                avatar.innerText = initials(myUsername);
                avatar.style.background = avatarColor(myUsername);
            }

            const toast = document.getElementById('update-toast');
            if (toast && toast.style.display !== 'none') {
                setTimeout(() => { toast.style.display = 'none'; }, 800); // 800ms delay to make it visible
            }

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

            // Always generate FRESH keys when we receive DH_INIT.
            // If we reuse old keys while the peer has new keys, the shared secrets won't match.
            chat.dhKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
            chat.isSecure = false;
            chat.sharedSecretKey = null;
            await persistKeys();
            const myPublicKeyBuffer = await crypto.subtle.exportKey("raw", chat.dhKeyPair.publicKey);

            const peerKey = await crypto.subtle.importKey("raw", peerPublicKeyData, { name: "ECDH", namedCurve: "P-256" }, true, []);
            chat.sharedSecretKey = await deriveSharedSecret(chat.dhKeyPair, peerKey);
            chat.isSecure = true;
            await persistKeys();

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
            await persistKeys();

            renderChatList();
            if (currentActiveChat === sender) openChat(sender);
        }
        else if (packet.command === CMD_USER_UPDATE_OK) {
            const data = JSON.parse(packet.payloadString);
            if (data.avatarUrl !== undefined) {
                myAvatarUrl = data.avatarUrl;
                const avatar = document.getElementById('my-avatar');
                if (myAvatarUrl) {
                    avatar.innerHTML = `<img src="${myAvatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                    avatar.style.background = 'transparent';
                }
            }
            if (data.bio !== undefined) myBio = data.bio;
        }
        else if (packet.command === CMD_ENC_MSG) {
            let chat = getOrCreateChat(sender);
            if (!chat.sharedSecretKey) return;

            const payload = JSON.parse(packet.payloadString);
            const decryptedMsg = await decryptPayload(chat.sharedSecretKey, payload);

            chat.messages.push({ text: decryptedMsg, type: 'received', isRead: true, time: Date.now() });
            chat.typing = false;
            await persistKeys();

            if (currentActiveChat === sender) {
                const readPacket = buildPacket(CMD_READ, sender, myId, "");
                ws.send(obfuscate(readPacket));
                renderMessages(sender);
            } else {
                chat.unreadCount++;
            }
            renderChatList();
        }
        else if (packet.command === CMD_TYPING) {
            const chat = chats.get(sender);
            if (!chat) return;
            chat.typing = true;
            clearTimeout(chat._typingTimer);
            chat._typingTimer = setTimeout(() => { chat.typing = false; renderChatList(); }, 3000);
            if (currentActiveChat === sender) showTypingIndicator();
            renderChatList();
        }
        else if (packet.command === CMD_READ) {
            let chat = getOrCreateChat(sender);
            chat.messages.forEach(m => {
                if (m.type === 'sent') m.isRead = true;
            });
            await persistKeys();
            if (currentActiveChat === sender) renderMessages(sender);
            renderChatList();
        }
        else if (packet.command === CMD_GROUP_CREATE_OK || packet.command === CMD_GROUP_INFO_OK) {
            const payload = JSON.parse(packet.payloadString);
            const { groupId, name, description, avatarUrl, members, isFeed, creatorId } = payload;
            const groupPeerId = 'group_' + groupId;
            chats.set(groupPeerId, {
                isGroup: true,
                isFeed: isFeed,
                creatorId: creatorId,
                groupId: groupId,
                username: name,
                description: description,
                avatarUrl: avatarUrl,
                members: members,
                messages: chats.get(groupPeerId)?.messages || [],
                unreadCount: chats.get(groupPeerId)?.unreadCount || 0
            });
            renderChatList();
        }
        else if (packet.command === CMD_GROUP_MSG_RELAY) {
            const payload = JSON.parse(packet.payloadString);
            const { groupId, senderId, text, messageId } = payload;
            const groupPeerId = 'group_' + groupId;
            let chat = chats.get(groupPeerId);
            if (!chat) return;

            // Fetch sender username from our contacts if possible, or fallback
            let senderName = `User ${senderId}`;
            if (senderId === myId) senderName = myUsername;
            else if (chats.has(senderId)) senderName = chats.get(senderId).username;

            chat.messages.push({
                senderId: senderId,
                senderUsername: senderName,
                text: text,
                type: senderId === myId ? 'sent' : 'received',
                isRead: true, // we received it, so it's read
                time: Date.now(),
                messageId: messageId
            });

            if (currentActiveChat === groupPeerId) {
                const readPacket = buildPacket(CMD_GROUP_READ, 0, myId, JSON.stringify({ groupId, lastReadMsgId: messageId }));
                ws.send(obfuscate(readPacket));
                renderMessages(groupPeerId);
            } else {
                chat.unreadCount++;
            }
            renderChatList();
        }
    } catch (err) {
        console.error("Protocol Error:", err);
    }
};

// ============ Persistent Key Management ============
async function persistKeys() {
    const exportableKeys = {};
    for (const [peerId, chat] of chats.entries()) {
        if (chat.isGroup) continue; // Groups are ephemeral/local
        let exportable = { username: chat.username, isSecure: chat.isSecure, messages: chat.messages };
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
    const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(myPasswordHash), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
    const wrappingKey = await crypto.subtle.deriveKey(
        { "name": "PBKDF2", salt: new Uint8Array(16), iterations: 1000, hash: "SHA-256" },
        keyMaterial, { "name": "AES-GCM", "length": 256 }, false, ["encrypt", "decrypt"]
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
        const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(myPasswordHash), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
        const wrappingKey = await crypto.subtle.deriveKey(
            { "name": "PBKDF2", salt: new Uint8Array(16), iterations: 1000, hash: "SHA-256" },
            keyMaterial, { "name": "AES-GCM", "length": 256 }, false, ["encrypt", "decrypt"]
        );

        const decryptedStore = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, wrappingKey, new Uint8Array(data));
        const exportableKeys = JSON.parse(new TextDecoder().decode(decryptedStore));

        for (const [peerIdStr, dataObj] of Object.entries(exportableKeys)) {
            const peerId = parseInt(peerIdStr);
            if (isNaN(peerId)) continue;
            const chat = getOrCreateChat(peerId);

            chat.username = dataObj.username || `User ${peerId}`;
            chat.isSecure = dataObj.isSecure || false;
            chat.messages = dataObj.messages || [];

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

// ============ WebCrypto ============
async function deriveSharedSecret(keyPair, peerPublicKey) {
    return await crypto.subtle.deriveKey(
        { name: "ECDH", public: peerPublicKey },
        keyPair.privateKey,
        { name: "AES-GCM", length: 256 },
        true,
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

// ============ AM Proto ============
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

// ============ State Management ============
function getOrCreateChat(peerId) {
    if (!chats.has(peerId)) {
        chats.set(peerId, {
            peerId: peerId,
            username: `User ${peerId}`,
            dhKeyPair: null,
            sharedSecretKey: null,
            messages: [],
            unreadCount: 0,
            isSecure: false,
            typing: false
        });
        renderChatList();
    }
    return chats.get(peerId);
}

function groupAvatarHTML(chat) {
    const members = (chat.members || []).slice(0, 4);
    const cells = members.map(id => {
        const name = id === myId ? myUsername : (chats.get(id)?.username || `User ${id}`);
        return `<span style="background:${avatarColor(name)}">${initials(name)}</span>`;
    }).join('');
    return `<div class="group-avatar-grid">${cells || '<span></span>'}</div>`;
}

// ============ Chat List ============
function renderChatList() {
    const list = document.getElementById('chat-list');
    list.innerHTML = '';

    chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = `chat-item ${currentActiveChat === chat.peerId ? 'active' : ''}`;

        const last = chat.messages.length ? chat.messages[chat.messages.length - 1] : null;
        const lastTime = last ? formatListTime(last.time) : '';

        let preview;
        if (chat.typing) preview = `<span class="typing-text">typing...</span>`;
        else if (last) preview = `${chat.isGroup && last.senderUsername ? escapeHtml(last.senderUsername) + ': ' : ''}${escapeHtml(last.text)}`;
        else if (chat.isGroup) preview = 'Space created';
        else if (chat.isSecure) preview = 'Encrypted chat';
        else preview = 'Connecting...';

        const receipt = last && last.type === 'sent'
            ? `<span class="receipt ${last.isRead ? 'seen' : ''}">${whisperIconSVG}</span>` : '';
        const badge = chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : '';
        const memberChip = chat.isGroup ? `<span class="member-chip">${chat.members.length} members</span>` : '';

        item.innerHTML = `
            <div class="chat-avatar" style="background:${avatarColor(chat.username)}">
                ${chat.isGroup ? groupAvatarHTML(chat) : initials(chat.username)}
                <span class="online-dot"></span>
            </div>
            <div class="chat-info">
                <div class="chat-line1"><h4>${escapeHtml(chat.username)}${memberChip}</h4><span class="chat-time">${lastTime}</span></div>
                <div class="chat-line2"><p>${preview}</p>${receipt}${badge}</div>
            </div>
        `;

        item.onclick = () => openChat(chat.peerId);
        list.appendChild(item);
    });

    renderRecentSearches();
}

function renderRecentSearches() {
    const list = document.getElementById('recent-searches-list');
    if (!list) return;
    list.innerHTML = '';
    
    let count = 0;
    // Map entries are usually in insertion order, we just take the first few as "recents"
    for (const [peerId, chat] of chats) {
        if (count >= 10) break; // show up to 10 recents
        
        const item = document.createElement('div');
        item.className = 'recent-user-item';
        
        item.innerHTML = `
            <div class="recent-avatar" style="background-color: ${avatarColor(chat.username)};">
                ${chat.isGroup ? groupAvatarHTML(chat) : `<span>${initials(chat.username)}</span>`}
            </div>
            <span class="recent-name">${escapeHtml(chat.username)}</span>
        `;
        
        item.onclick = () => {
            openChat(peerId);
            document.getElementById('btn-back-search').click();
        };
        
        list.appendChild(item);
        count++;
    }
}

// ============ Chat Header / Open ============
function openChat(peerId) {
    currentActiveChat = peerId;
    const chat = chats.get(peerId);
    if (!chat) return;

    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('main-chat-area').style.display = 'flex';
    document.getElementById('chat-title').innerText = chat.username;

    const headerAvatar = document.getElementById('header-avatar');
    headerAvatar.innerText = chat.isGroup ? '' : initials(chat.username);
    headerAvatar.style.background = avatarColor(chat.username);

    if (chat.isGroup) {
        document.getElementById('crypto-status').innerText = `${chat.members.length} members`;
        document.getElementById('crypto-status').className = 'status-text text-muted';
    } else if (chat.isSecure) {
        document.getElementById('crypto-status').innerText = 'Online';
        document.getElementById('crypto-status').className = 'status-text text-success';
    } else {
        document.getElementById('crypto-status').innerText = 'Connecting...';
        document.getElementById('crypto-status').className = 'status-text text-muted';
    }

    if (chat.unreadCount > 0 && !chat.isGroup) {
        const readPacket = buildPacket(CMD_READ, peerId, myId, "");
        ws.send(obfuscate(readPacket));
        chat.unreadCount = 0;
    }

    renderChatList();
    renderMessages(peerId);

    const input = document.getElementById('msg-input');
    const btn = document.getElementById('btn-send');
    if (chat.isSecure) {
        input.disabled = false;
        btn.disabled = false;
        input.placeholder = "Type an encrypted message...";
        input.focus({ preventScroll: true });
    } else if (chat.isGroup) {
        if (chat.isFeed && chat.creatorId !== myId) {
            input.disabled = true;
            btn.disabled = true;
            input.placeholder = "This is a broadcast Feed. Only admins can post.";
        } else {
            input.disabled = false;
            btn.disabled = false;
            input.placeholder = chat.isFeed ? "Broadcast to Feed..." : "Message group...";
            input.focus({ preventScroll: true });
        }
    } else {
        input.disabled = true;
        btn.disabled = true;
        input.placeholder = "Connecting...";
    }
}

// ============ Messages ============
function renderMessages(peerId) {
    const container = document.getElementById('messages');
    const chat = chats.get(peerId);
    container.innerHTML = '';

    let lastDay = null;
    chat.messages.forEach(msg => {
        const day = msg.time ? new Date(msg.time).toDateString() : '';
        if (day && day !== lastDay) {
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.innerText = dateLabel(msg.time);
            container.appendChild(divider);
            lastDay = day;
        }

        const wrapper = document.createElement('div');
        wrapper.className = `message-row ${msg.type}`;

        if (msg.type === 'system') {
            wrapper.classList.add('system');
            wrapper.innerHTML = `<div class="date-divider">${escapeHtml(msg.text)}</div>`;
        } else if (msg.type === 'received') {
            const name = chat.isGroup ? (msg.senderUsername || chat.username) : chat.username;
            wrapper.innerHTML = `
                <div class="row-avatar" style="background:${avatarColor(name)}">${initials(name)}</div>
                <div class="row-main">
                    ${chat.isGroup ? `<span class="sender-name" style="color:${avatarColor(msg.senderUsername || chat.username)}">${escapeHtml(msg.senderUsername || chat.username)}</span>` : ''}
                    <div class="bubble received">${escapeHtml(msg.text)}</div>
                    <span class="msg-time">${formatTime(msg.time)}</span>
                </div>
            `;
        } else {
            // Sent message — bubble + badge seen indicator overlapping corner
            wrapper.innerHTML = `
                <div class="sent-group">
                    <div class="bubble sent">${escapeHtml(msg.text)}
                        <span class="msg-time-inside">${formatTime(msg.time)}</span>
                    </div>
                    <span class="receipt-badge ${msg.isRead ? 'seen' : ''}">${whisperIconSVG}</span>
                </div>
            `;
        }

        container.appendChild(wrapper);
    });

    container.scrollTop = container.scrollHeight;
}

// ============ New Chat ============
document.getElementById('btn-new-chat').onclick = () => {
    const username = document.getElementById('new-chat-input').value.trim();
    if (!username || username === myUsername) return;
    document.getElementById('new-chat-input').value = '';

    const resolvePacket = buildPacket(CMD_RESOLVE, 0, myId, username);
    ws.send(obfuscate(resolvePacket));
};
document.getElementById('new-chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-new-chat').click();
});

// =======================
// GLOBAL SEARCH PANEL
// =======================
const searchPanel = document.getElementById('panel-global-search');
const btnBackSearch = document.getElementById('btn-back-search');
const mainSearchInput = document.getElementById('new-chat-input');
const globalSearchInput = document.getElementById('global-search-input');
const searchTabs = document.querySelectorAll('.search-tab');

mainSearchInput.addEventListener('focus', () => {
    searchPanel.classList.add('active');
    setTimeout(() => {
        globalSearchInput.focus();
    }, 300); // Wait for slide animation
});

btnBackSearch.addEventListener('click', () => {
    searchPanel.classList.remove('active');
    globalSearchInput.value = ''; // clear search
    mainSearchInput.blur(); // remove focus from main search to allow clicking it again
});

// Close search on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchPanel.classList.contains('active')) {
        btnBackSearch.click();
    }
});

searchTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        searchTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // Future logic: Filter search results based on tab selection
    });
});

// =======================
// USER SETTINGS PANEL
// =======================
const settingsPanel = document.getElementById('panel-settings');
const btnSettings = document.getElementById('btn-settings');
const btnBackSettings = document.getElementById('btn-back-settings');
const btnLogout = document.getElementById('btn-settings-logout');
const colorSwatches = document.querySelectorAll('.color-swatch');

// New Preferences inputs
const prefTheme = document.getElementById('pref-theme');
const prefDisplay = document.getElementById('pref-display');
const prefFontScale = document.getElementById('pref-font-scale');
const prefMsgSpace = document.getElementById('pref-msg-space');
const prefZoom = document.getElementById('pref-zoom');
const prefEmbeds = document.getElementById('pref-embeds');
const prefReactions = document.getElementById('pref-reactions');
const prefAutoplayGif = document.getElementById('pref-autoplay-gif');
const prefReducedMotion = document.getElementById('pref-reduced-motion');

function savePreferences() {
    myPreferences = {
        theme: prefTheme.value,
        display: prefDisplay.value,
        fontScale: prefFontScale.value,
        msgSpace: prefMsgSpace.value,
        zoom: prefZoom.value,
        embeds: prefEmbeds.checked,
        reactions: prefReactions.checked,
        autoplayGif: prefAutoplayGif.checked,
        reducedMotion: prefReducedMotion.checked
    };
    applyPreferences(myPreferences);
    
    // Save to backend instantly
    const updatePacket = buildPacket(CMD_USER_UPDATE, 0, myId, JSON.stringify({ preferences: myPreferences }));
    if (myId) ws.send(obfuscate(updatePacket));
}

function updateCustomSelectUI(select) {
    if (!select) return;
    const wrapper = select.previousElementSibling;
    if (wrapper && wrapper.classList.contains('custom-select-wrapper')) {
        const selectedOpt = select.options[select.selectedIndex];
        if (selectedOpt) {
            wrapper.querySelector('.custom-select-trigger span').innerText = selectedOpt.text;
            wrapper.querySelectorAll('.custom-option').forEach(o => {
                o.classList.toggle('selected', o.dataset.value === select.value);
            });
        }
    }
}

function initCustomSelects() {
    document.querySelectorAll('.settings-select').forEach(select => {
        select.style.display = 'none';
        
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        
        const selectedOpt = select.options[select.selectedIndex];
        trigger.innerHTML = `<span>${selectedOpt ? selectedOpt.text : ''}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        
        const optionsDiv = document.createElement('div');
        optionsDiv.className = 'custom-options';
        
        Array.from(select.options).forEach((opt, idx) => {
            const optDiv = document.createElement('div');
            optDiv.className = 'custom-option';
            optDiv.dataset.value = opt.value;
            optDiv.innerText = opt.text;
            
            if (idx === select.selectedIndex) optDiv.classList.add('selected');
            
            optDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                select.value = opt.value;
                select.dispatchEvent(new Event('change'));
                
                trigger.querySelector('span').innerText = opt.text;
                optionsDiv.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                optDiv.classList.add('selected');
                optionsDiv.classList.remove('open');
            });
            optionsDiv.appendChild(optDiv);
        });
        
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-options').forEach(o => {
                if (o !== optionsDiv) o.classList.remove('open');
            });
            optionsDiv.classList.toggle('open');
        });
        
        wrapper.appendChild(trigger);
        wrapper.appendChild(optionsDiv);
        select.parentNode.insertBefore(wrapper, select);
    });
    
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-options').forEach(o => o.classList.remove('open'));
    });
}
initCustomSelects();

function updateSliderBackground(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const percentage = ((val - min) / (max - min)) * 100;
    slider.style.backgroundSize = `${percentage}% 100%`;
}

function applyPreferences(prefs) {
    if (!prefs) return;
    
    // UI Elements Sync
    if (prefs.theme) { prefTheme.value = prefs.theme; updateCustomSelectUI(prefTheme); }
    if (prefs.display) { prefDisplay.value = prefs.display; updateCustomSelectUI(prefDisplay); }
    if (prefs.fontScale) { prefFontScale.value = prefs.fontScale; updateSliderBackground(prefFontScale); }
    if (prefs.msgSpace) { prefMsgSpace.value = prefs.msgSpace; updateSliderBackground(prefMsgSpace); }
    if (prefs.zoom) { prefZoom.value = prefs.zoom; updateCustomSelectUI(prefZoom); }
    if (prefs.embeds !== undefined) prefEmbeds.checked = prefs.embeds;
    if (prefs.reactions !== undefined) prefReactions.checked = prefs.reactions;
    if (prefs.autoplayGif !== undefined) prefAutoplayGif.checked = prefs.autoplayGif;
    if (prefs.reducedMotion !== undefined) prefReducedMotion.checked = prefs.reducedMotion;

    // DOM & CSS Var overrides
    document.body.dataset.theme = prefs.theme || 'light';
    document.body.dataset.display = prefs.display || 'cozy';
    document.body.dataset.reducedMotion = prefs.reducedMotion || false;
    
    if (prefs.fontScale) document.documentElement.style.setProperty('--chat-font-size', prefs.fontScale + 'px');
    if (prefs.msgSpace) document.documentElement.style.setProperty('--chat-msg-spacing', prefs.msgSpace + 'px');
    if (prefs.zoom) document.documentElement.style.setProperty('--app-zoom', prefs.zoom);
}

[prefTheme, prefDisplay].forEach(el => el.addEventListener('change', savePreferences));
[prefFontScale, prefMsgSpace].forEach(el => el.addEventListener('input', (e) => {
    updateSliderBackground(e.target);
    savePreferences();
}));
prefZoom.addEventListener('change', savePreferences);
[prefEmbeds, prefReactions, prefAutoplayGif, prefReducedMotion].forEach(el => el.addEventListener('change', savePreferences));

function applyThemeColor(color) {
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-light', color + '40');
    document.documentElement.style.setProperty('--accent-hover', color + 'dd');
    localStorage.setItem('whispr_accent_color', color);
    
    colorSwatches.forEach(s => {
        s.classList.toggle('active', s.dataset.color === color);
    });
}

// Load saved color initially for fast boot, but server might override on login
const savedColor = localStorage.getItem('whispr_accent_color');
if (savedColor) applyThemeColor(savedColor);

btnSettings.addEventListener('click', () => {
    document.getElementById('settings-display-name').value = myUsername;
    document.getElementById('settings-bio').value = myBio;
    
    const avatarPicker = document.getElementById('settings-avatar-picker');
    if (myAvatarUrl) {
        avatarPicker.innerHTML = `<img src="${myAvatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    }
    
    settingsPanel.classList.add('active');
});

btnBackSettings.addEventListener('click', () => {
    settingsPanel.classList.remove('active');
});

btnLogout.addEventListener('click', () => {
    localStorage.removeItem('whispr_session');
    location.reload();
});

// Appearance changes
colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
        const color = swatch.dataset.color;
        applyThemeColor(color);
        
        // Save to backend instantly
        const updatePacket = buildPacket(CMD_USER_UPDATE, 0, myId, JSON.stringify({ themeColor: color }));
        ws.send(obfuscate(updatePacket));
    });
});

// Profile Pic Picker
setupImagePicker('settings-avatar-picker', (croppedB64) => {
    pendingSpaceAvatar = croppedB64; // Reuse variable or just hold it
});

document.getElementById('btn-save-profile').addEventListener('click', () => {
    const bio = document.getElementById('settings-bio').value;
    const updatePacket = buildPacket(CMD_USER_UPDATE, 0, myId, JSON.stringify({
        avatarUrl: pendingSpaceAvatar,
        bio: bio
    }));
    ws.send(obfuscate(updatePacket));
    
    // Optimistic UI close
    settingsPanel.classList.remove('active');
});

// =======================
// SIDE PANELS (NEW GROUP / FEED)
// =======================
document.getElementById('btn-send').onclick = async () => {
    if (!currentActiveChat) return;
    const chat = chats.get(currentActiveChat);
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || (!chat.isSecure && !chat.isGroup)) return;

    input.value = '';

    if (chat.isGroup) {
        chat.messages.push({ senderId: myId, senderUsername: myUsername, text, type: 'sent', isRead: true, time: Date.now() });
        renderMessages(currentActiveChat);
        renderChatList();
        const packet = buildPacket(CMD_GROUP_MSG, 0, myId, JSON.stringify({ groupId: chat.groupId, text }));
        ws.send(obfuscate(packet));
        return;
    }

    chat.messages.push({ text, type: 'sent', isRead: false, time: Date.now() });
    await persistKeys();

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
    if (!chat.isSecure || chat.isGroup) return;

    const now = Date.now();
    if (now - lastTypingSent > 500) {
        lastTypingSent = now;
        const typingPacket = buildPacket(CMD_TYPING, currentActiveChat, myId, "");
        ws.send(obfuscate(typingPacket));
    }
});

// ============ Typing Indicator (in-chat) ============
let typingTimeout = null;
function showTypingIndicator() {
    const container = document.getElementById('messages');
    let indicator = document.getElementById('typing-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'typing-indicator';
        indicator.className = 'typing-indicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';
        container.appendChild(indicator);
    }
    indicator.style.display = 'flex';
    container.scrollTop = container.scrollHeight;

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { indicator.style.display = 'none'; }, 1500);
}

// ============ Groups ============
document.getElementById('my-avatar').onclick = (e) => {
    e.stopPropagation();
    const popover = document.getElementById('profile-popover');
    popover.style.display = popover.style.display === 'none' ? 'flex' : 'none';
};
document.addEventListener('click', () => {
    const popover = document.getElementById('profile-popover');
    if (popover) popover.style.display = 'none';
});

document.getElementById('btn-logout').onclick = () => {
    localStorage.removeItem('whispr_session');
    location.reload();
};

// ============ Groups & Feeds (Side Panels) ============
let pendingSpaceMembers = [];
let pendingFeedAvatar = null;
let pendingSpaceAvatar = null;

let currentCropper = null;
let activeCropCallback = null;
let activeCropElementId = null;

function setupImagePicker(elementId, callback) {
    document.getElementById(elementId).onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const b64 = ev.target.result;
                openCropModal(b64, elementId, callback);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    };
}

function openCropModal(imageSrc, elementId, callback) {
    const cropModal = document.getElementById('crop-modal');
    const container = document.getElementById('croppie-container');
    
    cropModal.style.display = 'flex';
    
    // Cleanup old croppie instance
    if (currentCropper) {
        currentCropper.destroy();
        currentCropper = null;
    }
    
    // Initialize Croppie
    currentCropper = new Croppie(container, {
        viewport: { width: 256, height: 256, type: 'circle' },
        boundary: { width: '100%', height: 300 },
        showZoomer: true,
        enableOrientation: true
    });
    
    currentCropper.bind({
        url: imageSrc
    });
    
    activeCropCallback = callback;
    activeCropElementId = elementId;
}

document.getElementById('btn-apply-crop').onclick = () => {
    if (!currentCropper) return;
    
    currentCropper.result({
        type: 'base64',
        size: 'viewport',
        format: 'png',
        circle: false // Croppie natively handles the circular crop if viewport is circle and format is png
    }).then(function (croppedB64) {
        document.getElementById(activeCropElementId).style.backgroundImage = `url(${croppedB64})`;
        document.getElementById(activeCropElementId).innerHTML = ''; // hide camera icon
        
        if (activeCropCallback) activeCropCallback(croppedB64);
        
        closeCropModal();
    });
};

document.getElementById('btn-cancel-crop').onclick = () => {
    closeCropModal();
};

function closeCropModal() {
    document.getElementById('crop-modal').style.display = 'none';
    if (currentCropper) {
        currentCropper.destroy();
        currentCropper = null;
    }
}

setupImagePicker('feed-avatar-picker', (b64) => pendingFeedAvatar = b64);
setupImagePicker('space-avatar-picker', (b64) => pendingSpaceAvatar = b64);

document.getElementById('btn-new-space').onclick = () => {
    const listEl = document.getElementById('space-member-list');
    listEl.innerHTML = '';
    chats.forEach(chat => {
        if (chat.isGroup || chat.peerId === myId) return;
        const row = document.createElement('label');
        row.className = 'group-member';
        row.innerHTML = `
            <input type="checkbox" value="${chat.peerId}">
            <span class="gm-avatar" style="background:${avatarColor(chat.username)}">${initials(chat.username)}</span>
            <span class="gm-name">${escapeHtml(chat.username)}</span>
        `;
        listEl.appendChild(row);
    });
    document.getElementById('panel-space-step1').classList.add('active');
};

document.getElementById('btn-space-next').onclick = () => {
    pendingSpaceMembers = Array.from(document.querySelectorAll('#space-member-list input:checked')).map(cb => parseInt(cb.value));
    
    // Populate selected members list for step 2
    const selEl = document.getElementById('space-selected-members');
    selEl.innerHTML = '';
    pendingSpaceMembers.forEach(id => {
        const chat = chats.get(id);
        if(chat) {
            selEl.innerHTML += `<div style="font-size:13px; margin-bottom:4px;">${escapeHtml(chat.username)}</div>`;
        }
    });

    document.getElementById('panel-space-step2').classList.add('active');
};

document.getElementById('btn-create-space-fab').onclick = () => {
    const name = document.getElementById('space-name').value.trim() || 'New Space';
    const description = document.getElementById('space-desc').value.trim();
    
    const payload = { name, members: pendingSpaceMembers, description, avatarUrl: pendingSpaceAvatar };
    const packet = buildPacket(CMD_GROUP_CREATE, 0, myId, JSON.stringify(payload));
    ws.send(obfuscate(packet));

    // Close panels
    document.getElementById('panel-space-step1').classList.remove('active');
    document.getElementById('panel-space-step2').classList.remove('active');
};

document.getElementById('btn-new-feed').onclick = () => {
    document.getElementById('feed-name').value = '';
    document.getElementById('feed-desc').value = '';
    pendingFeedAvatar = null;
    document.getElementById('feed-avatar-picker').style.backgroundImage = 'none';
    document.getElementById('feed-avatar-picker').innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`;
    
    document.getElementById('panel-new-feed').classList.add('active');
};

document.getElementById('btn-create-feed-fab').onclick = () => {
    const name = document.getElementById('feed-name').value.trim() || 'New Feed';
    const description = document.getElementById('feed-desc').value.trim();
    
    const payload = { name, members: [], isFeed: true, description, avatarUrl: pendingFeedAvatar };
    const packet = buildPacket(CMD_GROUP_CREATE, 0, myId, JSON.stringify(payload));
    ws.send(obfuscate(packet));

    document.getElementById('panel-new-feed').classList.remove('active');
};

// Back Buttons
document.getElementById('btn-back-feed').onclick = () => document.getElementById('panel-new-feed').classList.remove('active');
document.getElementById('btn-back-space1').onclick = () => document.getElementById('panel-space-step1').classList.remove('active');
document.getElementById('btn-back-space2').onclick = () => document.getElementById('panel-space-step2').classList.remove('active');

// ============ Nav placeholders ============
['btn-logo', 'btn-chats', 'btn-files', 'btn-contacts', 'btn-notifications', 'btn-settings', 'btn-filter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => console.log(`[Nav] ${id} clicked`));
});
