import { SignalingClient } from './SignalingClient.js';
import { EVENTS } from '../shared/events.js';

export class Call {
    constructor(roomId, signalingUrl) {
        this.roomId = roomId;
        this.signaling = new SignalingClient(signalingUrl);
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.remoteUserId = null;
        this.onVideoCallback = null;
        this.localVideoElement = null;
        this.audioTrack = null;
        this.videoTrack = null;
        this.screenStream = null;
        this.originalVideoTrack = null;
    }

    async entrar() {
        await this.signaling.connect();

        // Eventos de reconexão
        this.signaling.on('reconnecting', (info) => {
            if (this.onReconnectingCallback) this.onReconnectingCallback(info);
        });
        this.signaling.on('reconnected', () => {
            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }
            if (this.onReconnectedCallback) this.onReconnectedCallback();
        });
        this.signaling.on('error', (info) => {
            if (this.onErrorCallback) this.onErrorCallback(info);
        });
        
        this.signaling.on(EVENTS.ROOM_JOINED, (payload) => {
            console.log('Joined room:', this.roomId);
            if (payload.users && payload.users.length > 0) {
                this.remoteUserId = payload.users[0];
                this.initiateCall();
            }
        });

        this.signaling.on(EVENTS.USER_JOINED, async (payload) => {
            console.log('User joined, waiting for offer');
            this.remoteUserId = payload.userId;
        });

        this.signaling.on(EVENTS.SIGNAL_OFFER, async (payload) => {
            console.log('Received offer, creating answer');
            this.remoteUserId = payload.senderUserId;
            await this.createPeerConnection();
            await this.peerConnection.setRemoteDescription(payload.sdp);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.signaling.sendSignal(EVENTS.SIGNAL_ANSWER, this.remoteUserId, {
                sdp: this.peerConnection.localDescription
            });
        });

        this.signaling.on(EVENTS.SIGNAL_ANSWER, async (payload) => {
            console.log('Received answer');
            await this.peerConnection.setRemoteDescription(payload.sdp);
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

        this.signaling.joinRoom(this.roomId);
    }

    async initiateCall() {
        console.log('Initiating call');
        await this.createPeerConnection();
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        this.signaling.sendSignal(EVENTS.SIGNAL_OFFER, this.remoteUserId, {
            sdp: this.peerConnection.localDescription
        });
    }

    async createPeerConnection() {
        if (this.peerConnection) return;

        this.peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.remoteUserId) {
                this.signaling.sendSignal(EVENTS.SIGNAL_ICE_CANDIDATE, this.remoteUserId, {
                    candidate: event.candidate
                });
            }
        };

        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            if (this.onVideoCallback) {
                this.onVideoCallback(this.remoteStream);
            }
        };

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        }
    }

    onVideo(callback) {
        this.onVideoCallback = callback;
        if (this.remoteStream) {
            callback(this.remoteStream);
        }
    }

    // ==================== CONTROLES DE MÍDIA ====================

    async camera(videoElement) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            
            this.videoTrack = this.localStream.getVideoTracks()[0] || null;
            this.audioTrack = this.localStream.getAudioTracks()[0] || null;
            
            if (videoElement) {
                this.localVideoElement = videoElement;
                videoElement.srcObject = this.localStream;
                videoElement.muted = true;
            }

            if (this.peerConnection) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
        } catch (error) {
            throw new Error('Não foi possível acessar a câmera: ' + error.message);
        }
    }

    async microfone(habilitar = true) {
        if (this.audioTrack) {
            this.audioTrack.enabled = habilitar;
        }
    }

    mute() {
        if (this.audioTrack) {
            this.audioTrack.enabled = false;
        }
    }

    desmutar() {
        if (this.audioTrack) {
            this.audioTrack.enabled = true;
        }
    }

    pausarCamera() {
        if (this.videoTrack) {
            this.videoTrack.enabled = false;
        }
    }

    retomarCamera() {
        if (this.videoTrack) {
            this.videoTrack.enabled = true;
        }
    }

    async tela(videoElement) {
        try {
            this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = this.screenStream.getVideoTracks()[0];

            this.originalVideoTrack = this.videoTrack;

            if (this.peerConnection) {
                const senders = this.peerConnection.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    await videoSender.replaceTrack(screenTrack);
                }
            }

            const targetElement = videoElement || this.localVideoElement;
            if (targetElement) {
                targetElement.srcObject = this.screenStream;
            }

            this.videoTrack = screenTrack;

            screenTrack.onended = async () => {
                await this.pararTela();
            };

        } catch (error) {
            throw new Error('Não foi possível compartilhar a tela: ' + error.message);
        }
    }

    async pararTela() {
        if (!this.originalVideoTrack) return;

        if (this.peerConnection) {
            const senders = this.peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(this.originalVideoTrack);
            }
        }

        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
        }

        this.videoTrack = this.originalVideoTrack;
        this.originalVideoTrack = null;

        if (this.localVideoElement) {
            this.localVideoElement.srcObject = this.localStream;
        }
    }

    // ==================== ALIASES EM INGLÊS ====================
    async join() { return this.entrar(); }
    async video(videoElement) { return this.camera(videoElement); }
    async audio(enable = true) { return this.microfone(enable); }
    unmute() { return this.desmutar(); }
    pauseVideo() { return this.pausarCamera(); }
    resumeVideo() { return this.retomarCamera(); }
    async screen(videoElement) { return this.tela(videoElement); }
    async stopScreen() { return this.pararTela(); }
}
