# Video Lib 🎥

Bem-vindo à **Video Lib**! Uma biblioteca JavaScript moderna, desenvolvida para Node.js e navegadores, projetada para **abstrair completamente a complexidade de transmissão de áudio e vídeo em tempo real** utilizando a tecnologia WebRTC.

Você não precisa entender sobre `RTCPeerConnection`, `SDP` (Session Description Protocol), `ICE Candidates`, Servidores `STUN/TURN` ou como criar um servidor de `Signaling`. A biblioteca faz todo o trabalho pesado nos bastidores, fornecendo uma API elegante, assíncrona e incrivelmente fácil de usar.

---

## 🚀 Principais Recursos

- **Chamadas 1x1 Simples:** Conecte duas pessoas instantaneamente com poucas linhas de código.
- **Salas Múltiplas (Mesh P2P):** Suporte nativo para criar salas com vários participantes, onde a biblioteca gerencia todas as subconexões WebRTC em formato de malha.
- **Transmissões ao Vivo (Live):** Faça streaming para múltiplos espectadores sem que eles precisem enviar vídeo de volta (fluxo unidirecional otimizado).
- **Auto-Reconexão Inteligente:** A biblioteca lida com quedas de internet e instabilidades usando backoff exponencial, reconectando e re-entrando nas salas sozinha.
- **Controles de Mídia:** Mutar/desmutar microfone, ligar/desligar câmera e compartilhar tela — tudo em uma linha.
- **Streaming de Vídeo (VOD):** Sirva, assista, faça upload e baixe arquivos de vídeo com HTTP Range Requests (seeking funcional).
- **Servidor Embutido:** A classe `VideoServer` no backend cuida de signaling (WebSocket) e streaming de vídeo (HTTP) numa porta só.
- **Compatível com Express:** Se você já tem um servidor rodando, basta anexar o `VideoServer` nele — sem conflito de portas.

---

## 📦 Como Instalar

*(A biblioteca será publicada em breve no NPM. No momento, o código está disponível localmente neste repositório).*

Certifique-se de que o seu projeto Node.js suporta ES Modules (`"type": "module"` no `package.json`).

```bash
# Única dependência
npm install ws
```

---

## 💻 Guia Rápido: Subindo o Servidor (Backend)

O servidor de sinalização é o coração da biblioteca. Ele coordena a troca de informações entre os navegadores para que a conexão P2P possa ser estabelecida. Além disso, ele também pode servir arquivos de vídeo para streaming e download.

### Opção 1: Servidor próprio (sem Express)

Se você **não tem** um servidor HTTP já rodando, o `VideoServer` cria um pra você:

```javascript
import { VideoServer } from 'video-lib/server';

const server = new VideoServer();

// (Opcional) Serve vídeos de uma pasta
server.videos('/caminho/para/pasta/de/videos');

// Inicia o servidor na porta 3000
// Isso cria um servidor HTTP + WebSocket automaticamente
server.start(3000);
```

### Opção 2: Anexar a um servidor Express já existente

Se você **já tem** um servidor Express (ou qualquer `http.Server`) rodando, use `.anexar()` para evitar conflito de portas. O `VideoServer` vai se acoplar ao seu servidor existente:

```javascript
import express from 'express';
import { VideoServer } from '@caiomultiversando/videolib/server';

const app = express();

// Suas rotas normais continuam funcionando
app.get('/', (req, res) => res.send('Meu app!'));
app.get('/api/users', (req, res) => res.json([{ nome: 'Caio' }]));

// Inicia SEU servidor normalmente
const httpServer = app.listen(3000, () => {
    console.log('Meu app rodando na porta 3000');
});

// Acopla o VideoServer ao servidor já existente
const video = new VideoServer();
video.videos('/caminho/para/pasta/de/videos');
video.anexar(httpServer); // Sem porta extra! Tudo na 3000.
```

**O que acontece internamente:** O `.anexar()` intercepta apenas as requisições que pertencem ao `VideoServer` (como `/videos` e o WebSocket de signaling). Todas as outras requisições (suas rotas do Express, APIs, etc.) continuam funcionando normalmente.

### Opção 3: Anexar a um `http.createServer` puro

```javascript
import http from 'http';
import { VideoServer } from 'video-lib/server';

const httpServer = http.createServer((req, res) => {
    // Seu handler HTTP normal
    res.end('OK');
});

httpServer.listen(3000);

const video = new VideoServer();
video.videos('./meus-videos');
video.anexar(httpServer);
```

---

## 🌐 Guia Rápido: Cliente (Navegador)

O uso no frontend foi desenhado para ser intuitivo. Antes de começar, configure o endereço do servidor:

```javascript
import { Video } from '@caiomultiversando/videolib';

// Configura o endereço do servidor
Video.configure({ 
    signalingUrl: 'ws://localhost:3000',  // WebSocket para chamadas/salas
    serverUrl: 'http://localhost:3000'    // HTTP para streaming de vídeo
});
```

> **Nota:** Se não chamar `Video.configure()`, os valores padrão apontam para `localhost:3000`.

---

## 📞 Chamada Privada (1x1)

Ideal para conectar apenas duas pessoas numa chamada de vídeo.

```html
<video id="meuVideo" autoplay muted></video>
<video id="videoDele" autoplay></video>

<script type="module">
    import { Video } from '@caiomultiversando/videolib';
    Video.configure({ signalingUrl: 'ws://localhost:3000' });

    // 1. Cria a abstração da chamada conectando a uma sala específica
    const chamada = await Video.chamada("sala-privada-123");

    // 2. Define o que fazer quando o vídeo da outra pessoa chegar
    chamada.onVideo((stream) => {
        document.getElementById('videoDele').srcObject = stream;
    });

    // 3. Captura sua câmera e anexa ao seu elemento de vídeo local
    await chamada.camera(document.getElementById('meuVideo'));
    await chamada.microfone();

    // 4. Entra na chamada (inicia a negociação WebRTC internamente)
    await chamada.entrar();
</script>
```

---

## 👥 Sala de Reunião (Múltiplos Participantes)

Para salas onde várias pessoas podem entrar e sair a qualquer momento. A biblioteca gerencia todas as conexões P2P automaticamente (Mesh P2P).

```html
<video id="meuVideo" autoplay muted></video>
<div id="gridDeVideos"></div>

<script type="module">
    import { Video } from 'videolib';

    // 1. Cria a abstração da sala
    const sala = await Video.sala("minha-reuniao-equipe");

    // 2. Prepara a própria câmera ANTES de entrar (recomendado)
    await sala.camera(document.getElementById('meuVideo'));
    await sala.microfone();

    // 3. Escuta eventos da sala
    sala.on("entrar", (usuario) => {
        console.log(`O usuário ${usuario.id} conectou!`);
    });

    sala.on("sair", (usuario) => {
        console.log(`O usuário ${usuario.id} saiu.`);
        const videoAntigo = document.getElementById(`video-${usuario.id}`);
        if (videoAntigo) videoAntigo.remove();
    });

    sala.on("video", ({ usuario, stream }) => {
        let videoEl = document.getElementById(`video-${usuario.id}`);
        if (!videoEl) {
            videoEl = document.createElement('video');
            videoEl.id = `video-${usuario.id}`;
            videoEl.autoplay = true;
            document.getElementById('gridDeVideos').appendChild(videoEl);
        }
        videoEl.srcObject = stream;
    });

    // 4. Conecta à sala
    await sala.entrar();
</script>
```

---

## 📡 Transmissões ao Vivo (Live Stream)

Para casos onde uma pessoa transmite (Streamer) e várias pessoas apenas assistem (Viewers), a biblioteca tem uma API dedicada. Diferente de uma sala de reunião, os Viewers **não enviam vídeo ou áudio** de volta, economizando banda.

### O Streamer (Quem transmite)

```html
<video id="meuVideo" autoplay muted></video>

<script type="module">
    import { Video } from 'videolib';

    const live = await Video.live("minha-live-123");

    // Prepara câmera e microfone
    await live.camera(document.getElementById('meuVideo'));
    await live.microfone();

    // Eventos opcionais para saber quem entra
    live.on("espectador:entrou", (user) => console.log('Novo viewer:', user.id));
    live.on("espectador:saiu", (user) => console.log('Viewer saiu:', user.id));

    // Começa a transmitir
    await live.iniciar();
</script>
```

### O Viewer (Quem assiste)

```html
<video id="player" autoplay></video>

<script type="module">
    import { Video } from 'videolib';

    const live = await Video.assistir("minha-live-123");
    
    // Diz em qual elemento o vídeo do streamer vai aparecer
    live.video(document.getElementById('player'));

    // Escuta se a live for encerrada
    live.on("encerrado", () => console.log("O streamer encerrou a transmissão."));

    // Conecta à transmissão
    await live.conectar();
</script>
```

---

## ⚡ Reconexão Automática e Tratamento de Erros

A biblioteca foi construída pensando no mundo real: **a internet cai, o Wi-Fi pisca e o usuário troca de rede (3G para Wi-Fi)**. 

Você não precisa recriar a sala manualmente se a conexão cair. A biblioteca tentará se reconectar sozinha ao servidor usando a estratégia de **Backoff Exponencial** (espera 1s, 2s, 4s, 8s...) e **re-entrará na sala ou live automaticamente**.

Tanto `Call`, `Room`, `Live` quanto `Viewer` disparam os seguintes eventos para que você possa atualizar sua interface de usuário:

```javascript
sala.on("reconectando", (info) => {
    // Mostre um aviso na tela: "Conexão perdida. Tentando reconectar..."
    console.log(`Tentativa ${info.attempt} de ${info.maxAttempts}`);
});

sala.on("reconectado", () => {
    // Esconda o aviso. A sala/live foi restaurada!
    console.log("✅ Conexão restabelecida!");
});

sala.on("erro", (info) => {
    // Ocorreu um erro crítico ou esgotaram as tentativas de reconexão
    console.error("❌ Erro:", info.message);
});
```

---

## 🎤 Controles de Mídia

Tanto a `Call` (chamada 1x1) quanto a `Room` (sala múltipla) possuem os seguintes controles para gerenciar a mídia do usuário **sem derrubar a conexão**:

### Microfone

```javascript
// Mutar (para de enviar áudio, mas a conexão continua ativa)
sala.mute();

// Desmutar (volta a enviar áudio)
sala.desmutar();

// Também funciona com parâmetro:
sala.microfone(false); // equivale a mute()
sala.microfone(true);  // equivale a desmutar()
```

### Câmera

```javascript
// Pausar câmera (a outra pessoa vê a imagem congelada/preta, mas o áudio continua)
sala.pausarCamera();

// Retomar câmera
sala.retomarCamera();
```

### Compartilhamento de Tela

```javascript
// Inicia o compartilhamento de tela
// A trilha da câmera é SUBSTITUÍDA pela tela em tempo real (sem renegociar a conexão!)
await sala.tela();

// Ou com um elemento de vídeo para preview local:
await sala.tela(document.getElementById('meuVideo'));

// Para de compartilhar e volta para a câmera
await sala.pararTela();
```

**Detecção automática:** Se o usuário clicar no botão nativo do navegador ("Parar compartilhamento"), a biblioteca detecta automaticamente e volta para a câmera original. Você pode escutar esse evento:

```javascript
sala.on('tela:parou', () => {
    console.log('O compartilhamento de tela foi encerrado.');
});
```

---

## 🎬 Streaming de Vídeo (VOD)

A biblioteca também inclui funcionalidades para **servir, reproduzir, fazer upload e baixar** arquivos de vídeo.

### Configuração no Servidor

```javascript
// Importa a classe do servidor a partir dos exports da biblioteca
import { VideoServer } from '@caiomultiversando/videolib/server';

const server = new VideoServer();

// Registra uma pasta de vídeos para servir via HTTP
// Suporta: .mp4, .webm, .mkv, .avi, .mov, .ogg, .m4v
server.videos('/caminho/para/pasta/de/videos');

server.start(3000);
```

Isso cria automaticamente duas rotas HTTP:
- `GET /videos` — Retorna a lista de vídeos em JSON.
- `GET /videos/:arquivo` — Faz streaming do vídeo com suporte a **HTTP Range Requests** (o player do navegador consegue pular/seekar no vídeo sem baixar tudo).
- `POST /videos` — Recebe upload de novos vídeos via `multipart/form-data`.

### Listar vídeos disponíveis

```javascript
const videos = await Video.listar();
// Retorna:
// [
//   { nome: 'aula-01.mp4', tamanho: 52428800, url: '/videos/aula-01.mp4' },
//   { nome: 'reuniao.webm', tamanho: 10485760, url: '/videos/reuniao.webm' }
// ]
```

Ou passando uma URL personalizada:

```javascript
const videos = await Video.listar('http://meu-servidor.com/videos');
```

### Reproduzir um vídeo

```javascript
const videoElement = document.getElementById('player');

// Reproduz o vídeo no elemento <video>
// O seeking (pular no vídeo) funciona graças ao HTTP Range Requests
await Video.reproduzir('http://localhost:3000/videos/aula-01.mp4', videoElement);
```

**Tratamento de erro:** Se o vídeo não existir no servidor, a biblioteca lança um erro claro:

```javascript
try {
    await Video.reproduzir('http://localhost:3000/videos/nao-existe.mp4', videoEl);
} catch (erro) {
    console.error(erro); // Error: "Vídeo não encontrado: http://..."
}
```

### Baixar um vídeo

```javascript
// Dispara o download no navegador
await Video.baixar('http://localhost:3000/videos/aula-01.mp4');

// Com nome personalizado para o arquivo salvo:
await Video.baixar('http://localhost:3000/videos/aula-01.mp4', 'minha-aula.mp4');
```

**Tratamento de erro:** Se o vídeo não existir:

```javascript
try {
    await Video.baixar('http://localhost:3000/videos/nao-existe.mp4');
} catch (erro) {
    console.error(erro); // Error: "Vídeo não encontrado para download: http://..."
}
```

### Fazer upload de um vídeo

```javascript
// 'arquivo' é um objeto File (vindo de um <input type="file"> por exemplo)
const inputFile = document.getElementById('inputArquivo');
const arquivo = inputFile.files[0];

const resultado = await Video.enviar(arquivo);
// Retorna:
// {
//   sucesso: true,
//   nome: 'meu-video.mp4',
//   tamanho: 52428800,
//   url: '/videos/meu-video.mp4'
// }
```

**Formatos aceitos:** `.mp4`, `.webm`, `.mkv`, `.avi`, `.mov`, `.ogg`, `.m4v`. Se o formato não for suportado, o servidor retorna um erro com a lista de formatos válidos.

**Tratamento de erro:**

```javascript
try {
    await Video.enviar(arquivo);
} catch (erro) {
    console.error(erro); // Error: "Falha no upload: Formato não suportado..."
}
```

---

## 📖 Referência Completa da API

### Classe `Video` (Cliente — Navegador)

A classe estática principal que você importa no cliente.

| Método | Descrição |
|---|---|
| `Video.configure(options)` | Configura a URL do servidor. Ex: `{ signalingUrl: 'ws://...', serverUrl: 'http://...' }` |
| `Video.chamada(roomId)` | Cria uma chamada 1x1. Retorna `Promise<Call>`. |
| `Video.sala(roomId)` | Cria uma sala múltipla. Retorna `Promise<Room>`. |
| `Video.live(liveId)` | Cria uma transmissão (Streamer). Retorna `Promise<Live>`. |
| `Video.assistir(liveId)` | Entra numa transmissão (Viewer). Retorna `Promise<Viewer>`. |
| `Video.reproduzir(url, videoEl)` | Reproduz um vídeo do servidor num elemento `<video>`. Verifica se existe antes. |
| `Video.baixar(url, nome?)` | Dispara o download de um vídeo. Verifica se existe antes. |
| `Video.listar(url?)` | Retorna um array JSON com os vídeos disponíveis no servidor. |
| `Video.enviar(arquivo, url?)` | Faz upload de um `File` para o servidor. Retorna `{ sucesso, nome, tamanho, url }`. |

### Instância de `Call` (Chamadas 1x1)

| Método | Descrição |
|---|---|
| `await call.camera(videoEl?)` | Solicita a câmera. Opcionalmente exibe no elemento passado. |
| `await call.microfone(habilitar?)` | Habilita ou desabilita o microfone. Padrão: `true`. |
| `call.mute()` | Desativa o microfone. |
| `call.desmutar()` | Reativa o microfone. |
| `call.pausarCamera()` | Desativa a trilha de vídeo (imagem congela). |
| `call.retomarCamera()` | Reativa a trilha de vídeo. |
| `await call.tela(videoEl?)` | Compartilha a tela, substituindo a câmera. |
| `await call.pararTela()` | Para o compartilhamento e restaura a câmera. |
| `call.onVideo(callback)` | Define o callback que recebe o `MediaStream` remoto. |
| `await call.entrar()` | Inicia a conexão de sinalização e WebRTC. |

### Instância de `Room` (Salas Múltiplas)

| Método | Descrição |
|---|---|
| `await room.camera(videoEl?)` | Solicita a câmera. Opcionalmente exibe no elemento passado. |
| `await room.microfone(habilitar?)` | Habilita ou desabilita o microfone. Padrão: `true`. |
| `room.mute()` | Desativa o microfone. |
| `room.desmutar()` | Reativa o microfone. |
| `room.pausarCamera()` | Desativa a trilha de vídeo. |
| `room.retomarCamera()` | Reativa a trilha de vídeo. |
| `await room.tela(videoEl?)` | Compartilha a tela, substituindo a câmera em todos os peers. |
| `await room.pararTela()` | Para o compartilhamento e restaura a câmera. |
| `room.on(evento, callback)` | Assina eventos da sala (veja abaixo). |
| `await room.entrar()` | Inicia a conexão à malha P2P. |

#### Eventos da `Room`

| Evento | Payload | Quando dispara |
|---|---|---|
| `"entrar"` | `{ id: 'uuid' }` | Um novo participante entrou na sala. |
| `"sair"` | `{ id: 'uuid' }` | Um participante saiu da sala. |
| `"video"` | `{ usuario: { id }, stream: MediaStream }` | O stream de vídeo/áudio de um participante está disponível. |
| `"tela:parou"` | — | O compartilhamento de tela local foi encerrado. |

### Classe `VideoServer` (Servidor — Node.js)

| Método | Descrição |
|---|---|
| `server.videos(pasta, rota?)` | Registra uma pasta para servir vídeos via HTTP. A rota padrão é `/videos`. |
| `server.start(porta)` | Cria um servidor HTTP+WebSocket próprio e inicia na porta informada. **Use quando não tem servidor próprio.** |
| `server.anexar(httpServer)` | Acopla o VideoServer a um servidor HTTP/Express já existente. **Use quando já tem um servidor rodando para evitar conflito de portas.** |

---

## ⚠️ Dicas e Boas Práticas

1. **Ordem de Execução:** Sempre prefira capturar a mídia (chamando `.camera()` e `.microfone()`) **ANTES** de chamar `.entrar()`. Isso evita "Condições de Corrida" (Race Conditions) do WebRTC.
2. **Mute Local:** Se for usar a `.camera(videoEl)` para mostrar a si mesmo, certifique-se de que o elemento `<video>` local tenha a propriedade `muted` (`<video muted>`). Caso contrário, você ouvirá o próprio eco da sua voz.
3. **Autoplay:** Navegadores modernos bloqueiam "autoplay" de vídeos com áudio. É necessário que o usuário clique em algum lugar da tela (ex: um botão de "Entrar na Sala") antes de você injetar o vídeo na tela.
4. **Conflito de Portas:** Se você já tem um servidor Express/HTTP rodando, **use `.anexar()`** em vez de `.start()`. Assim o VideoServer roda na mesma porta do seu app, sem criar um servidor extra.
5. **Tratamento de Erros:** Sempre use `try/catch` ao redor de funções assíncronas da biblioteca. As mensagens de erro são em português e contextualizadas (ex: "Vídeo não encontrado", "Não foi possível acessar a câmera").
6. **Formatos de Vídeo:** Para streaming/upload, use preferencialmente `.mp4` (H.264) ou `.webm` (VP8/VP9), que são os formatos com maior compatibilidade nos navegadores.

---

## 🏗️ Fases de Desenvolvimento do Projeto

- [x] **Fase 1:** Chamada 1x1
- [x] **Fase 2:** Salas com múltiplos participantes (Mesh P2P)
- [x] **Fase 3:** Controles avançados de mídia (mute, câmera, tela)
- [x] **Streaming VOD:** Servir, reproduzir, upload e download de vídeos
- [x] **Integração com Express:** Método `.anexar()` para servidores existentes
- [x] **Fase 4:** Reconexão automática e tratamento de erros
- [x] **Fase 5:** Abstração de transmissões ao vivo (Live e Viewer)
- [ ] **Fase 6:** Arquitetura SFU (escalabilidade massiva)
- [ ] **Fase 7:** Segurança, tokens e autenticação
- [x] **Fase 8:** Documentação técnica e publicação NPM
