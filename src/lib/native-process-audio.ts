import { LocalAudioTrack, Track } from "livekit-client";

export type ProcessAudioTarget = {
  processId: number;
  includeTree: boolean;
  label: string;
};

export type ProcessAudioStatus = {
  supported: boolean;
  target: ProcessAudioTarget | null;
};

export type ProcessAudioBridge = {
  getStatus: () => Promise<ProcessAudioStatus>;
  start: () => Promise<ProcessAudioTarget>;
  stop: () => Promise<boolean>;
  onData: (callback: (pcm: Float32Array) => void) => void;
  removeDataListener: () => void;
};

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const JITTER_BUFFER_SECONDS = 0.12;
const REBUFFER_THRESHOLD_SECONDS = 0.02;

export const getProcessAudioBridge = (): ProcessAudioBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }
  // Read through a local view of the bridge so this module stays self-contained
  // and the web build never depends on the desktop type declarations.
  const api = (window as { electronAPI?: { processAudio?: ProcessAudioBridge } }).electronAPI;
  return api?.processAudio ?? null;
};

/**
 * Turns the PCM streamed by the native addon into a LiveKit audio track.
 * The addon already captures only the shared program (or the whole system minus
 * this app), so the other participants' voices are no longer part of the signal.
 */
export class ProcessAudioTrackPublisher {
  private audioContext: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private track: LocalAudioTrack | null = null;
  private bridge: ProcessAudioBridge | null = null;
  private nextStartTime = 0;

  async createTrack(bridge: ProcessAudioBridge): Promise<LocalAudioTrack> {
    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    await audioContext.resume().catch(() => undefined);

    const destination = audioContext.createMediaStreamDestination();
    destination.channelCount = CHANNELS;

    this.bridge = bridge;
    this.audioContext = audioContext;
    this.destination = destination;
    this.nextStartTime = 0;

    bridge.onData((pcm) => this.schedule(pcm));

    const sourceTrack = destination.stream.getAudioTracks()[0];
    if (!sourceTrack) {
      this.stop();
      throw new Error("Não foi possível preparar a faixa de áudio da transmissão.");
    }

    const track = new LocalAudioTrack(sourceTrack, undefined, false);
    track.source = Track.Source.ScreenShareAudio;
    this.track = track;
    return track;
  }

  // Chunks are scheduled ahead of time instead of being played on arrival, which
  // keeps the stream sample-accurate even when the renderer is busy.
  private schedule(pcm: Float32Array) {
    const audioContext = this.audioContext;
    const destination = this.destination;
    if (!audioContext || !destination || pcm.length < CHANNELS) {
      return;
    }

    const frameCount = Math.floor(pcm.length / CHANNELS);
    if (frameCount === 0) {
      return;
    }

    const buffer = audioContext.createBuffer(CHANNELS, frameCount, SAMPLE_RATE);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let index = 0; index < frameCount; index += 1) {
      left[index] = pcm[index * CHANNELS];
      right[index] = pcm[index * CHANNELS + 1];
    }

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);

    const now = audioContext.currentTime;
    if (this.nextStartTime < now + REBUFFER_THRESHOLD_SECONDS) {
      this.nextStartTime = now + JITTER_BUFFER_SECONDS;
    }
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  stop() {
    this.bridge?.removeDataListener();
    this.bridge = null;

    if (this.track) {
      this.track.stop();
      this.track = null;
    }

    const audioContext = this.audioContext;
    this.audioContext = null;
    this.destination = null;
    this.nextStartTime = 0;
    void audioContext?.close().catch(() => undefined);
  }
}
