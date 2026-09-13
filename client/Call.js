import { SignalingClient } from './SignalingClient.js';
import { EVENTS } from '../shared/events.js';

export class Call {
    constructor(roomId, signalingUrl) {
        this.roomId = roomId;
        this.signaling = new SignalingClient(signalingUrl);
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.onVideoCallback = null;
    }

    async entrar() {
        await this.signaling.connect();
        
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

    async camera(videoElement) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); // Audio included for simplicity here
            if (videoElement) {
                videoElement.srcObject = this.localStream;
                videoElement.muted = true; // Mute local video to prevent echo
            }

            if (this.peerConnection) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
        } catch (error) {
            console.error('Não foi possível acessar a câmera e microfone:', error);
            throw error;
        }
    }

    async microfone() {
        // In Phase 1, we include audio with the camera request.
        // We'll separate this properly in Phase 3.
        console.log("Microfone ativado junto com a câmera na Fase 1.");
    }
    
    onVideo(callback) {
        this.onVideoCallback = callback;
        if (this.remoteStream) {
            callback(this.remoteStream);
        }
    }
}
