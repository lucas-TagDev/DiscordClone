"use client";

/**
 * Supressão de ruído via DeepFilterNet3 usando o pacote oficial
 * `deepfilternet3-noise-filter` (integração pronta com LiveKit).
 *
 * O pacote baixa o WASM + modelo automaticamente de uma CDN
 * (https://cdn.mezon.ai/...), então NÃO precisa de binários manuais no servidor.
 *
 * Usa import dinâmico para não quebrar o SSR/prerender do Next.js.
 */

export const createDeepFilterProcessor = async () => {
  const mod = await import("deepfilternet3-noise-filter");
  const { DeepFilterNoiseFilterProcessor } = mod;

  return new DeepFilterNoiseFilterProcessor({
    sampleRate: 48000,
    noiseReductionLevel: 80,
    enabled: true,
  });
};
