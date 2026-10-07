import { NextRequest, NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { createServerEmoji, listServerEmojis } from "@/lib/store";

// Limite configurável via .env (em MB)
const MAX_EMOJI_FILE_SIZE = (Number(process.env.NEXT_PUBLIC_MAX_EMOJI_FILE_SIZE_MB ?? "2")) * 1024 * 1024;
const ALLOWED_EMOJI_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100) || "emoji";

const saveEmojiFile = async (file: File): Promise<{ url: string; mimeType: string; size: number }> => {
  if (!ALLOWED_EMOJI_TYPES.has(file.type)) {
    throw new Error("Envie uma imagem PNG, JPG, WEBP ou GIF para emoji.");
  }
  if (file.size <= 0) {
    throw new Error("Arquivo de emoji vazio não é permitido.");
  }
  if (file.size > MAX_EMOJI_FILE_SIZE) {
    throw new Error("Arquivo de emoji excede o limite de 2MB.");
  }

  const extension = path.extname(file.name) || ".img";
  const baseName = path.basename(file.name, extension);
  const safeBaseName = sanitizeFileName(baseName);
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "emojis");
  await mkdir(uploadsDir, { recursive: true });

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const finalPath = path.join(uploadsDir, finalFileName);
  await writeFile(finalPath, fileBuffer);

  return {
    url: `/uploads/emojis/${finalFileName}`,
    mimeType: file.type,
    size: file.size,
  };
};

const deleteEmojiFileByUrl = async (fileUrl: string) => {
  if (!fileUrl.startsWith("/uploads/emojis/")) {
    return;
  }

  const normalized = path.normalize(fileUrl.replace(/^\/+/, ""));
  if (!normalized.startsWith(path.normalize("uploads/emojis"))) {
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

    const emojis = await listServerEmojis(serverId, authenticatedUserId);
    return NextResponse.json({ emojis });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar emojis." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  let savedUrl: string | null = null;
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const formData = await request.formData();
    const actorId = z.string().min(2).parse(formData.get("actorId")?.toString());
    ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    const nameRaw = formData.get("name")?.toString().trim();
    const emoji = formData.get("emoji");

    if (!(emoji instanceof File) || !emoji.name) {
      return NextResponse.json({ error: "Arquivo de emoji é obrigatório." }, { status: 400 });
    }

    const saved = await saveEmojiFile(emoji);
    savedUrl = saved.url;

    const extension = path.extname(emoji.name);
    const defaultName = path.basename(emoji.name, extension);

    const created = await createServerEmoji(serverId, authenticatedUserId, {
      name: nameRaw || defaultName || "emoji",
      url: saved.url,
      mimeType: saved.mimeType,
      size: saved.size,
    });

    return NextResponse.json({ emoji: created }, { status: 201 });
  } catch (error) {
    if (savedUrl) {
      await deleteEmojiFileByUrl(savedUrl);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao enviar emoji." },
      { status: getApiErrorStatus(error) },
    );
  }
}
