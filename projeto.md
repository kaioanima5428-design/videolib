Quero que você desenvolva uma biblioteca JavaScript para Node.js + navegador cujo objetivo principal seja **abstrair completamente a complexidade de transmissão de áudio e vídeo em tempo real**.

A ideia é criar uma biblioteca que permita a um desenvolvedor implementar:

- chamadas de vídeo 1×1;
- chamadas com várias pessoas;
- salas de vídeo;
- transmissões ao vivo;
- espectadores entrando e saindo;
- câmera;
- microfone;
- compartilhamento de tela;
- mute/unmute;
- encerramento de conexão;
- reconexão automática;
- eventos de conexão;
- gerenciamento de participantes;

sem que o desenvolvedor precise conhecer WebRTC, SDP, ICE, signaling, STUN, TURN ou outros detalhes internos.

## Objetivo principal

A biblioteca deve proporcionar uma experiência semelhante à simplicidade de bibliotecas Node.js como Express.

O desenvolvedor deve conseguir fazer algo conceitualmente próximo de:

```js
import { Video } from "video-lib";

const sala = await Video.sala("minha-sala");

await sala.entrar();

sala.camera(videoElement);
sala.microfone();
```

Para uma chamada:

```js
const chamada = await Video.chamada("minha-sala");

await chamada.entrar();

chamada.camera(videoElement);
chamada.microfone();
```

Para uma live:

```js
const live = await Video.live("minha-live");

await live.iniciar();
```

E para o espectador:

```js
const live = await Video.assistir("minha-live");

live.video(videoElement);
```

Esses exemplos são apenas uma direção. Projete uma API consistente, simples e realmente utilizável.

---

# 1. Tecnologias

A implementação deve ser baseada principalmente em:

- JavaScript moderno;
- Node.js;
- WebRTC no navegador;
- WebSocket ou tecnologia equivalente para signaling;
- APIs nativas do navegador para câmera, microfone e tela.

Use ESM:

```js
import ...
export ...
```

Não utilize CommonJS com `require()`.

Não utilize TypeScript na primeira versão.

A biblioteca deve funcionar tanto no navegador quanto no backend Node.js, separando claramente as partes que pertencem a cada ambiente.

---

# 2. Abstração do WebRTC

Esta é uma das partes MAIS IMPORTANTES.

O usuário da biblioteca não deve precisar escrever diretamente:

```js
new RTCPeerConnection()
```

nem:

```js
createOffer()
createAnswer()
setLocalDescription()
setRemoteDescription()
addIceCandidate()
```

nem precisar entender SDP, ICE candidates ou signaling.

Toda essa complexidade deve ficar internamente na biblioteca.

O desenvolvedor deve trabalhar com conceitos simples:

```js
Video.sala()
Video.chamada()
Video.live()
Video.assistir()
```

e métodos como:

```js
entrar()
sair()
iniciar()
parar()
camera()
microfone()
tela()
mute()
desmutar()
```

---

# 3. Signaling

Implemente internamente um sistema de signaling.

O signaling deve ser responsável por coordenar:

- entrada na sala;
- saída;
- identificação dos participantes;
- offers;
- answers;
- ICE candidates;
- reconexões;
- eventos de conexão.

O usuário não deve precisar implementar WebSocket manualmente para usar a biblioteca.

O backend da biblioteca deve fornecer essa infraestrutura.

---

# 4. Salas

Crie um sistema interno de salas.

Exemplo:

```js
const sala = await Video.sala("abc");
```

A sala deve conseguir controlar:

- participantes;
- conexões;
- estado;
- entrada;
- saída;
- eventos.

Exemplo:

```js
sala.on("entrar", usuario => {
    console.log("Usuário entrou:", usuario.id);
});

sala.on("sair", usuario => {
    console.log("Usuário saiu:", usuario.id);
});
```

---

# 5. Participantes

Cada participante deve possuir uma identificação.

A API deve permitir descobrir:

```js
sala.participantes()
```

ou uma abordagem equivalente.

Também deve existir um evento para quando um novo participante disponibilizar áudio ou vídeo.

Exemplo conceitual:

```js
sala.on("video", ({ usuario, stream }) => {
    video.srcObject = stream;
});
```

---

# 6. Câmera

Forneça uma API extremamente simples.

Exemplo:

```js
await sala.camera(videoElement);
```

A biblioteca deve:

- solicitar permissão;
- acessar a câmera;
- iniciar a track;
- publicar a track;
- conectar a track aos participantes;
- lidar com erros de permissão.

Também deve permitir:

```js
await sala.camera();
```

quando o desenvolvedor quiser apenas transmitir a câmera sem anexá-la automaticamente a um elemento.

---

# 7. Microfone

Permitir:

```js
await sala.microfone();
```

e:

```js
sala.mute();
sala.desmutar();
```

Também permita:

```js
sala.microfone(false);
```

para desligar o microfone.

---

# 8. Compartilhamento de tela

Criar:

```js
await sala.tela(videoElement);
```

ou API equivalente.

Internamente utilize a API adequada do navegador para captura de tela.

Quando o usuário parar o compartilhamento, a biblioteca deve detectar isso automaticamente.

---

# 9. Chamada de vídeo

Criar uma abstração específica para chamadas.

Exemplo:

```js
const chamada = await Video.chamada("sala-123");

await chamada.entrar();

await chamada.camera(video);
await chamada.microfone();
```

Deve funcionar para:

- 1×1;
- pequenos grupos;
- salas com múltiplos participantes.

A biblioteca deve gerenciar automaticamente as conexões entre participantes.

---

# 10. Live

A biblioteca também deve possuir uma abstração para transmissões ao vivo.

Exemplo:

```js
const live = await Video.live("evento-123");

await live.iniciar();
```

E o espectador:

```js
const live = await Video.assistir("evento-123");

live.video(videoElement);
```

O sistema deve diferenciar claramente:

```text
CALL
ROOM
LIVE
VIEWER
```

Não misture todos os conceitos em uma única classe gigante.

---

# 11. Arquitetura de Live

Não implemente uma arquitetura ingênua onde o streamer precisa enviar uma conexão WebRTC independente para cada espectador.

Projete a biblioteca pensando em uma arquitetura escalável.

Para transmissões com muitos espectadores, considere uma arquitetura baseada em SFU ou outro servidor de mídia apropriado.

A biblioteca deve abstrair essa infraestrutura do desenvolvedor.

O usuário final deve enxergar:

```js
const live = await Video.live("abc");

await live.iniciar();
```

e não precisar saber se internamente existe:

- SFU;
- signaling server;
- TURN;
- múltiplas conexões;
- roteamento de mídia.

A arquitetura interna deve permitir trocar a implementação do servidor de mídia futuramente sem quebrar a API pública.

---

# 12. Banco de dados

A primeira versão NÃO deve exigir banco de dados.

As salas e conexões podem existir em memória.

Não introduza banco de dados apenas para armazenar participantes temporários.

Porém, projete a arquitetura de forma que futuramente seja possível adicionar persistência para:

- usuários;
- histórico de lives;
- gravações;
- permissões;
- estatísticas;
- configurações;
- tokens.

Crie interfaces internas que permitam adicionar persistência futuramente sem destruir a API pública.

---

# 13. Reconexão

A biblioteca deve tentar recuperar conexões automaticamente.

Exemplo:

```js
sala.on("reconectando", () => {});
sala.on("reconectado", () => {});
sala.on("erro", erro => {});
```

Não obrigue o desenvolvedor a reconstruir manualmente a conexão.

---

# 14. Eventos

Crie uma API consistente de eventos.

Por exemplo:

```js
sala.on("entrar", ...)
sala.on("sair", ...)
sala.on("video", ...)
sala.on("audio", ...)
sala.on("conectado", ...)
sala.on("desconectado", ...)
sala.on("reconectando", ...)
sala.on("reconectado", ...)
sala.on("erro", ...)
```

Os nomes podem ser ajustados se houver uma convenção melhor, mas mantenha consistência.

---

# 15. Tratamento de erros

Não deixe erros internos do WebRTC vazarem de forma incompreensível.

Em vez de:

```text
DOMException: Failed to execute setRemoteDescription...
```

quando possível, forneça erros contextualizados:

```text
Não foi possível conectar à sala.
```

mantendo a causa original disponível para debugging.

Exemplo:

```js
try {
    await sala.entrar();
} catch (erro) {
    console.error(erro);
}
```

---

# 16. Segurança

A arquitetura deve considerar:

- identificação de salas;
- tokens de acesso;
- autenticação;
- autorização;
- salas privadas;
- validação de origem;
- controle de quem pode transmitir;
- controle de quem pode assistir.

Não deixe a implementação inicial deliberadamente vulnerável.

Crie mecanismos que possam ser configurados pelo servidor.

---

# 17. API pública

A API deve ser pequena.

Evite expor dezenas de funções internas.

O objetivo é que um desenvolvedor consiga criar uma chamada funcional com pouquíssimas linhas.

Priorize algo próximo de:

```js
const sala = await Video.sala("abc");

await sala.entrar();
await sala.camera(video);
await sala.microfone();
```

E:

```js
const live = await Video.assistir("abc");

live.video(video);
```

---

# 18. Frontend e Backend

Separe claramente:

```text
video-lib/
├── client/
├── server/
├── shared/
├── package.json
└── README.md
```

A API de cliente deve funcionar no navegador.

A API de servidor deve funcionar no Node.js.

O consumidor não deve precisar instalar cinco bibliotecas diferentes para fazer uma chamada.

Idealmente:

```js
import { Video } from "video-lib";
```

no cliente e:

```js
import { VideoServer } from "video-lib";
```

no servidor.

---

# 19. Exemplo final desejado

Quero chegar a uma experiência semelhante a esta:

### Backend

```js
import { VideoServer } from "video-lib";

const video = new VideoServer();

video.start(3000);
```

### Streamer

```js
import { Video } from "video-lib";

const live = await Video.live("minha-live");

await live.iniciar();

await live.camera(video);
await live.microfone();
```

### Viewer

```js
import { Video } from "video-lib";

const live = await Video.assistir("minha-live");

await live.conectar();

live.video(video);
```

### Chamada

```js
const chamada = await Video.chamada("sala");

await chamada.entrar();

await chamada.camera(video);
await chamada.microfone();
```

Isso é apenas o objetivo de experiência. Se uma API diferente for tecnicamente melhor, faça a alteração, mas mantenha o princípio:

**pouquíssimas linhas, abstração máxima e nenhuma necessidade de conhecimento sobre WebRTC.**

---

# 20. Qualidade do projeto

Não faça apenas uma demonstração.

A implementação deve ser estruturada como uma biblioteca que possa futuramente ser publicada no npm.

Inclua:

- `package.json`;
- ESM;
- exports corretos;
- README;
- exemplos;
- documentação da API;
- tratamento de erros;
- arquitetura modular;
- testes básicos;
- exemplos de cliente e servidor;
- código limpo;
- comentários somente onde realmente forem necessários.

Não crie uma arquitetura exageradamente complexa.

Não transforme isso em dezenas de controllers, services e repositories sem necessidade.

Priorize simplicidade.

---

# 21. Desenvolvimento por etapas

Não tente implementar tudo de uma vez.

Faça nesta ordem:

### Fase 1

Chamada 1×1:

```text
Browser A
   ↕
WebRTC
   ↕
Browser B
```

com signaling funcionando.

### Fase 2

Salas com múltiplos participantes.

### Fase 3

Câmera, microfone, mute e compartilhamento de tela.

### Fase 4

Reconexão e tratamento de erros.

### Fase 5

Abstração de Live.

### Fase 6

Arquitetura SFU para transmissões com vários espectadores.

### Fase 7

Segurança, autenticação e tokens.

### Fase 8

Documentação e preparação para publicação no npm.

---

# Regra mais importante

**Não quero uma biblioteca que simplesmente exponha WebRTC com nomes diferentes.**

Quero uma biblioteca que realmente esconda WebRTC.

O desenvolvedor deve poder pensar:

> "Quero fazer uma chamada de vídeo."

e escrever:

```js
const chamada = await Video.chamada("sala");

await chamada.entrar();
```

sem precisar saber como WebRTC funciona.

A complexidade deve existir dentro da biblioteca, não na aplicação que utiliza a biblioteca.