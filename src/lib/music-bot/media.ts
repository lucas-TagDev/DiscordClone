import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { PCM_CHANNELS, PCM_SAMPLE_RATE, type MusicBotBinaries } from "@/lib/music-bot/config";

export class MediaError extends Error {}

export type TrackMetadata = {
  /** URL reproduzível pelo yt-dlp (uma faixa só, sem playlist acoplada). */
  url: string;
  title: string;
  durationSeconds: number | null;
};

export type PlaylistResolution = {
  /** Título da playlist quando o link é uma playlist; null para vídeo único. */
  playlistTitle: string | null;
  tracks: TrackMetadata[];
  /** true quando a playlist tem mais faixas do que o limite consultado. */
  truncated: boolean;
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

const describeSpawnError = (error: NodeJS.ErrnoException, label: string, binaryPath: string): string => {
  if (error.code === "ENOENT") {
    return `Não encontrei o ${label} ("${binaryPath}"). Instale-o no servidor ou ajuste ${
      label === "yt-dlp" ? "YT_DLP_PATH" : "FFMPEG_PATH"
    }.`;
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

/**
 * Resolve o link em uma ou mais faixas. Um link com playlist (ex: `watch?v=...&list=...`)
 * devolve todas as faixas dela, até `maxTracks`; um link de vídeo único devolve uma só.
 */
export const resolveTracks = async (
  url: string,
  binaries: MusicBotBinaries,
  options: { maxTracks: number },
): Promise<PlaylistResolution> => {
  if (!isHttpUrl(url)) {
    throw new MediaError("Envie um link http(s) válido.");
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

/**
 * Pluga o yt-dlp direto no ffmpeg (sem arquivo temporário): o yt-dlp resolve as
 * URLs e headers do site, e o ffmpeg entrega PCM bruto em tempo real.
 */
export const openPcmStream = (url: string, binaries: MusicBotBinaries): PcmStream => {
  if (!isHttpUrl(url)) {
    throw new MediaError("Envie um link http(s) válido.");
  }

  const ytDlp = spawn(
    binaries.ytDlpPath,
    // `--no-playlist` garante que o processo de streaming toque somente esta faixa.
    [...YTDLP_COMMON_ARGS, "--no-playlist", "-f", "bestaudio/best", "-o", "-", url],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const ffmpeg = spawn(
    binaries.ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
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
  let ytDlpExitCode: number | null = null;
  let ytDlpStderr = "";
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

  ytDlp.stderr?.setEncoding("utf8");
  ytDlp.stderr?.on("data", (chunk: string) => {
    if (ytDlpStderr.length < STDERR_LIMIT) {
      ytDlpStderr += chunk;
    }
  });
  ffmpeg.stderr?.setEncoding("utf8");
  ffmpeg.stderr?.on("data", (chunk: string) => {
    if (ffmpegStderr.length < STDERR_LIMIT) {
      ffmpegStderr += chunk;
    }
  });

  ytDlp.on("error", (error) => {
    spawnFailed = true;
    settle(describeSpawnError(error as NodeJS.ErrnoException, "yt-dlp", binaries.ytDlpPath));
  });
  ffmpeg.on("error", (error) => {
    spawnFailed = true;
    settle(describeSpawnError(error as NodeJS.ErrnoException, "ffmpeg", binaries.ffmpegPath));
  });
  ytDlp.stdout?.on("error", () => {
    // O término do ffmpeg decide se a faixa foi reproduzida.
  });
  ffmpeg.stdin?.on("error", () => {
    // O ffmpeg pode fechar o stdin antes do yt-dlp terminar (ex: skip): ignorar.
  });

  if (ytDlp.stdout && ffmpeg.stdin) {
    ytDlp.stdout.pipe(ffmpeg.stdin);
  }

  ytDlp.on("close", (code) => {
    ytDlpExitCode = code;
    ytDlp.stdout?.destroy();
    ffmpeg.stdin?.end();
  });

  ffmpeg.on("close", (code) => {
    if (spawnFailed || stopped) {
      settle();
      return;
    }

    if (code !== 0) {
      settle(lastLines(ffmpegStderr) || lastLines(ytDlpStderr) || "Não consegui decodificar o áudio desse link.");
      return;
    }

    if (ytDlpExitCode !== null && ytDlpExitCode !== 0) {
      settle(lastLines(ytDlpStderr) || "Não consegui baixar o áudio desse link.");
      return;
    }

    settle();
  });

  return {
    output: ffmpeg.stdout as Readable,
    stop: () => {
      stopped = true;
      ytDlp.stdout?.destroy();
      ytDlp.kill("SIGKILL");
      ffmpeg.stdin?.destroy();
      ffmpeg.stdout?.destroy();
      ffmpeg.kill("SIGKILL");
    },
    completion,
  };
};
