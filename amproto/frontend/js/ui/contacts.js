import { state } from '../core/store.js';
import { CMD_CONTACT_LIST, CMD_CONTACT_SUGGEST, CMD_CONTACT_REMOVE, CMD_CONTACT_BLOCK, CMD_CONTACT_UNBLOCK, CMD_REQ_SEND, buildPacket, obfuscate } from '../core/amproto.js';
import { initials, avatarColor, escapeHtml } from './chatList.js';
import { openFriendChat, sendFriendRequest } from './friends.js';

function avatarHTML(name, avatarUrl) {
    if (avatarUrl) {
        return `<img src="${avatarUrl}" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    }
    return `<span>${initials(name)}</span>`;
}

function statusLine(contact) {
    if (contact.online) return `<span style="color: #297A4A;">Online</span>`;
    if (contact.lastSeen) {
        const now = Date.now();
        const diff = Math.max(0, now - contact.lastSeen);
        const mins = Math.floor(diff / 60000);
        let label;
        if (mins < 1) label = 'just now';
        else if (mins < 60) label = `${mins}m ago`;
        else if (mins < 1440) label = `${Math.floor(mins / 60)}h ago`;
        else label = `${Math.floor(mins / 1440)}d ago`;
        return `last seen ${label}`;
    }
    return 'Offline';
}

export function loadContacts() {
    if (!state.ws || !state.myId) return;
    const listPacket = buildPacket(CMD_CONTACT_LIST, 0, state.myId, '{}');
    state.ws.send(obfuscate(listPacket));
    const suggestPacket = buildPacket(CMD_CONTACT_SUGGEST, 0, state.myId, '{}');
    state.ws.send(obfuscate(suggestPacket));
}

export function handleContactListOk(data) {
    state.contacts = data.contacts || [];
    state.blockedContacts = data.blocked || [];
    renderContactsPanel();
}

export function handleContactSuggestOk(data) {
    state.contactSuggestions = data.suggestions || [];
    renderContactsPanel();
}

export function handleContactRemoveOk(data) {
    state.contacts = state.contacts.filter(c => c.userId !== data.userId);
    renderContactsPanel();
    loadContacts();
}

export function handleContactBlockOk(data) {
    const contact = state.contacts.find(c => c.userId === data.userId);
    state.contacts = state.contacts.filter(c => c.userId !== data.userId);
    if (contact) {
        state.blockedContacts.push({ userId: contact.userId, username: contact.username, avatarUrl: contact.avatarUrl, bio: contact.bio });
    }
    renderContactsPanel();
    loadContacts();
}

export function handleContactUnblockOk(data) {
    state.blockedContacts = state.blockedContacts.filter(c => c.userId !== data.userId);
    renderContactsPanel();
    loadContacts();
}

export function removeFriend(userId) {
    if (!state.ws || !state.myId) return;
    const packet = buildPacket(CMD_CONTACT_REMOVE, 0, state.myId, JSON.stringify({ userId }));
    state.ws.send(obfuscate(packet));
}

export function blockContact(userId) {
    if (!state.ws || !state.myId) return;
    const packet = buildPacket(CMD_CONTACT_BLOCK, 0, state.myId, JSON.stringify({ userId }));
    state.ws.send(obfuscate(packet));
}

export function unblockContact(userId) {
    if (!state.ws || !state.myId) return;
    const packet = buildPacket(CMD_CONTACT_UNBLOCK, 0, state.myId, JSON.stringify({ userId }));
    state.ws.send(obfuscate(packet));
}

export function openContactChat(userId, username) {
    openFriendChat(userId, username);
    const btnChats = document.getElementById('btn-chats');
    const panel = document.getElementById('panel-contacts');
    if (panel) panel.classList.remove('active');
    if (btnChats) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btnChats.classList.add('active');
    }
}

function renderContactsRows(container, contacts) {
    container.innerHTML = contacts.map(c => `
        <div class="contact-item" data-user-id="${c.userId}">
            <div class="recent-avatar contact-avatar" style="background-color: ${avatarColor(c.username)};">${avatarHTML(c.username, c.avatarUrl)}</div>
            <div class="request-info">
                <div class="request-name">${escapeHtml(c.username)}</div>
                <div class="request-note">${c.bio ? escapeHtml(c.bio) : statusLine(c)}</div>
            </div>
            <div class="contact-actions">
                <button class="contact-btn msg" data-action="msg" title="Message">Message</button>
                <button class="contact-btn danger" data-action="remove" title="Remove friend">Remove</button>
                <button class="contact-btn danger" data-action="block" title="Block">Block</button>
            </div>
        </div>
    `).join('');
}

export function renderContactsPanel() {
    const panel = document.getElementById('panel-contacts');
    if (!panel) return;

    const list = document.getElementById('contacts-list');
    const suggestionsSection = document.getElementById('contacts-suggestions-section');
    const suggestionsList = document.getElementById('contacts-suggestions-list');
    const blockedSection = document.getElementById('contacts-blocked-section');
    const blockedList = document.getElementById('contacts-blocked-list');
    if (!list || !suggestionsList || !blockedList) return;

    const query = (document.getElementById('contacts-search').value || '').trim().toLowerCase();
    const filtered = query
        ? state.contacts.filter(c => (c.username || '').toLowerCase().includes(query) || (c.bio || '').toLowerCase().includes(query))
        : state.contacts;

    if (filtered.length === 0) {
        list.innerHTML = `<div class="contacts-empty">${state.contacts.length === 0 ? 'No contacts yet. Find people with the search bar to add friends.' : 'No contacts match your search.'}</div>`;
    } else {
        renderContactsRows(list, filtered);
    }

    if (state.contactSuggestions.length === 0) {
        if (suggestionsSection) suggestionsSection.style.display = 'none';
    } else {
        if (suggestionsSection) suggestionsSection.style.display = '';
        suggestionsList.innerHTML = state.contactSuggestions.map(c => `
            <div class="contact-item" data-user-id="${c.userId}">
                <div class="recent-avatar contact-avatar" style="background-color: ${avatarColor(c.username)};">${avatarHTML(c.username, c.avatarUrl)}</div>
                <div class="request-info">
                    <div class="request-name">${escapeHtml(c.username)}</div>
                    <div class="request-note">${c.bio ? escapeHtml(c.bio) : 'Suggested for you'}</div>
                </div>
                <button class="contact-btn msg suggest-add" data-action="add" title="Add friend">Add</button>
            </div>
        `).join('');
    }

    if (state.blockedContacts.length === 0) {
        if (blockedSection) blockedSection.style.display = 'none';
    } else {
        if (blockedSection) blockedSection.style.display = '';
        blockedList.innerHTML = state.blockedContacts.map(c => `
            <div class="contact-item" data-user-id="${c.userId}">
                <div class="recent-avatar contact-avatar" style="background-color: ${avatarColor(c.username)};">${avatarHTML(c.username, c.avatarUrl)}</div>
                <div class="request-info">
                    <div class="request-name">${escapeHtml(c.username)}</div>
                    <div class="request-note">Blocked</div>
                </div>
                <button class="req-decline" data-action="unblock" title="Unblock">Unblock</button>
            </div>
        `).join('');
    }
}

function handleRowClick(e) {
    const item = e.target.closest('.contact-item');
    if (!item) return;
    const userId = Number(item.dataset.userId);
    const actionBtn = e.target.closest('[data-action]');

    if (actionBtn) {
        const action = actionBtn.dataset.action;
        const nameEl = item.querySelector('.request-name');
        const username = nameEl ? nameEl.textContent : `User ${userId}`;
        e.stopPropagation();
        if (action === 'msg') openContactChat(userId, username);
        else if (action === 'remove') removeFriend(userId);
        else if (action === 'block') blockContact(userId);
        else if (action === 'unblock') unblockContact(userId);
        else if (action === 'add') sendFriendRequest(username);
        return;
    }

    const nameEl = item.querySelector('.request-name');
    const username = nameEl ? nameEl.textContent : `User ${userId}`;
    openContactChat(userId, username);
}

export function setupContactsUI() {
    const btnContacts = document.getElementById('btn-contacts');
    const panel = document.getElementById('panel-contacts');
    const btnBack = document.getElementById('btn-back-contacts');
    const search = document.getElementById('contacts-search');

    if (btnContacts && panel) {
        btnContacts.addEventListener('click', () => {
            document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btnContacts.classList.add('active');
            if (search) search.value = '';
            panel.classList.add('active');
            renderContactsPanel();
            loadContacts();
        });
    }

    if (btnBack && panel) {
        btnBack.addEventListener('click', () => {
            panel.classList.remove('active');
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            const btnChats = document.getElementById('btn-chats');
            if (btnChats) btnChats.classList.add('active');
        });
    }

    if (search) {
        search.addEventListener('input', renderContactsPanel);
    }

    document.addEventListener('click', handleRowClick);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel && panel.classList.contains('active')) {
            panel.classList.remove('active');
        }
    });
}
