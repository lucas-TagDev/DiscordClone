/**
 * Configuração do bot de música ("DJ") que entra nos canais de voz e toca áudio
 * de links do YouTube, como se fosse um usuário falando na call.
 *
 * Os binários `yt-dlp` e `ffmpeg` precisam estar instalados no host que roda o
 * servidor Next.js (caminhos configuráveis por env).
 */

export const PCM_SAMPLE_RATE = 48_000;
export const PCM_CHANNELS = 2;

export type MusicBotBinaries = {
  ytDlpPath: string;
  ffmpegPath: string;
};

export type MusicBotConfig = {
  enabled: boolean;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  binaries: MusicBotBinaries;
  maxQueueSize: number;
  idleTimeoutMs: number;
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
  idleTimeoutMs: readEnvPositiveInt("MUSIC_BOT_IDLE_TIMEOUT_SECONDS", 60, 5, 3600) * 1000,
});
