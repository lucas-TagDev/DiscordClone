"use client";

import { useEffect, useState } from "react";
import type { LinkPreviewData } from "@/app/api/link-preview/route";

const YOUTUBE_URL_PATTERN = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)[\w-]{11}/i;

const previewCache = new Map<string, LinkPreviewData | null>();

export const extractVideoPreviewUrls = (text: string): string[] => {
  const urls: string[] = [];
  const matches = text.match(/https?:\/\/[^\s]+/gi) ?? [];
  matches.forEach((raw) => {
    const cleaned = raw.replace(/[),.;!?]+$/g, "");
    if (YOUTUBE_URL_PATTERN.test(cleaned)) {
      if (!urls.includes(cleaned)) {
        urls.push(cleaned);
      }
    }
  });
  return urls;
};

const fetchPreview = async (url: string): Promise<LinkPreviewData | null> => {
  if (previewCache.has(url)) {
    return previewCache.get(url) ?? null;
  }

  try {
    const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { cache: "no-store" });
    if (!response.ok) {
      previewCache.set(url, null);
      return null;
    }
    const data = (await response.json()) as LinkPreviewData;
    previewCache.set(url, data);
    return data;
  } catch {
    previewCache.set(url, null);
    return null;
  }
};

export function LinkPreview({ text }: { text: string }) {
  const [previews, setPreviews] = useState<LinkPreviewData[]>([]);

  useEffect(() => {
    let cancelled = false;
    const urls = extractVideoPreviewUrls(text);

    if (urls.length === 0) {
      setPreviews([]);
      return;
    }

    void (async () => {
      const results = await Promise.all(urls.map((url) => fetchPreview(url)));
      if (!cancelled) {
        setPreviews(results.filter((preview): preview is LinkPreviewData => preview !== null));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text]);

  if (previews.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2">
      {previews.map((preview) => (
        <a
          key={preview.url}
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block max-w-xl overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900/80 hover:border-zinc-500 transition-colors"
        >
          <div className="flex">
            {preview.thumbnailUrl && (
              <div className="relative w-44 shrink-0 bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.thumbnailUrl}
                  alt={preview.title ?? "Vídeo"}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              </div>
            )}
            <div className="min-w-0 flex-1 p-3">
              {preview.providerName && (
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  {preview.providerName}
                </p>
              )}
              {preview.title && (
                <p className="mt-0.5 line-clamp-2 text-sm font-medium text-zinc-100">
                  {preview.title}
                </p>
              )}
              {preview.authorName && (
                <p className="mt-1 truncate text-xs text-zinc-400">{preview.authorName}</p>
              )}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
