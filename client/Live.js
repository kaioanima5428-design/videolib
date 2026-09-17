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

export class Live extends SimpleEventEmitter {
    constructor(liveId, signalingUrl) {
        super();
        this.liveId = liveId;
        this.signaling = new SignalingClient(signalingUrl);
        this.viewers = new Map(); // viewerId -> RTCPeerConnection
        this.localStream = null;
        this.localVideoElement = null;
        this.audioTrack = null;
        this.videoTrack = null;
        this.screenStream = null;
        this.originalVideoTrack = null;
    }

    async iniciar() {
        await this.signaling.connect();
        this.signaling.currentRoomType = 'live';
        this.signaling.currentRoomId = this.liveId;

        // Reconexão
        this.signaling.on('reconnecting', (info) => this.emit('reconectando', info));
        this.signaling.on('reconnected', () => {
            for (const peer of this.viewers.values()) peer.close();
            this.viewers.clear();
            this.emit('reconectado');
        });
        this.signaling.on('error', (info) => this.emit('erro', info));

        this.signaling.on(EVENTS.LIVE_STARTED, (payload) => {
            console.log('Live started:', this.liveId);
        });

        // Quando um viewer entra, criamos uma oferta para ele
        this.signaling.on(EVENTS.LIVE_VIEWER_JOINED, async (payload) => {
            console.log('Viewer joined:', payload.viewerId);
            this.emit('espectador:entrou', { id: payload.viewerId });
            await this.createViewerConnection(payload.viewerId);
        });

        this.signaling.on(EVENTS.LIVE_VIEWER_LEFT, (payload) => {
            console.log('Viewer left:', payload.viewerId);
            const peer = this.viewers.get(payload.viewerId);
            if (peer) {
                peer.close();
                this.viewers.delete(payload.viewerId);
            }
            this.emit('espectador:saiu', { id: payload.viewerId });
        });

        this.signaling.on(EVENTS.SIGNAL_ANSWER, async (payload) => {
            const peer = this.viewers.get(payload.senderUserId);
            if (peer) {
                await peer.setRemoteDescription(payload.sdp);
            }
        });

        this.signaling.on(EVENTS.SIGNAL_ICE_CANDIDATE, async (payload) => {
            const peer = this.viewers.get(payload.senderUserId);
            if (peer) {
                try {
                    await peer.addIceCandidate(payload.candidate);
                } catch (e) {
                    console.error('Error adding ICE candidate', e);
                }
            }
        });

        this.signaling.send(EVENTS.LIVE_START, { liveId: this.liveId });
    }

    async createViewerConnection(viewerId) {
        const peer = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                this.signaling.sendSignal(EVENTS.SIGNAL_ICE_CANDIDATE, viewerId, {
                    candidate: event.candidate
                });
            }
        };

        // Adiciona as trilhas locais (somente envio, viewer não envia nada)
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peer.addTrack(track, this.localStream);
            });
        }

        this.viewers.set(viewerId, peer);

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        this.signaling.sendSignal(EVENTS.SIGNAL_OFFER, viewerId, {
            sdp: peer.localDescription
        });
    }

    async parar() {
        for (const peer of this.viewers.values()) peer.close();
        this.viewers.clear();
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
        }
        this.signaling.disconnect();
        this.emit('encerrado');
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
        } catch (error) {
            throw new Error('Não foi possível acessar a câmera: ' + error.message);
        }
    }

    async microfone(habilitar = true) {
        if (this.audioTrack) this.audioTrack.enabled = habilitar;
    }

    mute() { if (this.audioTrack) this.audioTrack.enabled = false; }
    desmutar() { if (this.audioTrack) this.audioTrack.enabled = true; }
    pausarCamera() { if (this.videoTrack) this.videoTrack.enabled = false; }
    retomarCamera() { if (this.videoTrack) this.videoTrack.enabled = true; }

    async tela(videoElement) {
        try {
            this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = this.screenStream.getVideoTracks()[0];
            this.originalVideoTrack = this.videoTrack;

            for (const peer of this.viewers.values()) {
                const sender = peer.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) await sender.replaceTrack(screenTrack);
            }

            const target = videoElement || this.localVideoElement;
            if (target) target.srcObject = this.screenStream;
            this.videoTrack = screenTrack;

            screenTrack.onended = async () => await this.pararTela();
        } catch (error) {
            throw new Error('Não foi possível compartilhar a tela: ' + error.message);
        }
    }

    async pararTela() {
        if (!this.originalVideoTrack) return;
        for (const peer of this.viewers.values()) {
            const sender = peer.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) await sender.replaceTrack(this.originalVideoTrack);
        }
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
        }
        this.videoTrack = this.originalVideoTrack;
        this.originalVideoTrack = null;
        if (this.localVideoElement) this.localVideoElement.srcObject = this.localStream;
        this.emit('tela:parou');
    }

    // ==================== ALIASES EM INGLÊS ====================
    async start() { return this.iniciar(); }
    async stop() { return this.parar(); }
    async video(videoElement) { return this.camera(videoElement); }
    async audio(enable = true) { return this.microfone(enable); }
    unmute() { return this.desmutar(); }
    pauseVideo() { return this.pausarCamera(); }
    resumeVideo() { return this.retomarCamera(); }
    async screen(videoElement) { return this.tela(videoElement); }
    async stopScreen() { return this.pararTela(); }
}
