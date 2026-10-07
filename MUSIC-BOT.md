# Bot de música (DJ)

Documentação da implementação e da ativação do bot que toca áudio de links (YouTube e
outros sites suportados pelo `yt-dlp`) nos canais de voz, controlado por comandos no
canal de texto — como se fosse um usuário falando na call.

- Código: [`src/lib/music-bot/`](./src/lib/music-bot)
- Integração com o chat: [messages/route.ts](<./src/app/api/servers/[serverId]/channels/[channelId]/messages/route.ts>)
- Configuração de exemplo: [`.env.example`](./.env.example)

---

## 1. Como funciona

```
/play <link>  (canal de texto)
      │
      ▼
POST /api/servers/:serverId/channels/:channelId/messages
      │  grava a mensagem normalmente
      ▼
maybeHandleMusicCommand()                     ← src/lib/music-bot/manager.ts
      │  1. descobre, via LiveKit, em qual canal de voz o autor está
      │  2. resolve o link no yt-dlp: uma faixa (vídeo) ou a playlist inteira
      │  3. entra na sala como participante e publica uma faixa de áudio
      │  4. toca as faixas da fila em sequência
      ▼
yt-dlp  ──stdout──▶  ffmpeg  ──stdout (PCM s16le 48 kHz estéreo)──▶  AudioSource
                                                                        │
                                                        LiveKit ◀── frames de 20 ms
                                                                        │
                                                     todos na call ouvem ◀┘
```

Cada canal de voz é uma sala LiveKit chamada `serverId:channelId` — o bot usa exatamente o
mesmo formato da rota [`livekit/token`](./src/app/api/livekit/token/route.ts), então aparece
na call como qualquer outro participante.

**Detalhes do desenho:**

- A faixa é publicada com `source = MICROPHONE`, que é o que a rota
  [voice-presence](<./src/app/api/servers/[serverId]/voice-presence/route.ts>) lê para
  mostrar 🎤 na lista de participantes.
- O áudio vai **direto do yt-dlp para o ffmpeg** (pipe), sem arquivo temporário em disco e
  sem esperar o download terminar antes de começar a tocar.
- A playlist é apenas **listada** no `yt-dlp` (`--flat-playlist`, sem baixar mídia): só a
  faixa que está tocando é que abre o fluxo de áudio.
- O bot responde no chat como um usuário do servidor: na primeira interação ele cria
  sozinho o registro em `User` e a participação em `ServerMember` (cargo `member`).
- Nenhuma alteração de schema no Prisma foi necessária.
- Nada mudou no cliente: o app já sabe receber e exibir um participante com faixa de mic.

### Por que uma dependência nova (`@livekit/rtc-node`)

O app já coloca áudio na call, mas **sempre a partir de um cliente** (navegador/Electron):

| Caminho existente | Limitação para um bot |
|---|---|
| Soundboard (`playSoundLocally`) | toca **na máquina de cada um** via `new Audio()`; não publica faixa |
| Compartilhamento de tela (`ScreenShareAudio`) | roda no cliente, amarrado ao compartilhamento, e para quando o usuário fecha o app |

O servidor só tinha o `livekit-server-sdk`, que é um SDK **administrativo** (token, listar
participantes, kick, mute, webhooks) — por design ele **não publica mídia**. Para o servidor
virar participante é preciso o SDK de tempo real, que é o `@livekit/rtc-node`: a contraparte
Node do `livekit-client` que o app já usa no navegador.

---

## 2. Comandos

Todos no **canal de texto**, sempre com `/`:

| Comando | O que faz |
|---|---|
| `/play <link>` | entra no canal de voz de quem enviou e adiciona a música (ou a playlist toda) à fila |
| `/pause` | pausa a música atual |
| `/resume` | retoma a música pausada |
| `/skip` | pula para a próxima da fila |
| `/stop` | para tudo, limpa a fila e sai do canal |
| `/leave` | igual ao `/stop` |
| `/queue` | mostra o que está tocando e o que está na fila |

**Regras:**

- Comando desconhecido (ex: `/plays`) é ignorado e tratado como mensagem comum.
- `/play` exige que o autor esteja em um canal de voz: *"Entre em um canal de voz antes de
  usar /play."*
- Para controlar (`pause`/`resume`/`skip`/`stop`/`leave`/`queue`) é preciso estar **no mesmo
  canal de voz do bot**, para evitar sabotagem.
- **Playlists entram inteiras.** Se o link apontar para uma playlist (ex:
  `watch?v=...&list=...`, inclusive mixes/radio como `list=RDMM`), todas as faixas são
  enfileiradas; se for um vídeo único, entra só ele.
- A quantidade de faixas lidas de uma playlist é limitada por `MUSIC_BOT_MAX_PLAYLIST`, e o
  que não couber na fila (`MUSIC_BOT_MAX_QUEUE`) é descartado — o bot informa os dois casos
  na resposta.
- Transmissões ao vivo são recusadas (não têm fim) — dentro de playlists elas são puladas.
- Não há limite de duração por faixa.
- Quando a fila termina, o bot sai sozinho após `MUSIC_BOT_IDLE_TIMEOUT_SECONDS`.
- Falhas aparecem como mensagem do bot no próprio canal (ex: link inválido, yt-dlp ausente).

**Exemplos de resposta:**

```
Tocando agora: AViVA - GRRRLS (3:49)
Adicionada à fila (#2): Pitty - Teto de Vidro (3:47)
Playlist "My Mix": 50 músicas adicionadas à fila. Lidas apenas as 50 primeiras faixas.
```

---

## 3. Configuração

Todas as variáveis têm valor padrão — **nenhuma é obrigatória** para ativar o bot. Adicione ao
`.env` do servidor só o que quiser personalizar:

| Variável | Padrão | Descrição |
|---|---|---|
| `MUSIC_BOT_ENABLED` | `true` | `false` desativa todos os comandos de música |
| `YT_DLP_PATH` | `yt-dlp` | caminho do binário, se estiver fora do `PATH` |
| `FFMPEG_PATH` | `ffmpeg` | caminho do binário, se estiver fora do `PATH` |
| `MUSIC_BOT_USER_ID` | `music-bot` | id interno do bot no banco e identidade na call |
| `MUSIC_BOT_USERNAME` | `music-bot` | username do bot (pode conflitar com um usuário existente) |
| `MUSIC_BOT_DISPLAY_NAME` | `DJ` | nome exibido na call e no chat |
| `MUSIC_BOT_AVATAR_URL` | *(vazio)* | avatar público; vazio usa a inicial do nome |
| `MUSIC_BOT_MAX_QUEUE` | `50` | máximo de faixas por canal (1–500, inclui a que toca) |
| `MUSIC_BOT_MAX_PLAYLIST` | `50` | máximo de faixas lidas de um link de playlist (1–500) |
| `MUSIC_BOT_IDLE_TIMEOUT_SECONDS` | `60` | tempo sem fila antes de sair do canal (5–3600) |

O bot também depende das credenciais que já existem no `.env`:
`LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`.

> **Dica:** se o LiveKit roda na mesma máquina do app, usar `LIVEKIT_URL=ws://127.0.0.1:7880`
> faz o bot conectar localmente em vez de sair e voltar pela internet. O frontend continua
> usando a URL pública em `NEXT_PUBLIC_LIVEKIT_URL`.

---

## 4. Instalação e ativação

### 4.1 Requisitos no servidor

```bash
sudo apt update
sudo apt install -y ffmpeg

# yt-dlp: use o binário autocontido (não exige Python e é sempre a versão mais recente)
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

Conferindo:

```bash
yt-dlp --version
ffmpeg -version | head -1
```

> `apt install yt-dlp` também funciona, mas costuma entregar uma versão antiga — e o YouTube
> muda com frequência, então yt-dlp desatualizado é a causa mais comum de falha.

### 4.2 Arquivos para enviar

Se o servidor já roda o app, apenas estes 9 arquivos mudam:

**Novos**

```
src/lib/music-bot/config.ts
src/lib/music-bot/media.ts
src/lib/music-bot/player.ts
src/lib/music-bot/manager.ts
```

**Modificados**

```
package.json                                                      (dependência nova)
package-lock.json                                                 (lock, obrigatório)
next.config.ts                                                    (serverExternalPackages)
src/app/api/servers/[serverId]/channels/[channelId]/messages/route.ts   (hook dos comandos)
.env.example                                                      (opcional, só documentação)
```

**Não suba:** `node_modules/` e `.next/` — o `@livekit/rtc-node` é um addon nativo por
plataforma e o build precisa ser refeito no Linux. Confirme que o `.npmrc` com
`legacy-peer-deps=true` existe no servidor (ele já faz parte do projeto).

### 4.3 Instalar dependências e buildar

```bash
cd /caminho/do/projeto        # a pasta que tem o package.json
npm ci                        # instala o @livekit/rtc-node com o binário nativo do Linux
npm run build
```

> Rode o `npm` com o mesmo usuário que executa o app (ex: `sudo -u deploy -H npm ci`) para o
> `node_modules` não ficar com dono `root`.
>
> `npm install` também resolve, se você preferir não apagar o `node_modules`.

### 4.4 Verificação antes de reiniciar

```bash
cd /caminho/do/projeto    # o require resolve a partir do diretório atual

node -e "require('@livekit/rtc-node'); console.log('rtc-node OK')"
node -e "const{spawnSync}=require('child_process');const r=spawnSync('yt-dlp',['--version']);console.log('yt-dlp:',r.status===0?'OK':'FALHOU')"
node -e "const{spawnSync}=require('child_process');const r=spawnSync('ffmpeg',['--version']);console.log('ffmpeg:',r.status===0?'OK':'FALHOU')"
```

Os dois devem imprimir `OK`. Se `@livekit/rtc-node` falhar com `MODULE_NOT_FOUND`, ou o
`npm ci` não rodou, ou o comando está fora da pasta do projeto.

Teste opcional de extração (valida rede/YouTube):

```bash
yt-dlp -f bestaudio --no-playlist --dump-single-json 'https://youtu.be/SEU_VIDEO' | head -c 300
```

### 4.5 Reiniciar o app

Use o gerenciador que já roda o app:

```bash
pm2 list                                   # -> pm2 restart <nome> --update-env
systemctl list-units | grep -iE 'partiu|twins|next'
docker ps                                  # -> docker compose up -d --build
```

### 4.6 Teste final

1. Entre em um canal de voz (pelo app).
2. Em um canal de texto, envie `/play <link>`.
3. O esperado:
   - o bot responde no chat: `Tocando agora: <título> (m:s)`;
   - o bot aparece na call na lista de participantes;
   - o áudio é ouvido por todos na call.
4. ` /queue`, `/pause`, `/resume`, `/skip` e `/stop` para validar os controles.

---

## 5. Operação e diagnóstico

**Onde olhar primeiro:** os erros do bot são reportados **no próprio canal de texto**, então
na maioria dos casos você não precisa de acesso ao servidor para entender a falha.

| Mensagem no chat | Causa provável | Correção |
|---|---|---|
| `Não encontrei o yt-dlp ("yt-dlp")` | binário ausente/fora do `PATH` | instalar ou apontar `YT_DLP_PATH` |
| `Não encontrei o ffmpeg ("ffmpeg")` | idem | instalar ou apontar `FFMPEG_PATH` |
| `Não consegui baixar/decodificar o áudio` | yt-dlp desatualizado, vídeo privado/removido, região bloqueada | `yt-dlp -U` ou reinstalar o binário |
| `Transmissões ao vivo não são suportadas` | link é uma live | usar um vídeo normal |
| `Envie um link completo...` | link sem `http(s)://` | enviar o link completo |
| `Entre em um canal de voz antes de usar /play` | autor não está em call | entrar em um canal de voz |
| `Entre no canal de voz "X" para controlar a música` | autor está em outro canal | entrar no canal do bot |
| `Não consegui executar o comando: ...` | falha ao entrar na sala ou no banco | ver os logs do processo do Next |

**Logs do processo:** erros internos aparecem no stdout do Next/pm2/systemd. O SDK nativo
escreve logs com `"name":"lk-rtc"` — útil para diferenciar falha de rede da falha de mídia.

**Comportamentos esperados:**

- O bot fica na call enquanto houver fila ou faixa tocando, e sai após o tempo ocioso.
- A música **para quando o app é reiniciado** (o bot roda dentro do processo do Next).
- O bot não é uma conta logável: ele é criado com `passwordHash` inválido (`__NO_PASSWORD__`).
- O bot fica visível na lista de membros do servidor (cargo `member`). Para removê-lo, basta
  apagar o usuário `music-bot` do banco; ele é recriado no próximo comando.

---

## 6. Limitações conhecidas

- **Assume instância única.** O estado da fila vive na memória do processo. Com o Next em
  cluster (PM2 cluster, 2+ containers), dois `/play` podem subir **dois bots** na mesma sala.
  Nesse cenário é preciso extrair o motor para um serviço stateful separado.
- **`next dev` com hot reload** é problemático para esse SDK (aviso oficial do LiveKit). Use
  `next start`/build de produção para testar música de verdade.
- O `@livekit/rtc-node` traz um addon nativo: o `node_modules` **não é portável** entre
  Windows e Linux, e `dispose()` do SDK não é chamado de propósito (o processo do servidor é
  de longa duração e continua podendo abrir novas sessões).
- Playlists são limitadas a `MUSIC_BOT_MAX_PLAYLIST` faixas por comando (padrão 50); mixes
  automáticos do YouTube como `list=RDMM` costumam ter mais de 100 faixas.
- Não há busca por texto (só link), nem histórico de reprodução, nem volume por usuário.

---

## 7. Desativar

Remova ou ajuste no `.env` e reinicie o app:

```bash
MUSIC_BOT_ENABLED=false
```

Com isso os comandos deixam de ser interpretados e o bot nunca entra em uma call — sem
precisar remover código ou dependências.
