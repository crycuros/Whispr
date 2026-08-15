import { state } from '../core/store.js';
import { CMD_RESOLVE, buildPacket, obfuscate } from '../core/amproto.js';
import { openChat } from './messages.js';

export const AVATAR_PALETTE = ['#3390EC', '#297A4A', '#E06C75', '#8E6CD6', '#F08C3A', '#43A09E', '#7090C6', '#B76CE8'];

export function initials(name) {
    if (!name) return '?';
    return String(name).trim().charAt(0).toUpperCase();
}
export function avatarColor(name) {
    const key = String(name || '?');
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) & 0x7FFFFFFF;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function formatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function formatListTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return formatTime(ts);
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
export function dateLabel(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
export const whisperIconSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9 C 8 11, 8 13, 6 15" /><path d="M11 5 C 15 9, 15 15, 11 19" /><path d="M16 1 C 22 7, 22 17, 16 23" /></svg>`;

export function getOrCreateChat(peerId) {
    if (!state.chats.has(peerId)) {
        state.chats.set(peerId, {
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
    return state.chats.get(peerId);
}

export function groupAvatarHTML(chat) {
    const members = (chat.members || []).slice(0, 4);
    const cells = members.map(id => {
        const name = id === state.myId ? state.myUsername : (state.chats.get(id)?.username || `User ${id}`);
        return `<span style="background:${avatarColor(name)}">${initials(name)}</span>`;
    }).join('');
    return `<div class="group-avatar-grid">${cells || '<span></span>'}</div>`;
}

export function renderChatList() {
    const list = document.getElementById('chat-list');
    list.innerHTML = '';

    state.chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = `chat-item ${state.currentActiveChat === chat.peerId ? 'active' : ''}`;

        const last = chat.messages.length ? chat.messages[chat.messages.length - 1] : null;
        const lastTime = last ? formatListTime(last.time) : '';

        let preview;
        if (chat.typing && chat.typingUser) preview = `<span class="typing-text">${escapeHtml(chat.typingUser)} is typing...</span>`;
        else if (chat.typing) preview = `<span class="typing-text">typing...</span>`;
        else if (last) {
            let lastText = last.text || '';
            if (lastText.startsWith('{')) {
                try {
                    const p = JSON.parse(lastText);
                    if (p && p.type === 'voice') lastText = 'Voice message';
                    else if (p && p.text !== undefined) lastText = p.text;
                } catch(e) {}
            }
            preview = `${chat.isGroup && last.senderUsername ? escapeHtml(last.senderUsername) + ': ' : ''}${escapeHtml(lastText)}`;
        }
        else if (chat.isGroup) preview = 'Space created';
        else if (chat.isSecure) preview = 'Encrypted chat';
        else preview = 'Connecting...';

        const receipt = last && last.type === 'sent'
            ? `<span class="receipt ${last.isRead ? 'seen' : ''}">${whisperIconSVG}</span>` : '';
        const badge = chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : '';
        const memberChip = chat.isGroup ? `<span class="member-chip">${chat.members.length} members</span>` : '';
        const feedBadge = chat.isFeed ? `<span class="feed-badge" title="Broadcast Feed">📢</span>` : '';
        const onlineDot = (!chat.isGroup && state.presence.get(chat.peerId)?.online === true) ? '<span class="online-dot"></span>' : '';

        item.innerHTML = `
            <div class="chat-avatar" style="background:${avatarColor(chat.username)}">
                ${chat.isGroup ? groupAvatarHTML(chat) : initials(chat.username)}
                ${onlineDot}
            </div>
            <div class="chat-info">
                <div class="chat-line1"><h4>${escapeHtml(chat.username)}${feedBadge}${memberChip}</h4><span class="chat-time">${lastTime}</span></div>
                <div class="chat-line2"><p>${preview}</p>${receipt}${badge}</div>
            </div>
        `;

        item.onclick = () => openChat(chat.peerId);
        list.appendChild(item);
    });

    renderRecentSearches();
}

export function renderRecentSearches() {
    const list = document.getElementById('recent-searches-list');
    if (!list) return;
    list.innerHTML = '';
    
    let count = 0;
    for (const [peerId, chat] of state.chats) {
        if (count >= 10) break; 
        
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

export function setupChatListUI() {
    const searchPanel = document.getElementById('panel-global-search');
    const btnBackSearch = document.getElementById('btn-back-search');
    const mainSearchInput = document.getElementById('new-chat-input');
    const globalSearchInput = document.getElementById('global-search-input');
    const searchTabs = document.querySelectorAll('.search-tab');

    if(mainSearchInput) {
        mainSearchInput.addEventListener('focus', () => {
            searchPanel.classList.add('active');
            setTimeout(() => {
                globalSearchInput.focus();
            }, 300); 
        });
    }

    if(btnBackSearch) {
        btnBackSearch.addEventListener('click', () => {
            searchPanel.classList.remove('active');
            globalSearchInput.value = ''; 
            mainSearchInput.blur(); 
        });
    }

    if(globalSearchInput) {
        globalSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = globalSearchInput.value.trim();
                if (query.length > 0) {
                    const resolvePacket = buildPacket(CMD_RESOLVE, 0, state.myId, query);
                    state.ws.send(obfuscate(resolvePacket));
                }
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchPanel.classList.contains('active')) {
            btnBackSearch.click();
        }
    });

    searchTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            searchTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
        });
    });
}
