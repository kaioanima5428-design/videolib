import { EVENTS } from '../shared/events.js';

export class SignalingClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.handlers = new Map();
        this.userId = null; // Assigned by server
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);
            
            this.ws.onopen = () => {
                resolve();
            };

            this.ws.onerror = (error) => {
                reject(new Error('Failed to connect to signaling server'));
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                // Store our userId when we get ROOM_JOINED
                if (data.type === EVENTS.ROOM_JOINED) {
                    this.userId = data.payload.userId;
                }

                this.emit(data.type, data.payload);
            };

            this.ws.onclose = () => {
                this.emit('close');
            };
        });
    }

    joinRoom(roomId) {
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
