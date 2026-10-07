import { NextRequest, NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseBuffer } from "music-metadata";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { createServerSound, listServerSounds } from "@/lib/store";

// Limites configuráveis via .env
const MAX_SOUND_FILE_SIZE = (Number(process.env.NEXT_PUBLIC_MAX_SOUND_FILE_SIZE_MB ?? "8")) * 1024 * 1024;
const MAX_SOUND_DURATION_SECONDS = Number(process.env.NEXT_PUBLIC_MAX_SOUND_DURATION_SECONDS ?? "10");

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100) || "som";

const validateAudioDuration = async (fileBuffer: Buffer, mimeType: string): Promise<number> => {
  let durationSeconds = 0;

  try {
    const metadata = await parseBuffer(fileBuffer, {
      mimeType: mimeType || undefined,
      size: fileBuffer.length,
    }, {
      duration: true,
    });
    durationSeconds = metadata.format.duration ?? 0;
  } catch {
    throw new Error("Não foi possível validar a duração do áudio.");
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Arquivo de áudio inválido.");
  }

  if (durationSeconds > MAX_SOUND_DURATION_SECONDS) {
    throw new Error("O áudio deve ter no máximo 10 segundos.");
  }

  return Number(durationSeconds.toFixed(2));
};

const saveSoundFile = async (file: File): Promise<{ url: string; mimeType: string; size: number; durationSeconds: number }> => {
  if (!file.type.startsWith("audio/")) {
    throw new Error("Envie um arquivo de áudio válido.");
  }
  if (file.size <= 0) {
    throw new Error("Arquivo de áudio vazio não é permitido.");
  }
  if (file.size > MAX_SOUND_FILE_SIZE) {
    throw new Error("Arquivo de áudio excede o limite de 8MB.");
  }

  const extension = path.extname(file.name) || ".audio";
  const baseName = path.basename(file.name, extension);
  const safeBaseName = sanitizeFileName(baseName);
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "soundboard");
  await mkdir(uploadsDir, { recursive: true });

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const durationSeconds = await validateAudioDuration(fileBuffer, file.type);

  const finalPath = path.join(uploadsDir, finalFileName);
  await writeFile(finalPath, fileBuffer);

  return {
    url: `/uploads/soundboard/${finalFileName}`,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    durationSeconds,
  };
};

const deleteSoundFileByUrl = async (fileUrl: string) => {
  if (!fileUrl.startsWith("/uploads/soundboard/")) {
    return;
  }

  const normalized = path.normalize(fileUrl.replace(/^\/+/, ""));
  if (!normalized.startsWith(path.normalize("uploads/soundboard"))) {
    return;
  }

  const fullPath = path.join(process.cwd(), "public", normalized);
  await unlink(fullPath).catch(() => undefined);
};

const saveSoundGifFile = async (file: File): Promise<string> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("O arquivo de GIF deve ser uma imagem.");
  }
  if (file.size <= 0) {
    throw new Error("Arquivo de GIF vazio não é permitido.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Arquivo de GIF excede o limite de 8MB.");
  }

  const extension = path.extname(file.name) || ".gif";
  const baseName = path.basename(file.name, extension);
  const safeBaseName = sanitizeFileName(baseName);
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "soundboard-gifs");
  await mkdir(uploadsDir, { recursive: true });

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const finalPath = path.join(uploadsDir, finalFileName);
  await writeFile(finalPath, fileBuffer);

  return `/uploads/soundboard-gifs/${finalFileName}`;
};

const deleteSoundGifFileByUrl = async (fileUrl: string) => {
  if (!fileUrl.startsWith("/uploads/soundboard-gifs/")) {
    return;
  }

  const normalized = path.normalize(fileUrl.replace(/^\/+/, ""));
  if (!normalized.startsWith(path.normalize("uploads/soundboard-gifs"))) {
    return;
  }

  const fullPath = path.join(process.cwd(), "public", normalized);
  await unlink(fullPath).catch(() => undefined);
};

type Params = {
  params: Promise<{ serverId: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      ensureSameAuthenticatedUser(authenticatedUserId, userId);
    }

    const sounds = await listServerSounds(serverId, authenticatedUserId);
    return NextResponse.json({ sounds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar sons." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  let savedUrl: string | null = null;
  let savedGifUrl: string | null = null;
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const formData = await request.formData();
    const actorId = z.string().min(2).parse(formData.get("actorId")?.toString());
    ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    const nameRaw = formData.get("name")?.toString().trim();
    const sound = formData.get("sound");
    const gif = formData.get("gif");

    if (!(sound instanceof File) || !sound.name) {
      return NextResponse.json({ error: "Arquivo de áudio é obrigatório." }, { status: 400 });
    }

    const saved = await saveSoundFile(sound);
    savedUrl = saved.url;

    let gifUrl: string | null = null;
    if (gif instanceof File && gif.name) {
      gifUrl = await saveSoundGifFile(gif);
      savedGifUrl = gifUrl;
    }

    const extension = path.extname(sound.name);
    const defaultName = path.basename(sound.name, extension);

    const created = await createServerSound(serverId, authenticatedUserId, {
      name: nameRaw || defaultName || "som",
      url: saved.url,
      mimeType: saved.mimeType,
      size: saved.size,
      durationSeconds: saved.durationSeconds,
      gifUrl,
    });

    return NextResponse.json({ sound: created }, { status: 201 });
  } catch (error) {
    if (savedUrl) {
      await deleteSoundFileByUrl(savedUrl);
    }
    if (savedGifUrl) {
      await deleteSoundGifFileByUrl(savedGifUrl);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao enviar áudio." },
      { status: getApiErrorStatus(error) },
    );
  }
}
