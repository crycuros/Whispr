import { state } from './store.js';
import { CMD_LOGIN, CMD_REGISTER_OK, CMD_ERROR, CMD_LOGIN_OK, CMD_RESOLVE_OK, CMD_DH_INIT, CMD_DH_REPLY, CMD_USER_UPDATE_OK, CMD_ENC_MSG, CMD_TYPING, CMD_READ, CMD_GROUP_CREATE_OK, CMD_GROUP_INFO_OK, CMD_GROUP_MSG_RELAY, CMD_GROUP_READ, CMD_MSG_DELETE, CMD_PRESENCE, CMD_RTC_CALL, CMD_RTC_ANSWER, CMD_RTC_REJECT, CMD_RTC_END, CMD_RTC_ICE, CMD_VAULT_UPLOAD_OK, CMD_VAULT_LIST_OK, CMD_VAULT_DOWNLOAD_OK, CMD_LINK_PREVIEW_RES, CMD_REQ_SEND_OK, CMD_REQ_RECEIVED, CMD_REQ_ACCEPTED, CMD_REQ_DECLINED, CMD_REQ_LIST, CMD_REQ_LIST_OK, CMD_IDENTITY_KEY_RES, CMD_GROUP_KEY_GET_OK, CMD_VOICE_UPLOAD_OK, CMD_VOICE_GET_OK, buildPacket, parsePacket, obfuscate, deobfuscate, deriveSharedSecret, decryptPayload } from './amproto.js';
import { setupAuth, showError } from '../features/auth.js';
import { setupPolls, castVote } from '../features/polls.js';
import { loadBookmarks } from './bookmarks.js';
import { renderChatList, getOrCreateChat, initials, avatarColor } from '../ui/chatList.js';
import { renderMessages, appendMessage, openChat, updateChatStatus, updateGroupStatus, showTypingIndicator, setupMessageUI, handleVoiceUploadOk, handleVoiceGetOk } from '../ui/messages.js';
import { setupModals, applyPreferences, applyThemeColor } from '../ui/modals.js';
import { renderResolvedProfile, renderPendingRequests, addPendingRequest, removePendingRequest, setupFriendsUI } from '../ui/friends.js';
import * as WebRTC from '../features/webrtc.js';
import * as Vault from '../features/vault.js';
import { initCallUI } from '../ui/callUI.js';
import { ensureIdentityKeyPair, uploadIdentityKey, handleIdentityKeyRes, handleGroupKeyGetOk, ensureGroupKey, decryptGroupText } from './grouplock.js';

if (localStorage.getItem('whispr_session')) {
    document.getElementById('auth-modal').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('app-container').style.opacity = '1';
    document.getElementById('update-toast').style.display = 'flex';
}

// Breakpoints are based on the VISUAL window width (window.innerWidth), which
// stays constant under root `zoom`, so zooming never flips the app into a
// "narrow"/"mobile" layout on a desktop window. Container/media queries would
// evaluate against the zoomed layout space instead (visualWidth / zoom).
function updateViewportBreakpoints() {
    const w = window.innerWidth;
    document.documentElement.dataset.panel = w <= 600 ? 'mobile' : (w <= 900 ? 'narrow' : '');
}
window.addEventListener('resize', updateViewportBreakpoints);
updateViewportBreakpoints();

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
state.ws = new WebSocket(`${protocol}//${window.location.host}`);
state.ws.binaryType = 'arraybuffer';

state.ws.onopen = () => {
    console.log("Connected to Relay Server");
    const session = localStorage.getItem('whispr_session');
    if (session) {
        const { user, token } = JSON.parse(session);
        state.myUsername = user;
        loadBookmarks();
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

            await ensureIdentityKeyPair();
            await uploadIdentityKey();

            const reqListPacket = buildPacket(CMD_REQ_LIST, 0, state.myId, '{}');
            state.ws.send(obfuscate(reqListPacket));
        }
        else if (packet.command === CMD_IDENTITY_KEY_RES) {
            handleIdentityKeyRes(JSON.parse(packet.payloadString));
        }
        else if (packet.command === CMD_GROUP_KEY_GET_OK) {
            handleGroupKeyGetOk(JSON.parse(packet.payloadString));
        }
        else if (packet.command === CMD_RESOLVE_OK) {
            const data = JSON.parse(packet.payloadString);
            renderResolvedProfile(data);
        }
        else if (packet.command === CMD_REQ_LIST_OK) {
            const data = JSON.parse(packet.payloadString);
            state.pendingRequests = (data.pending || []).filter(r => r.requestId !== state.myId);
            renderPendingRequests();
        }
        else if (packet.command === CMD_REQ_SEND_OK) {
            const data = JSON.parse(packet.payloadString);
            if (state.resolvedProfile && state.resolvedProfile.userId === data.userId) {
                state.resolvedProfile.friendStatus = 'pending';
                renderResolvedProfile(state.resolvedProfile);
            }
        }
        else if (packet.command === CMD_REQ_RECEIVED) {
            const data = JSON.parse(packet.payloadString);
            addPendingRequest({ requestId: data.requestId, fromId: data.fromId, fromUsername: data.fromUsername, note: data.note || '' });
        }
        else if (packet.command === CMD_REQ_ACCEPTED) {
            const data = JSON.parse(packet.payloadString);
            const peerId = data.userId;
            const chat = getOrCreateChat(peerId);
            chat.username = data.username;
            removePendingRequest(peerId);
            renderChatList();
            if (state.resolvedProfile && state.resolvedProfile.userId === peerId) {
                state.resolvedProfile.friendStatus = 'friends';
                renderResolvedProfile(state.resolvedProfile);
            }
        }
        else if (packet.command === CMD_REQ_DECLINED) {
            const data = JSON.parse(packet.payloadString);
            if (state.resolvedProfile && state.resolvedProfile.userId === data.userId) {
                state.resolvedProfile.friendStatus = 'none';
                renderResolvedProfile(state.resolvedProfile);
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
                time: Date.now(), 
                audioId: msgObj.audioId, 
                duration: msgObj.duration, 
                mime: msgObj.mime 
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
            // Check if it's a group typing packet
            let groupTyping = null;
            try { if (packet.payloadString) groupTyping = JSON.parse(packet.payloadString); } catch(e) {}

            if (groupTyping && groupTyping.groupId) {
                const groupPeerId = 'group_' + groupTyping.groupId;
                const chat = state.chats.get(groupPeerId);
                if (!chat) return;
                chat.typingUser = groupTyping.username || `User ${packet.senderId}`;
                chat.typing = true;
                clearTimeout(chat._typingTimer);
                chat._typingTimer = setTimeout(() => { chat.typing = false; chat.typingUser = null; renderChatList(); }, 3000);
                if (state.currentActiveChat === groupPeerId) showTypingIndicator(chat.typingUser);
                renderChatList();
            } else {
                const chat = state.chats.get(sender);
                if (!chat) return;
                chat.typing = true;
                clearTimeout(chat._typingTimer);
                chat._typingTimer = setTimeout(() => { chat.typing = false; renderChatList(); }, 3000);
                if (state.currentActiveChat === sender) showTypingIndicator();
                renderChatList();
            }
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
            const { groupId, name, description, avatarUrl, members, memberNames, isFeed, creatorId } = payload;
            const groupPeerId = 'group_' + groupId;
            state.chats.set(groupPeerId, {
                peerId: groupPeerId,
                isGroup: true,
                isFeed: isFeed,
                creatorId: creatorId,
                groupId: groupId,
                username: name,
                description: description,
                avatarUrl: avatarUrl,
                members: members,
                memberNames: memberNames || state.chats.get(groupPeerId)?.memberNames || {},
                messages: state.chats.get(groupPeerId)?.messages || [],
                unreadCount: state.chats.get(groupPeerId)?.unreadCount || 0
            });
            ensureGroupKey(state.chats.get(groupPeerId)).catch(() => {});
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
            else if (chat.memberNames && chat.memberNames[senderId]) senderName = chat.memberNames[senderId];
            else if (state.chats.has(senderId)) senderName = state.chats.get(senderId).username;

            let msgObj;
            try {
                const env = JSON.parse(text);
                if (env && env.v === 1) {
                    await ensureGroupKey(chat);
                    if (chat.groupKey) {
                        msgObj = await decryptGroupText(chat.groupKey, text);
                    } else {
                        msgObj = { text: '[encrypted]' };
                    }
                } else {
                    msgObj = env;
                }
            } catch(e) {
                msgObj = { text: text };
            }

            const matchId = msgObj.id || messageId;
            const existing = chat.messages.find(m => m.id === matchId);
            if (existing) {
                existing.messageId = messageId;
                if (msgObj.timer !== undefined) existing.timer = msgObj.timer;
                if (msgObj.text && !msgObj.audioId) existing.text = msgObj.text;
                if (msgObj.imgData) existing.imgData = msgObj.imgData;
                if (msgObj.isInvisible !== undefined) existing.isInvisible = msgObj.isInvisible;
                if (msgObj.audioId) existing.audioId = msgObj.audioId;
                if (msgObj.duration) existing.duration = msgObj.duration;
                if (msgObj.mime) existing.mime = msgObj.mime;
                if (state.currentActiveChat === groupPeerId) {
                    const groupReadPacket = buildPacket(CMD_GROUP_READ, 0, state.myId, JSON.stringify({ groupId: chat.groupId, lastReadMsgId: messageId }));
                    state.ws.send(obfuscate(groupReadPacket));
                }
                await persistKeys();
                renderChatList();
                if (state.currentActiveChat === groupPeerId) renderMessages(groupPeerId);
                return;
            }

            chat.messages.push({
                id: msgObj.id || messageId,
                timer: msgObj.timer,
                senderId: senderId,
                senderUsername: senderName,
                text: msgObj.text || '',
                imgData: msgObj.imgData,
                isInvisible: msgObj.isInvisible,
                audioId: msgObj.audioId,
                duration: msgObj.duration,
                mime: msgObj.mime,
                type: senderId === state.myId ? 'sent' : 'received',
                isRead: true,
                time: Date.now(),
                messageId: messageId
            });

            if (state.currentActiveChat === groupPeerId) {
                appendMessage(groupPeerId, chat.messages[chat.messages.length - 1]);
                const groupReadPacket = buildPacket(CMD_GROUP_READ, 0, state.myId, JSON.stringify({ groupId: chat.groupId, lastReadMsgId: messageId }));
                state.ws.send(obfuscate(groupReadPacket));
            } else {
                chat.unreadCount++;
            }
            await persistKeys();
            renderChatList();
        }
        else if (packet.command === CMD_LINK_PREVIEW_RES) {
            const data = JSON.parse(packet.payloadString);
            if (state.pendingPreviewCallback) {
                state.pendingPreviewCallback(data.url ? data : null);
                state.pendingPreviewCallback = null;
            }
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
        else if (packet.command === CMD_PRESENCE) {
            const data = JSON.parse(packet.payloadString);
            state.presence.set(data.userId, { online: data.online, lastSeen: data.lastSeen || null });
            const cur = state.chats.get(state.currentActiveChat);
            if (cur && cur.isGroup && cur.members.includes(data.userId)) updateGroupStatus(state.currentActiveChat);
            else if (state.currentActiveChat === data.userId) updateChatStatus(data.userId);
            renderChatList();
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
        else if (packet.command === CMD_VOICE_UPLOAD_OK) {
            handleVoiceUploadOk(JSON.parse(packet.payloadString));
        }
        else if (packet.command === CMD_VOICE_GET_OK) {
            handleVoiceGetOk(JSON.parse(packet.payloadString));
        }
    } catch (err) {
        console.error("Protocol Error:", err);
    }
};

export async function persistKeys() {
    const exportableKeys = {};
    for (const [peerId, chat] of state.chats.entries()) {
        if (chat.isGroup) {
            const groupExport = {
                isGroup: true,
                groupId: chat.groupId,
                username: chat.username,
                isFeed: chat.isFeed,
                creatorId: chat.creatorId,
                members: chat.members,
                memberNames: chat.memberNames || {},
                messages: chat.messages,
                isEncrypted: chat.isEncrypted || false
            };
            if (chat.groupKey) {
                const gk = await crypto.subtle.exportKey("raw", chat.groupKey);
                groupExport.groupKey = Array.from(new Uint8Array(gk));
            }
            exportableKeys[peerId] = groupExport;
            continue;
        }
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
    if (state.identityKeyPair) {
        const ipriv = await crypto.subtle.exportKey("pkcs8", state.identityKeyPair.privateKey);
        const ipub = await crypto.subtle.exportKey("raw", state.identityKeyPair.publicKey);
        exportableKeys.__identity = {
            priv: Array.from(new Uint8Array(ipriv)),
            pub: Array.from(new Uint8Array(ipub))
        };
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
            if (peerIdStr === '__identity') {
                const ipriv = await crypto.subtle.importKey("pkcs8", new Uint8Array(dataObj.priv), { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
                const ipub = await crypto.subtle.importKey("raw", new Uint8Array(dataObj.pub), { name: "ECDH", namedCurve: "P-256" }, true, []);
                state.identityKeyPair = { privateKey: ipriv, publicKey: ipub };
                continue;
            }
            if (dataObj.isGroup) {
                // Restore group chat
                const groupPeerId = peerIdStr;
                if (!state.chats.has(groupPeerId)) {
                    state.chats.set(groupPeerId, {
                        peerId: groupPeerId,
                        isGroup: true,
                        groupId: dataObj.groupId,
                        username: dataObj.username,
                        isFeed: dataObj.isFeed,
                        creatorId: dataObj.creatorId,
                        members: dataObj.members || [],
                        memberNames: dataObj.memberNames || {},
                        messages: dataObj.messages || [],
                        unreadCount: 0
                    });
                } else {
                    // Merge: keep existing messages, update meta
                    const existing = state.chats.get(groupPeerId);
                    if (!existing.messages || existing.messages.length === 0) {
                        existing.messages = dataObj.messages || [];
                    }
                    if (dataObj.memberNames) existing.memberNames = dataObj.memberNames;
                }
                const restored = state.chats.get(groupPeerId);
                if (dataObj.groupKey) {
                    restored.groupKey = await crypto.subtle.importKey("raw", new Uint8Array(dataObj.groupKey), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
                    restored.isEncrypted = true;
                }
                continue;
            }
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

const startNewChat = () => {
    const username = document.getElementById('new-chat-input').value.trim();
    if (!username || username === state.myUsername) return;
    document.getElementById('new-chat-input').value = '';

    const resolvePacket = buildPacket(CMD_RESOLVE, 0, state.myId, username);
    state.ws.send(obfuscate(resolvePacket));
};

document.getElementById('new-chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') startNewChat();
});

import { setupChatListUI } from '../ui/chatList.js';
setupChatListUI();
setupAuth();
setupMessageUI();
setupFriendsUI();
setupPolls();
window.castVote = castVote;
setupModals();
initCallUI();
