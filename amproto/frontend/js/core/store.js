export const state = {
    myId: null,
    myUsername: null,
    myPasswordHash: null,
    myAvatarUrl: null,
    myBio: '',
    myPreferences: {},
    chats: new Map(), // peerId -> Chat Object
    currentActiveChat: null,
    groupSeq: 1,
    pendingSpaceMembers: [],
    pendingFeedAvatar: null,
    pendingSpaceAvatar: null,
    currentCropper: null,
    activeCropCallback: null,
    activeCropElementId: null,
    lastTypingSent: 0,
    typingTimeout: null,
    ws: null
};
