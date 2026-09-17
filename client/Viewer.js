import { SignalingClient } from './SignalingClient.js';
import { EVENTS } from '../shared/events.js';
import { loadYoutubeApi } from './youtube.js';

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
        
        // YouTube Watch Party
        this.ytContainer = null;
        this.ytPlayer = null;
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

        this.signaling.on(EVENTS.YOUTUBE_SYNC, async (payload) => {
            if (!this.ytPlayer && this.ytContainer) {
                if (this.videoElement) this.videoElement.style.display = 'none';
                
                const YT = await loadYoutubeApi();
                const playerDiv = document.createElement('div');
                this.ytContainer.appendChild(playerDiv);
                
                this.ytPlayer = new YT.Player(playerDiv, {
                    videoId: payload.videoId,
                    playerVars: { 'playsinline': 1, 'controls': 0, 'disablekb': 1 },
                    events: {
                        'onReady': () => this._applyYtSync(payload)
                    }
                });
            } else if (this.ytPlayer && this.ytPlayer.seekTo) {
                this._applyYtSync(payload);
            }
        });

        this.signaling.send(EVENTS.LIVE_JOIN, { liveId: this.liveId });
    }

    _applyYtSync(payload) {
        if (!this.ytPlayer || !this.ytPlayer.seekTo) return;
        
        const currentVid = this.ytPlayer.getVideoData ? this.ytPlayer.getVideoData().video_id : null;
        if (currentVid && currentVid !== payload.videoId) {
            this.ytPlayer.loadVideoById(payload.videoId, payload.time);
            return;
        }

        const currentTime = this.ytPlayer.getCurrentTime();
        const timeDiff = Math.abs(currentTime - payload.time);
        
        if (timeDiff > 2 || payload.action === 'seek') {
            this.ytPlayer.seekTo(payload.time, true);
        }

        if (payload.action === 'play') {
            this.ytPlayer.playVideo();
        } else if (payload.action === 'pause') {
            this.ytPlayer.pauseVideo();
        }
    }

    video(videoElement) {
        this.videoElement = videoElement;
        if (this.remoteStream) {
            videoElement.srcObject = this.remoteStream;
        }
    }

    youtube(containerElement) {
        this.ytContainer = containerElement;
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
