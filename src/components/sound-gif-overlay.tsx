"use client";

type SoundGifOverlayProps = {
  gifUrl: string;
  soundName: string;
  senderName: string;
  visible: boolean;
  id: number;
};

// Overlay central estilo "alerta de donate" da Twitch:
// a imagem/GIF sobe com animação de entrada e faz fade out quando o áudio termina.
export function SoundGifOverlay({ gifUrl, soundName, senderName, visible }: SoundGifOverlayProps) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center"
      aria-hidden="true"
    >
      <div
        className={`flex flex-col items-center gap-3 transition-all duration-500 ease-out ${
          visible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-10 scale-90 opacity-0"
        }`}
      >
        <div className="overflow-hidden rounded-2xl border-2 border-indigo-400/70 bg-zinc-950/80 shadow-2xl shadow-indigo-500/30 backdrop-blur-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gifUrl}
            alt={soundName}
            className="max-h-64 w-auto object-contain sm:max-h-80"
          />
        </div>
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/90 px-4 py-2 text-center shadow-xl backdrop-blur-sm">
          <p className="text-sm font-bold text-indigo-300">{senderName}</p>
          <p className="text-xs text-zinc-300">🔊 {soundName}</p>
        </div>
      </div>
    </div>
  );
}
