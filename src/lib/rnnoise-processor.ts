"use client";

// O @sapphi-red/web-noise-suppressor referencia AudioWorkletNode no nível do módulo,
// que não existe no SSR/Node. Por isso usamos import DINÂMICO dentro das funções,
// garantindo que o módulo só seja avaliado no navegador, em runtime.

type RnnoiseModule = typeof import("@sapphi-red/web-noise-suppressor");

let audioContextPromise: Promise<AudioContext> | null = null;
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;
let workletReadyPromise: Promise<void> | null = null;

const getAudioContext = (): Promise<AudioContext> => {
  if (!audioContextPromise) {
    audioContextPromise = (async () => {
      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume().catch(() => undefined);
      return ctx;
    })();
  }
  return audioContextPromise;
};

const getRnnNoiseModule = (): Promise<RnnoiseModule> => {
  return import("@sapphi-red/web-noise-suppressor");
};

const getWasmBinary = async (): Promise<ArrayBuffer> => {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = (async () => {
      const { loadRnnoise } = await getRnnNoiseModule();
      return loadRnnoise({
        url: "/wasm/rnnoise.wasm",
        simdUrl: "/wasm/rnnoise_simd.wasm",
      });
    })();
  }
  return wasmBinaryPromise;
};

const getWorkletReady = async (): Promise<void> => {
  if (!workletReadyPromise) {
    workletReadyPromise = (async () => {
      const ctx = await getAudioContext();
      await Promise.all([
        ctx.audioWorklet.addModule("/wasm/rnnoiseWorklet.js"),
        ctx.audioWorklet.addModule("/wasm/noiseGateWorklet.js"),
      ]);
    })();
  }
  return workletReadyPromise;
};

export type RnnNoiseAttachment = {
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  gainNode: GainNode;
  rnnoiseNode: AudioWorkletNode & { destroy(): void };
  noiseGateNode: AudioWorkletNode;
  destination: MediaStreamAudioDestinationNode;
  originalTrack: MediaStreamTrack;
};

/** Ajusta o ganho do microfone no pipeline (micGain 0-300, 100 = normal). */
export const setRnnNoiseGain = (attachment: RnnNoiseAttachment, micGain: number): void => {
  const gain = Math.max(0, Math.min(300, micGain)) / 100;
  attachment.gainNode.gain.setTargetAtTime(gain, attachment.ctx.currentTime, 0.05);
};

/**
 * Cria o pipeline de supressão de ruído para um MediaStreamTrack.
 *
 * Pipeline: microfone -> GANHO -> RNNoise (remove ruído contínuo) -> Noise Gate (corta cliques/ruídos baixos)
 */
export const attachRnnNoise = async (
  mediaStreamTrack: MediaStreamTrack,
  initialGain: number = 100,
): Promise<RnnNoiseAttachment> => {
  const ctx = await getAudioContext();
  const [wasmBinary] = await Promise.all([getWasmBinary(), getWorkletReady()]);
  const { RnnoiseWorkletNode, NoiseGateWorkletNode } = await getRnnNoiseModule();

  const rnnoiseNode = new RnnoiseWorkletNode(ctx, {
    wasmBinary,
    maxChannels: 2,
  });

  const noiseGateNode = new NoiseGateWorkletNode(ctx, {
    openThreshold: -45,
    closeThreshold: -55,
    holdMs: 90,
    maxChannels: 2,
  });

  const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
  const gainNode = ctx.createGain();
  gainNode.gain.value = Math.max(0, Math.min(300, initialGain)) / 100;
  const destination = ctx.createMediaStreamDestination();

  source.connect(gainNode);
  gainNode.connect(rnnoiseNode);
  rnnoiseNode.connect(noiseGateNode);
  noiseGateNode.connect(destination);

  return {
    ctx,
    source,
    gainNode,
    rnnoiseNode,
    noiseGateNode,
    destination,
    originalTrack: mediaStreamTrack,
  };
};

/**
 * Remove o pipeline de supressão de ruído e libera os recursos.
 */
export const detachRnnNoise = (attachment: RnnNoiseAttachment): void => {
  try {
    attachment.source.disconnect();
  } catch {
    // ignore
  }
  try {
    attachment.gainNode.disconnect();
  } catch {
    // ignore
  }
  try {
    attachment.rnnoiseNode.disconnect();
    attachment.rnnoiseNode.destroy();
  } catch {
    // ignore
  }
  try {
    attachment.noiseGateNode.disconnect();
  } catch {
    // ignore
  }
  try {
    attachment.destination.disconnect();
  } catch {
    // ignore
  }
};

/**
 * Aplica (ou remove) a supressão de ruído em um LocalAudioTrack do LiveKit.
 */
export const applyRnnNoiseToLiveKitTrack = async (
  micTrack: { mediaStreamTrack: MediaStreamTrack; replaceTrack(track: MediaStreamTrack): Promise<void> },
  enabled: boolean,
  attachmentRef: { current: RnnNoiseAttachment | null },
  micGain: number = 100,
): Promise<void> => {
  const current = attachmentRef.current;

  if (!enabled) {
    if (current) {
      await micTrack.replaceTrack(current.originalTrack).catch(() => undefined);
      detachRnnNoise(current);
      attachmentRef.current = null;
    }
    return;
  }

  if (current) {
    // já está ativo - apenas atualiza o ganho
    setRnnNoiseGain(current, micGain);
    return;
  }

  const attachment = await attachRnnNoise(micTrack.mediaStreamTrack, micGain);
  const processedTrack = attachment.destination.stream.getAudioTracks()[0];
  if (!processedTrack) {
    detachRnnNoise(attachment);
    throw new Error("Não foi possível obter o track de áudio processado.");
  }

  await micTrack.replaceTrack(processedTrack);
  attachmentRef.current = attachment;
};
