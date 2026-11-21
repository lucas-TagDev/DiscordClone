import {
  parseSpotifyLink,
  readSpotifyLink,
  type SpotifyCollection,
  type SpotifyLink,
  type SpotifyTrack,
} from "@/lib/music-bot/spotify";
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import {
  PCM_CHANNELS,
  PCM_SAMPLE_RATE,
  SPOTIFY_PCM_SAMPLE_RATE,
  type MusicBotBinaries,
  type SpotifyAudioConfig,
} from "@/lib/music-bot/config";

export class MediaError extends Error {}

export type TrackMetadata = {
  /** URL reproduzível pelo yt-dlp (uma faixa só, sem playlist acoplada). */
  url: string;
  title: string;
  durationSeconds: number | null;
  /**
   * Para faixas vindas de álbum/playlist do Spotify: busca o áudio no YouTube só na hora
   * de tocar (memoizado). Quando existe, `url` é o link da faixa no Spotify.
   */
  resolveUrl?: () => Promise<string>;
  /**
   * Com o áudio direto do Spotify ligado: o ID da faixa, tocada pelo `spotify-pcm`.
   * Nesse caso `resolveUrl` (quando existe) é só o plano B pelo YouTube.
   */
  spotifyTrackId?: string;
};

export type PlaylistResolution = {
  /** Título da playlist quando o link é uma playlist; null para vídeo único. */
  playlistTitle: string | null;
  tracks: TrackMetadata[];
  /** true quando a playlist tem mais faixas do que o limite consultado. */
  truncated: boolean;
  sourceNote?: string;
};

const YTDLP_COMMON_ARGS = ["--no-warnings", "--no-progress", "--socket-timeout", "20"];
const STDERR_LIMIT = 4000;
const UNTITLED = "Faixa sem título";

export const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const SPAWN_HINTS: Record<string, string> = {
  "yt-dlp": "Instale-o no servidor ou ajuste YT_DLP_PATH.",
  ffmpeg: "Instale-o no servidor ou ajuste FFMPEG_PATH.",
  "spotify-pcm": "Compile com `npm run spotify:build` ou ajuste SPOTIFY_PCM_PATH.",
};

const describeSpawnError = (error: NodeJS.ErrnoException, label: string, binaryPath: string): string => {
  if (error.code === "ENOENT") {
    return `Não encontrei o ${label} ("${binaryPath}"). ${SPAWN_HINTS[label] ?? ""}`.trim();
  }

  return `Falha ao executar o ${label}: ${error.message}`;
};

const lastLines = (value: string): string =>
  value.trim().split("\n").filter(Boolean).slice(-2).join(" ");

const collectProcess = (
  command: string,
  args: string[],
  label: string,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (callback: () => void) => {
      if (!settled) {
        settled = true;
        callback();
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < STDERR_LIMIT) {
        stderr += chunk;
      }
    });

    child.on("error", (error) => {
      settle(() => reject(new MediaError(describeSpawnError(error as NodeJS.ErrnoException, label, command))));
    });

    child.on("close", (code) => {
      settle(() => {
        if (code === 0) {
          resolve(stdout);
          return;
        }

        reject(new MediaError(lastLines(stderr) || `O ${label} terminou com erro (código ${code}).`));
      });
    });
  });

type YtDlpInfo = {
  _type?: string;
  title?: string;
  duration?: number;
  is_live?: boolean;
  live_status?: string;
  webpage_url?: string;
  url?: string;
  id?: string;
  ie_key?: string;
  channel?: string;
  uploader?: string;
  entries?: YtDlpInfo[];
};

const isLiveEntry = (info: YtDlpInfo): boolean =>
  info.is_live === true || info.live_status === "is_live";

const readDuration = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

/** O yt-dlp devolve a URL completa nas playlists, mas nem todo extractor faz isso. */
const readEntryUrl = (entry: YtDlpInfo): string | null => {
  for (const candidate of [entry.webpage_url, entry.url]) {
    if (candidate && isHttpUrl(candidate)) {
      return candidate;
    }
  }

  if (entry.id && (entry.ie_key ?? "").toLowerCase().includes("youtube")) {
    return `https://www.youtube.com/watch?v=${entry.id}`;
  }

  return null;
};

const readMetadata = (info: YtDlpInfo, fallbackUrl: string): TrackMetadata => {
  if (isLiveEntry(info)) {
    throw new MediaError("Transmissões ao vivo não são suportadas.");
  }

  const title = info.title?.trim();
  if (!title) {
    throw new MediaError("Não consegui identificar o áudio desse link.");
  }

  return {
    url: readEntryUrl(info) ?? fallbackUrl,
    title,
    durationSeconds: readDuration(info.duration),
  };
};

const readPlaylistEntries = (
  entries: YtDlpInfo[],
  maxTracks: number,
): { tracks: TrackMetadata[]; truncated: boolean } => {
  // Faixas ao vivo e entradas sem URL reproduzível são descartadas em silêncio.
  const usable = entries.flatMap((entry) => {
    if (!entry || isLiveEntry(entry)) {
      return [];
    }

    const url = readEntryUrl(entry);
    if (!url) {
      return [];
    }

    return [
      {
        url,
        title: entry.title?.trim() || UNTITLED,
        durationSeconds: readDuration(entry.duration),
      },
    ];
  });

  return {
    tracks: usable.slice(0, maxTracks),
    truncated: usable.length > maxTracks,
  };
};

const normalizeMusicText = (value: string) => value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

type YouTubeMatch = { entry: YtDlpInfo; url: string };

/** Procura no YouTube o áudio que corresponde à faixa do Spotify (nome, artista e duração). */
const findYouTubeMatch = async (track: SpotifyTrack, binaries: MusicBotBinaries): Promise<YouTubeMatch> => {
  // Com muitos artistas a busca dilui: os dois primeiros bastam para achar a faixa.
  const query = `${track.artists.slice(0, 2).join(" ")} ${track.name} official audio`.trim();
  const stdout = await collectProcess(binaries.ytDlpPath,
    [...YTDLP_COMMON_ARGS, "--flat-playlist", "--dump-single-json", `ytsearch5:${query}`], "yt-dlp");
  let info: YtDlpInfo;
  try { info = JSON.parse(stdout) as YtDlpInfo; }
  catch { throw new MediaError("Não consegui interpretar a busca da música no YouTube."); }
  const nameWords = normalizeMusicText(track.name).split(" ").filter(Boolean);
  // Sem artista (plano B via oEmbed) a correspondência exige mais do título
  const artists = track.artists.map(normalizeMusicText).filter(Boolean);
  const minTitleScore = artists.length ? 0.6 : 0.8;
  const candidates = (info.entries ?? []).flatMap((entry) => {
    if (!entry || isLiveEntry(entry)) return [];
    const candidateUrl = readEntryUrl(entry);
    if (!candidateUrl) return [];
    const titleWords = normalizeMusicText(entry.title ?? "").split(" ");
    const author = normalizeMusicText(`${entry.channel ?? ""} ${entry.uploader ?? ""} ${entry.title ?? ""}`);
    const titleScore = nameWords.filter((word) => titleWords.includes(word)).length / Math.max(1, nameWords.length);
    // Basta um dos artistas no canal/título (feats costumam sair no canal de outro artista).
    if (titleScore < minTitleScore || (artists.length && !artists.some((artist) => author.includes(artist)))) return [];
    const duration = readDuration(entry.duration);
    const delta = duration && track.durationSeconds ? Math.abs(duration - track.durationSeconds) : null;
    if (delta !== null && delta > Math.max(25, (track.durationSeconds ?? 0) * 0.15)) return [];
    // Prefere a versão original a covers/remixes/ao vivo com nome parecido.
    const alternate = ["cover", "remix", "live", "karaoke", "sped", "slowed"]
      .filter((word) => titleWords.includes(word) && !nameWords.includes(word)).length;
    return [{ entry, url: candidateUrl, score: titleScore * 10 - alternate * 8 - (delta ?? 15) / 10 }];
  }).sort((a, b) => b.score - a.score);
  const match = candidates[0];
  if (!match || match.score < 0) {
    throw new MediaError(`Não encontrei no YouTube uma versão de "${describeSpotifyTrack(track)}". Envie um link direto do YouTube ou YouTube Music.`);
  }
  return match;
};

const describeSpotifyTrack = (track: SpotifyTrack) =>
  `${track.artists.length ? `${track.artists.join(", ")} — ` : ""}${track.name}`;

const SPOTIFY_TRACK_ID = /\/track\/([a-zA-Z0-9]{22})/;

/** Busca no YouTube só quando for tocar (memoizado; libera nova tentativa se falhar). */
const lazyYouTubeUrl = (track: SpotifyTrack, binaries: MusicBotBinaries): (() => Promise<string>) => {
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= findYouTubeMatch(track, binaries).then((match) => match.url);
    pending.catch(() => { pending = null; });
    return pending;
  };
};

/** Áudio direto do Spotify: nada de busca no YouTube na hora do /play. */
const resolveSpotifyDirect = (
  collection: SpotifyCollection,
  binaries: MusicBotBinaries,
  spotifyAudio: SpotifyAudioConfig,
  maxTracks: number,
): PlaylistResolution => {
  const tracks = collection.tracks.slice(0, maxTracks).flatMap((track): TrackMetadata[] => {
    const spotifyTrackId = track.url.match(SPOTIFY_TRACK_ID)?.[1];
    if (!spotifyTrackId) return [];
    return [{
      url: track.url,
      title: describeSpotifyTrack(track),
      durationSeconds: track.durationSeconds,
      spotifyTrackId,
      resolveUrl: spotifyAudio.youtubeFallback ? lazyYouTubeUrl(track, binaries) : undefined,
    }];
  });

  if (!tracks.length) {
    throw new MediaError("Não encontrei faixas tocáveis nesse link do Spotify.");
  }

  if (collection.kind === "track") {
    return { playlistTitle: null, truncated: false, tracks, sourceNote: `Áudio direto do Spotify: ${tracks[0].url}` };
  }

  return {
    playlistTitle: `${collection.kind === "album" ? "Álbum" : "Playlist"} do Spotify "${collection.name}"`,
    tracks,
    truncated: collection.tracks.length > maxTracks,
    sourceNote: "Áudio direto do Spotify.",
  };
};

const resolveSpotify = async (
  link: SpotifyLink,
  binaries: MusicBotBinaries,
  maxTracks: number,
  spotifyAudio: SpotifyAudioConfig | null,
): Promise<PlaylistResolution> => {
  const collection = await readSpotifyLink(link);

  if (spotifyAudio) {
    return resolveSpotifyDirect(collection, binaries, spotifyAudio, maxTracks);
  }

  if (collection.kind === "track") {
    const track = collection.tracks[0];
    const match = await findYouTubeMatch(track, binaries);
    const metadata = readMetadata(match.entry, match.url);
    return {
      playlistTitle: null, truncated: false,
      tracks: [{ ...metadata, title: describeSpotifyTrack(track), durationSeconds: track.durationSeconds ?? metadata.durationSeconds }],
      sourceNote: `Do Spotify: ${track.url}
Áudio correspondente do YouTube: ${match.url}`,
    };
  }

  // Álbum/playlist: entra tudo na fila já; o áudio de cada faixa é buscado ao tocar.
  const tracks = collection.tracks.slice(0, maxTracks).map((track): TrackMetadata => ({
    url: track.url,
    title: describeSpotifyTrack(track),
    durationSeconds: track.durationSeconds,
    resolveUrl: lazyYouTubeUrl(track, binaries),
  }));

  return {
    playlistTitle: `${collection.kind === "album" ? "Álbum" : "Playlist"} do Spotify "${collection.name}"`,
    tracks,
    truncated: collection.tracks.length > maxTracks,
    sourceNote: "O áudio de cada faixa é encontrado no YouTube na hora de tocar.",
  };
};

/**
 * Resolve o link em uma ou mais faixas. Um link com playlist (ex: `watch?v=...&list=...`)
 * devolve todas as faixas dela, até `maxTracks`; um link de vídeo único devolve uma só.
 */
export const resolveTracks = async (
  url: string,
  binaries: MusicBotBinaries,
  options: { maxTracks: number; spotifyAudio?: SpotifyAudioConfig | null },
): Promise<PlaylistResolution> => {
  if (!isHttpUrl(url)) {
    throw new MediaError("Envie um link http(s) válido.");
  }

  const spotifyLink = await parseSpotifyLink(url);
  if (spotifyLink) return resolveSpotify(spotifyLink, binaries, options.maxTracks, options.spotifyAudio ?? null);

  // YouTube Music shares video/playlist identifiers with YouTube.
  const parsedUrl = new URL(url);
  if (parsedUrl.hostname === "music.youtube.com") {
    parsedUrl.hostname = "www.youtube.com";
    url = parsedUrl.toString();
  }

  // Consulta leve: `--flat-playlist` traz título/duração de cada faixa sem baixar mídia.
  // Um item a mais que o limite serve para saber se a playlist foi cortada.
  const stdout = await collectProcess(
    binaries.ytDlpPath,
    [...YTDLP_COMMON_ARGS, "--flat-playlist", "--playlist-end", String(options.maxTracks + 1), "--dump-single-json", url],
    "yt-dlp",
  );

  let info: YtDlpInfo;
  try {
    info = JSON.parse(stdout) as YtDlpInfo;
  } catch {
    throw new MediaError("Não consegui interpretar a resposta do yt-dlp.");
  }

  const entries = Array.isArray(info.entries) ? info.entries.filter(Boolean) : [];

  if (entries.length > 0) {
    const { tracks, truncated } = readPlaylistEntries(entries, options.maxTracks);
    if (tracks.length === 0) {
      throw new MediaError("Essa playlist não tem faixas reproduzíveis.");
    }

    return { playlistTitle: info.title?.trim() || null, tracks, truncated };
  }

  return { playlistTitle: null, tracks: [readMetadata(info, url)], truncated: false };
};

export type PcmStream = {
  /** PCM s16le entrelaçado, 48kHz estéreo, pronto para virar AudioFrame. */
  output: Readable;
  /** Encerra os processos em execução (usado em skip/stop). */
  stop: () => void;
  /** Resolve quando a faixa termina de decodificar; rejeita em falha real. */
  completion: Promise<void>;
};

type PcmSource = {
  label: string;
  command: string;
  args: string[];
  /** Argumentos de entrada do ffmpeg que descrevem o que chega pelo stdin. */
  ffmpegInputArgs: string[];
  /** Mensagem quando a fonte termina com erro sem explicar no stderr. */
  failureMessage: string;
};

/**
 * Pluga a fonte (yt-dlp ou spotify-pcm) direto no ffmpeg, sem arquivo temporário: o
 * ffmpeg entrega PCM bruto 48kHz estéreo em tempo real.
 */
const openPipedPcmStream = (source: PcmSource, ffmpegPath: string): PcmStream => {
  const producer = spawn(source.command, source.args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const ffmpeg = spawn(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      ...source.ffmpegInputArgs,
      "-i",
      "pipe:0",
      "-vn",
      "-f",
      "s16le",
      "-ar",
      String(PCM_SAMPLE_RATE),
      "-ac",
      String(PCM_CHANNELS),
      "pipe:1",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );

  let stopped = false;
  let settled = false;
  let spawnFailed = false;
  let producerExitCode: number | null = null;
  let producerStderr = "";
  let ffmpegStderr = "";

  let resolveCompletion: () => void = () => {};
  let rejectCompletion: (error: Error) => void = () => {};

  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  const settle = (failureMessage?: string) => {
    if (settled) {
      return;
    }
    settled = true;
    clearInterval(watchdog);

    if (!failureMessage || stopped) {
      resolveCompletion();
      return;
    }

    rejectCompletion(new MediaError(failureMessage));
  };

  // Se os processos travarem sem nunca fechar (ex: binário pendurado), libera a fila.
  const watchdog = setInterval(() => {
    settle("A reprodução desse link demorou demais para responder.");
  }, 30 * 60 * 1000);
  watchdog.unref?.();

  producer.stderr?.setEncoding("utf8");
  producer.stderr?.on("data", (chunk: string) => {
    if (producerStderr.length < STDERR_LIMIT) {
      producerStderr += chunk;
    }
  });
  ffmpeg.stderr?.setEncoding("utf8");
  ffmpeg.stderr?.on("data", (chunk: string) => {
    if (ffmpegStderr.length < STDERR_LIMIT) {
      ffmpegStderr += chunk;
    }
  });

  producer.on("error", (error) => {
    spawnFailed = true;
    settle(describeSpawnError(error as NodeJS.ErrnoException, source.label, source.command));
  });
  ffmpeg.on("error", (error) => {
    spawnFailed = true;
    settle(describeSpawnError(error as NodeJS.ErrnoException, "ffmpeg", ffmpegPath));
  });
  producer.stdout?.on("error", () => {
    // O término do ffmpeg decide se a faixa foi reproduzida.
  });
  ffmpeg.stdin?.on("error", () => {
    // O ffmpeg pode fechar o stdin antes da fonte terminar (ex: skip): ignorar.
  });

  if (producer.stdout && ffmpeg.stdin) {
    producer.stdout.pipe(ffmpeg.stdin);
  }

  producer.on("close", (code) => {
    producerExitCode = code;
    producer.stdout?.destroy();
    ffmpeg.stdin?.end();
  });

  ffmpeg.on("close", (code) => {
    if (spawnFailed || stopped) {
      settle();
      return;
    }

    // A falha da fonte vem primeiro: sem entrada, o ffmpeg só diria "Invalid data".
    if (producerExitCode !== null && producerExitCode !== 0) {
      settle(lastLines(producerStderr) || source.failureMessage);
      return;
    }

    if (code !== 0) {
      settle(lastLines(ffmpegStderr) || lastLines(producerStderr) || "Não consegui decodificar o áudio desse link.");
      return;
    }

    settle();
  });

  return {
    output: ffmpeg.stdout as Readable,
    stop: () => {
      stopped = true;
      producer.stdout?.destroy();
      producer.kill("SIGKILL");
      ffmpeg.stdin?.destroy();
      ffmpeg.stdout?.destroy();
      ffmpeg.kill("SIGKILL");
    },
    completion,
  };
};

/** Toca um link pelo yt-dlp (YouTube, YouTube Music e outros sites suportados). */
export const openPcmStream = (url: string, binaries: MusicBotBinaries): PcmStream => {
  if (!isHttpUrl(url)) {
    throw new MediaError("Envie um link http(s) válido.");
  }

  return openPipedPcmStream({
    label: "yt-dlp",
    command: binaries.ytDlpPath,
    // `--no-playlist` garante que o processo de streaming toque somente esta faixa.
    args: [...YTDLP_COMMON_ARGS, "--no-playlist", "-f", "bestaudio/best", "-o", "-", url],
    ffmpegInputArgs: [],
    failureMessage: "Não consegui baixar o áudio desse link.",
  }, binaries.ffmpegPath);
};

/**
 * Toca uma faixa com o áudio original do Spotify pelo `spotify-pcm` (motor librespot do
 * spotatui), que escreve PCM s16le 44.1kHz estéreo no stdout.
 */
export const openSpotifyPcmStream = (
  trackId: string,
  spotifyAudio: SpotifyAudioConfig,
  binaries: MusicBotBinaries,
): PcmStream => {
  if (!/^[a-zA-Z0-9]{22}$/.test(trackId)) {
    throw new MediaError("ID de faixa do Spotify inválido.");
  }

  return openPipedPcmStream({
    label: "spotify-pcm",
    command: spotifyAudio.binaryPath,
    args: [
      "play",
      "--cache", spotifyAudio.cacheDir,
      "--bitrate", String(spotifyAudio.bitrate),
      ...(spotifyAudio.normalize ? ["--normalize"] : []),
      `spotify:track:${trackId}`,
    ],
    ffmpegInputArgs: ["-f", "s16le", "-ar", String(SPOTIFY_PCM_SAMPLE_RATE), "-ac", "2"],
    failureMessage: "O Spotify não entregou o áudio desta faixa.",
  }, binaries.ffmpegPath);
};
