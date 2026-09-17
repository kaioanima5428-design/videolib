import { SignalingClient } from './SignalingClient.js';
import { EVENTS } from '../shared/events.js';

class SimpleEventEmitter {
    constructor() { this.events = new Map(); }
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

export class Viewer extends SimpleEventEmitter {
    constructor(liveId, signalingUrl) {
        super();
        this.liveId = liveId;
        this.signaling = new SignalingClient(signalingUrl);
        this.peerConnection = null;
        this.remoteStream = null;
        this.videoElement = null;
    }

    async conectar() {
        await this.signaling.connect();
        this.signaling.currentRoomType = 'viewer';
        this.signaling.currentRoomId = this.liveId;

        // Reconexão
        this.signaling.on('reconnecting', (info) => this.emit('reconectando', info));
        this.signaling.on('reconnected', () => {
            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }
            this.emit('reconectado');
        });
        this.signaling.on('error', (info) => this.emit('erro', info));

        this.signaling.on(EVENTS.LIVE_JOINED, (payload) => {
            console.log('Joined live as viewer:', this.liveId);
        });

        // Streamer envia uma offer para nós
        this.signaling.on(EVENTS.SIGNAL_OFFER, async (payload) => {
            console.log('Received offer from streamer');
            this.peerConnection = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });

            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.signaling.sendSignal(EVENTS.SIGNAL_ICE_CANDIDATE, payload.senderUserId, {
                        candidate: event.candidate
                    });
                }
            };

            this.peerConnection.ontrack = (event) => {
                this.remoteStream = event.streams[0];
                if (this.videoElement) {
                    this.videoElement.srcObject = this.remoteStream;
                }
                this.emit('video', { stream: this.remoteStream });
            };

            await this.peerConnection.setRemoteDescription(payload.sdp);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.signaling.sendSignal(EVENTS.SIGNAL_ANSWER, payload.senderUserId, {
                sdp: this.peerConnection.localDescription
            });
        });

        this.signaling.on(EVENTS.SIGNAL_ICE_CANDIDATE, async (payload) => {
            if (this.peerConnection) {
                try {
                    await this.peerConnection.addIceCandidate(payload.candidate);
                } catch (e) {
                    console.error('Error adding ICE candidate', e);
                }
            }
        });

        this.signaling.on(EVENTS.LIVE_ENDED, () => {
            this.emit('encerrado');
        });

        this.signaling.send(EVENTS.LIVE_JOIN, { liveId: this.liveId });
    }

    video(videoElement) {
        this.videoElement = videoElement;
        if (this.remoteStream) {
            videoElement.srcObject = this.remoteStream;
        }
    }

    sair() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        this.signaling.disconnect();
    }

    // ==================== ALIASES EM INGLÊS ====================
    async connect() { return this.conectar(); }
    leave() { return this.sair(); }
}
