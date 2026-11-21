/**
 * Leitura de links do Spotify para o bot de música.
 *
 * Método principal (inspirado no projeto HARMONI): a página pública de embed
 * (`open.spotify.com/embed/<tipo>/<id>`) traz no `__NEXT_DATA__` o nome, os artistas e a
 * duração de faixas, álbuns e playlists públicas — sem login, sem app de desenvolvedor e
 * sem Premium. O áudio em si continua vindo do YouTube (o Spotify não libera stream).
 *
 * Planos B para faixas: Web API (se SPOTIFY_CLIENT_ID/SECRET estiverem no .env) e oEmbed.
 */

export type SpotifyTrack = {
  name: string;
  artists: string[];
  durationSeconds: number | null;
  url: string;
  /** De onde vieram os dados: embed público, Web API ou oEmbed (só o nome). */
  source: "embed" | "api" | "oembed";
};

export type SpotifyLinkKind = "track" | "album" | "playlist";

export type SpotifyLink = { kind: SpotifyLinkKind; id: string; url: string };

export type SpotifyCollection = {
  kind: SpotifyLinkKind;
  name: string;
  tracks: SpotifyTrack[];
};

export class SpotifyError extends Error {}

// Erro que vale tentar contornar por outro método (acesso negado, limite, credenciais ausentes...)
class SpotifyApiUnavailableError extends Error {}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const NEXT_DATA = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
const LINK_PATH = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist)\/([a-zA-Z0-9]{22})\/?$/i;
const SHORT_LINK_HOSTS = new Set(["spotify.link", "spotify.app.link"]);

const isSpotifyHost = (hostname: string) =>
  hostname === "open.spotify.com" || SHORT_LINK_HOSTS.has(hostname);

const readSpotifyPath = (url: URL): SpotifyLink | null => {
  if (url.hostname !== "open.spotify.com") return null;
  const match = url.pathname.match(LINK_PATH);
  if (!match) return null;
  const kind = match[1].toLowerCase() as SpotifyLinkKind;
  return { kind, id: match[2], url: `https://open.spotify.com/${kind}/${match[2]}` };
};

const UNSUPPORTED_LINK = "Envie o link de uma música, álbum ou playlist do Spotify (ex.: https://open.spotify.com/track/ID). Artistas, podcasts e episódios não são suportados.";

/** true quando o link é do Spotify (mesmo que ainda não suportado). */
export const isSpotifyUrl = (value: string): boolean => {
  try {
    return isSpotifyHost(new URL(value).hostname);
  } catch {
    return false;
  }
};

/**
 * Converte o link em { tipo, id }. Links encurtados (spotify.link) são seguidos até o
 * endereço final. Devolve null para links que não são do Spotify.
 */
export const parseSpotifyLink = async (value: string): Promise<SpotifyLink | null> => {
  const url = new URL(value);
  if (!isSpotifyHost(url.hostname)) return null;

  if (SHORT_LINK_HOSTS.has(url.hostname)) {
    const response = await fetch(url, {
      redirect: "follow", headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000), cache: "no-store",
    }).catch(() => null);
    await response?.body?.cancel().catch(() => {});
    const finalUrl = response?.url ? new URL(response.url) : null;
    const resolved = finalUrl ? readSpotifyPath(finalUrl) : null;
    if (!resolved) throw new SpotifyError(UNSUPPORTED_LINK);
    return resolved;
  }

  const link = readSpotifyPath(url);
  if (!link) throw new SpotifyError(UNSUPPORTED_LINK);
  return link;
};

/* ------------------------------------------------------------------ */
/* Embed público (método principal)                                    */
/* ------------------------------------------------------------------ */

type EmbedArtist = { name?: unknown };
type EmbedTrackItem = {
  uri?: unknown; title?: unknown; name?: unknown; subtitle?: unknown;
  artists?: EmbedArtist[]; duration?: unknown; isPlayable?: unknown;
};
type EmbedEntity = EmbedTrackItem & { type?: unknown; trackList?: EmbedTrackItem[] };

const msToSeconds = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value / 1000) : null;

/** O embed separa artistas com vírgula + espaço não separável. */
const splitArtists = (subtitle: unknown): string[] =>
  typeof subtitle === "string"
    ? subtitle.replace(/ /g, " ").split(",").map((name) => name.trim()).filter(Boolean)
    : [];

const readEmbedTrack = (item: EmbedTrackItem, fallbackUrl: string | null): SpotifyTrack | null => {
  const rawName = typeof item.title === "string" ? item.title : typeof item.name === "string" ? item.name : "";
  const name = rawName.trim();
  const artists = Array.isArray(item.artists)
    ? item.artists.flatMap((artist) => typeof artist?.name === "string" && artist.name.trim() ? [artist.name.trim()] : [])
    : [];
  const allArtists = artists.length ? artists : splitArtists(item.subtitle);
  if (!name || !allArtists.length || item.isPlayable === false) return null;
  const uri = typeof item.uri === "string" ? item.uri : "";
  const trackId = uri.startsWith("spotify:track:") ? uri.slice("spotify:track:".length) : null;
  return {
    name, artists: allArtists, durationSeconds: msToSeconds(item.duration), source: "embed",
    url: trackId ? `https://open.spotify.com/track/${trackId}` : fallbackUrl ?? "",
  };
};

const readSpotifyEmbed = async (link: SpotifyLink): Promise<SpotifyCollection> => {
  let html: string;
  try {
    const response = await fetch(`https://open.spotify.com/embed/${link.kind}/${link.id}`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    if (response.status === 404) throw new SpotifyError("Não encontrei esse conteúdo no Spotify. Confira se o link está certo e é público.");
    if (!response.ok) throw new SpotifyApiUnavailableError(`embed respondeu ${response.status}`);
    html = await response.text();
  } catch (error) {
    if (error instanceof SpotifyError || error instanceof SpotifyApiUnavailableError) throw error;
    throw new SpotifyApiUnavailableError(`não consegui acessar o embed (${(error as Error).message})`);
  }

  let entity: EmbedEntity | undefined;
  try {
    const match = html.match(NEXT_DATA);
    entity = match ? JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity : undefined;
  } catch {
    entity = undefined;
  }
  if (!entity || typeof entity !== "object") {
    throw new SpotifyApiUnavailableError("o embed não trouxe os dados da página");
  }

  const name = (typeof entity.name === "string" && entity.name.trim())
    || (typeof entity.title === "string" && entity.title.trim()) || "Spotify";

  const items = link.kind === "track" ? [entity] : Array.isArray(entity.trackList) ? entity.trackList : [];
  const tracks = items.flatMap((item) => {
    const track = item ? readEmbedTrack(item, link.kind === "track" ? link.url : null) : null;
    return track?.url ? [track] : [];
  });
  return { kind: link.kind, name, tracks };
};

/* ------------------------------------------------------------------ */
/* Planos B para faixa única: Web API e oEmbed                         */
/* ------------------------------------------------------------------ */

/** Só o nome da faixa (sem artista nem duração), sem login. */
const readSpotifyTrackFromOEmbed = async (canonical: string): Promise<SpotifyTrack> => {
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`, {
    signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  if (response.status === 404) throw new SpotifyError("Esta música não foi encontrada no Spotify.");
  if (!response.ok) throw new SpotifyError("Não foi possível consultar a música no Spotify.");
  const data = await response.json() as { title?: unknown };
  if (typeof data.title !== "string" || !data.title.trim()) {
    throw new SpotifyError("Não foi possível identificar o nome desta música no Spotify.");
  }
  return { name: data.title.trim(), artists: [], durationSeconds: null, url: canonical, source: "oembed" };
};

let cachedToken: { value: string; expiresAt: number; credentials: string } | null = null;

const getToken = async (): Promise<string> => {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new SpotifyApiUnavailableError("SPOTIFY_CLIENT_ID/SECRET não configurados");
  const credentials = Buffer.from(`${id}:${secret}`).toString("base64");
  if (cachedToken?.credentials === credentials && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials", signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn(`[music-bot] Spotify recusou o token (${response.status}): ${detail.slice(0, 300)}`);
    throw new SpotifyApiUnavailableError("token recusado");
  }
  const data = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token) throw new SpotifyApiUnavailableError("token inválido");
  const ttl = typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : 3600;
  cachedToken = { value: data.access_token, credentials, expiresAt: Date.now() + Math.max(0, ttl - 60) * 1000 };
  return data.access_token;
};

const readSpotifyTrackFromApi = async (link: SpotifyLink): Promise<SpotifyTrack> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`https://api.spotify.com/v1/tracks/${link.id}`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
      signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    if (response.status === 401 && attempt === 0) { cachedToken = null; continue; }
    if (response.status === 404) throw new SpotifyError("Esta música não foi encontrada no Spotify.");
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(`[music-bot] Spotify Web API respondeu ${response.status}: ${detail.slice(0, 300)}`);
      cachedToken = null;
      throw new SpotifyApiUnavailableError(`Web API respondeu ${response.status}`);
    }
    const data = await response.json() as { name?: unknown; artists?: { name?: unknown }[]; duration_ms?: unknown };
    const artists = Array.isArray(data.artists)
      ? data.artists.flatMap((artist) => typeof artist?.name === "string" && artist.name.trim() ? [artist.name.trim()] : [])
      : [];
    if (typeof data.name !== "string" || !data.name.trim() || !artists.length) {
      throw new SpotifyApiUnavailableError("Web API sem nome/artista");
    }
    return { name: data.name.trim(), artists, url: link.url, source: "api", durationSeconds: msToSeconds(data.duration_ms) };
  }
  throw new SpotifyApiUnavailableError("não foi possível renovar o token");
};

/* ------------------------------------------------------------------ */
/* API pública do módulo                                               */
/* ------------------------------------------------------------------ */

/**
 * Lê uma faixa, álbum ou playlist pública. Para faixa única tenta embed → Web API → oEmbed.
 * O embed de playlists lista no máximo ~100 faixas.
 */
export const readSpotifyLink = async (link: SpotifyLink): Promise<SpotifyCollection> => {
  try {
    const collection = await readSpotifyEmbed(link);
    if (collection.tracks.length) return collection;
    if (link.kind !== "track") {
      throw new SpotifyError(`${link.kind === "album" ? "Esse álbum" : "Essa playlist"} não tem faixas disponíveis (ou não é pública).`);
    }
    console.warn("[music-bot] Embed do Spotify não trouxe a faixa. Tentando outros métodos.");
  } catch (error) {
    if (!(error instanceof SpotifyApiUnavailableError)) throw error;
    console.warn(`[music-bot] Embed do Spotify indisponível (${error.message}).`);
    if (link.kind !== "track") {
      throw new SpotifyError("Não consegui ler esse link do Spotify agora. Tente de novo em instantes.");
    }
  }

  try {
    const track = await readSpotifyTrackFromApi(link);
    return { kind: "track", name: track.name, tracks: [track] };
  } catch (error) {
    if (!(error instanceof SpotifyApiUnavailableError)) throw error;
  }
  const track = await readSpotifyTrackFromOEmbed(link.url);
  return { kind: "track", name: track.name, tracks: [track] };
};
