import { NextRequest, NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { createServerSticker, listServerStickers } from "@/lib/store";

// Limite configurável via .env (em MB)
const MAX_STICKER_FILE_SIZE = (Number(process.env.NEXT_PUBLIC_MAX_STICKER_FILE_SIZE_MB ?? "8")) * 1024 * 1024;
const ALLOWED_STICKER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100) || "sticker";

const saveStickerFile = async (file: File): Promise<{ url: string; mimeType: string; size: number }> => {
  if (!ALLOWED_STICKER_TYPES.has(file.type)) {
    throw new Error("Envie uma imagem PNG, JPG, WEBP ou GIF para figurinha.");
  }
  if (file.size <= 0) {
    throw new Error("Arquivo de figurinha vazio não é permitido.");
  }
  if (file.size > MAX_STICKER_FILE_SIZE) {
    throw new Error("Arquivo de figurinha excede o limite de 8MB.");
  }

  const extension = path.extname(file.name) || ".img";
  const baseName = path.basename(file.name, extension);
  const safeBaseName = sanitizeFileName(baseName);
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "stickers");
  await mkdir(uploadsDir, { recursive: true });

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const finalPath = path.join(uploadsDir, finalFileName);
  await writeFile(finalPath, fileBuffer);

  return {
    url: `/uploads/stickers/${finalFileName}`,
    mimeType: file.type,
    size: file.size,
  };
};

const deleteStickerFileByUrl = async (fileUrl: string) => {
  if (!fileUrl.startsWith("/uploads/stickers/")) {
    return;
  }

  const normalized = path.normalize(fileUrl.replace(/^\/+/, ""));
  if (!normalized.startsWith(path.normalize("uploads/stickers"))) {
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

    const stickers = await listServerStickers(serverId, authenticatedUserId);
    return NextResponse.json({ stickers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar figurinhas." },
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
    const sticker = formData.get("sticker");

    if (!(sticker instanceof File) || !sticker.name) {
      return NextResponse.json({ error: "Arquivo de figurinha é obrigatório." }, { status: 400 });
    }

    const saved = await saveStickerFile(sticker);
    savedUrl = saved.url;

    const extension = path.extname(sticker.name);
    const defaultName = path.basename(sticker.name, extension);

    const created = await createServerSticker(serverId, authenticatedUserId, {
      name: nameRaw || defaultName || "figurinha",
      url: saved.url,
      mimeType: saved.mimeType,
      size: saved.size,
    });

    return NextResponse.json({ sticker: created }, { status: 201 });
  } catch (error) {
    if (savedUrl) {
      await deleteStickerFileByUrl(savedUrl);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao enviar figurinha." },
      { status: getApiErrorStatus(error) },
    );
  }
}
