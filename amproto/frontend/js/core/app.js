import { state } from './store.js';
import { CMD_LOGIN, CMD_REGISTER_OK, CMD_ERROR, CMD_LOGIN_OK, CMD_RESOLVE_OK, CMD_DH_INIT, CMD_DH_REPLY, CMD_USER_UPDATE_OK, CMD_ENC_MSG, CMD_TYPING, CMD_READ, CMD_GROUP_CREATE_OK, CMD_GROUP_INFO_OK, CMD_GROUP_MSG_RELAY, CMD_GROUP_READ, CMD_MSG_DELETE, CMD_RTC_CALL, CMD_RTC_ANSWER, CMD_RTC_REJECT, CMD_RTC_END, CMD_RTC_ICE, CMD_VAULT_UPLOAD_OK, CMD_VAULT_LIST_OK, CMD_VAULT_DOWNLOAD_OK, buildPacket, parsePacket, obfuscate, deobfuscate, deriveSharedSecret, decryptPayload } from './amproto.js';
import { setupAuth, showError } from '../features/auth.js';
import { renderChatList, getOrCreateChat, initials, avatarColor } from '../ui/chatList.js';
import { renderMessages, openChat, showTypingIndicator, setupMessageUI } from '../ui/messages.js';
import { setupModals, applyPreferences, applyThemeColor } from '../ui/modals.js';
import * as WebRTC from '../features/webrtc.js';
import * as Vault from '../features/vault.js';
import { initCallUI } from '../ui/callUI.js';

if (localStorage.getItem('whispr_session')) {
    document.getElementById('auth-modal').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('app-container').style.opacity = '1';
    document.getElementById('update-toast').style.display = 'flex';
}

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
state.ws = new WebSocket(`${protocol}//${window.location.host}`);
state.ws.binaryType = 'arraybuffer';

state.ws.onopen = () => {
    console.log("Connected to Relay Server");
    const session = localStorage.getItem('whispr_session');
    if (session) {
        const { user, token } = JSON.parse(session);
        state.myUsername = user;
        loadPersistedKeys().then(() => {
            const payload = JSON.stringify({ username: user, sessionToken: token });
            const packet = buildPacket(CMD_LOGIN, 0, 0, payload);
            state.ws.send(obfuscate(packet));
        });
    }
};

state.ws.onmessage = async (event) => {
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
            state.myId = data.userId;
            state.myUsername = data.username;
            state.myAvatarUrl = data.avatarUrl;
            state.myBio = data.bio || '';
            
            if (data.themeColor) applyThemeColor(data.themeColor);
            
            state.myPreferences = data.preferences || {};
            applyPreferences(state.myPreferences);
            
            if (data.sessionToken) {
                localStorage.setItem('whispr_session', JSON.stringify({ user: data.username, token: data.sessionToken }));
            }

            const avatar = document.getElementById('my-avatar');
            if (state.myAvatarUrl) {
                avatar.innerHTML = `<img src="${state.myAvatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                avatar.style.background = 'transparent';
            } else {
                avatar.innerText = initials(state.myUsername);
                avatar.style.background = avatarColor(state.myUsername);
            }

            const toast = document.getElementById('update-toast');
            if (toast && toast.style.display !== 'none') {
                setTimeout(() => { toast.style.display = 'none'; }, 800);
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
                const initPacket = buildPacket(CMD_DH_INIT, peerId, state.myId, JSON.stringify({ publicKey: Array.from(new Uint8Array(myPub)), username: state.myUsername }));
                state.ws.send(obfuscate(initPacket));
            }
        }
        else if (packet.command === CMD_DH_INIT) {
            let chat = getOrCreateChat(sender);

            const payload = JSON.parse(packet.payloadString);
            if (payload.username) chat.username = payload.username;

            const peerPublicKeyData = new Uint8Array(payload.publicKey);

            chat.dhKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
            chat.isSecure = false;
            chat.sharedSecretKey = null;
            await persistKeys();
            const myPublicKeyBuffer = await crypto.subtle.exportKey("raw", chat.dhKeyPair.publicKey);

            const peerKey = await crypto.subtle.importKey("raw", peerPublicKeyData, { name: "ECDH", namedCurve: "P-256" }, true, []);
            chat.sharedSecretKey = await deriveSharedSecret(chat.dhKeyPair, peerKey);
            chat.isSecure = true;
            await persistKeys();

            const replyPayload = { publicKey: Array.from(new Uint8Array(myPublicKeyBuffer)), username: state.myUsername };
            const replyPacket = buildPacket(CMD_DH_REPLY, sender, state.myId, JSON.stringify(replyPayload));
            state.ws.send(obfuscate(replyPacket));

            renderChatList();
            if (state.currentActiveChat === sender) openChat(sender);
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
            if (state.currentActiveChat === sender) openChat(sender);
        }
        else if (packet.command === CMD_USER_UPDATE_OK) {
            const data = JSON.parse(packet.payloadString);
            if (data.avatarUrl !== undefined) {
                state.myAvatarUrl = data.avatarUrl;
                const avatar = document.getElementById('my-avatar');
                if (state.myAvatarUrl) {
                    avatar.innerHTML = `<img src="${state.myAvatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                    avatar.style.background = 'transparent';
                }
            }
            if (data.bio !== undefined) state.myBio = data.bio;
        }
        else if (packet.command === CMD_ENC_MSG) {
            let chat = getOrCreateChat(sender);
            if (!chat.sharedSecretKey) return;

            const payload = JSON.parse(packet.payloadString);
            const decryptedMsg = await decryptPayload(chat.sharedSecretKey, payload);
            
            let msgObj;
            try {
                msgObj = JSON.parse(decryptedMsg);
            } catch(e) {
                msgObj = { text: decryptedMsg };
            }

            chat.messages.push({ 
                id: msgObj.id,
                timer: msgObj.timer,
                text: msgObj.text || '', 
                imgData: msgObj.imgData, 
                isInvisible: msgObj.isInvisible, 
                type: 'received', 
                isRead: true, 
                time: Date.now() 
            });
            chat.typing = false;
            await persistKeys();

            if (state.currentActiveChat === sender) {
                const readPacket = buildPacket(CMD_READ, sender, state.myId, "");
                state.ws.send(obfuscate(readPacket));
                renderMessages(sender);
            } else {
                chat.unreadCount++;
            }
            renderChatList();
        }
        else if (packet.command === CMD_TYPING) {
            const chat = state.chats.get(sender);
            if (!chat) return;
            chat.typing = true;
            clearTimeout(chat._typingTimer);
            chat._typingTimer = setTimeout(() => { chat.typing = false; renderChatList(); }, 3000);
            if (state.currentActiveChat === sender) showTypingIndicator();
            renderChatList();
        }
        else if (packet.command === CMD_READ) {
            let chat = getOrCreateChat(sender);
            chat.messages.forEach(m => {
                if (m.type === 'sent') m.isRead = true;
            });
            await persistKeys();
            if (state.currentActiveChat === sender) renderMessages(sender);
            renderChatList();
        }
        else if (packet.command === CMD_GROUP_CREATE_OK || packet.command === CMD_GROUP_INFO_OK) {
            const payload = JSON.parse(packet.payloadString);
            const { groupId, name, description, avatarUrl, members, isFeed, creatorId } = payload;
            const groupPeerId = 'group_' + groupId;
            state.chats.set(groupPeerId, {
                isGroup: true,
                isFeed: isFeed,
                creatorId: creatorId,
                groupId: groupId,
                username: name,
                description: description,
                avatarUrl: avatarUrl,
                members: members,
                messages: state.chats.get(groupPeerId)?.messages || [],
                unreadCount: state.chats.get(groupPeerId)?.unreadCount || 0
            });
            renderChatList();
        }
        else if (packet.command === CMD_GROUP_MSG_RELAY) {
            const payload = JSON.parse(packet.payloadString);
            const { groupId, senderId, text, messageId } = payload;
            const groupPeerId = 'group_' + groupId;
            let chat = state.chats.get(groupPeerId);
            if (!chat) return;

            let senderName = `User ${senderId}`;
            if (senderId === state.myId) senderName = state.myUsername;
            else if (state.chats.has(senderId)) senderName = state.chats.get(senderId).username;

            let msgObj;
            try {
                msgObj = JSON.parse(text);
            } catch(e) {
                msgObj = { text: text };
            }

            chat.messages.push({
                id: msgObj.id || messageId,
                timer: msgObj.timer,
                senderId: senderId,
                senderUsername: senderName,
                text: msgObj.text || '',
                imgData: msgObj.imgData,
                isInvisible: msgObj.isInvisible,
                type: senderId === state.myId ? 'sent' : 'received',
                isRead: true,
                time: Date.now(),
                messageId: messageId
            });

            if (state.currentActiveChat === groupPeerId) {
                const readPacket = buildPacket(CMD_GROUP_READ, 0, state.myId, JSON.stringify({ groupId, lastReadMsgId: messageId }));
                state.ws.send(obfuscate(readPacket));
                renderMessages(groupPeerId);
            } else {
                chat.unreadCount++;
            }
            renderChatList();
        }
        else if (packet.command === CMD_MSG_DELETE) {
            const payload = JSON.parse(packet.payloadString);
            const chatPeer = payload.isGroup ? 'group_' + payload.groupId : sender;
            const chat = state.chats.get(chatPeer);
            if (chat) {
                chat.messages = chat.messages.filter(m => m.id !== payload.msgId);
                await persistKeys();
                if (state.currentActiveChat === chatPeer) renderMessages(chatPeer);
            }
        }
        else if (packet.command === CMD_RTC_CALL) {
            const payload = JSON.parse(packet.payloadString);
            WebRTC.handleIncomingCall(sender, payload);
        }
        else if (packet.command === CMD_RTC_ANSWER) {
            const payload = JSON.parse(packet.payloadString);
            WebRTC.handleAnswer(payload);
        }
        else if (packet.command === CMD_RTC_ICE) {
            const payload = JSON.parse(packet.payloadString);
            WebRTC.handleIceCandidate(payload);
        }
        else if (packet.command === CMD_RTC_REJECT) {
            const payload = JSON.parse(packet.payloadString);
            WebRTC.handleReject(payload);
        }
        else if (packet.command === CMD_RTC_END) {
            WebRTC.handleEnd();
        }
        else if (packet.command === CMD_VAULT_UPLOAD_OK) {
            Vault.handleVaultUploadOk(JSON.parse(packet.payloadString));
        }
        else if (packet.command === CMD_VAULT_LIST_OK) {
            Vault.handleVaultListOk(JSON.parse(packet.payloadString));
        }
        else if (packet.command === CMD_VAULT_DOWNLOAD_OK) {
            Vault.handleVaultDownloadOk(JSON.parse(packet.payloadString));
        }
    } catch (err) {
        console.error("Protocol Error:", err);
    }
};

export async function persistKeys() {
    const exportableKeys = {};
    for (const [peerId, chat] of state.chats.entries()) {
        if (chat.isGroup) continue; 
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
    const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(state.myPasswordHash), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
    const wrappingKey = await crypto.subtle.deriveKey(
        { "name": "PBKDF2", salt: new Uint8Array(16), iterations: 1000, hash: "SHA-256" },
        keyMaterial, { "name": "AES-GCM", "length": 256 }, false, ["encrypt", "decrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedStore = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, new TextEncoder().encode(JSON.stringify(exportableKeys)));

    localStorage.setItem(`whispr_keys_${state.myUsername}`, JSON.stringify({
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encryptedStore))
    }));
}

export async function loadPersistedKeys() {
    const stored = localStorage.getItem(`whispr_keys_${state.myUsername}`);
    if (!stored) return;

    try {
        const { iv, data } = JSON.parse(stored);
        const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(state.myPasswordHash), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
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
        localStorage.removeItem(`whispr_keys_${state.myUsername}`);
    }
}

document.getElementById('btn-new-chat').onclick = () => {
    const username = document.getElementById('new-chat-input').value.trim();
    if (!username || username === state.myUsername) return;
    document.getElementById('new-chat-input').value = '';

    const resolvePacket = buildPacket(CMD_RESOLVE, 0, state.myId, username);
    state.ws.send(obfuscate(resolvePacket));
};

document.getElementById('new-chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-new-chat').click();
});

import { setupChatListUI } from '../ui/chatList.js';
setupChatListUI();
setupAuth();
setupMessageUI();
setupModals();
initCallUI();
