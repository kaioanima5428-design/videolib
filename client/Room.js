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
        this.localVideoElement = null;
        this.audioTrack = null;
        this.videoTrack = null;
        this.screenStream = null;
        this.originalVideoTrack = null; // Guarda a trilha da câmera quando compartilha tela
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

        // Eventos de reconexão
        this.signaling.on('reconnecting', (info) => {
            this.emit('reconectando', info);
        });
        this.signaling.on('reconnected', () => {
            // Limpa peers antigos, o ROOM_JOINED vai recriá-los
            for (const [userId, peer] of this.peers) {
                peer.close();
            }
            this.peers.clear();
            this.peerQueues.clear();
            this.emit('reconectado');
        });
        this.signaling.on('error', (info) => {
            this.emit('erro', info);
        });
        
        this.signaling.on(EVENTS.ROOM_JOINED, (payload) => {
            console.log('Joined room:', this.roomId, 'My ID:', payload.userId);
            for (const userId of payload.users) {
                this.initiateCall(userId);
            }
        });

        this.signaling.on(EVENTS.USER_JOINED, (payload) => {
            console.log('User joined room:', payload.userId);
            this.emit('entrar', { id: payload.userId });
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
        this.peerQueues.delete(userId);
    }

    // ==================== CONTROLES DE MÍDIA ====================

    async camera(videoElement) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            
            // Salva referências individuais às trilhas
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

            // Guarda a trilha original da câmera para restaurar depois
            this.originalVideoTrack = this.videoTrack;

            // Substitui a trilha de vídeo em TODAS as conexões peer ativas
            for (const peer of this.peers.values()) {
                const senders = peer.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    await videoSender.replaceTrack(screenTrack);
                }
            }

            // Atualiza a exibição local (se um elemento foi passado ou se já havia um)
            const targetElement = videoElement || this.localVideoElement;
            if (targetElement) {
                targetElement.srcObject = this.screenStream;
            }

            this.videoTrack = screenTrack;

            // Detecta quando o usuário para de compartilhar a tela pelo botão do navegador
            screenTrack.onended = async () => {
                await this.pararTela();
            };

        } catch (error) {
            throw new Error('Não foi possível compartilhar a tela: ' + error.message);
        }
    }

    async pararTela() {
        if (!this.originalVideoTrack) return;

        // Restaura a trilha da câmera em todas as conexões peer
        for (const peer of this.peers.values()) {
            const senders = peer.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(this.originalVideoTrack);
            }
        }

        // Para as trilhas do screenStream
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
        }

        // Restaura a exibição local
        this.videoTrack = this.originalVideoTrack;
        this.originalVideoTrack = null;

        if (this.localVideoElement) {
            this.localVideoElement.srcObject = this.localStream;
        }

        this.emit('tela:parou');
    }
}
