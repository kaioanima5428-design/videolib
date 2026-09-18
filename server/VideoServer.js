import { WebSocketServer } from 'ws';
import { EVENTS } from '../shared/events.js';
import crypto from 'crypto';
import http from 'http';
import fs from 'fs';
import path from 'path';

const MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.ogg': 'video/ogg',
    '.m4v': 'video/mp4',
    // Imagens
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
};

export class VideoServer {
    constructor() {
        this.wss = null;
        this.httpServer = null;
        this.rooms = new Map(); // roomId -> Map(userId -> ws)
        this.youtubeRooms = new Map(); // roomId -> { playlist, queueIndex, state, currentTime, lastUpdate, interval }
        this.fileRooms = new Map(); // roomId -> { playlist, queueIndex, state, currentTime, lastUpdate, interval }
        this.videosPath = null; // Caminho da pasta de vídeos
        this.videosRoute = '/videos'; // Rota HTTP para os vídeos
    }

    videos(dirPath, route = '/videos') {
        this.videosPath = path.resolve(dirPath);
        this.videosRoute = route;

        if (!fs.existsSync(this.videosPath)) {
            throw new Error(`Pasta de vídeos não encontrada: ${this.videosPath}`);
        }

        console.log(`Servindo vídeos de: ${this.videosPath} na rota ${this.videosRoute}`);
    }

    start(port) {
        // Cria um servidor HTTP próprio (para quem não tem servidor já rodando)
        this.httpServer = http.createServer((req, res) => {
            this.handleHttpRequest(req, res);
        });

        this.setupWebSocket(this.httpServer);

        this.httpServer.listen(port, () => {
            console.log(`VideoServer started on port ${port}`);
        });
    }

    anexar(server) {
        // Conecta o VideoServer a um servidor HTTP/Express já existente
        // Assim o dev não precisa abrir uma porta nova
        //
        // Uso com Express:
        //   const app = express();
        //   const httpServer = app.listen(3000);
        //   videoServer.anexar(httpServer);
        //
        // Uso com http.createServer:
        //   const httpServer = http.createServer(handler);
        //   videoServer.anexar(httpServer);

        this.httpServer = server;

        // Intercepta as requisições HTTP para tratar as rotas de vídeo
        const originalListeners = server.listeners('request').slice();
        server.removeAllListeners('request');

        server.on('request', (req, res) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const pathname = url.pathname;

            // Se a rota pertence ao VideoServer, trata aqui
            if (this.videosPath && (pathname === this.videosRoute || pathname.startsWith(this.videosRoute + '/'))) {
                return this.handleHttpRequest(req, res);
            }

            // Senão, repassa para os handlers originais do servidor do dev
            for (const listener of originalListeners) {
                listener.call(server, req, res);
            }
        });

        this.setupWebSocket(server);
        console.log('VideoServer attached to existing server');
    }

    setupWebSocket(server) {
        this.wss = new WebSocketServer({ noServer: true });

        server.on('upgrade', (request, socket, head) => {
            const pathname = request.url.split('?')[0];

            // Só processa o upgrade se a rota for nossa ('/' ou '/videolib')
            // Isso evita quebrar o Socket.io ou outras libs do dev que usam Websocket
            if (pathname === '/' || pathname === '/videolib') {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request);
                });
            }
        });

        this.wss.on('connection', (ws) => {
            ws.userId = crypto.randomUUID();

            ws.on('message', (message) => {
                this.handleMessage(ws, message);
            });

            ws.on('close', () => {
                this.handleDisconnect(ws);
            });
        });
    }

    // ==================== HEADLESS YOUTUBE SERVER ====================
    
    _extractYtId(urlOrId) {
        if (!urlOrId) return null;
        const match = urlOrId.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
        return match ? match[1] : urlOrId;
    }

    youtubeParty(roomId, playlist) {
        if (this.youtubeRooms.has(roomId)) {
            this.stopYoutubeParty(roomId);
        }

        let ids = [];
        if (Array.isArray(playlist)) {
            ids = playlist.map(v => this._extractYtId(v)).filter(Boolean);
        } else {
            const singleId = this._extractYtId(playlist);
            if (singleId) ids = [singleId];
        }

        if (ids.length === 0) return;

        const state = {
            playlist: ids,
            queueIndex: 0,
            status: 'PLAYING',
            currentTime: 0,
            lastUpdate: Date.now(),
            interval: null,
            lastJump: 0
        };

        state.interval = setInterval(() => {
            if (state.status === 'PLAYING') {
                const now = Date.now();
                const delta = (now - state.lastUpdate) / 1000;
                state.currentTime += delta;
                state.lastUpdate = now;
            }

            const videoId = state.playlist[state.queueIndex];
            const payload = {
                action: state.status === 'PLAYING' ? 'sync' : 'pause',
                time: state.currentTime,
                videoId: videoId
            };
            
            this.broadcastToRoom(roomId, 'server', { type: EVENTS.YOUTUBE_SYNC, payload });
        }, 2000);

        this.youtubeRooms.set(roomId, state);
    }

    youtubeQueue(roomId, urlOrId) {
        const id = this._extractYtId(urlOrId);
        if (!id) return;

        const state = this.youtubeRooms.get(roomId);
        if (state) {
            state.playlist.push(id);
        } else {
            this.youtubeParty(roomId, [id]);
        }
    }

    youtubePlay(roomId) {
        const state = this.youtubeRooms.get(roomId);
        if (!state || state.status === 'PLAYING') return;
        state.status = 'PLAYING';
        state.lastUpdate = Date.now();
        this.broadcastToRoom(roomId, 'server', { 
            type: EVENTS.YOUTUBE_SYNC, 
            payload: { action: 'play', time: state.currentTime, videoId: state.playlist[state.queueIndex] } 
        });
    }

    youtubePause(roomId) {
        const state = this.youtubeRooms.get(roomId);
        if (!state || state.status === 'PAUSED') return;
        state.currentTime += (Date.now() - state.lastUpdate) / 1000;
        state.status = 'PAUSED';
        this.broadcastToRoom(roomId, 'server', { 
            type: EVENTS.YOUTUBE_SYNC, 
            payload: { action: 'pause', time: state.currentTime, videoId: state.playlist[state.queueIndex] } 
        });
    }

    youtubeSeek(roomId, time) {
        const state = this.youtubeRooms.get(roomId);
        if (!state) return;
        state.currentTime = time;
        state.lastUpdate = Date.now();
        this.broadcastToRoom(roomId, 'server', { 
            type: EVENTS.YOUTUBE_SYNC, 
            payload: { action: 'seek', time: state.currentTime, videoId: state.playlist[state.queueIndex] } 
        });
    }

    youtubeNext(roomId) {
        const state = this.youtubeRooms.get(roomId);
        if (!state) return;
        
        const now = Date.now();
        if (now - state.lastJump < 3000) return; // Debounce de 3s
        state.lastJump = now;

        if (state.queueIndex < state.playlist.length - 1) {
            state.queueIndex++;
            state.currentTime = 0;
            state.lastUpdate = Date.now();
            this.broadcastToRoom(roomId, 'server', { 
                type: EVENTS.YOUTUBE_SYNC, 
                payload: { action: 'sync', time: state.currentTime, videoId: state.playlist[state.queueIndex] } 
            });
        }
    }

    stopYoutubeParty(roomId) {
        const state = this.youtubeRooms.get(roomId);
        if (state) {
            if (state.interval) clearInterval(state.interval);
            this.broadcastToRoom(roomId, 'server', { 
                type: EVENTS.YOUTUBE_SYNC, 
                payload: { action: 'pause', time: state.currentTime, videoId: state.playlist[state.queueIndex] } 
            });
            this.youtubeRooms.delete(roomId);
        }
    }

    // =================================================================

    // ==================== HEADLESS FILE SERVER (VOD SYNC) ====================

    fileParty(roomId, playlist) {
        if (this.fileRooms.has(roomId)) {
            this.stopFileParty(roomId);
        }

        let urls = [];
        if (Array.isArray(playlist)) {
            urls = playlist;
        } else {
            urls = [playlist];
        }

        if (urls.length === 0) return;

        const state = {
            playlist: urls,
            queueIndex: 0,
            status: 'PLAYING',
            currentTime: 0,
            lastUpdate: Date.now(),
            interval: null,
            lastJump: 0
        };

        state.interval = setInterval(() => {
            if (state.status === 'PLAYING') {
                const now = Date.now();
                const delta = (now - state.lastUpdate) / 1000;
                state.currentTime += delta;
                state.lastUpdate = now;
            }

            const url = state.playlist[state.queueIndex];
            const payload = {
                action: state.status === 'PLAYING' ? 'sync' : 'pause',
                time: state.currentTime,
                url: url
            };
            
            this.broadcastToRoom(roomId, 'server', { type: EVENTS.FILE_SYNC, payload });
        }, 2000);

        this.fileRooms.set(roomId, state);
    }

    fileQueue(roomId, url) {
        if (!url) return;
        
        const state = this.fileRooms.get(roomId);
        if (state) {
            state.playlist.push(url);
        } else {
            this.fileParty(roomId, [url]);
        }
    }

    filePlay(roomId) {
        const state = this.fileRooms.get(roomId);
        if (!state || state.status === 'PLAYING') return;
        state.status = 'PLAYING';
        state.lastUpdate = Date.now();
        this.broadcastToRoom(roomId, 'server', { 
            type: EVENTS.FILE_SYNC, 
            payload: { action: 'play', time: state.currentTime, url: state.playlist[state.queueIndex] } 
        });
    }

    filePause(roomId) {
        const state = this.fileRooms.get(roomId);
        if (!state || state.status === 'PAUSED') return;
        state.currentTime += (Date.now() - state.lastUpdate) / 1000;
        state.status = 'PAUSED';
        this.broadcastToRoom(roomId, 'server', { 
            type: EVENTS.FILE_SYNC, 
            payload: { action: 'pause', time: state.currentTime, url: state.playlist[state.queueIndex] } 
        });
    }

    fileSeek(roomId, time) {
        const state = this.fileRooms.get(roomId);
        if (!state) return;
        state.currentTime = time;
        state.lastUpdate = Date.now();
        this.broadcastToRoom(roomId, 'server', { 
            type: EVENTS.FILE_SYNC, 
            payload: { action: 'seek', time: state.currentTime, url: state.playlist[state.queueIndex] } 
        });
    }

    fileNext(roomId) {
        const state = this.fileRooms.get(roomId);
        if (!state) return;
        
        const now = Date.now();
        if (now - state.lastJump < 3000) return;
        state.lastJump = now;

        if (state.queueIndex < state.playlist.length - 1) {
            state.queueIndex++;
            state.currentTime = 0;
            state.lastUpdate = Date.now();
            this.broadcastToRoom(roomId, 'server', { 
                type: EVENTS.FILE_SYNC, 
                payload: { action: 'sync', time: state.currentTime, url: state.playlist[state.queueIndex] } 
            });
        }
    }

    stopFileParty(roomId) {
        const state = this.fileRooms.get(roomId);
        if (state) {
            if (state.interval) clearInterval(state.interval);
            this.broadcastToRoom(roomId, 'server', { 
                type: EVENTS.FILE_SYNC, 
                payload: { action: 'pause', time: state.currentTime, url: state.playlist[state.queueIndex] } 
            });
            this.fileRooms.delete(roomId);
        }
    }

    // =================================================================

    // ==================== HTTP (Streaming de Vídeo) ====================

    handleHttpRequest(req, res) {
        // CORS headers para permitir acesso do navegador
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        if (!this.videosPath) {
            res.writeHead(404);
            res.end('Video serving not configured. Call server.videos(path) first.');
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        // Rota de listagem: GET /videos
        if (pathname === this.videosRoute && req.method === 'GET') {
            return this.handleListVideos(req, res);
        }

        // Rota de arquivo: GET /videos/nome-do-arquivo.mp4
        if (pathname.startsWith(this.videosRoute + '/') && req.method === 'GET') {
            const fileName = decodeURIComponent(pathname.slice(this.videosRoute.length + 1));
            return this.handleStreamVideo(req, res, fileName);
        }

        // Rota de upload: POST /videos
        if (pathname === this.videosRoute && req.method === 'POST') {
            return this.handleUploadVideo(req, res);
        }

        res.writeHead(404);
        res.end('Not found');
    }

    handleListVideos(req, res) {
        try {
            const files = fs.readdirSync(this.videosPath);
            const videos = files
                .filter(file => {
                    const ext = path.extname(file).toLowerCase();
                    return MIME_TYPES[ext] !== undefined;
                })
                .map(file => {
                    const filePath = path.join(this.videosPath, file);
                    const stats = fs.statSync(filePath);
                    return {
                        nome: file,
                        tamanho: stats.size,
                        url: `${this.videosRoute}/${encodeURIComponent(file)}`
                    };
                });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(videos));
        } catch (error) {
            res.writeHead(500);
            res.end('Erro ao listar vídeos: ' + error.message);
        }
    }

    handleStreamVideo(req, res, fileName) {
        // Previne path traversal
        const safeName = path.basename(fileName);
        const filePath = path.join(this.videosPath, safeName);

        if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end('Vídeo não encontrado: ' + safeName);
            return;
        }

        const ext = path.extname(safeName).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;

        const range = req.headers.range;

        if (range) {
            // HTTP Range Request (permite seeking no player)
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;

            const stream = fs.createReadStream(filePath, { start, end });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType,
            });

            stream.pipe(res);
        } else {
            // Requisição normal (sem Range)
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
            });

            fs.createReadStream(filePath).pipe(res);
        }
    }
    handleUploadVideo(req, res) {
        const contentType = req.headers['content-type'] || '';

        // Suporta multipart/form-data (formulários com arquivo)
        if (contentType.includes('multipart/form-data')) {
            const boundary = contentType.split('boundary=')[1];
            if (!boundary) {
                res.writeHead(400);
                res.end(JSON.stringify({ erro: 'Boundary não encontrado no Content-Type.' }));
                return;
            }

            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const boundaryBuffer = Buffer.from('--' + boundary);

                // Encontra as partes do multipart
                let start = buffer.indexOf(boundaryBuffer) + boundaryBuffer.length;
                let end = buffer.indexOf(boundaryBuffer, start + 1);

                if (start === -1 || end === -1) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ erro: 'Formato multipart inválido.' }));
                    return;
                }

                const part = buffer.slice(start, end);

                // Extrai o nome do arquivo do header Content-Disposition
                const headerEnd = part.indexOf('\r\n\r\n');
                const headers = part.slice(0, headerEnd).toString();
                const fileData = part.slice(headerEnd + 4, part.length - 2); // Remove trailing \r\n

                const fileNameMatch = headers.match(/filename="(.+?)"/);
                if (!fileNameMatch) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ erro: 'Nome do arquivo não encontrado.' }));
                    return;
                }

                const fileName = path.basename(fileNameMatch[1]); // Previne path traversal
                const ext = path.extname(fileName).toLowerCase();

                if (!MIME_TYPES[ext]) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ erro: `Formato não suportado: ${ext}. Use: ${Object.keys(MIME_TYPES).join(', ')}` }));
                    return;
                }

                const destPath = path.join(this.videosPath, fileName);
                fs.writeFileSync(destPath, fileData);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    sucesso: true,
                    nome: fileName,
                    tamanho: fileData.length,
                    url: `${this.videosRoute}/${encodeURIComponent(fileName)}`
                }));
            });

            req.on('error', (err) => {
                res.writeHead(500);
                res.end(JSON.stringify({ erro: 'Erro no upload: ' + err.message }));
            });
            return;
        }

        res.writeHead(400);
        res.end(JSON.stringify({ erro: 'Use multipart/form-data para enviar arquivos.' }));
    }

    // ==================== WebSocket (Signaling) ====================

    handleMessage(ws, message) {
        try {
            const data = JSON.parse(message);
            const { type, payload } = data;

            switch (type) {
                case EVENTS.ROOM_JOIN:
                    this.joinRoom(ws, payload.roomId);
                    break;
                case EVENTS.LIVE_START:
                    this.startLive(ws, payload.liveId);
                    break;
                case EVENTS.LIVE_JOIN:
                    this.joinLive(ws, payload.liveId);
                    break;
                case EVENTS.SIGNAL_OFFER:
                case EVENTS.SIGNAL_ANSWER:
                case EVENTS.SIGNAL_ICE_CANDIDATE:
                    this.forwardSignal(ws, type, payload);
                    break;
                case EVENTS.YOUTUBE_SYNC:
                    if (payload && payload.action === 'ended') {
                        this.youtubeNext(ws.roomId);
                    } else {
                        this.broadcastToRoom(ws.roomId, ws.userId, { type, payload });
                    }
                    break;
                case EVENTS.FILE_SYNC:
                    if (payload && payload.action === 'ended') {
                        this.fileNext(ws.roomId);
                    } else {
                        this.broadcastToRoom(ws.roomId, ws.userId, { type, payload });
                    }
                    break;
                case EVENTS.LIVE_POSTER:
                    this.broadcastToRoom(ws.roomId, ws.userId, { type, payload });
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

        this.broadcastToRoom(roomId, ws.userId, {
            type: EVENTS.USER_JOINED,
            payload: { userId: ws.userId }
        });

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

    startLive(ws, liveId) {
        if (!this.rooms.has(liveId)) {
            this.rooms.set(liveId, new Map());
        }
        
        const room = this.rooms.get(liveId);
        room.set(ws.userId, ws);
        ws.roomId = liveId;
        ws.roomType = 'live';
        ws.liveRole = 'streamer';

        ws.send(JSON.stringify({ 
            type: EVENTS.LIVE_STARTED, 
            payload: { liveId, streamerId: ws.userId } 
        }));
    }

    joinLive(ws, liveId) {
        if (!this.rooms.has(liveId)) {
            this.rooms.set(liveId, new Map());
        }
        
        const room = this.rooms.get(liveId);
        room.set(ws.userId, ws);
        ws.roomId = liveId;
        ws.roomType = 'live';
        ws.liveRole = 'viewer';

        ws.send(JSON.stringify({ 
            type: EVENTS.LIVE_JOINED, 
            payload: { liveId, viewerId: ws.userId } 
        }));

        // Avisa o streamer que um viewer entrou
        for (const client of room.values()) {
            if (client.liveRole === 'streamer' && client.readyState === 1) {
                client.send(JSON.stringify({
                    type: EVENTS.LIVE_VIEWER_JOINED,
                    payload: { viewerId: ws.userId }
                }));
            }
        }
    }

    forwardSignal(ws, type, payload) {
        const roomId = ws.roomId;
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (!room) return;

        const targetWs = room.get(payload.targetUserId);
        if (targetWs && targetWs.readyState === 1) {
            targetWs.send(JSON.stringify({
                type,
                payload: {
                    ...payload,
                    senderUserId: ws.userId
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
                if (ws.roomType === 'live') {
                    if (ws.liveRole === 'streamer') {
                        // Streamer caiu, avisa todos e mata a sala
                        this.broadcastToRoom(roomId, ws.userId, { type: EVENTS.LIVE_ENDED });
                        this.rooms.delete(roomId);
                    } else if (ws.liveRole === 'viewer') {
                        // Viewer caiu, avisa o streamer
                        for (const client of room.values()) {
                            if (client.liveRole === 'streamer' && client.readyState === 1) {
                                client.send(JSON.stringify({
                                    type: EVENTS.LIVE_VIEWER_LEFT,
                                    payload: { viewerId: ws.userId }
                                }));
                            }
                        }
                    }
                } else {
                    this.broadcastToRoom(roomId, ws.userId, {
                        type: EVENTS.USER_LEFT,
                        payload: { userId: ws.userId }
                    });
                }
            }
        }
    }
}
