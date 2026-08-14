import { state } from '../core/store.js';
import { initials, avatarColor, escapeHtml, formatTime, dateLabel, whisperIconSVG, renderChatList } from './chatList.js';
import { CMD_READ, CMD_TYPING, CMD_GROUP_MSG, CMD_ENC_MSG, buildPacket, obfuscate, encryptPayload } from '../core/amproto.js';
import { persistKeys } from '../core/app.js';

export function openChat(peerId) {
    state.currentActiveChat = peerId;
    const chat = state.chats.get(peerId);
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
        const readPacket = buildPacket(CMD_READ, peerId, state.myId, "");
        if (state.ws) state.ws.send(obfuscate(readPacket));
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
}

export function renderMessages(peerId) {
    const container = document.getElementById('messages');
    const chat = state.chats.get(peerId);
    if (!chat || !container) return;
    
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();

    let lastDay = null;
    chat.messages.forEach(msg => {
        const day = msg.time ? new Date(msg.time).toDateString() : '';
        if (day && day !== lastDay) {
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.innerText = dateLabel(msg.time);
            fragment.appendChild(divider);
            lastDay = day;
        }

        const wrapper = document.createElement('div');
        wrapper.className = `message-row ${msg.type}`;

        let messageContent = '';
        if (msg.imgData) {
            messageContent = `<img src="${msg.imgData}" style="max-width: 200px; border-radius: 8px; cursor: pointer;">`;
            if (msg.text) messageContent += `<br>${escapeHtml(msg.text)}`;
        } else {
            messageContent = escapeHtml(msg.text);
        }

        const invisibleClass = msg.isInvisible ? 'invisible-ink' : '';

        if (msg.type === 'system') {
            wrapper.classList.add('system');
            wrapper.innerHTML = `<div class="date-divider">${messageContent}</div>`;
        } else if (msg.type === 'received') {
            const name = chat.isGroup ? (msg.senderUsername || chat.username) : chat.username;
            wrapper.innerHTML = `
                <div class="row-avatar" style="background:${avatarColor(name)}">${initials(name)}</div>
                <div class="row-main">
                    ${chat.isGroup ? `<span class="sender-name" style="color:${avatarColor(msg.senderUsername || chat.username)}">${escapeHtml(msg.senderUsername || chat.username)}</span>` : ''}
                    <div class="bubble received ${invisibleClass}">${messageContent}</div>
                    <span class="msg-time">${formatTime(msg.time)}</span>
                </div>
            `;
        } else {
            wrapper.innerHTML = `
                <div class="sent-group">
                    <div class="bubble sent ${invisibleClass}">${messageContent}
                        <span class="msg-time-inside">${formatTime(msg.time)}</span>
                    </div>
                    <span class="receipt-badge ${msg.isRead ? 'seen' : ''}">${whisperIconSVG}</span>
                </div>
            `;
        }

        fragment.appendChild(wrapper);
    });

    container.appendChild(fragment);
    container.scrollTop = container.scrollHeight;
}

export function showTypingIndicator() {
    const container = document.getElementById('messages');
    if (!container) return;
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

    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(() => { indicator.style.display = 'none'; }, 1500);
}

export function setupMessageUI() {
    let isInvisibleMode = false;
    const btnInvisible = document.getElementById('btn-invisible-ink');
    if (btnInvisible) {
        btnInvisible.onclick = () => {
            isInvisibleMode = !isInvisibleMode;
            btnInvisible.style.color = isInvisibleMode ? 'var(--accent)' : '';
        };
    }

    const drawModal = document.getElementById('draw-modal');
    const drawCanvas = document.getElementById('draw-canvas');
    let ctx, isDrawing = false;
    let currentColor = '#000';
    if (drawCanvas) {
        ctx = drawCanvas.getContext('2d');
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = 4;
        
        const startDraw = (e) => {
            isDrawing = true;
            ctx.beginPath();
            const rect = drawCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            ctx.moveTo(clientX - rect.left, clientY - rect.top);
        };
        const draw = (e) => {
            if (!isDrawing) return;
            e.preventDefault();
            const rect = drawCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            ctx.strokeStyle = currentColor;
            ctx.lineTo(clientX - rect.left, clientY - rect.top);
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
        
        const localMsg = { 
            text: payloadObj.text || '', 
            imgData: payloadObj.imgData, 
            isInvisible: payloadObj.isInvisible,
            type: 'sent', 
            isRead: chat.isGroup, 
            time: Date.now() 
        };
        if (chat.isGroup) {
            localMsg.senderId = state.myId;
            localMsg.senderUsername = state.myUsername;
            chat.messages.push(localMsg);
            renderMessages(state.currentActiveChat);
            renderChatList();
            
            const packet = buildPacket(CMD_GROUP_MSG, 0, state.myId, JSON.stringify({ groupId: chat.groupId, text: JSON.stringify(payloadObj) }));
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

    document.getElementById('btn-send').onclick = async () => {
        if (!state.currentActiveChat) return;
        const chat = state.chats.get(state.currentActiveChat);
        const input = document.getElementById('msg-input');
        const text = input.value.trim();
        if (!text || (!chat.isSecure && !chat.isGroup)) return;

        input.value = '';
        sendMessageData({ text, isInvisible: isInvisibleMode });
    };

    document.getElementById('msg-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('btn-send').click();
    });

    document.getElementById('msg-input').addEventListener('input', () => {
        if (!state.currentActiveChat) return;
        const chat = state.chats.get(state.currentActiveChat);
        if (!chat.isSecure || chat.isGroup) return;

        const now = Date.now();
        if (now - state.lastTypingSent > 500) {
            state.lastTypingSent = now;
            const typingPacket = buildPacket(CMD_TYPING, state.currentActiveChat, state.myId, "");
            if (state.ws) state.ws.send(obfuscate(typingPacket));
        }
    });
}
