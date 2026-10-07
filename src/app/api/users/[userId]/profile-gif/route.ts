import { NextRequest, NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { updateUserProfileCardGif } from "@/lib/store";

// Limite configurável via .env (em MB)
const MAX_PROFILE_GIF_SIZE = (Number(process.env.NEXT_PUBLIC_MAX_PROFILE_GIF_SIZE_MB ?? "15")) * 1024 * 1024;

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100) || "profile-gif";

const saveProfileGifFile = async (file: File): Promise<string> => {
  if (file.type !== "image/gif") {
    throw new Error("Envie um arquivo GIF válido (.gif).");
  }

  if (file.size <= 0) {
    throw new Error("Arquivo GIF vazio não é permitido.");
  }

  if (file.size > MAX_PROFILE_GIF_SIZE) {
    throw new Error("GIF excede o limite de 15MB.");
  }

  const gifsDir = path.join(process.cwd(), "public", "uploads", "profile-gifs");
  await mkdir(gifsDir, { recursive: true });

  const extension = ".gif";
  const baseName = path.basename(file.name, path.extname(file.name));
  const safeBaseName = sanitizeFileName(baseName);
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;
  const finalPath = path.join(gifsDir, finalFileName);

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  await writeFile(finalPath, fileBuffer);

  return `/uploads/profile-gifs/${finalFileName}`;
};

const deleteProfileGifFile = async (fileUrl: string | null) => {
  if (!fileUrl || !fileUrl.startsWith("/uploads/profile-gifs/")) {
    return;
  }

  const normalized = path.normalize(fileUrl.replace(/^\/+/, ""));
  if (!normalized.startsWith("uploads")) {
    return;
  }

  const fullPath = path.join(process.cwd(), "public", normalized.replace(/^uploads[\\/]/, "uploads/"));
  await unlink(fullPath).catch(() => undefined);
};

type Params = {
  params: Promise<{ userId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { userId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    ensureSameAuthenticatedUser(authenticatedUserId, userId);
    const formData = await request.formData();
    const actorId = formData.get("actorId")?.toString().trim();
    const gif = formData.get("gif");

    if (!actorId) {
      return NextResponse.json({ error: "Campo actorId é obrigatório." }, { status: 400 });
    }

    ensureSameAuthenticatedUser(authenticatedUserId, actorId);

    if (!(gif instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo GIF." }, { status: 400 });
    }

    const gifUrl = await saveProfileGifFile(gif);
    const result = await updateUserProfileCardGif(actorId, userId, gifUrl);
    await deleteProfileGifFile(result.previousProfileCardGifUrl);

    return NextResponse.json({ user: result.user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar GIF do perfil." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { userId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    ensureSameAuthenticatedUser(authenticatedUserId, userId);
    const body = await request.json() as { actorId?: string };
    const actorId = body.actorId?.toString().trim();

    if (!actorId) {
      return NextResponse.json({ error: "Campo actorId é obrigatório." }, { status: 400 });
    }

    ensureSameAuthenticatedUser(authenticatedUserId, actorId);

    const result = await updateUserProfileCardGif(actorId, userId, null);
    await deleteProfileGifFile(result.previousProfileCardGifUrl);

    return NextResponse.json({ user: result.user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao remover GIF do perfil." },
      { status: getApiErrorStatus(error) },
    );
  }
}
