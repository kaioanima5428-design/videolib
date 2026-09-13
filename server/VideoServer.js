import { WebSocketServer } from 'ws';
import { EVENTS } from '../shared/events.js';
import crypto from 'crypto';

export class VideoServer {
    constructor() {
        this.wss = null;
        this.rooms = new Map(); // roomId -> Map(userId -> ws)
    }

    start(port) {
        this.wss = new WebSocketServer({ port });
        
        this.wss.on('connection', (ws) => {
            // Assign a unique ID to each connection immediately
            ws.userId = crypto.randomUUID();

            ws.on('message', (message) => {
                this.handleMessage(ws, message);
            });

            ws.on('close', () => {
                this.handleDisconnect(ws);
            });
        });

        console.log(`VideoServer started on port ${port}`);
    }

    handleMessage(ws, message) {
        try {
            const data = JSON.parse(message);
            const { type, payload } = data;

            switch (type) {
                case EVENTS.ROOM_JOIN:
                    this.joinRoom(ws, payload.roomId);
                    break;
                case EVENTS.SIGNAL_OFFER:
                case EVENTS.SIGNAL_ANSWER:
                case EVENTS.SIGNAL_ICE_CANDIDATE:
                    this.forwardSignal(ws, type, payload);
                    break;
                default:
                    console.warn('Unknown message type:', type);
            }
        } catch (error) {
            console.error('Failed to handle message:', error);
        }
    }

    joinRoom(ws, roomId) {
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, new Map());
        }
        
        const room = this.rooms.get(roomId);
        room.set(ws.userId, ws);
        ws.roomId = roomId;

        // Notify others in the room
        this.broadcastToRoom(roomId, ws.userId, {
            type: EVENTS.USER_JOINED,
            payload: { userId: ws.userId }
        });

        // Send back the room confirmation and the list of already connected users
        const otherUsers = Array.from(room.keys()).filter(id => id !== ws.userId);
        
        ws.send(JSON.stringify({ 
            type: EVENTS.ROOM_JOINED, 
            payload: { 
                roomId,
                userId: ws.userId,
                users: otherUsers 
            } 
        }));
    }

    forwardSignal(ws, type, payload) {
        const roomId = ws.roomId;
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (!room) return;

        const targetWs = room.get(payload.targetUserId);
        if (targetWs && targetWs.readyState === 1) { // 1 = OPEN
            targetWs.send(JSON.stringify({
                type,
                payload: {
                    ...payload,
                    senderUserId: ws.userId // Attach the sender's ID so the target knows who it's from
                }
            }));
        }
    }

    broadcastToRoom(roomId, senderUserId, messageData) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        const messageString = JSON.stringify(messageData);
        for (const [userId, clientWs] of room.entries()) {
            if (userId !== senderUserId && clientWs.readyState === 1) {
                clientWs.send(messageString);
            }
        }
    }

    handleDisconnect(ws) {
        const roomId = ws.roomId;
        if (roomId && this.rooms.has(roomId)) {
            const room = this.rooms.get(roomId);
            room.delete(ws.userId);
            
            if (room.size === 0) {
                this.rooms.delete(roomId);
            } else {
                this.broadcastToRoom(roomId, ws.userId, {
                    type: EVENTS.USER_LEFT,
                    payload: { userId: ws.userId }
                });
            }
        }
    }
}
