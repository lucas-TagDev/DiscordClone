"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Medidor de nível do microfone (VU meter) em tempo real.
 * Usa AnalyserNode do Web Audio API para mostrar o nível de volume.
 */
export function MicLevelMeter({ active }: { active: boolean }) {
  const [level, setLevel] = useState(0); // 0-100
  const [hasPermission, setHasPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;

    const setup = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setHasPermission(true);
        setError(null);

        const AudioContextClass =
          window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const context = new AudioContextClass();
        contextRef.current = context;

        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (cancelled) {
            return;
          }
          analyser.getByteTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i += 1) {
            const sample = (dataArray[i] - 128) / 128;
            sum += sample * sample;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          // Escala logarítmica aproximada para parecer mais natural
          const displayLevel = Math.max(0, Math.min(100, Math.round(rms * 260)));
          setLevel(displayLevel);
          rafRef.current = window.requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        if (!cancelled) {
          setHasPermission(false);
          setError(err instanceof Error ? err.message : "Sem acesso ao microfone");
        }
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (contextRef.current) {
        void contextRef.current.close().catch(() => undefined);
        contextRef.current = null;
      }
      setLevel(0);
    };
  }, [active]);

  if (!active) {
    return null;
  }

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] text-zinc-400">Nível do microfone:</p>
        <span className="text-[11px] font-medium text-zinc-200">{level}%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded bg-zinc-800">
        <div
          className={`h-full rounded transition-[width] duration-75 ${
            level > 80 ? "bg-red-500" : level > 50 ? "bg-emerald-400" : "bg-emerald-600"
          }`}
          style={{ width: `${Math.max(2, level)}%` }}
        />
      </div>
      {!hasPermission && (
        <p className="mt-1 text-[10px] text-amber-400">
          {error ? "Permita o acesso ao microfone para medir." : "Solicitando acesso ao microfone..."}
        </p>
      )}
      <p className="mt-1 text-[10px] text-zinc-500">
        Fale para ver o nível. Ajuste o ganho para ficar no meio (verde), sem estourar (vermelho).
      </p>
    </div>
  );
}
