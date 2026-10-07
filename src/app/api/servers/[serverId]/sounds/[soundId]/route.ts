import { NextRequest, NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { deleteServerSound, updateServerSoundGif } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string; soundId: string }>;
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
  const safeBaseName = baseName
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100) || "gif";
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "soundboard-gifs");
  await mkdir(uploadsDir, { recursive: true });

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const finalPath = path.join(uploadsDir, finalFileName);
  await writeFile(finalPath, fileBuffer);

  return `/uploads/soundboard-gifs/${finalFileName}`;
};

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId, soundId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    const result = await deleteServerSound(serverId, soundId, authenticatedUserId);
    await deleteSoundFileByUrl(result.deletedUrl);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao remover áudio." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { serverId, soundId } = await params;

  let savedGifUrl: string | null = null;
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const actorId = z.string().min(2).parse(formData.get("actorId")?.toString());
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);

      const action = formData.get("action")?.toString();
      const gif = formData.get("gif");

      if (action === "remove-gif") {
        const updated = await updateServerSoundGif(serverId, soundId, authenticatedUserId, null);
        return NextResponse.json({ sound: updated });
      }

      if (gif instanceof File && gif.name) {
        const gifUrl = await saveSoundGifFile(gif);
        savedGifUrl = gifUrl;
        const updated = await updateServerSoundGif(serverId, soundId, authenticatedUserId, gifUrl);
        return NextResponse.json({ sound: updated });
      }

      return NextResponse.json({ error: "Nenhum GIF enviado para atualizar." }, { status: 400 });
    }

    return NextResponse.json({ error: "Formato inválido. Envie o GIF via multipart/form-data." }, { status: 400 });
  } catch (error) {
    if (savedGifUrl) {
      await deleteSoundGifFileByUrl(savedGifUrl);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar o GIF do áudio." },
      { status: getApiErrorStatus(error) },
    );
  }
}
