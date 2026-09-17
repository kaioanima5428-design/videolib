import { Call } from './Call.js';
import { Room } from './Room.js';
import { Live } from './Live.js';
import { Viewer } from './Viewer.js';

export class Video {
    static _signalingUrl = 'ws://localhost:3000';
    static _serverUrl = 'http://localhost:3000';

    static configure(options) {
        if (options.signalingUrl) Video._signalingUrl = options.signalingUrl;
        if (options.serverUrl) Video._serverUrl = options.serverUrl;
    }

    static async chamada(roomId) {
        return new Call(roomId, Video._signalingUrl);
    }

    static async sala(roomId) {
        return new Room(roomId, Video._signalingUrl);
    }

    static async live(liveId) {
        return new Live(liveId, Video._signalingUrl);
    }

    static async assistir(liveId) {
        return new Viewer(liveId, Video._signalingUrl);
    }

    // ==================== STREAMING DE VÍDEO (VOD) ====================

    static async reproduzir(url, videoElement) {
        if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
            throw new Error('É necessário passar um elemento <video> HTML válido.');
        }

        const check = await fetch(url, { method: 'HEAD' });
        if (!check.ok) {
            throw new Error(`Vídeo não encontrado: ${url}`);
        }

        videoElement.src = url;
        videoElement.load();

        videoElement.onerror = () => {
            throw new Error(`Não foi possível reproduzir o vídeo: ${url}`);
        };

        return videoElement.play().catch(() => {
            console.warn('Autoplay bloqueado. O usuário precisa interagir com a página para reproduzir.');
        });
    }

    static async baixar(url, nomeArquivo) {
        const check = await fetch(url, { method: 'HEAD' });
        if (!check.ok) {
            throw new Error(`Vídeo não encontrado para download: ${url}`);
        }

        const nome = nomeArquivo || url.split('/').pop() || 'video.mp4';
        const link = document.createElement('a');
        link.href = url;
        link.download = decodeURIComponent(nome);
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    static async listar(url) {
        const endpoint = url || Video._serverUrl + '/videos';
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error('Não foi possível listar os vídeos: ' + response.statusText);
        }
        return response.json();
    }

    static async enviar(arquivo, url) {
        const endpoint = url || Video._serverUrl + '/videos';
        const formData = new FormData();
        formData.append('video', arquivo);

        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const erro = await response.json().catch(() => ({ erro: response.statusText }));
            throw new Error('Falha no upload: ' + (erro.erro || response.statusText));
        }

        return response.json();
    }
}
