import { state } from '../core/store.js';
import { initials, avatarColor, escapeHtml, formatTime, formatListTime, dateLabel, whisperIconSVG, renderChatList } from './chatList.js';
import { CMD_READ, CMD_TYPING, CMD_GROUP_MSG, CMD_GROUP_READ, CMD_ENC_MSG, CMD_DH_INIT, CMD_LINK_PREVIEW_REQ, CMD_VOICE_UPLOAD, CMD_VOICE_GET, CMD_VOICE_UPLOAD_OK, CMD_VOICE_GET_OK, buildPacket, obfuscate, encryptPayload } from '../core/amproto.js';
import { encryptGroupText, encryptBytes, decryptBytes } from '../core/grouplock.js';
import { isBookmarked, toggleBookmark, loadBookmarks, getBookmarkedMessages, isBookmarkFilterActive, setBookmarkFilterActive } from '../core/bookmarks.js';
import { persistKeys } from '../core/app.js';
import { fetchLatest, setupHistoryScroll } from '../core/history.js';
import { renderPoll } from '../features/polls.js';
import { fileBubbleHTML, downloadFile } from '../features/files.js';

let voiceGetResolve = null;

const bookmarkSVGOutline = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
const bookmarkSVGFilled = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';

export function handleVoiceGetOk(data) {
    if (voiceGetResolve) { const r = voiceGetResolve; voiceGetResolve = null; r(data); }
}

let voiceUploadResolve = null;

export function handleVoiceUploadOk(data) {
    if (voiceUploadResolve) { const r = voiceUploadResolve; voiceUploadResolve = null; r(data); }
}

function waitForVoiceUpload() {
    return new Promise((resolve) => {
        voiceUploadResolve = (data) => resolve(data || null);
        setTimeout(() => { if (voiceUploadResolve) { voiceUploadResolve = null; resolve(null); } }, 8000);
    });
}

function formatRecTime(seconds) {
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}

function fetchVoiceClip(audioId) {
    return new Promise((resolve) => {
        voiceGetResolve = (data) => resolve(data || null);
        const pkt = buildPacket(CMD_VOICE_GET, 0, state.myId, JSON.stringify({ id: audioId }));
        if (state.ws) state.ws.send(obfuscate(pkt));
        setTimeout(() => { if (voiceGetResolve) { voiceGetResolve = null; resolve(null); } }, 8000);
    });
}

async function loadVoiceSrc(msg, chat) {
    if (!window.__audioCache) window.__audioCache = {};
    if (window.__audioCache[msg.audioId]) return window.__audioCache[msg.audioId];
    try {
        const data = await fetchVoiceClip(msg.audioId);
        if (!data || !data.encData) return null;
        const env = JSON.parse(atob(data.encData));
        const key = chat.isGroup ? chat.groupKey : chat.sharedSecretKey;
        if (!key) return null;
        const plain = await decryptBytes(key, env);
        const blob = new Blob([plain], { type: data.mime || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        window.__audioCache[msg.audioId] = url;
        renderWaveform(msg.audioId, url);
        return url;
    } catch (e) {
        console.error('voice load error:', e);
        return null;
    }
}

function voicePlayerHTML(msg, chat) {
    const dur = Math.ceil(msg.duration || 0);
    return `
        <div class="voice-bubble" data-audio-id="${escapeHtml(String(msg.audioId))}">
            <button class="play-btn voice-play" data-audio-id="${escapeHtml(String(msg.audioId))}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </button>
            <div class="waveform">
                ${Array.from({ length: 24 }, (_, i) => `<span style="height:${6 + Math.abs(Math.sin(i * 0.7)) * 14}px;--i:${i}"></span>`).join('')}
            </div>
            <span class="duration">${dur}s</span>
        </div>`;
}

let __voiceCtx = null;
function voiceAudioCtx() {
    if (!__voiceCtx) __voiceCtx = new (window.AudioContext || window.webkitAudioContext)();
    return __voiceCtx;
}

async function computeWaveform(url, bars = 24) {
    try {
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        const audioCtx = voiceAudioCtx();
        const audioBuf = await audioCtx.decodeAudioData(buf);
        const data = audioBuf.getChannelData(0);
        const heights = [];
        const step = Math.floor(data.length / bars);
        const rmsArr = [];
        for (let i = 0; i < bars; i++) {
            const start = i * step;
            const end = (i === bars - 1) ? data.length : start + step;
            let sum = 0, count = 0;
            for (let j = start; j < end; j += 8) {
                sum += Math.abs(data[j]);
                count++;
            }
            rmsArr.push(count ? sum / count : 0);
        }
        const maxRms = Math.max(...rmsArr);
        for (let i = 0; i < bars; i++) {
            const v = maxRms > 0.001 ? (rmsArr[i] / maxRms) * 24 : (rmsArr[i] * 160);
            heights.push(Math.round(Math.max(3, Math.min(24, v))));
        }
        return heights;
    } catch (e) {
        console.error('waveform compute error:', e);
        return null;
    }
}

function renderWaveform(audioId, url) {
    if (!window.__waveCache) window.__waveCache = {};
    if (window.__waveCache[audioId]) return;
    computeWaveform(url).then((heights) => {
        if (!heights) return;
        window.__waveCache[audioId] = heights;
        document.querySelectorAll(`.voice-bubble[data-audio-id="${audioId}"]`).forEach(b => applyWaveform(b, heights));
    });
}

function applyWaveform(bubble, heights) {
    const bars = bubble.querySelectorAll('.waveform span');
    if (!bars.length) return;
    bars.forEach((b, i) => { if (heights[i] != null) b.style.height = heights[i] + 'px'; });
}

export function openChat(peerId) {
    state.currentActiveChat = peerId;
    const chat = state.chats.get(peerId);
    if (!chat) return;
    const pop = document.getElementById('members-popover');
    if (pop) pop.style.display = 'none';

    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('main-chat-area').style.display = 'flex';
    document.querySelector('.messages-panel')?.classList.remove('mobile-visible');
    document.getElementById('chat-title').innerText = chat.username;

    const headerAvatar = document.getElementById('header-avatar');
    headerAvatar.innerText = chat.isGroup ? '' : initials(chat.username);
    headerAvatar.style.background = avatarColor(chat.username);

    if (chat.isGroup) {
        updateGroupStatus(peerId);
    } else {
        updateChatStatus(peerId);
    }

    if (chat.unreadCount > 0) {
        if (chat.isGroup) {
            const lastMsg = chat.messages[chat.messages.length - 1];
            const readPacket = buildPacket(CMD_GROUP_READ, 0, state.myId, JSON.stringify({ groupId: chat.groupId, lastReadMsgId: lastMsg ? (lastMsg.messageId || 0) : 0 }));
            if (state.ws) state.ws.send(obfuscate(readPacket));
        } else {
            const readPacket = buildPacket(CMD_READ, peerId, state.myId, "");
            if (state.ws) state.ws.send(obfuscate(readPacket));
        }
        chat.unreadCount = 0;
    }

    renderChatList();
    renderMessages(peerId);

    if (chat.messages.length === 0) fetchLatest(peerId);

    const input = document.getElementById('msg-input');
    const btn = document.getElementById('btn-send');
    if (chat.isSecure) {
        input.disabled = false;
        btn.disabled = false;
        input.placeholder = "Type an encrypted message...";
        input.focus({ preventScroll: true });
    } else if (chat.isGroup) {
        if (chat.isFeed && chat.creatorId !== state.myId) {
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

    const btnPoll = document.getElementById('btn-poll');
    if (btnPoll) {
        if (chat.isGroup && !(chat.isFeed && chat.creatorId !== state.myId)) {
            btnPoll.style.display = 'flex';
        } else {
            btnPoll.style.display = 'none';
        }
    }

    if (!chat.isGroup && !chat.isSecure && !chat.dhKeyPair && state.ws && state.myId) {
        ensureHandshake(peerId, chat);
    }
}

export function updateGroupStatus(peerId) {
    const statusEl = document.getElementById('crypto-status');
    if (!statusEl || state.currentActiveChat !== peerId) return;
    const chat = state.chats.get(peerId);
    if (!chat || !chat.isGroup) return;
    const members = chat.members || [];
    const onlineCount = members.filter(id => id === state.myId || state.presence.get(id)?.online === true).length;
    statusEl.innerText = `${onlineCount}/${members.length} members online`;
    statusEl.className = 'status-text text-muted';
    renderMembersPopover(peerId);
}

export function renderMembersPopover(peerId) {
    const pop = document.getElementById('members-popover');
    if (!pop) return;
    const chat = state.chats.get(peerId);
    if (!chat || !chat.isGroup) {
        pop.style.display = 'none';
        return;
    }
    const names = chat.memberNames || {};
    const members = (chat.members || []).map(id => ({
        id,
        username: names[id] || state.chats.get(id)?.username || `User ${id}`,
        online: id === state.myId || state.presence.get(id)?.online === true
    }));
    pop.innerHTML = members.map(m => `
        <div class="member-row ${m.online ? 'online' : ''}">
            <span class="member-dot ${m.online ? 'text-success' : 'text-muted'}"></span>
            <span class="member-name">${escapeHtml(m.username)}</span>
        </div>`).join('');
}

export function updateChatStatus(peerId) {
    const statusEl = document.getElementById('crypto-status');
    if (!statusEl || state.currentActiveChat !== peerId) return;
    const chat = state.chats.get(peerId);
    if (!chat || chat.isGroup) return;
    const p = state.presence.get(peerId);
    if (p && p.online) {
        statusEl.innerText = 'Present';
        statusEl.className = 'status-text text-success';
    } else if (p && !p.online) {
        statusEl.innerText = p.lastSeen ? `Away (${formatListTime(p.lastSeen)})` : 'Offline';
        statusEl.className = 'status-text text-muted';
    } else {
        statusEl.innerText = 'Connecting...';
        statusEl.className = 'status-text text-muted';
    }
}

async function ensureHandshake(peerId, chat) {
    try {
        chat.dhKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
        await persistKeys();
        const myPub = await crypto.subtle.exportKey("raw", chat.dhKeyPair.publicKey);
        const initPacket = buildPacket(CMD_DH_INIT, peerId, state.myId, JSON.stringify({ publicKey: Array.from(new Uint8Array(myPub)), username: state.myUsername }));
        state.ws.send(obfuscate(initPacket));
    } catch (e) {
        console.error("Handshake init failed:", e);
    }
}

export function isNarrowLayout() {
    return window.innerWidth <= 600;
}

export function syncMobilePanel() {
    const panel = document.querySelector('.messages-panel');
    if (!panel) return;
    const listIsShown = document.getElementById('empty-state') && document.getElementById('empty-state').style.display !== 'none';
    if (isNarrowLayout() && (!state.currentActiveChat || listIsShown)) {
        panel.classList.add('mobile-visible');
    } else {
        panel.classList.remove('mobile-visible');
    }
}

export function renderMessages(peerId) {
    const container = document.getElementById('messages');
    const chat = state.chats.get(peerId);
    if (!chat || !container) return;
    
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const messages = isBookmarkFilterActive() ? getBookmarkedMessages(chat) : chat.messages;

    let lastDay = null;
    messages.forEach(msg => {
        const day = msg.time ? new Date(msg.time).toDateString() : '';
        if (day && day !== lastDay) {
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.innerText = dateLabel(msg.time);
            fragment.appendChild(divider);
            lastDay = day;
        }
        const el = buildMessageElement(msg, chat, peerId);
        if (el) fragment.appendChild(el);
    });

    container.appendChild(fragment);
    container._histSuppressUntil = Date.now() + 1200;
    container.scrollTop = container.scrollHeight;
}

export function appendMessage(peerId, msg) {
    const container = document.getElementById('messages');
    const chat = state.chats.get(peerId);
    if (!chat || !container || state.currentActiveChat !== peerId) return;
    const el = buildMessageElement(msg, chat, peerId);
    if (!el) return;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
}

let timerTickerInterval = null;

function startTimerTicker() {
    if (timerTickerInterval) return;
    timerTickerInterval = setInterval(() => {
        const peerId = state.currentActiveChat;
        if (!peerId) return;
        const chat = state.chats.get(peerId);
        if (!chat) return;

        let needRender = false;
        for (const msg of chat.messages) {
            if (!msg.timer || msg.timer <= 0 || !msg.readTime) continue;
            const timeLeft = Math.max(0, msg.readTime + (msg.timer * 1000) - Date.now());
            if (timeLeft === 0) {
                chat.messages = chat.messages.filter(m => m.id !== msg.id);
                if (msg.type === 'received') {
                    import('../core/amproto.js').then(AMP => {
                        const packet = AMP.buildPacket(AMP.CMD_MSG_DELETE, 0, state.myId, JSON.stringify({ msgId: msg.id, isGroup: chat.isGroup, groupId: chat.groupId }));
                        if (state.ws) state.ws.send(AMP.obfuscate(packet));
                    });
                }
                import('../core/app.js').then(a => a.persistKeys && a.persistKeys());
                needRender = true;
            } else {
                const badge = document.querySelector(`.timer-badge[data-msg-id="${msg.id}"]`);
                if (badge) {
                    const text = `${Math.ceil(timeLeft / 1000)}s left`;
                    if (badge.textContent !== text) badge.textContent = text;
                }
            }
        }
        if (needRender && state.currentActiveChat === peerId) renderMessages(peerId);
    }, 500);
}

const MSG_LINK_MAX = 60;

function linkifyMessageText(text) {
    if (!text) return '';
    return escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/gi, (match) => {
        const truncated = match.length > MSG_LINK_MAX;
        return `<a class="msg-link${truncated ? ' truncated' : ''}" href="${match}" target="_blank" rel="noopener" title="${match}">${match}</a>`;
    });
}

export function buildMessageElement(msg, chat, peerId) {
        const payloadObj = (msg.text && msg.text.startsWith('{')) ? (() => { try { return JSON.parse(msg.text); } catch(e) { return null; } })() : null;
        const isPoll = payloadObj && payloadObj.type === 'poll';
        const isVote = payloadObj && payloadObj.type === 'vote';
        const isVoice = (payloadObj && payloadObj.type === 'voice') || !!msg.audioId;

        if (isVote) return null;

        const displayString = (payloadObj && payloadObj.text !== undefined) ? payloadObj.text : (msg.text || '');
        let messageContent = linkifyMessageText(displayString);
        if (isPoll) {
            messageContent = renderPoll(msg, chat, payloadObj);
        } else if (isVoice) {
            messageContent = voicePlayerHTML({ ...msg, ...payloadObj }, chat);
            if (window.__waveCache && window.__waveCache[msg.audioId]) {
                messageContent = messageContent.replace(/<span style="height:[^"]+"--i:(\d+)"><\/span>/g, (m, i) => `<span style="height:${window.__waveCache[msg.audioId][Number(i)] || 3}px;--i:${i}"></span>`);
            }
        } else if (msg.file) {
            messageContent = fileBubbleHTML(msg.file);
        } else if (msg.imgData) {
            messageContent = `<img src="${msg.imgData}" style="max-width: 250px; border-radius: 8px; cursor: pointer;" onclick="window.open('${msg.imgData}', '_blank')">`;
        }
        
        const preview = (payloadObj && payloadObj.preview) || msg.preview;
        if (state.myPreferences.embeds !== false && preview && preview.title) {
            const pv = preview;
            const safeUrl = String(pv.url || '').replace(/'/g, '%27');
            const imgHtml = pv.image ? `<div class="link-preview-imgwrap"><img src="${pv.image}" alt="" loading="lazy"></div>` : '';
            messageContent += `
                <div class="link-preview" title="${escapeHtml(pv.title)}" onclick="window.open('${safeUrl}','_blank')">
                    ${imgHtml}
                    <div class="link-preview-body">
                        <div class="link-preview-title">${escapeHtml(pv.title)}</div>
                        ${pv.description ? `<div class="link-preview-desc">${escapeHtml(pv.description)}</div>` : ''}
                    </div>
                </div>
            `;
        }

        const invisibleClass = msg.isInvisible ? 'invisible-ink' : '';
        const wrapper = document.createElement('div');
        wrapper.className = `message-row ${msg.type}`;

        if (msg.type === 'system') {
            wrapper.classList.add('system');
            wrapper.innerHTML = `<div class="date-divider">${messageContent}</div>`;
        } else if (msg.type === 'received') {
            const name = chat.isGroup ? (msg.senderUsername || chat.username) : chat.username;
            wrapper.innerHTML = `
                <div class="row-avatar" style="background:${avatarColor(name)}">${initials(name)}</div>
                <div class="row-main">
                    <span class="sender-name" style="color:${avatarColor(name)}">${escapeHtml(name)}</span>
                    <div class="bubble received ${invisibleClass}">
                        <div class="ink-wrapper">${messageContent}</div>
                    </div>
                    <span class="msg-time">${formatTime(msg.time)}</span>
                </div>
            `;
            if (!chat.isGroup) wrapper.classList.add('dm');
        } else {
            wrapper.innerHTML = `
                <div class="sent-group">
                    <div class="bubble sent ${invisibleClass}">
                        <div class="ink-wrapper">${messageContent}</div>
                        <span class="msg-time-inside">${formatTime(msg.time)}</span>
                    </div>
                    <span class="receipt-badge ${msg.isRead ? 'seen' : ''}">${whisperIconSVG}</span>
                </div>
            `;
        }
        if (msg.timer && msg.timer > 0) {
            if (!msg.readTime) {
                if (msg.type === 'sent') msg.readTime = msg.time;
                else if (msg.type === 'received') msg.readTime = Date.now();
            }
            
            const timeLeft = Math.max(0, msg.readTime + (msg.timer * 1000) - Date.now());
            const timerBadge = `<span class="timer-badge" data-msg-id="${msg.id}" style="font-size: 10px; background: rgba(0,0,0,0.5); color: white; padding: 2px 6px; border-radius: 12px; margin-left: 8px;">${Math.ceil(timeLeft/1000)}s left</span>`;
            wrapper.querySelector('.bubble').innerHTML += timerBadge;
            startTimerTicker();
        }

        if (msg.id) {
            wrapper.dataset.msgId = String(msg.id);
        }

        return wrapper;
}

function payloadTextOf(msg) {
    if (!msg.text) return '';
    if (msg.text.startsWith('{')) {
        try { const o = JSON.parse(msg.text); if (o.text !== undefined) return o.text; } catch(e) {}
    }
    return msg.text;
}

function isVoiceMsg(msg) {
    if (msg.audioId) return true;
    if (msg.text && msg.text.startsWith('{')) {
        try { const o = JSON.parse(msg.text); if (o.type === 'voice') return true; } catch(e) {}
    }
    return false;
}

function payloadLinkOf(msg) {
    if (!msg.text || !msg.text.startsWith('{')) return null;
    try { const o = JSON.parse(msg.text); if (o.preview && o.preview.url) return o.preview.url; } catch(e) {}
    return null;
}

async function resolveVoiceBlob(msg, chat) {
    const url = await loadVoiceSrc(msg, chat);
    if (!url) return null;
    try {
        const resp = await fetch(url);
        return await resp.blob();
    } catch (e) {
        return null;
    }
}

async function saveMessageToVault(msg, chat, peerId) {
    const Vault = await import('../features/vault.js');
    const source = chat.isGroup ? chat.username : (msg.type === 'received' ? chat.username : state.myUsername);
    const meta = { type: 'text', source, time: formatTime(msg.time) };

    let contentBytes = null;
    try {
        if (isVoiceMsg(msg)) {
            const blob = await resolveVoiceBlob(msg, chat);
            if (!blob) { alert('Could not load voice message to save.'); return; }
            meta.type = 'voice';
            meta.mime = blob.type || 'audio/webm';
            meta.duration = msg.duration || 0;
            contentBytes = new Uint8Array(await blob.arrayBuffer());
        } else if (msg.imgData) {
            meta.type = 'file';
            meta.name = 'image_' + (msg.id || Date.now()) + '.png';
            meta.mime = 'image/png';
            meta.size = msg.imgData.length;
            const b64 = msg.imgData.split(',')[1] || msg.imgData;
            const bin = atob(b64);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            contentBytes = u8;
        } else {
            const text = payloadTextOf(msg);
            if (!text) return;
            const link = payloadLinkOf(msg);
            meta.type = link ? 'link' : 'text';
            contentBytes = new TextEncoder().encode(JSON.stringify(link ? { text, url: link } : { text }));
        }

        const ok = await Vault.saveToVault(meta.type, contentBytes, meta);
        if (ok) Vault.showVaultToast('Saved to Vault');
    } catch (err) {
        console.error('save error:', err);
    }
}

function setupMessageContextMenu() {
    const container = document.getElementById('messages');
    if (!container) return;

    let menu = null;
    const closeMenu = () => {
        if (menu) { menu.remove(); menu = null; }
    };

    container.addEventListener('contextmenu', async (e) => {
        const row = e.target.closest('.message-row');
        if (!row || !row.dataset.msgId) return;
        e.preventDefault();
        closeMenu();

        const peerId = state.currentActiveChat;
        const chat = state.chats.get(peerId);
        const msg = chat ? chat.messages.find(m => String(m.id) === row.dataset.msgId) : null;
        if (!msg) return;

        menu = document.createElement('div');
        menu.id = 'msg-context-menu';
        menu.className = 'context-menu';

        const items = [];

        const doSave = () => {
            saveMessageToVault(msg, chat, peerId);
        };
        const doBookmark = () => {
            toggleBookmark(peerId, msg.id);
            if (state.currentActiveChat === peerId) renderMessages(peerId);
        };

        items.push({ label: 'Save to Vault', action: doSave });
        items.push({ label: isBookmarked(peerId, msg.id) ? 'Remove Bookmark' : 'Bookmark', action: doBookmark });

        if (msg.file) {
            items.push({ label: 'Download File', action: () => downloadFile(msg, chat) });
        }

        if (!isVoiceMsg(msg)) {
            const text = payloadTextOf(msg);
            if (text) items.push({ label: 'Copy Text', action: () => navigator.clipboard && navigator.clipboard.writeText(text) });
        }
        const link = payloadLinkOf(msg);
        if (link) items.push({ label: 'Copy Link', action: () => navigator.clipboard && navigator.clipboard.writeText(link) });

        if (msg.type === 'sent') {
            items.push({ divider: true });
            items.push({
                label: 'Delete Message',
                danger: true,
                action: () => {
                    chat.messages = chat.messages.filter(m => m.id !== msg.id);
                    if (state.currentActiveChat === peerId) renderMessages(peerId);
                    import('../core/app.js').then(a => a.persistKeys && a.persistKeys());
                    import('../core/amproto.js').then(AMP => {
                        const packet = AMP.buildPacket(AMP.CMD_MSG_DELETE, chat.isGroup ? 0 : peerId, state.myId, JSON.stringify({ msgId: msg.id, isGroup: chat.isGroup, groupId: chat.groupId }));
                        if (state.ws) state.ws.send(AMP.obfuscate(packet));
                    });
                }
            });
        }

        for (const it of items) {
            if (it.divider) {
                const div = document.createElement('div');
                div.className = 'context-menu-divider';
                menu.appendChild(div);
                continue;
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'context-menu-item' + (it.danger ? ' danger' : '');
            btn.textContent = it.label;
            btn.onclick = (ev) => { ev.stopPropagation(); closeMenu(); it.action(); };
            menu.appendChild(btn);
        }

        document.body.appendChild(menu);
        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const mw = menu.offsetWidth * zoom;
        const mh = menu.offsetHeight * zoom;
        menu.style.left = (Math.max(8, Math.min(e.clientX, window.innerWidth - mw - 8)) / zoom) + 'px';
        menu.style.top = (Math.max(8, Math.min(e.clientY, window.innerHeight - mh - 8)) / zoom) + 'px';
    });

    document.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
}

export function showTypingIndicator(username) {
    const bar = document.getElementById('typing-status');
    if (!bar) return;
    const dots = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    bar.innerHTML = username
        ? `${escapeHtml(username)} is typing ${dots}`
        : `typing ${dots}`;
    bar.style.display = 'flex';

    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(() => { bar.style.display = 'none'; bar.innerHTML = ''; }, 3000);
}

function setupTimerSelect() {
    const wrap = document.getElementById('timer-select-wrap');
    const btn = document.getElementById('timer-select-btn');
    const menu = document.getElementById('timer-select-menu');
    const label = document.getElementById('timer-select-label');
    const select = document.getElementById('timer-select');
    if (!btn || !menu || !select) return;

    const closeMenu = () => {
        menu.style.display = 'none';
        if (wrap) wrap.classList.remove('open');
    };

    const setValue = (v) => {
        select.value = String(v);
        if (label && select.selectedIndex >= 0) label.textContent = select.options[select.selectedIndex].textContent;
        menu.querySelectorAll('.timer-select-item').forEach((it) => {
            it.classList.toggle('active', String(it.dataset.timer) === String(v));
        });
        closeMenu();
    };

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.style.display !== 'none';
        closeMenu();
        if (!isOpen) {
            menu.style.display = 'block';
            if (wrap) wrap.classList.add('open');
        }
    });

    menu.addEventListener('click', (e) => {
        const item = e.target.closest('.timer-select-item');
        if (item) setValue(item.dataset.timer);
    });

    document.addEventListener('click', (e) => {
        if (wrap && !wrap.contains(e.target)) closeMenu();
    });
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);

    setValue(select.value || '0');
}

export function setupMessageUI() {
    loadBookmarks();
    setupMessageContextMenu();
    setupTimerSelect();
    setupHistoryScroll();
    let isInvisibleMode = false;
    const btnInvisible = document.getElementById('btn-invisible-ink');
    if (btnInvisible) {
        btnInvisible.onclick = () => {
            isInvisibleMode = !isInvisibleMode;
            btnInvisible.style.color = isInvisibleMode ? 'var(--accent)' : '';
        };
    }

    const btnMic = document.getElementById('btn-mic');
    let recorder = null;
    let recordChunks = [];
    let recordStart = 0;
    let recTimerInterval = null;
    const recTimer = document.getElementById('rec-timer');

    const stopRecording = () => {
        if (recorder && recorder.state === 'recording') recorder.stop();
    };

    if (btnMic) {
        btnMic.onclick = async () => {
            if (recorder && recorder.state === 'recording') {
                stopRecording();
                return;
            }
            const chat = state.chats.get(state.currentActiveChat);
            const key = chat ? (chat.isGroup ? chat.groupKey : chat.sharedSecretKey) : null;
            if (!chat || !key) {
                alert('Start a secure chat to send voice messages.');
                return;
            }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert('Voice recording not supported on this device.');
                return;
            }
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (e) {
                alert('Microphone access denied.');
                return;
            }
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
            recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 16000 } : { audioBitsPerSecond: 16000 });
            recordChunks = [];
            recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordChunks.push(e.data); };
            recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                if (recTimerInterval) clearInterval(recTimerInterval);
                recTimerInterval = null;
                if (btnMic) btnMic.classList.remove('recording');
                if (recTimer) recTimer.style.display = 'none';
                const duration = (Date.now() - recordStart) / 1000;
                const blob = new Blob(recordChunks, { type: mimeType || 'audio/webm' });
                recordChunks = [];
                recorder = null;
                if (blob.size === 0) return;
                uploadVoiceMessage(blob, Math.round(duration), chat);
            };
            recordStart = Date.now();
            if (btnMic) btnMic.classList.add('recording');
            if (recTimer) {
                recTimer.style.display = 'flex';
                const tick = () => { recTimer.innerText = formatRecTime((Date.now() - recordStart) / 1000); };
                tick();
                recTimerInterval = setInterval(tick, 500);
            }
            recorder.start();
            setTimeout(() => {
                if (recorder && recorder.state === 'recording') stopRecording();
            }, 15000);
        };
    }

    document.addEventListener('click', async (e) => {
        const playBtn = e.target.closest('.voice-play');
        if (!playBtn) return;
        const audioId = playBtn.dataset.audioId;
        if (!audioId || !state.currentActiveChat) return;
        const chat = state.chats.get(state.currentActiveChat);
        if (!chat) return;
        const src = await loadVoiceSrc({ audioId }, chat);
        if (!src) {
            alert('Could not load voice message.');
            return;
        }
        const bubble = playBtn.closest('.voice-bubble');
        let audioEl = document.querySelector(`audio[data-audio-id="${audioId}"]`);
        const clearPlaying = () => {
            document.querySelectorAll('.voice-bubble.playing').forEach(v => v.classList.remove('playing'));
        };
        const updatePlaying = () => {
            clearPlaying();
            if (audioEl && !audioEl.paused && !audioEl.ended && bubble) bubble.classList.add('playing');
        };
        if (!audioEl) {
            audioEl = new Audio(src);
            audioEl.dataset.audioId = audioId;
            window.__currentAudio = audioEl;
            audioEl.onplay = updatePlaying;
            audioEl.onpause = clearPlaying;
            audioEl.onended = clearPlaying;
            document.querySelectorAll('audio[data-audio-id]').forEach(a => a.pause());
            audioEl.play().catch(() => {});
            updatePlaying();
        } else {
            if (audioEl.paused) audioEl.play().catch(() => {});
            else audioEl.pause();
        }
    });

    const btnBookmark = document.getElementById('btn-bookmark');
    if (btnBookmark) {
        btnBookmark.onclick = () => {
            if (!state.currentActiveChat) return;
            setBookmarkFilterActive(!isBookmarkFilterActive());
            btnBookmark.classList.toggle('active', isBookmarkFilterActive());
            renderMessages(state.currentActiveChat);
        };
    }

    const drawModal = document.getElementById('draw-modal');
    const drawCanvas = document.getElementById('draw-canvas');
    let ctx, isDrawing = false;
    let currentColor = '#000';
    let currentSize = 6;
    let strokes = [];
    let currentStroke = null;

    const updateDrawActions = () => {
        const btnSend = document.getElementById('btn-draw-send');
        const btnUndo = document.getElementById('btn-draw-undo');
        const btnClear = document.getElementById('btn-draw-clear');
        const hasStrokes = strokes.length > 0;
        if (btnSend) btnSend.disabled = !hasStrokes;
        if (btnUndo) btnUndo.disabled = !hasStrokes;
        if (btnClear) btnClear.disabled = !hasStrokes;
    };

    const redrawDraw = () => {
        if (!ctx) return;
        ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        for (const st of strokes) {
            ctx.beginPath();
            ctx.strokeStyle = st.color;
            ctx.lineWidth = st.size;
            if (st.points.length === 1) {
                ctx.arc(st.points[0].x, st.points[0].y, st.size / 2, 0, Math.PI * 2);
                ctx.fillStyle = st.color;
                ctx.fill();
            } else {
                ctx.moveTo(st.points[0].x, st.points[0].y);
                for (let i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i].x, st.points[i].y);
                ctx.stroke();
            }
        }
    };

    const resetDraw = () => {
        strokes = [];
        currentStroke = null;
        redrawDraw();
        updateDrawActions();
    };

    const backToList = document.getElementById('btn-back-to-list');
    if (backToList) {
        backToList.onclick = () => {
            state.currentActiveChat = null;
            document.getElementById('main-chat-area').style.display = 'none';
            document.getElementById('empty-state').style.display = 'flex';
            document.querySelector('.messages-panel')?.classList.add('mobile-visible');
            const pop = document.getElementById('members-popover');
            if (pop) pop.style.display = 'none';
        };
    }

    const statusEl = document.getElementById('crypto-status');
    const popover = document.getElementById('members-popover');
    if (statusEl && popover) {
        statusEl.onclick = (e) => {
            e.stopPropagation();
            const chat = state.chats.get(state.currentActiveChat);
            if (chat && chat.isGroup) {
                if (popover.style.display === 'block') {
                    popover.style.display = 'none';
                } else {
                    renderMembersPopover(state.currentActiveChat);
                    popover.style.display = 'block';
                }
            }
        };
        document.addEventListener('click', (e) => {
            if (popover.style.display === 'block' && !popover.contains(e.target) && e.target !== statusEl) {
                popover.style.display = 'none';
            }
        });
    }
    window.addEventListener('resize', () => {
        clearTimeout(window.__mobileResizeTimer);
        window.__mobileResizeTimer = setTimeout(syncMobilePanel, 120);
    });
    syncMobilePanel();

    if (drawCanvas) {
        ctx = drawCanvas.getContext('2d');
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const toDrawCoords = (e) => {
            const rect = drawCanvas.getBoundingClientRect();
            const sx = drawCanvas.width / rect.width;
            const sy = drawCanvas.height / rect.height;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
        };

        const startDraw = (e) => {
            e.preventDefault();
            isDrawing = true;
            currentStroke = { color: currentColor, size: currentSize, points: [toDrawCoords(e)] };
        };
        const draw = (e) => {
            if (!isDrawing) return;
            e.preventDefault();
            const p = toDrawCoords(e);
            currentStroke.points.push(p);
            ctx.beginPath();
            ctx.strokeStyle = currentStroke.color;
            ctx.lineWidth = currentStroke.size;
            const prev = currentStroke.points[currentStroke.points.length - 2];
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        };
        const endDraw = () => {
            if (!isDrawing) return;
            isDrawing = false;
            if (currentStroke && currentStroke.points.length) {
                strokes.push(currentStroke);
                currentStroke = null;
                updateDrawActions();
            }
        };

        drawCanvas.addEventListener('mousedown', startDraw);
        drawCanvas.addEventListener('mousemove', draw);
        window.addEventListener('mouseup', endDraw);
        drawCanvas.addEventListener('touchstart', startDraw, {passive: false});
        drawCanvas.addEventListener('touchmove', draw, {passive: false});
        window.addEventListener('touchend', endDraw);

        document.querySelectorAll('#draw-modal .color-swatch').forEach(btn => {
            btn.onclick = () => {
                currentColor = btn.dataset.drawColor;
                document.querySelectorAll('#draw-modal .color-swatch').forEach(b => b.classList.toggle('active', b === btn));
            };
        });

        document.querySelectorAll('#draw-modal .size-btn').forEach(btn => {
            btn.onclick = () => {
                currentSize = parseInt(btn.dataset.size, 10);
                document.querySelectorAll('#draw-modal .size-btn').forEach(b => b.classList.toggle('active', b === btn));
            };
        });

        const btnUndo = document.getElementById('btn-draw-undo');
        if (btnUndo) btnUndo.onclick = () => { strokes.pop(); redrawDraw(); updateDrawActions(); };

        const btnClear = document.getElementById('btn-draw-clear');
        if (btnClear) btnClear.onclick = resetDraw;

        updateDrawActions();
    }

    const closeDrawModal = () => { drawModal.style.display = 'none'; };

    document.getElementById('btn-draw').onclick = () => {
        if (!state.currentActiveChat) return;
        const chat = state.chats.get(state.currentActiveChat);
        if (!chat.isSecure && !chat.isGroup) return;
        resetDraw();
        drawModal.style.display = 'flex';
    };
    document.getElementById('btn-draw-cancel').onclick = closeDrawModal;
    const btnDrawClose = document.getElementById('btn-draw-close');
    if (btnDrawClose) btnDrawClose.onclick = closeDrawModal;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawModal.style.display === 'flex') closeDrawModal();
    });
    drawModal.addEventListener('click', (e) => {
        if (e.target === drawModal) closeDrawModal();
    });
    
    const sendMessageData = async (payloadObj) => {
        const chat = state.chats.get(state.currentActiveChat);
        const timerSelect = document.getElementById('timer-select');
        const timerValue = timerSelect ? parseInt(timerSelect.value) : 0;
        const localId = Date.now().toString() + '-' + Math.floor(Math.random()*1000);

        const isVoiceMsg = payloadObj.type === 'voice';
        const localMsg = { 
            id: localId,
            text: isVoiceMsg ? JSON.stringify(payloadObj) : (payloadObj.text || ''), 
            imgData: payloadObj.imgData, 
            isInvisible: payloadObj.isInvisible,
            audioId: payloadObj.audioId,
            duration: payloadObj.duration,
            mime: payloadObj.mime,
            file: payloadObj.file,
            preview: payloadObj.preview,
            timer: isVoiceMsg ? 0 : timerValue,
            type: 'sent', 
            isRead: chat.isGroup, 
            time: Date.now() 
        };
        
        payloadObj.id = localId;
        payloadObj.time = Date.now();
        if (payloadObj.type !== 'voice') payloadObj.timer = timerValue;
        if (chat.isGroup) {
            localMsg.senderId = state.myId;
            localMsg.senderUsername = state.myUsername;
            chat.messages.push(localMsg);
            await persistKeys();
            renderMessages(state.currentActiveChat);
            renderChatList();
            
            const wireText = chat.groupKey ? await encryptGroupText(chat.groupKey, payloadObj) : JSON.stringify(payloadObj);
            const packet = buildPacket(CMD_GROUP_MSG, 0, state.myId, JSON.stringify({ groupId: chat.groupId, text: wireText }));
            if (state.ws) state.ws.send(obfuscate(packet));
        } else {
            chat.messages.push(localMsg);
            await persistKeys();
            renderMessages(state.currentActiveChat);
            renderChatList();
            
            const encryptedPayload = await encryptPayload(chat.sharedSecretKey, JSON.stringify(payloadObj));
            const encPacket = buildPacket(CMD_ENC_MSG, state.currentActiveChat, state.myId, JSON.stringify(encryptedPayload));
            if (state.ws) state.ws.send(obfuscate(encPacket));
        }
    };
    window.sendMessageData = sendMessageData;

    document.getElementById('btn-draw-send').onclick = () => {
        if (!state.currentActiveChat) return;
        const imgData = drawCanvas.toDataURL('image/png');
        drawModal.style.display = 'none';
        sendMessageData({ imgData, isInvisible: isInvisibleMode });
    };

    async function uploadVoiceMessage(blob, duration, chat) {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (bytes.length > 44000) {
            alert('Voice message is too long to send.');
            return;
        }
        const key = chat.isGroup ? chat.groupKey : chat.sharedSecretKey;
        let env;
        try {
            env = await encryptBytes(key, bytes);
        } catch (e) {
            alert('Could not encrypt voice message.');
            return;
        }
        const encData = bytesToBase64(new Uint8Array(new TextEncoder().encode(JSON.stringify(env))));
        if (encData.length > 60000) {
            alert('Voice message is too long to send.');
            return;
        }
        const uploadPkt = buildPacket(CMD_VOICE_UPLOAD, 0, state.myId, JSON.stringify({ encData, mime: blob.type || 'audio/webm', duration }));
        if (state.ws) state.ws.send(obfuscate(uploadPkt));
        const result = await waitForVoiceUpload();
        if (!result || !result.id) {
            alert('Voice upload failed.');
            return;
        }
        await sendMessageData({ type: 'voice', audioId: result.id, duration, mime: blob.type || 'audio/webm', text: 'Voice message' });
    }

    document.getElementById('btn-send').onclick = async () => {
        if (!state.currentActiveChat) return;
        const chat = state.chats.get(state.currentActiveChat);
        const input = document.getElementById('msg-input');
        const text = input.value.trim();
        if (!text || (!chat.isSecure && !chat.isGroup)) return;

        input.value = '';
        
        // Extract URL
        const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
        if (urlMatch && state.myPreferences.embeds !== false) {
            const url = urlMatch[1].replace(/[.,!?;:]+$/, '');
            state.pendingPreviewCallback = (previewData) => {
                const payloadObj = { text, isInvisible: isInvisibleMode };
                if (previewData) payloadObj.preview = previewData;
                sendMessageData(payloadObj);
            };
            const reqPacket = buildPacket(CMD_LINK_PREVIEW_REQ, 0, state.myId, JSON.stringify({ url }));
            if (state.ws) state.ws.send(obfuscate(reqPacket));
            
            // Timeout in case server doesn't respond
            setTimeout(() => {
                if (state.pendingPreviewCallback) {
                    state.pendingPreviewCallback(null);
                }
            }, 3000);
        } else {
            sendMessageData({ text, isInvisible: isInvisibleMode });
        }
    };

    document.getElementById('msg-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('btn-send').click();
    });

    document.getElementById('msg-input').addEventListener('input', () => {
        if (!state.currentActiveChat) return;
        const chat = state.chats.get(state.currentActiveChat);
        if (!chat.isSecure && !chat.isGroup) return;

        const now = Date.now();
        if (now - state.lastTypingSent > 500) {
            state.lastTypingSent = now;
            if (chat.isGroup) {
                const typingPacket = buildPacket(CMD_TYPING, 0, state.myId, JSON.stringify({ groupId: chat.groupId, username: state.myUsername }));
                if (state.ws) state.ws.send(obfuscate(typingPacket));
            } else {
                const typingPacket = buildPacket(CMD_TYPING, state.currentActiveChat, state.myId, "");
                if (state.ws) state.ws.send(obfuscate(typingPacket));
            }
        }
    });
}
