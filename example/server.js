import { VideoServer } from '../server/index.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pasta de vídeos de exemplo (crie e coloque arquivos .mp4 aqui)
const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir, { recursive: true });
    console.log(`Pasta de vídeos criada em: ${videosDir}`);
    console.log('Coloque arquivos .mp4, .webm, etc. dentro dela para testar.');
}

// Simple HTTP server to serve the example files (HTML, JS)
const exampleServer = http.createServer((req, res) => {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    if (req.url.startsWith('/client') || req.url.startsWith('/shared')) {
         filePath = path.join(__dirname, '..', req.url);
    }
    
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    switch (extname) {
        case '.js':
            contentType = 'text/javascript';
            break;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end(`File not found: ${filePath}`);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// Start HTTP server for serving HTML examples
exampleServer.listen(8080, () => {
    console.log('Example HTTP server running at http://localhost:8080');
});

// Start the VideoServer (signaling + video streaming)
const videoServer = new VideoServer();
videoServer.videos(videosDir); // Serve vídeos da pasta example/videos/
videoServer.start(3000);
