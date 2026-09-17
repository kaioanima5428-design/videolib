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

        this.signaling.on(EVENTS.LIVE_POSTER, (payload) => {
            if (this.videoElement) {
                this.videoElement.poster = payload.url;
            }
        });

        this.signaling.on(EVENTS.YOUTUBE_SYNC, async (payload) => {
            if (!this.ytPlayer && this.ytContainer) {
                if (this.videoElement) this.videoElement.style.display = 'none';
                
                const YT = await loadYoutubeApi();
                const playerDiv = document.createElement('div');
                this.ytContainer.appendChild(playerDiv);
                
                this.ytPlayer = new YT.Player(playerDiv, {
                    videoId: payload.videoId,
                    playerVars: { 'playsinline': 1, 'controls': 0, 'disablekb': 1, 'autoplay': 1 },
                    events: {
                        'onReady': () => {
                            // Impede que o usuário clique na tela para pausar o iframe
                            const iframe = this.ytPlayer.getIframe();
                            if (iframe) iframe.style.pointerEvents = 'none';

                            this._applyYtSync(payload);
                        },
                        'onStateChange': (event) => {
                            if (event.data === YT.PlayerState.ENDED) {
                                this.signaling.send(EVENTS.YOUTUBE_SYNC, { action: 'ended' });
                            }
                        }
                    }
                });
            } else if (this.ytPlayer && this.ytPlayer.seekTo) {
                this._applyYtSync(payload);
            }
        });

        this.signaling.on(EVENTS.FILE_SYNC, (payload) => {
            if (!this.videoElement) return;

            if (this.videoElement.srcObject) {
                this.videoElement.srcObject = null; // Desliga P2P se houver
            }

            // Impede que o espectador pause ou interaja com o vídeo (TV Mode)
            this.videoElement.controls = false;
            this.videoElement.style.pointerEvents = 'none';

            // Atualiza URL se for diferente
            const currentSrc = this.videoElement.src || '';
            if (!currentSrc.includes(payload.url)) {
                this.videoElement.src = payload.url;
            }

            // Sync de tempo
            const currentTime = this.videoElement.currentTime || 0;
            const timeDiff = Math.abs(currentTime - payload.time);
            
            if (timeDiff > 2 || payload.action === 'seek') {
                this.videoElement.currentTime = payload.time;
            }

            if (payload.action === 'play' || payload.action === 'sync') {
                this.videoElement.play().catch(e => console.warn('Autoplay block:', e));
            } else if (payload.action === 'pause') {
                this.videoElement.pause();
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

        if (payload.action === 'play' || payload.action === 'sync') {
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

        // Listener para VOD Sync (avisa o servidor que o vídeo acabou)
        this.videoElement.addEventListener('ended', () => {
            if (this.signaling) {
                this.signaling.send(EVENTS.FILE_SYNC, { action: 'ended' });
            }
        });
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
