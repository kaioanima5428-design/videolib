# Video Lib 🎥

Bem-vindo à **Video Lib**! Uma biblioteca JavaScript moderna, desenvolvida para Node.js e navegadores, projetada para **abstrair completamente a complexidade de transmissão de áudio e vídeo em tempo real** utilizando a tecnologia WebRTC.

Você não precisa entender sobre `RTCPeerConnection`, `SDP` (Session Description Protocol), `ICE Candidates`, Servidores `STUN/TURN` ou como criar um servidor de `Signaling`. A biblioteca faz todo o trabalho pesado nos bastidores, fornecendo uma API elegante, assíncrona e incrivelmente fácil de usar.

---

## 🚀 Principais Recursos

- **Chamadas 1x1 Simples:** Conecte duas pessoas instantaneamente com poucas linhas de código.
- **Salas Múltiplas (Mesh P2P):** Suporte nativo para criar salas com vários participantes, onde a biblioteca gerencia todas as subconexões WebRTC em formato de malha (cada usuário se conecta com todos os outros).
- **Gerenciamento Automático de Mídia:** Funções rápidas para capturar a câmera e o microfone do dispositivo.
- **Servidor Embutido:** O pacote inclui não apenas o cliente de navegador, mas também a classe `VideoServer` pronta para rodar no backend (Node.js) e atuar como servidor de sinalização.

---

## 📦 Como Instalar

*(A biblioteca será publicada em breve. No momento, o código está disponível localmente neste repositório).*

Você só precisa importar os módulos no seu projeto. Certifique-se de que o seu projeto Node.js suporta ES Modules (`"type": "module"` no `package.json`).

---

## 💻 Guia Rápido: Subindo o Servidor (Backend)

O servidor de sinalização é o coração da biblioteca. Ele não trafega o vídeo (que é P2P direto entre os navegadores), mas é responsável por dizer para um navegador onde o outro está na internet.

Crie um arquivo `server.js`:

```javascript
// Importa a classe do servidor a partir dos exports da biblioteca
import { VideoServer } from 'video-lib/server';

// Instancia o servidor
const server = new VideoServer();

// Inicia o servidor na porta 3000 (usando WebSockets)
server.start(3000);

console.log("Servidor rodando em ws://localhost:3000");
```

Rode com: `node server.js`

---

## 🌐 Guia Rápido: Cliente (Navegador)

O uso no frontend foi desenhado para ser intuitivo. Antes de começar a chamar ou criar salas, você precisa garantir que está apontando para o servidor que criamos acima.

No seu arquivo HTML ou arquivo JS do frontend:

```javascript
import { Video } from 'video-lib/client';

// Configura o endereço do servidor de sinalização
Video.configure({ signalingUrl: 'ws://localhost:3000' });
```

### Exemplo 1: Chamada Privada (1x1)

Ideal para conectar apenas duas pessoas. 

```html
<video id="meuVideo" autoplay muted></video>
<video id="videoDele" autoplay></video>

<script type="module">
    import { Video } from 'video-lib/client';
    Video.configure({ signalingUrl: 'ws://localhost:3000' });

    // 1. Cria a abstração da chamada conectando a uma sala específica
    const chamada = await Video.chamada("sala-privada-123");

    // 2. Define o que fazer quando o vídeo da outra pessoa chegar
    chamada.onVideo((stream) => {
        document.getElementById('videoDele').srcObject = stream;
    });

    // 3. Captura sua câmera e anexa ao seu elemento de vídeo local
    await chamada.camera(document.getElementById('meuVideo'));
    await chamada.microfone(); // Libera o áudio

    // 4. Entra na chamada (inicia a negociação WebRTC)
    await chamada.entrar();
</script>
```

### Exemplo 2: Sala de Reunião (Múltiplos Participantes)

Para salas onde várias pessoas podem entrar e sair a qualquer momento, use `Video.sala()`. A biblioteca gerenciará todas as conexões simultâneas dinamicamente.

```html
<div id="gridDeVideos">
    <!-- Os vídeos de quem entrar vão aparecer aqui -->
</div>

<script type="module">
    import { Video } from 'video-lib/client';
    Video.configure({ signalingUrl: 'ws://localhost:3000' });

    // 1. Cria a abstração da sala
    const sala = await Video.sala("minha-reuniao-equipe");

    // 2. Prepara a própria câmera ANTES de entrar (recomendado)
    // Se você quiser apenas enviar sem mostrar na sua tela, pode chamar sem argumentos:
    await sala.camera(); 
    await sala.microfone();

    // 3. Escuta eventos da sala
    sala.on("entrar", (usuario) => {
        console.log(`O usuário ${usuario.id} acabou de conectar!`);
    });

    sala.on("sair", (usuario) => {
        console.log(`O usuário ${usuario.id} saiu.`);
        // Remove o elemento de vídeo dele da tela
        const videoAntigo = document.getElementById(`video-${usuario.id}`);
        if (videoAntigo) videoAntigo.remove();
    });

    // Quando o fluxo de vídeo/áudio de alguém estiver pronto, este evento é disparado
    sala.on("video", ({ usuario, stream }) => {
        // Verifica se já criamos o vídeo para essa pessoa (pois o evento pode disparar mais de uma vez)
        let videoEl = document.getElementById(`video-${usuario.id}`);
        
        if (!videoEl) {
            videoEl = document.createElement('video');
            videoEl.id = `video-${usuario.id}`;
            videoEl.autoplay = true;
            document.getElementById('gridDeVideos').appendChild(videoEl);
        }
        
        // Atualiza a fonte de mídia
        videoEl.srcObject = stream;
    });

    // 4. Conecta à sala
    await sala.entrar();
</script>
```

---

## 📖 Referência Completa da API (Cliente)

### `Video`
A classe estática principal que você importa no cliente.

- `Video.configure(options)`: Configurações globais. Ex: `{ signalingUrl: 'ws://...' }`.
- `Video.chamada(roomId)`: Retorna uma `Promise<Call>`.
- `Video.sala(roomId)`: Retorna uma `Promise<Room>`.

### Instância de `Call` (Chamadas 1x1)
- `await call.camera(htmlVideoElement?)`: Solicita a câmera do usuário. Pode opcionalmente receber um elemento `<video>` HTML para exibir a própria câmera.
- `await call.microfone()`: Solicita acesso ao microfone.
- `call.onVideo(callback)`: Define a função que será executada recebendo o `MediaStream` remoto quando a outra pessoa estiver conectada.
- `await call.entrar()`: Inicia a conexão de sinalização e WebRTC.

### Instância de `Room` (Salas Múltiplas)
- `await room.camera(htmlVideoElement?)`: Solicita a câmera do usuário.
- `await room.microfone()`: Solicita acesso ao microfone.
- `room.on(evento, callback)`: Assina eventos da sala.
  - Evento `"entrar"`: `({ id: 'uuid-do-usuario' })`
  - Evento `"sair"`: `({ id: 'uuid-do-usuario' })`
  - Evento `"video"`: `({ usuario: { id: '...' }, stream: MediaStream })`
- `await room.entrar()`: Inicia a conexão à malha P2P.

---

## ⚠️ Dicas e Boas Práticas

1. **Ordem de Execução:** Sempre prefira capturar a mídia (chamando `.camera()` e `.microfone()`) **ANTES** de chamar `.entrar()`. Isso evita problemas de "Condição de Corrida" (Race Conditions) do WebRTC.
2. **Mute Local:** Se for usar a `.camera(videoEl)` para mostrar a si mesmo, certifique-se de que o elemento `<video>` local tenha a propriedade `muted = true` (ou `<video muted>`). Caso contrário, você ouvirá o próprio eco da sua voz.
3. **Autoplay:** Navegadores modernos têm regras estritas contra "autoplay" de vídeos com áudio. Normalmente, é necessário que o usuário clique em algum lugar da tela (ex: um botão de "Entrar na Sala") antes de você injetar o vídeo na tela.

---

## 🏗️ Fases de Desenvolvimento do Projeto

Este projeto está seguindo um roadmap rigoroso focado na abstração:

- [x] **Fase 1:** Chamada 1x1 (Concluída)
- [x] **Fase 2:** Salas com múltiplos participantes - Mesh P2P (Concluída)
- [ ] **Fase 3:** Câmera, microfone, mute/desmutar avançado e compartilhamento de tela
- [ ] **Fase 4:** Reconexão e tratamento de erros
- [ ] **Fase 5:** Abstração de transmissões ao vivo (Live)
- [ ] **Fase 6:** Arquitetura SFU (escalabilidade massiva)
- [ ] **Fase 7:** Segurança, tokens e autenticação
- [ ] **Fase 8:** Documentação técnica e publicação NPM
