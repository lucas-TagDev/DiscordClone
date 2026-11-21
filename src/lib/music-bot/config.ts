/**
 * Configuração do bot de música ("DJ") que entra nos canais de voz e toca áudio
 * de links do YouTube, como se fosse um usuário falando na call.
 *
 * Os binários `yt-dlp` e `ffmpeg` precisam estar instalados no host que roda o
 * servidor Next.js (caminhos configuráveis por env).
 *
 * Com MUSIC_BOT_SPOTIFY_AUDIO=true, as faixas do Spotify tocam o áudio original do
 * Spotify pelo `spotify-pcm` (tools/spotify-pcm, motor de streaming do spotatui), em vez
 * de buscar uma versão no YouTube. Exige conta Premium e um login feito uma vez.
 */

import path from "node:path";

export const PCM_SAMPLE_RATE = 48_000;
export const PCM_CHANNELS = 2;

export type MusicBotBinaries = {
  ytDlpPath: string;
  ffmpegPath: string;
};

/** O librespot entrega PCM s16le estéreo a 44.1kHz; o ffmpeg converte para 48kHz. */
export const SPOTIFY_PCM_SAMPLE_RATE = 44_100;

export type SpotifyAudioConfig = {
  /** Caminho do binário `spotify-pcm`. */
  binaryPath: string;
  /** Pasta onde o login do Spotify fica salvo (gerada por `npm run spotify:login`). */
  cacheDir: string;
  bitrate: 96 | 160 | 320;
  normalize: boolean;
  /** Se o Spotify falhar, tenta a versão do YouTube da mesma faixa. */
  youtubeFallback: boolean;
};

export type MusicBotConfig = {
  enabled: boolean;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  binaries: MusicBotBinaries;
  maxQueueSize: number;
  maxPlaylistTracks: number;
  idleTimeoutMs: number;
  /** null quando o áudio direto do Spotify está desligado. */
  spotifyAudio: SpotifyAudioConfig | null;
};

const readEnvString = (key: string, fallback: string): string => {
  const value = process.env[key]?.trim();
  return value ? value : fallback;
};

const readEnvPositiveInt = (key: string, fallback: number, min: number, max: number): number => {
  const parsedValue = Number(process.env[key]);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  const normalizedValue = Math.floor(parsedValue);
  if (normalizedValue < min || normalizedValue > max) {
    return fallback;
  }

  return normalizedValue;
};

const readEnvFlag = (key: string, fallback: boolean): boolean => {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
};

const DEFAULT_SPOTIFY_PCM_PATH = path.join(
  "tools", "spotify-pcm", "target", "release", process.platform === "win32" ? "spotify-pcm.exe" : "spotify-pcm",
);

const readSpotifyAudioConfig = (): SpotifyAudioConfig | null => {
  if (!readEnvFlag("MUSIC_BOT_SPOTIFY_AUDIO", false)) return null;
  const bitrate = Number(process.env.SPOTIFY_PCM_BITRATE);
  return {
    binaryPath: path.resolve(readEnvString("SPOTIFY_PCM_PATH", DEFAULT_SPOTIFY_PCM_PATH)),
    cacheDir: path.resolve(readEnvString("SPOTIFY_PCM_CACHE_DIR", ".spotify-cache")),
    bitrate: bitrate === 96 || bitrate === 160 ? bitrate : 320,
    normalize: readEnvFlag("SPOTIFY_PCM_NORMALIZE", true),
    youtubeFallback: readEnvFlag("SPOTIFY_PCM_YOUTUBE_FALLBACK", true),
  };
};

export const getMusicBotConfig = (): MusicBotConfig => ({
  enabled: readEnvString("MUSIC_BOT_ENABLED", "true").toLowerCase() !== "false",
  userId: readEnvString("MUSIC_BOT_USER_ID", "music-bot").toLowerCase(),
  username: readEnvString("MUSIC_BOT_USERNAME", "music-bot").toLowerCase(),
  displayName: readEnvString("MUSIC_BOT_DISPLAY_NAME", "DJ"),
  avatarUrl: process.env.MUSIC_BOT_AVATAR_URL?.trim() || null,
  binaries: {
    ytDlpPath: readEnvString("YT_DLP_PATH", "yt-dlp"),
    ffmpegPath: readEnvString("FFMPEG_PATH", "ffmpeg"),
  },
  maxQueueSize: readEnvPositiveInt("MUSIC_BOT_MAX_QUEUE", 50, 1, 500),
  maxPlaylistTracks: readEnvPositiveInt("MUSIC_BOT_MAX_PLAYLIST", 50, 1, 500),
  idleTimeoutMs: readEnvPositiveInt("MUSIC_BOT_IDLE_TIMEOUT_SECONDS", 60, 5, 3600) * 1000,
  spotifyAudio: readSpotifyAudioConfig(),
});
