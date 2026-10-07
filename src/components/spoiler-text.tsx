"use client";

import { useState } from "react";

export function SpoilerText({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) {
    return <span className="rounded bg-zinc-800 px-1 break-all [overflow-wrap:anywhere]">{text}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      title="Spoiler — clique para revelar"
      className="rounded bg-zinc-700 px-1 text-transparent select-none transition-colors hover:bg-zinc-600 cursor-pointer"
      aria-label="Spoiler — clique para revelar"
    >
      {text}
    </button>
  );
}
