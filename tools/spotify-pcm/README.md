# spotify-pcm

Ponte entre o bot de música (`src/lib/music-bot`) e o motor de streaming do
[spotatui](https://github.com/LargeModGames/spotatui): o fork mantido do librespot,
publicado como `spotatui-librespot-*` (licença MIT).

Com `MUSIC_BOT_SPOTIFY_AUDIO=true`, um `/play` com link do Spotify (música, álbum ou
playlist) toca o **áudio original do Spotify** na call, em vez de procurar uma versão no
YouTube. Para cada faixa o bot abre um `spotify-pcm play`, que escreve PCM s16le 44.1kHz
estéreo no stdout. O ffmpeg converte para 48kHz e o bot publica no LiveKit.

## Requisitos

- Conta **Spotify Premium** (o Spotify recusa streaming para contas grátis).
- Rust 1.85+ ([rustup.rs](https://rustup.rs)) e, no Windows, as Build Tools do Visual Studio (C++).
- `ffmpeg` (já usado pelo bot).

## Configuração

```powershell
npm run spotify:build
```

```powershell
npm run spotify:login
```

O login abre a página de pareamento do Spotify no navegador. Confirme o código mostrado no
terminal. Ele fica salvo em `.spotify-cache/` (ignorada pelo git, trate como senha). Depois:

```powershell
npm run spotify:check
```

e no `.env.local`:

```
MUSIC_BOT_SPOTIFY_AUDIO=true
```

Reinicie o `npm run dev`. As outras variáveis (`SPOTIFY_PCM_*`) estão no `.env.example`.

## Uso direto

```
spotify-pcm login [--cache DIR]
spotify-pcm check [--cache DIR]
spotify-pcm play  [--cache DIR] [--bitrate 96|160|320] [--normalize] <spotify:track:ID | ID | link>
```

Códigos de saída: 0 ok, 1 erro, 2 sem login, 3 faixa indisponível, 4 conta sem Premium,
64 uso incorreto. Tudo que não é áudio vai para o stderr.

## Limitações

- Uma conta Spotify toca uma faixa por vez. Duas calls tocando Spotify ao mesmo tempo
  com a mesma conta podem se derrubar.
- Retransmitir o áudio do Spotify para outras pessoas vai contra os termos de uso do
  Spotify e pode levar ao bloqueio da conta. Prefira uma conta própria para o bot.
- Se o Spotify não tocar a faixa (sem login, faixa indisponível, sem Premium), o bot tenta
  a versão do YouTube, a menos que `SPOTIFY_PCM_YOUTUBE_FALLBACK=false`.
