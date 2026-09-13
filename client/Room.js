import { SignalingClient } from './SignalingClient.js';
import { EVENTS } from '../shared/events.js';

// EventEmitter implementation since browser doesn't have standard one
class SimpleEventEmitter {
    constructor() {
        this.events = new Map();
    }
    on(event, cb) {
        if (!this.events.has(event)) this.events.set(event, []);
        this.events.get(event).push(cb);
    }
    emit(event, data) {
        if (this.events.has(event)) {
            this.events.get(event).forEach(cb => cb(data));
        }
    }
}

export class Room extends SimpleEventEmitter {
    constructor(roomId, signalingUrl) {
        super();
        this.roomId = roomId;
        this.signaling = new SignalingClient(signalingUrl);
        this.peers = new Map(); // userId -> RTCPeerConnection
        this.peerQueues = new Map(); // userId -> Promise queue
        this.localStream = null;
    }

    async queueForPeer(userId, action) {
        if (!this.peerQueues.has(userId)) {
            this.peerQueues.set(userId, Promise.resolve());
        }
        const q = this.peerQueues.get(userId).then(action).catch(e => console.error('Error in peer queue:', e));
        this.peerQueues.set(userId, q);
        return q;
    }

    async entrar() {
        await this.signaling.connect();
        
        this.signaling.on(EVENTS.ROOM_JOINED, (payload) => {
            console.log('Joined room:', this.roomId, 'My ID:', payload.userId);
            // Initiate connection to all users already in the room
            for (const userId of payload.users) {
                this.initiateCall(userId);
            }
        });

        this.signaling.on(EVENTS.USER_JOINED, (payload) => {
            console.log('User joined room:', payload.userId);
            this.emit('entrar', { id: payload.userId });
            // The other person will initiate the call, we just wait for the offer
        });

        this.signaling.on(EVENTS.USER_LEFT, (payload) => {
            console.log('User left room:', payload.userId);
            this.removePeer(payload.userId);
            this.emit('sair', { id: payload.userId });
        });

        this.signaling.on(EVENTS.SIGNAL_OFFER, (payload) => {
            this.queueForPeer(payload.senderUserId, async () => {
                console.log('Received offer from:', payload.senderUserId);
                const peer = await this.getOrCreatePeer(payload.senderUserId);
                await peer.setRemoteDescription(payload.sdp);
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                this.signaling.sendSignal(EVENTS.SIGNAL_ANSWER, payload.senderUserId, {
                    sdp: peer.localDescription
                });
            });
        });

        this.signaling.on(EVENTS.SIGNAL_ANSWER, (payload) => {
            this.queueForPeer(payload.senderUserId, async () => {
                console.log('Received answer from:', payload.senderUserId);
                const peer = this.peers.get(payload.senderUserId);
                if (peer) {
                    await peer.setRemoteDescription(payload.sdp);
                }
            });
        });

        this.signaling.on(EVENTS.SIGNAL_ICE_CANDIDATE, (payload) => {
            this.queueForPeer(payload.senderUserId, async () => {
                const peer = this.peers.get(payload.senderUserId);
                if (peer) {
                    try {
                        await peer.addIceCandidate(payload.candidate);
                    } catch (e) {
                        console.error('Error adding ICE candidate', e);
                    }
                }
            });
        });

        this.signaling.joinRoom(this.roomId);
    }

    async initiateCall(targetUserId) {
        const peer = await this.getOrCreatePeer(targetUserId);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        this.signaling.sendSignal(EVENTS.SIGNAL_OFFER, targetUserId, {
            sdp: peer.localDescription
        });
    }

    async getOrCreatePeer(userId) {
        if (this.peers.has(userId)) {
            return this.peers.get(userId);
        }

        const peer = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                this.signaling.sendSignal(EVENTS.SIGNAL_ICE_CANDIDATE, userId, {
                    candidate: event.candidate
                });
            }
        };

        peer.ontrack = (event) => {
            this.emit('video', { 
                usuario: { id: userId }, 
                stream: event.streams[0] 
            });
        };

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peer.addTrack(track, this.localStream);
            });
        }

        this.peers.set(userId, peer);
        return peer;
    }

    removePeer(userId) {
        const peer = this.peers.get(userId);
        if (peer) {
            peer.close();
            this.peers.delete(userId);
        }
    }

    async camera(videoElement) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (videoElement) {
                videoElement.srcObject = this.localStream;
                videoElement.muted = true; 
            }
        } catch (error) {
            console.error('Não foi possível acessar a câmera e microfone:', error);
            throw error;
        }
    }

    async microfone() {
        console.log("Microfone ativado junto com a câmera.");
    }
}
