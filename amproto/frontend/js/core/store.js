export const state = {
    myId: null,
    myUsername: null,
    myAvatarUrl: null,
    myBio: '',
    myPreferences: {},
    chats: new Map(), // peerId -> Chat Object
    pendingRequests: [], // incoming friend requests
    resolvedProfile: null, // last resolved search profile
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
    presence: new Map(), // userId -> { online, lastSeen }
    identityKeyPair: null,
    ws: null,
    premiumUntil: 0,
    subscriptionToken: null,
    selectedPlan: null
};
