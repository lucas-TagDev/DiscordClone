import { AccessToken } from "livekit-server-sdk";
import type { Readable } from "node:stream";
import {
  PCM_CHANNELS,
  PCM_SAMPLE_RATE,
  type MusicBotConfig,
} from "@/lib/music-bot/config";
import { MediaError, openPcmStream, type PcmStream } from "@/lib/music-bot/media";

type RtcModule = typeof import("@livekit/rtc-node");
type AudioFrameInstance = InstanceType<RtcModule["AudioFrame"]>;
type AudioSourceInstance = InstanceType<RtcModule["AudioSource"]>;
type LocalAudioTrackInstance = InstanceType<RtcModule["LocalAudioTrack"]>;
type RoomInstance = InstanceType<RtcModule["Room"]>;

// O SDK nativo é pesado: só carrega quando o bot realmente entra em um canal de voz.
let rtcModulePromise: Promise<RtcModule> | null = null;
const loadRtcModule = (): Promise<RtcModule> => {
  rtcModulePromise ??= import("@livekit/rtc-node");
  return rtcModulePromise;
};

const FRAME_DURATION_MS = 20;
const FRAME_SAMPLES = (PCM_SAMPLE_RATE * FRAME_DURATION_MS) / 1000;
const FRAME_BYTES = FRAME_SAMPLES * PCM_CHANNELS * 2;
const SUBSCRIPTION_WAIT_MS = 3_000;
const IDLE_CHECK_INTERVAL_MS = 10_000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

export type MusicQueueItem = {
  id: string;
  url: string;
  title: string;
  durationSeconds: number | null;
  requestedBy: string;
  requestedByName: string;
};

export type MusicPlayerStatus = "idle" | "playing" | "paused";

export type MusicPlayerSnapshot = {
  status: MusicPlayerStatus;
  current: MusicQueueItem | null;
  queue: MusicQueueItem[];
};

export type MusicPlayerOptions = {
  roomName: string;
  config: MusicBotConfig;
  /** Envia uma mensagem de texto no canal onde o comando foi usado. */
  notify: (content: string) => Promise<void>;
};

export class MusicPlayer {
  readonly roomName: string;

  private readonly config: MusicBotConfig;
  private readonly notify: (content: string) => Promise<void>;

  private rtc: RtcModule | null = null;
  private room: RoomInstance | null = null;
  private source: AudioSourceInstance | null = null;
  private track: LocalAudioTrackInstance | null = null;

  private queue: MusicQueueItem[] = [];
  private current: MusicQueueItem | null = null;
  private status: MusicPlayerStatus = "idle";

  private paused = false;
  private stopped = false;
  private skipRequested = false;
  private disconnected = false;

  private activeStream: PcmStream | null = null;
  private wakeLoopResolve: (() => void) | null = null;
  private resumeWaiters: Array<() => void> = [];
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private emptySince: number | null = null;
  private loop: Promise<void> | null = null;

  constructor(options: MusicPlayerOptions) {
    this.roomName = options.roomName;
    this.config = options.config;
    this.notify = options.notify;
  }

  /** Entra no canal de voz e publica a faixa de áudio do bot. */
  async connect(): Promise<void> {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL ?? process.env.NEXT_PUBLIC_LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      throw new Error("Defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no .env.local.");
    }

    const rtc = await loadRtcModule();

    try {
      const accessToken = new AccessToken(apiKey, apiSecret, {
        identity: this.config.userId,
        name: this.config.displayName,
        ttl: "12h",
      });
      accessToken.addGrant({
        roomJoin: true,
        roomCreate: true,
        room: this.roomName,
        canPublish: true,
        canSubscribe: false,
      });

      const room = new rtc.Room();
      await room.connect(livekitUrl, await accessToken.toJwt(), { autoSubscribe: false, dynacast: false });

      room.on(rtc.RoomEvent.Disconnected, () => {
        this.disconnected = true;
        this.stopped = true;
        this.releasePaused();
        this.wakeLoop();
      });

      const source = new rtc.AudioSource(PCM_SAMPLE_RATE, PCM_CHANNELS);
      const track = rtc.LocalAudioTrack.createAudioTrack("music", source);
      const publishOptions = new rtc.TrackPublishOptions();
      publishOptions.source = rtc.TrackSource.SOURCE_MICROPHONE;

      // Registra os recursos antes de publicar para que uma falha ainda libere a sala.
      this.rtc = rtc;
      this.room = room;
      this.source = source;
      this.track = track;
      this.emptySince = Date.now();

      const localParticipant = room.localParticipant;
      if (!localParticipant) {
        throw new Error("Não consegui publicar o áudio do bot no canal de voz.");
      }

      const publication = await localParticipant.publishTrack(track, publishOptions);

      // Esperar alguém assinar evita perder os primeiros instantes da faixa;
      // o timeout cobre o caso em que todos silenciaram o bot.
      await Promise.race([publication.waitForSubscription().catch(() => undefined), delay(SUBSCRIPTION_WAIT_MS)]);

      this.idleTimer = setInterval(() => {
        void this.checkIdle();
      }, IDLE_CHECK_INTERVAL_MS);
      this.loop = this.runLoop();
    } catch (error) {
      await this.teardown();
      throw error;
    }
  }

  isConnected(): boolean {
    return Boolean(this.room) && !this.stopped && !this.disconnected;
  }

  hasWork(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  snapshot(): MusicPlayerSnapshot {
    return { status: this.status, current: this.current, queue: [...this.queue] };
  }

  /** Adiciona uma faixa ao fim da fila. */
  enqueue(item: MusicQueueItem): void {
    this.queue.push(item);
    this.wakeLoop();
  }

  queueSize(): number {
    return this.queue.length;
  }

  /** Músicas esperando depois da que está tocando (usada para mostrar a posição). */
  pendingCount(): number {
    return this.queue.filter((item) => item.id !== this.current?.id).length;
  }

  pause(): boolean {
    if (!this.current || this.paused) {
      return false;
    }

    this.paused = true;
    this.status = "paused";
    this.source?.clearQueue();
    return true;
  }

  resume(): boolean {
    if (!this.paused) {
      return false;
    }

    this.paused = false;
    this.status = "playing";
    this.releasePaused();
    return true;
  }

  skip(): boolean {
    if (!this.current) {
      return false;
    }

    this.skipRequested = true;
    this.releasePaused();
    this.activeStream?.stop();
    this.source?.clearQueue();
    return true;
  }

  /** Interrompe a reprodução, limpa a fila e sai do canal de voz. */
  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.skipRequested = true;
    this.releasePaused();
    this.wakeLoop();

    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }

    this.activeStream?.stop();
    this.activeStream = null;
    this.queue = [];
    this.source?.clearQueue();

    // Espera o laço de reprodução sair antes de liberar a faixa e a sala.
    await this.loop?.catch(() => undefined);
    await this.teardown();
  }

  private releasePaused(): void {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    this.paused = false;
    waiters.forEach((resolve) => resolve());
  }

  private wakeLoop(): void {
    const resolve = this.wakeLoopResolve;
    this.wakeLoopResolve = null;
    resolve?.();
  }

  private waitForNextItem(): Promise<void> {
    if (this.stopped || this.queue.length > 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.wakeLoopResolve = resolve;
    });
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.stopped && !this.skipRequested) {
      await new Promise<void>((resolve) => {
        this.resumeWaiters.push(resolve);
      });
    }
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      const item = this.queue[0];

      if (!item) {
        await this.waitForNextItem();
        continue;
      }

      await this.playItem(item);

      if (this.stopped) {
        return;
      }

      if (this.queue[0]?.id === item.id) {
        this.queue.shift();
      }
    }
  }

  private async playItem(item: MusicQueueItem): Promise<void> {
    this.current = item;
    this.status = "playing";
    this.skipRequested = false;
    this.paused = false;

    try {
      const stream = openPcmStream(item.url, this.config.binaries);
      this.activeStream = stream;

      const frames = await this.pump(stream.output);
      await stream.completion;

      if (frames === 0 && !this.skipRequested && !this.stopped) {
        throw new MediaError("Não consegui reproduzir o áudio desse link.");
      }

      if (!this.skipRequested && !this.stopped) {
        // O buffer nativo ainda pode ter áudio: espera tocar antes de liberar a próxima faixa.
        await this.source?.waitForPlayout();
      }
    } catch (error) {
      await this.reportFailure(item, error);
    } finally {
      this.activeStream?.stop();
      this.activeStream = null;
      this.source?.clearQueue();
      this.current = null;
      this.status = "idle";
      this.skipRequested = false;
      this.paused = false;
      this.resumeWaiters = [];
    }
  }

  /** Lê o PCM do ffmpeg em pedaços fixos de 20ms e alimenta a faixa do LiveKit. */
  private async pump(output: Readable): Promise<number> {
    const rtc = this.rtc;
    const source = this.source;

    if (!rtc || !source) {
      return 0;
    }

    let frames = 0;
    let pending: Uint8Array = new Uint8Array(0);

    for await (const chunk of output) {
      if (this.stopped || this.skipRequested) {
        break;
      }

      await this.waitWhilePaused();

      if (this.stopped || this.skipRequested) {
        break;
      }

      const incoming = chunk as Buffer;
      pending = pending.length === 0 ? incoming : Buffer.concat([pending, incoming]);

      let offset = 0;
      while (pending.length - offset >= FRAME_BYTES) {
        const samples = new Int16Array(FRAME_SAMPLES * PCM_CHANNELS);
        Buffer.from(samples.buffer).set(pending.subarray(offset, offset + FRAME_BYTES));
        offset += FRAME_BYTES;

        const frame: AudioFrameInstance = new rtc.AudioFrame(
          samples,
          PCM_SAMPLE_RATE,
          PCM_CHANNELS,
          FRAME_SAMPLES,
        );
        // captureFrame aplica a cadência real de reprodução (backpressure).
        await source.captureFrame(frame);
        frames += 1;

        if (this.stopped || this.skipRequested) {
          break;
        }
      }

      pending = offset === 0 ? pending : Buffer.from(pending.subarray(offset));
    }

    return frames;
  }

  private async reportFailure(item: MusicQueueItem, error: unknown): Promise<void> {
    if (this.stopped || this.skipRequested) {
      return;
    }

    const detail = error instanceof Error ? error.message : "erro inesperado";
    await this.notify(`Não consegui tocar "${item.title}": ${detail}`).catch(() => undefined);
  }

  private async checkIdle(): Promise<void> {
    if (this.stopped || !this.room) {
      return;
    }

    // Enquanto houver faixa tocando/pausada ou fila, o bot fica na call.
    if (this.hasWork()) {
      this.emptySince = null;
      return;
    }

    if (this.emptySince === null) {
      this.emptySince = Date.now();
      return;
    }

    if (Date.now() - this.emptySince < this.config.idleTimeoutMs) {
      return;
    }

    await this.notify("Saí do canal de voz porque a fila terminou.").catch(() => undefined);
    await this.stop();
  }

  private async teardown(): Promise<void> {
    const track = this.track;
    const room = this.room;

    this.track = null;
    this.room = null;
    this.source = null;
    this.rtc = null;

    try {
      await track?.close(true);
    } catch {
      // A faixa já pode ter sido encerrada pelo LiveKit.
    }

    try {
      await room?.disconnect();
    } catch {
      // A conexão já pode ter caído.
    }
  }
}
