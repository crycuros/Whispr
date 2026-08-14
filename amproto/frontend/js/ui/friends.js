import { state } from '../core/store.js';
import { CMD_REQ_SEND, CMD_REQ_ACCEPT, CMD_REQ_DECLINE, buildPacket, obfuscate } from '../core/amproto.js';
import { initials, avatarColor, escapeHtml, getOrCreateChat } from './chatList.js';

export function renderResolvedProfile(profile) {
    state.resolvedProfile = profile;
    const results = document.getElementById('global-search-results');
    if (!results) return;

    if (!profile || !profile.userId) {
        results.innerHTML = `<div style="text-align: center; color: var(--text-secondary); margin-top: 40px; font-size: 14px;">User not found</div>`;
        return;
    }

    const isSelf = profile.userId === state.myId;
    const name = profile.username || `User ${profile.userId}`;

    let actionHTML = '';
    if (isSelf) {
        actionHTML = `<button class="profile-action" disabled>You</button>`;
    } else if (profile.friendStatus === 'friends') {
        actionHTML = `<button class="profile-action btn-chat" data-action="chat">Chat</button>`;
    } else if (profile.friendStatus === 'pending') {
        actionHTML = `<button class="profile-action" disabled>Request Sent</button>`;
    } else {
        actionHTML = `<button class="profile-action btn-add-friend" data-action="add">Add Friend</button>`;
    }

    results.innerHTML = `
        <div class="profile-card" style="margin: 16px;">
            <div class="profile-avatar" style="background:${avatarColor(name)}">${initials(name)}</div>
            <div class="profile-info">
                <div class="profile-name">${escapeHtml(name)}</div>
                <div class="profile-bio">${profile.bio ? escapeHtml(profile.bio) : 'No bio yet'}</div>
                <div class="profile-status ${profile.friendStatus === 'friends' ? 'ok' : ''}">
                    ${profile.friendStatus === 'friends' ? 'Friend' : profile.friendStatus === 'pending' ? 'Request pending' : 'Not connected'}
                </div>
            </div>
            ${actionHTML}
        </div>
    `;

    const btn = results.querySelector('[data-action]');
    if (btn) {
        btn.onclick = () => {
            if (btn.dataset.action === 'chat') {
                openFriendChat(profile.userId, profile.username);
            } else if (btn.dataset.action === 'add') {
                sendFriendRequest(profile.username);
            }
        };
    }
}

export function sendFriendRequest(username) {
    if (!state.ws || !state.myId) return;
    const packet = buildPacket(CMD_REQ_SEND, 0, state.myId, JSON.stringify({ toUsername: username, note: '' }));
    state.ws.send(obfuscate(packet));
}

export function acceptRequest(requestId) {
    if (!state.ws || !state.myId) return;
    const packet = buildPacket(CMD_REQ_ACCEPT, 0, state.myId, JSON.stringify({ requestId }));
    state.ws.send(obfuscate(packet));
}

export function declineRequest(requestId) {
    if (!state.ws || !state.myId) return;
    const packet = buildPacket(CMD_REQ_DECLINE, 0, state.myId, JSON.stringify({ requestId }));
    state.ws.send(obfuscate(packet));
}

export function openFriendChat(peerId, username) {
    import('../ui/messages.js').then(({ openChat }) => {
        const chat = getOrCreateChat(peerId);
        chat.username = username;
        openChat(peerId);
    });
}

export function renderPendingRequests() {
    const section = document.getElementById('friend-requests-section');
    const list = document.getElementById('friend-requests-list');
    if (!section || !list) return;

    if (!state.pendingRequests || state.pendingRequests.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';

    list.innerHTML = state.pendingRequests.map(req => `
        <div class="request-item">
            <div class="recent-avatar" style="background-color: ${avatarColor(req.fromUsername)};">
                <span>${initials(req.fromUsername)}</span>
            </div>
            <div class="request-info">
                <div class="request-name">${escapeHtml(req.fromUsername)}</div>
                ${req.note ? `<div class="request-note">${escapeHtml(req.note)}</div>` : ''}
            </div>
            <button class="req-accept" data-id="${req.requestId}">Accept</button>
            <button class="req-decline" data-id="${req.requestId}">Decline</button>
        </div>
    `).join('');

    list.querySelectorAll('.req-accept').forEach(btn => {
        btn.onclick = () => acceptRequest(Number(btn.dataset.id));
    });
    list.querySelectorAll('.req-decline').forEach(btn => {
        btn.onclick = () => declineRequest(Number(btn.dataset.id));
    });
}

export function addPendingRequest(req) {
    if (!state.pendingRequests.some(r => r.requestId === req.requestId)) {
        state.pendingRequests.push(req);
    }
    renderPendingRequests();
}

export function removePendingRequest(requestId) {
    state.pendingRequests = state.pendingRequests.filter(r => r.requestId !== requestId);
    renderPendingRequests();
}

export function setupFriendsUI() {
    renderPendingRequests();
}
