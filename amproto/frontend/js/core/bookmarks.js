import { state } from './store.js';

let bookmarks = {};
let filterActive = false;
const KEY = () => `whispr_bookmarks_${state.myUsername || 'anon'}`;

export function loadBookmarks() {
    try {
        bookmarks = JSON.parse(localStorage.getItem(KEY()) || '{}') || {};
    } catch (e) {
        bookmarks = {};
    }
    if (typeof bookmarks !== 'object' || Array.isArray(bookmarks)) bookmarks = {};
    return bookmarks;
}

export function saveBookmarks() {
    try {
        localStorage.setItem(KEY(), JSON.stringify(bookmarks));
    } catch (e) {}
}

export function isBookmarked(peerId, msgId) {
    const list = bookmarks[peerId] || [];
    return list.includes(msgId);
}

export function toggleBookmark(peerId, msgId) {
    const list = bookmarks[peerId] || [];
    const idx = list.indexOf(msgId);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(msgId);
    bookmarks[peerId] = list;
    saveBookmarks();
    return idx < 0;
}

export function getBookmarkedMessages(chat) {
    const ids = bookmarks[chat.peerId] || [];
    return chat.messages.filter(m => ids.includes(m.id));
}

export function isBookmarkFilterActive() {
    return filterActive;
}

export function setBookmarkFilterActive(v) {
    filterActive = v;
}
