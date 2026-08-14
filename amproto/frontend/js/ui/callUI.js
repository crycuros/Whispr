import * as WebRTC from '../features/webrtc.js';
import * as Store from '../core/store.js';

let currentIncomingOffer = null;

export function initCallUI() {
    const btnAudio = document.getElementById('btn-call-audio');
    const btnVideo = document.getElementById('btn-call-video');
    const btnReject = document.getElementById('btn-reject-call');
    const btnAccept = document.getElementById('btn-accept-call');
    const btnToggleMic = document.getElementById('btn-toggle-mic');
    const btnToggleCam = document.getElementById('btn-toggle-cam');
    const btnEndCall = document.getElementById('btn-end-call');

    if (btnAudio) {
        btnAudio.addEventListener('click', () => {
            const target = Store.state.currentActiveChat;
            if (target && !String(target).startsWith('group_')) {
                WebRTC.startCall(target, false);
            }
        });
    }

    if (btnVideo) {
        btnVideo.addEventListener('click', () => {
            const target = Store.state.currentActiveChat;
            if (target && !String(target).startsWith('group_')) {
                WebRTC.startCall(target, true);
            }
        });
    }

    if (btnReject) {
        btnReject.addEventListener('click', () => {
            hideIncomingCallModal();
            WebRTC.rejectCall();
        });
    }

    if (btnAccept) {
        btnAccept.addEventListener('click', () => {
            const offer = currentIncomingOffer;
            hideIncomingCallModal();
            if (offer) {
                WebRTC.acceptCall(offer);
            }
        });
    }

    let micEnabled = true;
    if (btnToggleMic) {
        btnToggleMic.addEventListener('click', () => {
            micEnabled = !micEnabled;
            WebRTC.toggleAudio(micEnabled);
            btnToggleMic.style.opacity = micEnabled ? '1' : '0.5';
        });
    }

    let camEnabled = true;
    if (btnToggleCam) {
        btnToggleCam.addEventListener('click', () => {
            camEnabled = !camEnabled;
            WebRTC.toggleVideo(camEnabled);
            btnToggleCam.style.opacity = camEnabled ? '1' : '0.5';
        });
    }

    const btnShareScreen = document.getElementById('btn-share-screen');
    let isSharingScreen = false;
    if (btnShareScreen) {
        btnShareScreen.addEventListener('click', async () => {
            isSharingScreen = !isSharingScreen;
            await WebRTC.toggleScreenShare(isSharingScreen);
            btnShareScreen.style.color = isSharingScreen ? 'var(--accent)' : '';
        });
    }

    const btnVoiceModulator = document.getElementById('btn-voice-modulator');
    let isModulatorOn = false;
    if (btnVoiceModulator) {
        btnVoiceModulator.addEventListener('click', () => {
            isModulatorOn = !isModulatorOn;
            WebRTC.toggleVoiceModulator(isModulatorOn);
            btnVoiceModulator.style.color = isModulatorOn ? 'var(--accent)' : '';
        });
    }

    if (btnEndCall) {
        btnEndCall.addEventListener('click', () => {
            WebRTC.endCall();
        });
    }
}

export function showIncomingCallModal(callerId, isVideo, offer) {
    currentIncomingOffer = offer;
    const modal = document.getElementById('incoming-call-modal');
    const title = document.getElementById('incoming-call-title');
    
    let callerName = callerId;
    if (Store.state.chats.has(callerId)) {
        callerName = Store.state.chats.get(callerId).username;
    }

    if (title) {
        title.innerText = `Incoming ${isVideo ? 'Video' : 'Audio'} Call`;
    }
    const desc = document.getElementById('incoming-call-desc');
    if (desc) {
        desc.innerText = `${callerName} is calling you...`;
    }

    if (modal) modal.style.display = 'flex';
}

export function hideIncomingCallModal() {
    const modal = document.getElementById('incoming-call-modal');
    if (modal) modal.style.display = 'none';
    currentIncomingOffer = null;
}

export function showActiveCall(localStream, remoteStream, isVideo, isRinging = false) {
    const panel = document.getElementById('active-call-panel');
    const localVid = document.getElementById('local-video');
    const statusOverlay = document.getElementById('call-status-overlay');
    
    if (panel) panel.style.display = 'flex';
    
    if (statusOverlay) {
        statusOverlay.style.display = isRinging ? 'flex' : 'none';
        if (isRinging) statusOverlay.innerText = 'Ringing...';
    }
    
    if (localVid && localStream) {
        localVid.srcObject = localStream;
        localVid.style.display = isVideo ? 'block' : 'none';
    }
}

export function hideRinging() {
    const statusOverlay = document.getElementById('call-status-overlay');
    if (statusOverlay) statusOverlay.style.display = 'none';
}

export function updateRemoteStream(stream, isVideo = true) {
    const remoteVid = document.getElementById('remote-video');
    hideRinging();
    if (remoteVid) {
        remoteVid.srcObject = stream;
        remoteVid.style.display = isVideo ? 'block' : 'none';
    }
}

export function hideActiveCall() {
    const panel = document.getElementById('active-call-panel');
    const localVid = document.getElementById('local-video');
    const remoteVid = document.getElementById('remote-video');
    const statusOverlay = document.getElementById('call-status-overlay');
    
    if (panel) panel.style.display = 'none';
    if (localVid) localVid.srcObject = null;
    if (remoteVid) remoteVid.srcObject = null;
    if (statusOverlay) statusOverlay.style.display = 'none';
}
