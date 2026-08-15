import { state } from './store.js';
import { CMD_GET_CHAT_HISTORY, buildPacket, obfuscate, decryptPayload } from './amproto.js';
import { ensureGroupKey, decryptGroupText } from './grouplock.js';
import { buildMessageElement, renderMessages } from '../ui/messages.js';
import { dateLabel } from '../ui/chatList.js';
import { persistKeys } from './app.js';
import { isBookmarkFilterActive } from './bookmarks.js';

const HISTORY_LIMIT = 50;

export function requestHistory(params) {
    return new Promise((resolve) => {
        state._historyResolve = resolve;
        const pkt = buildPacket(CMD_GET_CHAT_HISTORY, 0, state.myId, JSON.stringify(params));
        if (state.ws) state.ws.send(obfuscate(pkt));
        setTimeout(() => {
            if (state._historyResolve === resolve) {
                state._historyResolve = null;
                resolve(null);
            }
        }, 15000);
    });
}

async function processHistoryRow(chat, row) {
    try {
        if (chat.isGroup) {
            let msgObj;
            try {
                const env = JSON.parse(row.text);
                if (env && env.v === 1) {
                    if (!chat.groupKey) await ensureGroupKey(chat);
                    if (chat.groupKey) {
                        msgObj = await decryptGroupText(chat.groupKey, row.text);
                    } else {
                        msgObj = { text: '[encrypted]' };
                    }
                } else {
                    msgObj = env;
                }
            } catch (e) {
                msgObj = { text: row.text };
            }

            const senderId = row.senderId;
            let senderName = `User ${senderId}`;
            if (senderId === state.myId) senderName = state.myUsername;
            else if (chat.memberNames && chat.memberNames[senderId]) senderName = chat.memberNames[senderId];
            else if (state.chats.has(senderId)) senderName = state.chats.get(senderId).username;

            return {
                id: msgObj.id || row.id,
                messageId: row.id,
                dbId: row.id,
                timer: msgObj.timer,
                senderId,
                senderUsername: senderName,
                text: msgObj.text || '',
                imgData: msgObj.imgData,
                isInvisible: msgObj.isInvisible,
                audioId: msgObj.audioId,
                duration: msgObj.duration,
                mime: msgObj.mime,
                file: msgObj.file,
                preview: msgObj.preview,
                type: senderId === state.myId ? 'sent' : 'received',
                isRead: true,
                time: msgObj.time || row.sentAt || Date.now()
            };
        }

        if (!chat.sharedSecretKey) return null;
        const data = JSON.parse(row.payload);
        const payload = data.enc || data;
        const decrypted = await decryptPayload(chat.sharedSecretKey, payload);
        let msgObj;
        try {
            msgObj = JSON.parse(decrypted);
        } catch (e) {
            msgObj = { text: decrypted };
        }

        return {
            id: msgObj.id || row.id,
            dbId: row.id,
            timer: msgObj.timer,
            text: msgObj.text || '',
            imgData: msgObj.imgData,
            isInvisible: msgObj.isInvisible,
            audioId: msgObj.audioId,
            duration: msgObj.duration,
            mime: msgObj.mime,
            file: msgObj.file,
            preview: msgObj.preview,
            type: row.senderId === state.myId ? 'sent' : 'received',
            isRead: true,
            time: msgObj.time || row.sentAt || Date.now()
        };
    } catch (e) {
        console.error('history row error:', e);
        return null;
    }
}

function historyParams(chat) {
    if (chat.isGroup) {
        return { chatType: 'group', chatId: chat.groupId };
    }
    return { chatType: 'dm', chatId: chat.peerId };
}

export async function fetchLatest(peerId) {
    const chat = state.chats.get(peerId);
    if (!chat) return;
    const res = await requestHistory({ ...historyParams(chat), beforeId: 0, limit: HISTORY_LIMIT });
    if (!res || !Array.isArray(res.messages) || res.messages.length === 0) return;

    const processed = [];
    for (const row of res.messages) {
        const m = await processHistoryRow(chat, row);
        if (m) processed.push(m);
    }
    if (processed.length === 0) return;

    const existingIds = new Set(chat.messages.map(m => String(m.id)));
    const fresh = processed.filter(m => !existingIds.has(String(m.id)));
    if (fresh.length === 0) return;

    chat.messages = chat.messages.concat(fresh);
    if (state.currentActiveChat === peerId) {
        renderMessages(peerId);
        const container = document.getElementById('messages');
        if (container) {
            container._histSuppressUntil = Date.now() + 1200;
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { if (state.currentActiveChat === peerId) container.scrollTop = container.scrollHeight; }, 80);
        }
    }
    await persistKeys();
}

export async function loadOlder(peerId) {
    const chat = state.chats.get(peerId);
    if (!chat) return;
    if (chat._loadingOlder || chat._noMoreOlder) return;
    if (isBookmarkFilterActive()) return;
    if (chat.messages.length === 0) return;

    const oldest = chat.messages[0];
    let beforeId = 0;
    let beforeTime = 0;
    if (chat.isGroup) {
        beforeId = oldest.messageId;
        if (!beforeId) { chat._noMoreOlder = true; return; }
    } else {
        beforeId = oldest.dbId || 0;
        beforeTime = oldest.time || 0;
    }

    chat._loadingOlder = true;
    showHistoryLoader();
    const res = await requestHistory({ ...historyParams(chat), beforeId, beforeTime, limit: HISTORY_LIMIT });
    chat._loadingOlder = false;
    hideHistoryLoader();

    if (!res || !Array.isArray(res.messages)) return;
    if (!res.hasMore) chat._noMoreOlder = true;

    const processed = [];
    for (const row of res.messages) {
        const m = await processHistoryRow(chat, row);
        if (m && !chat.messages.some(ex => String(ex.id) === String(m.id))) processed.push(m);
    }
    if (processed.length === 0) {
        if (res.messages.length === 0) chat._noMoreOlder = true;
        return;
    }

    chat.messages = processed.concat(chat.messages);
    if (state.currentActiveChat === peerId) prependOlder(peerId, processed);
    await persistKeys();
}

function prependOlder(peerId, olderMsgs) {
    const container = document.getElementById('messages');
    if (!container || state.currentActiveChat !== peerId) return;

    const chat = state.chats.get(peerId);
    const firstExisting = chat.messages[olderMsgs.length];

    const prevScroll = container.scrollTop;
    const prevHeight = container.scrollHeight;

    const frag = document.createDocumentFragment();
    let lastDay = null;
    olderMsgs.forEach(msg => {
        const day = msg.time ? new Date(msg.time).toDateString() : '';
        if (day && day !== lastDay) {
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.innerText = dateLabel(msg.time);
            frag.appendChild(divider);
            lastDay = day;
        }
        const el = buildMessageElement(msg, chat, peerId);
        if (el) frag.appendChild(el);
    });

    if (firstExisting && firstExisting.time && lastDay && new Date(firstExisting.time).toDateString() !== lastDay) {
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.innerText = dateLabel(firstExisting.time);
        frag.appendChild(divider);
    }

    const prevSmooth = container.style.scrollBehavior;
    container.style.scrollBehavior = 'auto';
    container.insertBefore(frag, container.firstChild);
    container._histSuppressUntil = Date.now() + 1200;
    container.scrollTop = prevScroll + (container.scrollHeight - prevHeight);
    container.style.scrollBehavior = prevSmooth;
}

function showHistoryLoader() {
    let el = document.getElementById('history-loader');
    const container = document.getElementById('messages');
    if (!container) return;
    if (!el) {
        el = document.createElement('div');
        el.id = 'history-loader';
        el.className = 'history-loader';
        el.textContent = 'Loading older messages…';
        container.prepend(el);
    } else {
        el.style.display = '';
    }
}

function hideHistoryLoader() {
    const el = document.getElementById('history-loader');
    if (el) el.style.display = 'none';
}

export function setupHistoryScroll() {
    const container = document.getElementById('messages');
    if (!container) return;
    container.addEventListener('scroll', () => {
        if (Date.now() < (container._histSuppressUntil || 0)) return;
        if (container.scrollTop < 120 && state.currentActiveChat) {
            loadOlder(state.currentActiveChat);
        }
    }, { passive: true });
}
