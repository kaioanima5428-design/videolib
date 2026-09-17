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

export class Live extends SimpleEventEmitter {
    constructor(liveId, signalingUrl) {
        super();
        this.liveId = liveId;
        this.signalingUrl = signalingUrl || 'ws://localhost:3000';
        this.signaling = new SignalingClient(this.signalingUrl);
        this.viewers = new Map(); // viewerId -> RTCPeerConnection
        this.localStream = null;
        this.localVideoElement = null;
        this.audioTrack = null;
        this.videoTrack = null;
        this.screenStream = null;
        this.originalVideoTrack = null;
        this.isScreenSharing = false;

        // Estado da fila de vídeos
        this.videoQueue = [];
        this.queueIndex = 0;
        this.isLooping = false;
        this._onVideoEnded = null;

        // Estado do YouTube Watch Party
        this.ytPlayer = null;
        this._ytSyncInterval = null;
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

    async parar(viewerId = null) {
        if (viewerId) {
            const peer = this.viewers.get(viewerId);
            if (peer) {
                peer.close();
                this.viewers.delete(viewerId);
            }
            return;
        }

        for (const peer of this.viewers.values()) peer.close();
        this.viewers.clear();
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
        }
        if (this._ytSyncInterval) clearInterval(this._ytSyncInterval);
        if (this.ytPlayer && this.ytPlayer.destroy) this.ytPlayer.destroy();
        
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
            
            // Atualiza trilhas para os peers ativos
            for (const peer of this.viewers.values()) {
                if (this.videoTrack) {
                    const videoSender = peer.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (videoSender) videoSender.replaceTrack(this.videoTrack);
                }
                if (this.audioTrack) {
                    const audioSender = peer.getSenders().find(s => s.track && s.track.kind === 'audio');
                    if (audioSender) audioSender.replaceTrack(this.audioTrack);
                }
            }
        } catch (error) {
            throw new Error('Não foi possível acessar a câmera: ' + error.message);
        }
    }

    async transmitirVideo(videoElement) {
        try {
            const captureFn = videoElement.captureStream || videoElement.mozCaptureStream;
            if (!captureFn) throw new Error("O navegador não suporta captureStream.");
            
            this.localStream = captureFn.call(videoElement);
            this.videoTrack = this.localStream.getVideoTracks()[0] || null;
            this.audioTrack = this.localStream.getAudioTracks()[0] || null;
            this.localVideoElement = videoElement;

            for (const peer of this.viewers.values()) {
                if (this.videoTrack) {
                    const videoSender = peer.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (videoSender) await videoSender.replaceTrack(this.videoTrack);
                }
                if (this.audioTrack) {
                    const audioSender = peer.getSenders().find(s => s.track && s.track.kind === 'audio');
                    if (audioSender) await audioSender.replaceTrack(this.audioTrack);
                }
            }
        } catch (error) {
            throw new Error('Não foi possível capturar o vídeo: ' + error.message);
        }
    }

    async transmitirImagem(fileOrUrl) {
        let imgUrl = fileOrUrl;
        if (fileOrUrl instanceof File) {
            imgUrl = URL.createObjectURL(fileOrUrl);
        }
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = imgUrl;
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Erro ao processar imagem.'));
        });

        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const hRatio = canvas.width / img.width;
        const vRatio = canvas.height / img.height;
        const ratio  = Math.min(hRatio, vRatio);
        const cx = (canvas.width - img.width*ratio) / 2;
        const cy = (canvas.height - img.height*ratio) / 2;
        ctx.drawImage(img, 0, 0, img.width, img.height, cx, cy, img.width*ratio, img.height*ratio);

        const canvasStream = canvas.captureStream(15);
        this.videoTrack = canvasStream.getVideoTracks()[0];
        
        if (this.localVideoElement) {
            if (this.localVideoElement.srcObject) {
                const currentAudio = this.localVideoElement.srcObject.getAudioTracks();
                this.localVideoElement.srcObject = new MediaStream([this.videoTrack, ...currentAudio]);
            } else {
                this.localVideoElement.srcObject = canvasStream;
            }
        }

        for (const peer of this.viewers.values()) {
            const videoSender = peer.getSenders().find(s => s.track && s.track.kind === 'video');
            if (videoSender) videoSender.replaceTrack(this.videoTrack);
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

    // ==================== FILA DE VÍDEOS (QUEUE) ====================
    adicionarNaFila(arquivoOuUrl) {
        this.videoQueue.push(arquivoOuUrl);
    }

    removerDaFila(index) {
        this.videoQueue.splice(index, 1);
    }

    loopFila(ativo) {
        this.isLooping = ativo;
    }

    async iniciarFila(videoElement) {
        if (this.videoQueue.length === 0) throw new Error("A fila está vazia.");
        this.localVideoElement = videoElement;
        
        if (this._onVideoEnded) {
            videoElement.removeEventListener('ended', this._onVideoEnded);
        }

        this._onVideoEnded = async () => {
            this.queueIndex++;
            if (this.queueIndex >= this.videoQueue.length) {
                if (this.isLooping) {
                    this.queueIndex = 0;
                } else {
                    return; // Fim da fila
                }
            }
            await this._tocarVideoAtual(videoElement);
        };
        videoElement.addEventListener('ended', this._onVideoEnded);
        
        this.queueIndex = 0;
        await this._tocarVideoAtual(videoElement);
    }

    async _tocarVideoAtual(videoElement) {
        const item = this.videoQueue[this.queueIndex];
        let fileUrl = item;
        if (item instanceof File) {
            fileUrl = URL.createObjectURL(item);
        }
        
        videoElement.srcObject = null;
        videoElement.src = fileUrl;
        
        // Aguarda carregar os metadados para garantir que o vídeo pode ser tocado e capturado
        await new Promise((resolve, reject) => {
            videoElement.onloadedmetadata = resolve;
            videoElement.onerror = reject;
        });

        await videoElement.play();
        await this.transmitirVideo(videoElement);
        this.emit('fila:mudou', { index: this.queueIndex, item });
    }

    // ==================== YOUTUBE WATCH PARTY ====================
    async youtube(containerElement, videoIdOuArray) {
        const YT = await loadYoutubeApi();
        
        // Extrai o ID do(s) link(s)
        const videos = Array.isArray(videoIdOuArray) ? videoIdOuArray : [videoIdOuArray];
        const finalIds = videos.map(vid => {
            if (vid.includes('youtube.com') || vid.includes('youtu.be')) {
                const url = new URL(vid);
                return url.searchParams.get('v') || url.pathname.slice(1);
            }
            return vid;
        });

        const mainVideoId = finalIds[0];
        const playlistStr = finalIds.join(',');

        const playerDiv = document.createElement('div');
        containerElement.appendChild(playerDiv);

        return new Promise((resolve) => {
            this.ytPlayer = new YT.Player(playerDiv, {
                videoId: mainVideoId,
                playerVars: { 
                    'playsinline': 1, 
                    'controls': 1,
                    'loop': 1,
                    'playlist': playlistStr 
                },
                events: {
                    'onReady': () => {
                        resolve(this.ytPlayer);
                        
                        // Sincronização Periódica para seeks
                        if (this._ytSyncInterval) clearInterval(this._ytSyncInterval);
                        this._ytSyncInterval = setInterval(() => {
                            if (this.ytPlayer && this.ytPlayer.getPlayerState) {
                                const state = this.ytPlayer.getPlayerState();
                                if (state === YT.PlayerState.PLAYING) {
                                    const time = this.ytPlayer.getCurrentTime();
                                    const data = this.ytPlayer.getVideoData ? this.ytPlayer.getVideoData() : {};
                                    const currVid = data.video_id || mainVideoId;
                                    this.signaling.send(EVENTS.YOUTUBE_SYNC, { action: 'sync', time, videoId: currVid });
                                }
                            }
                        }, 2000);
                    },
                    'onStateChange': (event) => {
                        const state = event.data;
                        const time = this.ytPlayer.getCurrentTime();
                        const data = this.ytPlayer.getVideoData ? this.ytPlayer.getVideoData() : {};
                        const currVid = data.video_id || mainVideoId;
                        let action = '';

                        if (state === YT.PlayerState.PLAYING) action = 'play';
                        else if (state === YT.PlayerState.PAUSED) action = 'pause';

                        if (action) {
                            this.signaling.send(EVENTS.YOUTUBE_SYNC, { action, time, videoId: currVid });
                        }
                    }
                }
            });
        });
    }

    // ==================== CAPA DA LIVE ====================
    async capa(fileOrUrl) {
        let url = fileOrUrl;
        if (fileOrUrl instanceof File) {
            const formData = new FormData();
            formData.append('video', fileOrUrl);
            const endpoint = this.signalingUrl.replace('ws://', 'http://').replace('wss://', 'https://') + '/videos';
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData
            });
            if (!response.ok) throw new Error('Falha no upload da capa');
            const res = await response.json();
            url = res.url;
        }
        
        if (this.localVideoElement) {
            this.localVideoElement.poster = url;
        }
        this.signaling.send(EVENTS.LIVE_POSTER, { url });
        return url;
    }

    // ==================== ALIASES EM INGLÊS ====================
    async start() { return this.iniciar(); }
    async stop(id = null) { return this.parar(id); }
    async video(videoElement) { return this.camera(videoElement); }
    async streamVideo(videoElement) { return this.transmitirVideo(videoElement); }
    async streamImage(fileOrUrl) { return this.transmitirImagem(fileOrUrl); }
    async audio(enable = true) { return this.microfone(enable); }
    unmute() { return this.desmutar(); }
    pauseVideo() { return this.pausarCamera(); }
    resumeVideo() { return this.retomarCamera(); }
    async screen(videoElement) { return this.tela(videoElement); }
    async stopScreen() { return this.pararTela(); }
    
    async enqueue(file) { return this.adicionarNaFila(file); }
    dequeue(index) { this.removerDaFila(index); }
    async loopQueue(active) { return this.loopFila(active); }
    async startQueue(videoElement) { return this.iniciarFila(videoElement); }
    async poster(fileOrUrl) { return this.capa(fileOrUrl); }
}
