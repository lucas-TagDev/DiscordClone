import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { PCM_CHANNELS, PCM_SAMPLE_RATE, type MusicBotBinaries } from "@/lib/music-bot/config";

export class MediaError extends Error {}

export type TrackMetadata = {
  title: string;
  durationSeconds: number | null;
  webpageUrl: string;
};

// `--no-playlist` evita que um link de playlist enfileire dezenas de faixas de uma
// vez: o yt-dlp resolve apenas o primeiro vídeo do link.
const YTDLP_COMMON_ARGS = ["--no-playlist", "--no-warnings", "--no-progress", "--socket-timeout", "20"];
const STDERR_LIMIT = 4000;

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
  webpage_url?: string;
  entries?: YtDlpInfo[];
};

const readMetadata = (info: YtDlpInfo): TrackMetadata => {
  if (info.is_live) {
    throw new MediaError("Transmissões ao vivo não são suportadas.");
  }

  const title = info.title?.trim();
  if (!title) {
    throw new MediaError("Não consegui identificar o áudio desse link.");
  }

  const duration =
    typeof info.duration === "number" && Number.isFinite(info.duration) && info.duration > 0
      ? Math.round(info.duration)
      : null;

  return {
    title,
    durationSeconds: duration,
    webpageUrl: info.webpage_url?.trim() || "",
  };
};

export const resolveTrackMetadata = async (
  url: string,
  binaries: MusicBotBinaries,
): Promise<TrackMetadata> => {
  if (!isHttpUrl(url)) {
    throw new MediaError("Envie um link http(s) válido.");
  }

  const stdout = await collectProcess(
    binaries.ytDlpPath,
    [...YTDLP_COMMON_ARGS, "--dump-single-json", "-f", "bestaudio/best", url],
    "yt-dlp",
  );

  let info: YtDlpInfo;
  try {
    info = JSON.parse(stdout) as YtDlpInfo;
  } catch {
    throw new MediaError("Não consegui interpretar a resposta do yt-dlp.");
  }

  const firstEntry = Array.isArray(info.entries) ? info.entries.find(Boolean) : undefined;
  if (info._type === "playlist" || firstEntry) {
    if (!firstEntry) {
      throw new MediaError("Esse link não contém nenhum áudio reproduzível.");
    }

    return readMetadata(firstEntry);
  }

  return readMetadata(info);
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
    [...YTDLP_COMMON_ARGS, "-f", "bestaudio/best", "-o", "-", url],
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
