import { Call } from './Call.js';
import { Room } from './Room.js';

export class Video {
    static _signalingUrl = 'ws://localhost:3000'; // Default, could be configurable

    static configure(options) {
        if (options.signalingUrl) {
            Video._signalingUrl = options.signalingUrl;
        }
    }

    static async chamada(roomId) {
        return new Call(roomId, Video._signalingUrl);
    }

    static async sala(roomId) {
        return new Room(roomId, Video._signalingUrl);
    }
}
