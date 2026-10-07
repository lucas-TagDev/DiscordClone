import { NextRequest, NextResponse } from "next/server";

export type LinkPreviewData = {
  url: string;
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  providerName: string | null;
};

const YOUTUBE_VIDEO_ID_PATTERN = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i;

const extractYouTubeVideoId = (url: string): string | null => {
  const match = url.match(YOUTUBE_VIDEO_ID_PATTERN);
  return match ? match[1] : null;
};

const isProbablyYoutubeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
};

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "URL ausente." }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "URL inválida." }, { status: 400 });
  }

  if (!isProbablyYoutubeUrl(parsedUrl.toString()) && parsedUrl.protocol !== "https:") {
    return NextResponse.json({ error: "Apenas links HTTPS são suportados." }, { status: 400 });
  }

  const videoId = extractYouTubeVideoId(parsedUrl.toString());
  if (!videoId) {
    return NextResponse.json({ error: "Apenas links do YouTube são suportados." }, { status: 400 });
  }

  try {
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const response = await fetch(oEmbedUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TwinSLKItLinkPreview/1.0)",
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Falha ao buscar preview do vídeo." }, { status: 502 });
    }

    const data = (await response.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
      provider_name?: string;
    };

    return NextResponse.json({
      url: canonicalUrl,
      title: data.title ?? null,
      authorName: data.author_name ?? null,
      thumbnailUrl: data.thumbnail_url ?? null,
      providerName: data.provider_name ?? "YouTube",
    } satisfies LinkPreviewData);
  } catch {
    return NextResponse.json({ error: "Falha ao buscar preview do vídeo." }, { status: 502 });
  }
}
