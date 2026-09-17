import { EVENTS } from '../shared/events.js';

export class SignalingClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.handlers = new Map();
        this.userId = null;
        this.currentRoomId = null;
        this.currentRoomType = null; // 'room', 'call', 'live', 'viewer'
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.isReconnecting = false;
        this.intentionallyClosed = false;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.intentionallyClosed = false;
            this.ws = new WebSocket(this.url);
            
            this.ws.onopen = () => {
                if (this.isReconnecting) {
                    this.isReconnecting = false;
                    this.reconnectAttempts = 0;
                    this.emit('reconnected');

                    // Re-entra na sala automaticamente
                    if (this.currentRoomId) {
                        if (this.currentRoomType === 'live') {
                            this.send(EVENTS.LIVE_START, { liveId: this.currentRoomId });
                        } else if (this.currentRoomType === 'viewer') {
                            this.send(EVENTS.LIVE_JOIN, { liveId: this.currentRoomId });
                        } else {
                            this.joinRoom(this.currentRoomId);
                        }
                    }
                }
                resolve();
            };

            this.ws.onerror = () => {
                if (!this.isReconnecting) {
                    reject(new Error('Não foi possível conectar ao servidor de sinalização.'));
                }
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.type === EVENTS.ROOM_JOINED) {
                    this.userId = data.payload.userId;
                }
                if (data.type === EVENTS.LIVE_STARTED) {
                    this.userId = data.payload.streamerId;
                }
                if (data.type === EVENTS.LIVE_JOINED) {
                    this.userId = data.payload.viewerId;
                }

                this.emit(data.type, data.payload);
            };

            this.ws.onclose = () => {
                if (this.intentionallyClosed) return;
                this.tryReconnect();
            };
        });
    }

    tryReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.emit('error', { message: 'Não foi possível reconectar ao servidor após várias tentativas.' });
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        // Backoff exponencial: 1s, 2s, 4s, 8s... máximo 30s
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

        this.emit('reconnecting', { 
            attempt: this.reconnectAttempts, 
            maxAttempts: this.maxReconnectAttempts,
            nextRetryMs: delay
        });

        setTimeout(() => {
            this.connect().catch(() => {
                // Se falhar, o onclose vai chamar tryReconnect novamente
            });
        }, delay);
    }

    disconnect() {
        this.intentionallyClosed = true;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    joinRoom(roomId) {
        this.currentRoomId = roomId;
        this.currentRoomType = 'room';
        this.send(EVENTS.ROOM_JOIN, { roomId });
    }

    sendSignal(type, targetUserId, payload) {
        this.send(type, {
            targetUserId,
            ...payload
        });
    }

    send(type, payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, payload }));
        }
    }

    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
        }
        this.handlers.get(event).push(handler);
    }

    emit(event, payload) {
        const handlers = this.handlers.get(event);
        if (handlers) {
            handlers.forEach(handler => handler(payload));
        }
    }
}
