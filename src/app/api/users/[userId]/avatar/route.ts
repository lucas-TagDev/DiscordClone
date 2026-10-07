import { NextRequest, NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { updateUserAvatar } from "@/lib/store";

// Limite configurável via .env (em MB)
const MAX_AVATAR_SIZE = (Number(process.env.NEXT_PUBLIC_MAX_AVATAR_SIZE_MB ?? "10")) * 1024 * 1024;

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100) || "avatar";

const saveAvatarFile = async (file: File): Promise<string> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Avatar deve ser uma imagem (png, jpg, gif, webp...).");
  }

  if (file.size <= 0) {
    throw new Error("Arquivo de avatar vazio não é permitido.");
  }

  if (file.size > MAX_AVATAR_SIZE) {
    throw new Error("Avatar excede o limite de 10MB.");
  }

  const avatarsDir = path.join(process.cwd(), "public", "uploads", "avatars");
  await mkdir(avatarsDir, { recursive: true });

  const extension = path.extname(file.name) || ".img";
  const baseName = path.basename(file.name, extension);
  const safeBaseName = sanitizeFileName(baseName);
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;
  const finalPath = path.join(avatarsDir, finalFileName);

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  await writeFile(finalPath, fileBuffer);

  return `/uploads/avatars/${finalFileName}`;
};

const deleteAvatarFile = async (fileUrl: string | null) => {
  if (!fileUrl) {
    return;
  }

  const normalized = path.normalize(fileUrl.replace(/^\/+/, ""));
  const isLegacyAvatarPath = normalized.startsWith("avatars");
  const isUploadsAvatarPath = normalized.startsWith(path.normalize("uploads/avatars"));
  if (!isLegacyAvatarPath && !isUploadsAvatarPath) {
    return;
  }

  const normalizedPath = isLegacyAvatarPath
    ? normalized.replace(/^avatars[\\/]/, "avatars/")
    : normalized.replace(/^uploads[\\/]avatars[\\/]/, "uploads/avatars/");
  const fullPath = path.join(process.cwd(), "public", normalizedPath);
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
    const avatar = formData.get("avatar");

    if (!actorId) {
      return NextResponse.json({ error: "Campo actorId é obrigatório." }, { status: 400 });
    }

    ensureSameAuthenticatedUser(authenticatedUserId, actorId);

    if (!(avatar instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo de avatar." }, { status: 400 });
    }

    const avatarUrl = await saveAvatarFile(avatar);
    const result = await updateUserAvatar(actorId, userId, avatarUrl);
    await deleteAvatarFile(result.previousAvatarUrl);

    return NextResponse.json({ user: result.user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar avatar." },
      { status: getApiErrorStatus(error) },
    );
  }
}
