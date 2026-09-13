import { VideoServer } from '../server/index.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple HTTP server to serve the example files
const server = http.createServer((req, res) => {
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

// Start HTTP server for serving HTML
server.listen(8080, () => {
    console.log('Example HTTP server running at http://localhost:8080');
});

// Start the signaling VideoServer
const videoServer = new VideoServer();
videoServer.start(3000);
