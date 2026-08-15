import { state } from '../core/store.js';
import { initials, avatarColor, escapeHtml, formatTime, formatListTime, dateLabel, whisperIconSVG, renderChatList } from './chatList.js';
import { CMD_READ, CMD_TYPING, CMD_GROUP_MSG, CMD_GROUP_READ, CMD_ENC_MSG, CMD_DH_INIT, CMD_LINK_PREVIEW_REQ, CMD_VOICE_UPLOAD, CMD_VOICE_GET, CMD_VOICE_UPLOAD_OK, CMD_VOICE_GET_OK, buildPacket, obfuscate, encryptPayload } from '../core/amproto.js';
import { encryptGroupText, encryptBytes, decryptBytes } from '../core/grouplock.js';
import { isBookmarked, toggleBookmark, loadBookmarks, getBookmarkedMessages, isBookmarkFilterActive, setBookmarkFilterActive } from '../core/bookmarks.js';
import { persistKeys } from '../core/app.js';
import { renderPoll } from '../features/polls.js';

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
        return url;
    } catch (e) {
        console.error('voice load error:', e);
        return null;
    }
}

function voicePlayerHTML(msg, chat) {
    const dur = Math.ceil(msg.duration || 0);
    return `
        <div class="voice-bubble">
            <button class="play-btn voice-play" data-audio-id="${escapeHtml(String(msg.audioId))}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </button>
            <div class="waveform">
                ${Array.from({ length: 24 }, (_, i) => `<span style="height:${6 + Math.abs(Math.sin(i * 0.7)) * 14}px"></span>`).join('')}
            </div>
            <span class="duration">${dur}s</span>
        </div>`;
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

function buildMessageElement(msg, chat, peerId) {
        const payloadObj = (msg.text && msg.text.startsWith('{')) ? (() => { try { return JSON.parse(msg.text); } catch(e) { return null; } })() : null;
        const isPoll = payloadObj && payloadObj.type === 'poll';
        const isVote = payloadObj && payloadObj.type === 'vote';
        const isVoice = (payloadObj && payloadObj.type === 'voice') || !!msg.audioId;

        if (isVote) return null;

        const displayString = (payloadObj && payloadObj.text !== undefined) ? payloadObj.text : (msg.text || '');
        let messageContent = escapeHtml(displayString);
        if (isPoll) {
            messageContent = renderPoll(msg, chat, payloadObj);
        } else if (isVoice) {
            messageContent = voicePlayerHTML({ ...msg, ...payloadObj }, chat);
        } else if (msg.imgData) {
            messageContent = `<img src="${msg.imgData}" style="max-width: 250px; border-radius: 8px; cursor: pointer;" onclick="window.open('${msg.imgData}', '_blank')">`;
        }
        
        if (payloadObj && payloadObj.preview && payloadObj.preview.title) {
            const pv = payloadObj.preview;
            messageContent += `
                <div class="link-preview" style="margin-top: 8px; border-left: 3px solid #3b82f6; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; display: flex; flex-direction: column; gap: 4px; cursor: pointer;" onclick="window.open('${pv.url}', '_blank')">
                    ${pv.image ? `<img src="${pv.image}" style="max-width: 100%; border-radius: 4px; margin-bottom: 4px;">` : ''}
                    <div style="font-weight: 600; font-size: 0.9em; color: #e5e7eb;">${escapeHtml(pv.title)}</div>
                    ${pv.description ? `<div style="font-size: 0.8em; color: #9ca3af; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(pv.description)}</div>` : ''}
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
            if (timeLeft === 0) {
                setTimeout(() => {
                    chat.messages = chat.messages.filter(m => m.id !== msg.id);
                    if (msg.type === 'received') {
                        import('../core/amproto.js').then(AMP => {
                            const packet = AMP.buildPacket(AMP.CMD_MSG_DELETE, 0, state.myId, JSON.stringify({ msgId: msg.id, isGroup: chat.isGroup, groupId: chat.groupId }));
                            if (state.ws) state.ws.send(AMP.obfuscate(packet));
                        });
                    }
                    import('../core/app.js').then(a => a.persistKeys && a.persistKeys());
                    renderMessages(peerId);
                }, 0);
                return null;
            }
            
            const timerBadge = `<span style="font-size: 10px; background: rgba(0,0,0,0.5); color: white; padding: 2px 6px; border-radius: 12px; margin-left: 8px;">${Math.ceil(timeLeft/1000)}s left</span>`;
            wrapper.querySelector('.bubble').innerHTML += timerBadge;
            
            if (!window.activeTimers) window.activeTimers = new Set();
            if (!window.activeTimers.has(msg.id)) {
                window.activeTimers.add(msg.id);
                setTimeout(() => {
                    window.activeTimers.delete(msg.id);
                    if (state.currentActiveChat === peerId) renderMessages(peerId);
                }, 1000);
            }
        }

        if (msg.id) {
            const bookmarked = isBookmarked(peerId, msg.id);
            const bmBtn = document.createElement('button');
            bmBtn.className = 'bookmark-btn' + (bookmarked ? ' active' : '');
            bmBtn.title = bookmarked ? 'Remove bookmark' : 'Bookmark message';
            bmBtn.innerHTML = bookmarked ? bookmarkSVGFilled : bookmarkSVGOutline;
            bmBtn.onclick = (e) => {
                e.stopPropagation();
                const nowBookmarked = toggleBookmark(peerId, msg.id);
                bmBtn.classList.toggle('active', nowBookmarked);
                bmBtn.title = nowBookmarked ? 'Remove bookmark' : 'Bookmark message';
                bmBtn.innerHTML = nowBookmarked ? bookmarkSVGFilled : bookmarkSVGOutline;
            };
            wrapper.appendChild(bmBtn);
        }

        return wrapper;
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

export function setupMessageUI() {
    loadBookmarks();
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
        let audioEl = document.querySelector(`audio[data-audio-id="${audioId}"]`);
        if (!audioEl) {
            audioEl = new Audio(src);
            audioEl.dataset.audioId = audioId;
            document.querySelectorAll('audio[data-audio-id]').forEach(a => a.pause());
            audioEl.play().catch(() => {});
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
        ctx.lineWidth = 4;
        
        const startDraw = (e) => {
            isDrawing = true;
            ctx.beginPath();
            const rect = drawCanvas.getBoundingClientRect();
            const sx = drawCanvas.width / rect.width;
            const sy = drawCanvas.height / rect.height;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            ctx.moveTo((clientX - rect.left) * sx, (clientY - rect.top) * sy);
        };
        const draw = (e) => {
            if (!isDrawing) return;
            e.preventDefault();
            const rect = drawCanvas.getBoundingClientRect();
            const sx = drawCanvas.width / rect.width;
            const sy = drawCanvas.height / rect.height;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            ctx.strokeStyle = currentColor;
            ctx.lineTo((clientX - rect.left) * sx, (clientY - rect.top) * sy);
            ctx.stroke();
        };
        const endDraw = () => { isDrawing = false; ctx.closePath(); };
        
        drawCanvas.addEventListener('mousedown', startDraw);
        drawCanvas.addEventListener('mousemove', draw);
        window.addEventListener('mouseup', endDraw);
        drawCanvas.addEventListener('touchstart', startDraw, {passive: false});
        drawCanvas.addEventListener('touchmove', draw, {passive: false});
        window.addEventListener('touchend', endDraw);
        
        document.querySelectorAll('#draw-modal .color-swatch').forEach(btn => {
            btn.onclick = () => currentColor = btn.dataset.drawColor;
        });
        document.getElementById('btn-draw-clear').onclick = () => {
            ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        };
    }

    document.getElementById('btn-draw').onclick = () => {
        if (!state.currentActiveChat) return;
        const chat = state.chats.get(state.currentActiveChat);
        if (!chat.isSecure && !chat.isGroup) return;
        if (ctx) ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        drawModal.style.display = 'flex';
    };
    document.getElementById('btn-draw-cancel').onclick = () => drawModal.style.display = 'none';
    
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
            timer: isVoiceMsg ? 0 : timerValue,
            type: 'sent', 
            isRead: chat.isGroup, 
            time: Date.now() 
        };
        
        payloadObj.id = localId;
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
        if (urlMatch) {
            const url = urlMatch[1];
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
