type SpotifyTrack = {
  name: string;
  artists: string[];
  durationSeconds: number | null;
  url: string;
  /** "api" = Web API do Spotify (nome, artistas, duração); "oembed" = só o nome, via endpoint público */
  source: "api" | "oembed";
};

// Erro que vale tentar contornar pelo oEmbed (acesso negado, limite, credenciais ausentes...)
class SpotifyApiUnavailableError extends Error {}

/**
 * Plano B sem login: o endpoint público oEmbed do Spotify devolve o nome da faixa
 * (sem artista nem duração). Funciona mesmo quando a Web API responde 403.
 */
const readSpotifyTrackFromOEmbed = async (canonical: string): Promise<SpotifyTrack> => {
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`, {
    signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  if (response.status === 404) throw new Error("Esta música não foi encontrada no Spotify.");
  if (!response.ok) throw new Error("Não foi possível consultar a música no Spotify.");
  const data = await response.json() as { title?: unknown };
  if (typeof data.title !== "string" || !data.title.trim()) {
    throw new Error("Não foi possível identificar o nome desta música no Spotify.");
  }
  return { name: data.title.trim(), artists: [], durationSeconds: null, url: canonical, source: "oembed" };
};

let cachedToken: { value: string; expiresAt: number; credentials: string } | null = null;

export const spotifyTrackUrl = (value: string): string | null => {
  const url = new URL(value);
  if (url.hostname !== "open.spotify.com" && url.hostname !== "spotify.link") return null;
  const match = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([a-zA-Z0-9]{22})\/?$/i);
  if (url.hostname !== "open.spotify.com" || !match) {
    throw new Error("Envie o link completo de uma música do Spotify: https://open.spotify.com/track/ID. Álbuns, playlists e links encurtados ainda não são suportados.");
  }
  return `https://open.spotify.com/track/${match[1]}`;
};

const getToken = async (): Promise<string> => {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    throw new SpotifyApiUnavailableError("Para aceitar links do Spotify, configure SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET no .env do servidor. O áudio será encontrado no YouTube.");
  }
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
    throw new SpotifyApiUnavailableError("Não foi possível autenticar no Spotify. Verifique as credenciais do aplicativo no servidor.");
  }
  const data = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token) throw new Error("O Spotify não retornou um token válido.");
  const ttl = typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : 3600;
  cachedToken = { value: data.access_token, credentials, expiresAt: Date.now() + Math.max(0, ttl - 60) * 1000 };
  return data.access_token;
};

export const readSpotifyTrack = async (url: string): Promise<SpotifyTrack> => {
  const canonical = spotifyTrackUrl(url);
  if (!canonical) throw new Error("Link do Spotify inválido.");
  try {
    return await readSpotifyTrackFromApi(canonical);
  } catch (error) {
    if (!(error instanceof SpotifyApiUnavailableError)) throw error;
    console.warn(`[music-bot] Web API do Spotify indisponível (${error.message}). Usando oEmbed público.`);
    return readSpotifyTrackFromOEmbed(canonical);
  }
};

const readSpotifyTrackFromApi = async (canonical: string): Promise<SpotifyTrack> => {
  const id = canonical.split("/").pop();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
      signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    if (response.status === 401 && attempt === 0) { cachedToken = null; continue; }
    if (response.status === 429) throw new SpotifyApiUnavailableError("O Spotify atingiu o limite de consultas.");
    if (response.status === 403) {
      // O corpo costuma dizer o motivo exato (ex.: Premium exigido para o dono do app)
      const detail = await response.text().catch(() => "");
      console.warn(`[music-bot] Spotify Web API respondeu 403: ${detail.slice(0, 300)}`);
      // Pede um token novo na próxima vez (ex.: depois que o Premium for ativado)
      cachedToken = null;
      throw new SpotifyApiUnavailableError("O Spotify negou acesso ao aplicativo.");
    }
    if (response.status === 404) throw new Error("Esta música não foi encontrada no Spotify.");
    if (!response.ok) throw new Error("Não foi possível consultar a música no Spotify.");
    const data = await response.json() as { name?: unknown; artists?: { name?: unknown }[]; duration_ms?: unknown };
    const artists = Array.isArray(data.artists)
      ? data.artists.flatMap((artist) => typeof artist?.name === "string" && artist.name.trim() ? [artist.name.trim()] : [])
      : [];
    if (typeof data.name !== "string" || !data.name.trim() || !artists.length) {
      throw new Error("Não foi possível identificar o nome e o artista desta música no Spotify.");
    }
    return {
      name: data.name.trim(), artists, url: canonical, source: "api",
      durationSeconds: typeof data.duration_ms === "number" && Number.isFinite(data.duration_ms) && data.duration_ms > 0
        ? Math.round(data.duration_ms / 1000) : null,
    };
  }
  throw new SpotifyApiUnavailableError("Não foi possível renovar a autenticação do Spotify.");
};
