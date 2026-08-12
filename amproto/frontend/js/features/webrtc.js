import * as AMProto from '../core/amproto.js';
import * as Store from '../core/store.js';
import * as App from '../core/app.js';
import * as CallUI from '../ui/callUI.js';

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentCallTarget = null;
let isVideoCall = false;
let callStartTime = null;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

export async function startCall(targetId, video = false) {
    if (peerConnection) return; // Already in a call
    isVideoCall = video;
    currentCallTarget = targetId;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: isVideoCall, audio: true });
        CallUI.showActiveCall(localStream, null, isVideoCall, true);
        
        peerConnection = new RTCPeerConnection(configuration);
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        peerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            CallUI.updateRemoteStream(remoteStream, isVideoCall);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const packet = AMProto.buildPacket(AMProto.CMD_RTC_ICE, currentCallTarget, Store.state.myId, JSON.stringify(event.candidate));
                Store.state.ws.send(AMProto.obfuscate(packet));
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
                endCall();
            }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        const packet = AMProto.buildPacket(AMProto.CMD_RTC_CALL, currentCallTarget, Store.state.myId, JSON.stringify({
            offer: offer,
            video: isVideoCall
        }));
        Store.state.ws.send(AMProto.obfuscate(packet));

    } catch (err) {
        console.error('Error starting call:', err);
        CallUI.hideActiveCall();
        currentCallTarget = null;
    }
}

export function handleIncomingCall(senderId, payload) {
    if (peerConnection || currentCallTarget) {
        // Busy
        const packet = AMProto.buildPacket(AMProto.CMD_RTC_REJECT, senderId, Store.state.myId, JSON.stringify({ reason: 'busy' }));
        Store.state.ws.send(AMProto.obfuscate(packet));
        return;
    }

    currentCallTarget = senderId;
    isVideoCall = payload.video;
    
    CallUI.showIncomingCallModal(senderId, isVideoCall, payload.offer);
}

export async function acceptCall(offer) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: isVideoCall, audio: true });
        CallUI.showActiveCall(localStream, null, isVideoCall);

        peerConnection = new RTCPeerConnection(configuration);

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        peerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            CallUI.updateRemoteStream(remoteStream, isVideoCall);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const packet = AMProto.buildPacket(AMProto.CMD_RTC_ICE, currentCallTarget, Store.state.myId, JSON.stringify(event.candidate));
                Store.state.ws.send(AMProto.obfuscate(packet));
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
                endCall(false);
            }
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        const packet = AMProto.buildPacket(AMProto.CMD_RTC_ANSWER, currentCallTarget, Store.state.myId, JSON.stringify(answer));
        Store.state.ws.send(AMProto.obfuscate(packet));

        callStartTime = Date.now();

    } catch (err) {
        console.error('Error accepting call:', err);
        endCall(true);
    }
}

export function rejectCall() {
    const packet = AMProto.buildPacket(AMProto.CMD_RTC_REJECT, currentCallTarget, Store.state.myId, JSON.stringify({ reason: 'declined' }));
    Store.state.ws.send(AMProto.obfuscate(packet));
    currentCallTarget = null;
}

export async function handleAnswer(answer) {
    if (!peerConnection) return;
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        CallUI.hideRinging();
        callStartTime = Date.now();
    } catch (err) {
        console.error('Error setting remote description from answer:', err);
    }
}

export async function handleIceCandidate(candidate) {
    if (!peerConnection) return;
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
}

export function handleReject(payload) {
    console.log('Call rejected:', payload.reason);
    cleanupCall();
    CallUI.hideActiveCall();
    // Maybe show a toast that call was rejected/busy
}

export function handleEnd() {
    logCallDuration();
    cleanupCall();
    CallUI.hideActiveCall();
}

export function endCall(notifyPeer = true) {
    logCallDuration();
    if (notifyPeer && currentCallTarget) {
        const packet = AMProto.buildPacket(AMProto.CMD_RTC_END, currentCallTarget, Store.state.myId, JSON.stringify({}));
        Store.state.ws.send(AMProto.obfuscate(packet));
    }
    cleanupCall();
    CallUI.hideActiveCall();
}

function logCallDuration() {
    if (callStartTime && currentCallTarget) {
        const durationSecs = Math.floor((Date.now() - callStartTime) / 1000);
        const mins = Math.floor(durationSecs / 60);
        const secs = durationSecs % 60;
        const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        const target = currentCallTarget;
        const chat = Store.state.chats.get(target);
        if (chat) {
            chat.messages.push({
                type: 'system',
                text: `${isVideoCall ? 'Video' : 'Audio'} call ended - ${timeStr}`,
                time: Date.now()
            });
            import('../ui/messages.js').then(m => {
                if (Store.state.currentActiveChat === target) m.renderMessages(target);
                import('../ui/chatList.js').then(l => l.renderChatList());
            });
            import('../core/app.js').then(a => a.persistKeys && a.persistKeys());
        }
        callStartTime = null;
    }
}

function cleanupCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    remoteStream = null;
    currentCallTarget = null;
}

export function toggleAudio(enabled) {
    if (localStream) {
        localStream.getAudioTracks().forEach(t => t.enabled = enabled);
    }
}

export function toggleVideo(enabled) {
    if (localStream) {
        localStream.getVideoTracks().forEach(t => t.enabled = enabled);
    }
}
