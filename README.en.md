# Video Lib 🎥

*[🇺🇸 Read in English](README.en.md) | [🇧🇷 Leia em Português](README.md)*

Welcome to **Video Lib**! A modern JavaScript library for Node.js and browsers designed to **completely abstract the complexity of real-time audio and video transmission** using WebRTC.

You don't need to understand `RTCPeerConnection`, `SDP` (Session Description Protocol), `ICE Candidates`, `STUN/TURN` servers, or how to build a `Signaling` server. The library does all the heavy lifting behind the scenes, providing an elegant, asynchronous, and incredibly easy-to-use API.

---

## 🚀 Key Features

- **Simple 1x1 Calls:** Connect two people instantly with just a few lines of code.
- **Multiple Rooms (Mesh P2P):** Native support for multi-participant rooms, where the library manages all WebRTC sub-connections in a mesh topology.
- **Live Broadcasting:** Stream to multiple viewers without them sending video back (optimized one-way stream).
- **Smart Auto-Reconnect:** The library handles internet drops and instabilities using exponential backoff, reconnecting and re-joining rooms automatically.
- **Media Controls:** Mute/unmute microphone, toggle camera, and share screen — all with a single method.
- **Video Streaming (VOD):** Serve, watch, upload, and download video files with HTTP Range Requests (seek support).
- **Built-in Server:** The `VideoServer` class in the backend handles signaling (WebSocket) and video streaming (HTTP) on a single port.
- **Express Compatible:** If you already have a server running, just attach `VideoServer` to it — no port conflicts.

---

## 📦 How to Install

Make sure your Node.js project supports ES Modules (`"type": "module"` in `package.json`).

```bash
# Install the library and server
npm install @caiomultiversando/videolib
```

---

## 💻 Quick Start: Server (Backend)

The signaling server is the heart of the library. It coordinates the exchange of information between browsers so the P2P connection can be established. It can also serve video files for streaming and downloading.

### Option 1: Standalone Server

If you **do not** have an HTTP server running, `VideoServer` creates one for you:

```javascript
import { VideoServer } from '@caiomultiversando/videolib/server';

const server = new VideoServer();

// (Optional) Serve videos from a folder
server.videos('/path/to/videos/folder');

// Start the server on port 3000 (creates HTTP + WebSocket)
server.start(3000);
```

### Option 2: Attach to an existing Express Server

If you **already have** an Express server (or any `http.Server`) running, use `.attach()` (or `.anexar()`) to avoid port conflicts:

```javascript
import express from 'express';
import { VideoServer } from '@caiomultiversando/videolib/server';

const app = express();

app.get('/', (req, res) => res.send('My app!'));

const httpServer = app.listen(3000, () => {
    console.log('App running on port 3000');
});

// Attach VideoServer to the existing server
const video = new VideoServer();
video.attach(httpServer); // Everything runs on port 3000!
```

---

## 🌐 Quick Start: Client (Browser)

The frontend usage is designed to be intuitive. First, configure the server address:

```javascript
import { Video } from '@caiomultiversando/videolib';

Video.configure({ 
    signalingUrl: 'ws://localhost:3000',  // WebSocket for calls/rooms
    serverUrl: 'http://localhost:3000'    // HTTP for VOD
});
```

---

## 📞 Private Call (1x1)

Ideal for connecting just two people.

```html
<video id="myVideo" autoplay muted></video>
<video id="theirVideo" autoplay></video>

<script type="module">
    import { Video } from '@caiomultiversando/videolib';
    Video.configure({ signalingUrl: 'ws://localhost:3000' });

    const call = await Video.call("private-room-123");

    call.onVideo((stream) => {
        document.getElementById('theirVideo').srcObject = stream;
    });

    await call.video(document.getElementById('myVideo'));
    await call.audio();

    await call.join();
</script>
```

---

## 👥 Meeting Room (Multiple Participants)

For rooms where multiple people can join and leave at any time.

```html
<video id="myVideo" autoplay muted></video>
<div id="videoGrid"></div>

<script type="module">
    import { Video } from '@caiomultiversando/videolib';

    const room = await Video.room("team-meeting");

    await room.video(document.getElementById('myVideo'));
    await room.audio();

    room.on("video", ({ usuario, stream }) => {
        const videoEl = document.createElement('video');
        videoEl.id = `video-${usuario.id}`;
        videoEl.autoplay = true;
        videoEl.srcObject = stream;
        document.getElementById('videoGrid').appendChild(videoEl);
    });

    room.on("sair", (usuario) => {
        document.getElementById(`video-${usuario.id}`)?.remove();
    });

    await room.join();
</script>
```

---

## 📡 Live Broadcasting

For cases where one person streams and many watch (unidirectional flow).

### The Streamer

```javascript
const live = await Video.stream("my-live-123");

await live.video(document.getElementById('myVideo'));
await live.audio();

await live.start();
```

### The Viewer

```javascript
const live = await Video.watch("my-live-123");
    
live.video(document.getElementById('player'));
await live.connect();
```

---

## ⚡ Auto-Reconnect & Error Handling

The library uses **Exponential Backoff** to automatically reconnect if the internet drops.

```javascript
room.on("reconnecting", (info) => {
    console.log(`Connection lost. Retrying... ${info.attempt}/${info.maxAttempts}`);
});

room.on("reconnected", () => {
    console.log("✅ Connection restored!");
});
```

---

## 🎤 Media Controls

Manage media without dropping the connection:

```javascript
// Mute / Unmute
room.mute();
room.unmute();

// Pause / Resume camera (remote sees a black screen)
room.pauseVideo();
room.resumeVideo();

// Share Screen (Replaces camera track seamlessly)
await room.screen();
await room.stopScreen();
```

---

## 🎬 Video Streaming (VOD)

The library also handles physical video files.

```javascript
// Upload a file
await Video.upload(document.getElementById('inputFile').files[0]);

// Play a video with seeking support
await Video.play('http://localhost:3000/videos/class.mp4', document.getElementById('player'));

// Download a video
await Video.download('http://localhost:3000/videos/class.mp4', 'my-class.mp4');
```

---

## 📖 Complete API Reference

*The library fully supports both Portuguese and English method aliases (`.sala()` === `.room()`, `.entrar()` === `.join()`).*

| Method / Class | Description |
|---|---|
| `Video.configure(opts)` | Configures the WebSocket and Server URL. |
| `Video.call(id)` | Creates a 1x1 P2P Call. Returns `Promise<Call>`. |
| `Video.room(id)` | Creates a P2P Room (Mesh). Returns `Promise<Room>`. |
| `Video.stream(id)` | Creates a live broadcast (Streamer). Returns `Promise<Live>`. |
| `Video.watch(id)` | Accesses a broadcast (Viewer). Returns `Promise<Viewer>`. |
| `Video.play(url, el)` | Streams (VOD) a video to a `<video>` element. |
| `Video.download(url, name)` | Triggers a file download in the browser. |
| `Video.list(url?)` | Returns a JSON array of available videos on the server. |
| `Video.upload(file)` | Uploads a `File` object to the server. |

### Room / Call / Live Instances
- `await room.join()` / `.start()` (for Live)
- `await room.video(element)`
- `await room.audio(true/false)`
- `room.mute()`, `room.unmute()`
- `room.pauseVideo()`, `room.resumeVideo()`
- `await room.screen(element)`, `await room.stopScreen()`

### VideoServer (Backend)
- `server.videos(folderPath)`
- `server.start(port)`
- `server.attach(httpServer)`
