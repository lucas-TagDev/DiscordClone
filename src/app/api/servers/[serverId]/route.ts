import { NextRequest, NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApiAuthError, ensureApiRequest, ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId, sanitizeServerForApi } from "@/lib/api-auth";
import { deleteServerByOwner, getRoleForUser, getServerForUser, updateServerSettings } from "@/lib/store";

const MAX_SERVER_AVATAR_SIZE = 10 * 1024 * 1024;
const MAX_SERVER_BANNER_SIZE = 20 * 1024 * 1024;

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100) || "server";

const saveServerAvatarFile = async (file: File): Promise<string> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Foto do servidor deve ser uma imagem.");
  }
  if (file.size <= 0) {
    throw new Error("Arquivo da foto do servidor está vazio.");
  }
  if (file.size > MAX_SERVER_AVATAR_SIZE) {
    throw new Error("Foto do servidor excede o limite de 10MB.");
  }

  const avatarsDir = path.join(process.cwd(), "public", "uploads", "server-avatars");
  await mkdir(avatarsDir, { recursive: true });

  const extension = path.extname(file.name) || ".img";
  const baseName = path.basename(file.name, extension);
  const safeBaseName = sanitizeFileName(baseName);
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;
  const finalPath = path.join(avatarsDir, finalFileName);

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  await writeFile(finalPath, fileBuffer);

  return `/uploads/server-avatars/${finalFileName}`;
};

const saveServerBannerFile = async (file: File): Promise<string> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Banner do servidor deve ser uma imagem ou GIF.");
  }
  if (file.size <= 0) {
    throw new Error("Arquivo do banner está vazio.");
  }
  if (file.size > MAX_SERVER_BANNER_SIZE) {
    throw new Error("Banner do servidor excede o limite de 20MB.");
  }

  const bannersDir = path.join(process.cwd(), "public", "uploads", "server-banners");
  await mkdir(bannersDir, { recursive: true });

  const extension = path.extname(file.name) || ".img";
  const baseName = path.basename(file.name, extension);
  const safeBaseName = sanitizeFileName(baseName);
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;
  const finalPath = path.join(bannersDir, finalFileName);

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  await writeFile(finalPath, fileBuffer);

  return `/uploads/server-banners/${finalFileName}`;
};

const deleteServerFileByUrl = async (fileUrl: string | null) => {
  if (!fileUrl || (!fileUrl.startsWith("/server-avatars/") && !fileUrl.startsWith("/server-banners/") && !fileUrl.startsWith("/uploads/"))) {
    return;
  }

  const normalized = path.normalize(fileUrl.replace(/^\/+/, ""));
  if (!normalized.startsWith("server-avatars") && !normalized.startsWith("server-banners") && !normalized.startsWith("uploads")) {
    return;
  }

  const safeRelative = normalized
    .replace(/^server-avatars[\\/]/, "server-avatars/")
    .replace(/^server-banners[\\/]/, "server-banners/")
    .replace(/^uploads[\\/]/, "uploads/");
  const fullPath = path.join(process.cwd(), "public", safeRelative);
  await unlink(fullPath).catch(() => undefined);
};

type Params = {
  params: Promise<{ serverId: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    ensureApiRequest(request);
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      ensureSameAuthenticatedUser(authenticatedUserId, userId);
    }

    const server = await getServerForUser(serverId, authenticatedUserId);
    const currentRole = await getRoleForUser(serverId, authenticatedUserId);
    const sanitized = sanitizeServerForApi(server);
    return NextResponse.json({ server: sanitized, currentRole });
  } catch (error) {
    if (error instanceof ApiAuthError && error.status === 404 && error.message === "Endpoint não disponível para navegação direta.") {
      return new Response("", {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar servidor." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  let newAvatarUrl: string | null = null;
  let newServerBannerUrl: string | null = null;
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const formData = await request.formData();
    const actorId = z.string().min(2).parse(formData.get("actorId")?.toString());
    ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    const nameRaw = formData.get("name");
    const removeAvatar = formData.get("removeAvatar")?.toString() === "true";
    const virusTotalEnabledRaw = formData.get("virusTotalEnabled");
    const virusTotalApiKeyRaw = formData.get("virusTotalApiKey");
    const allowMemberInvitesRaw = formData.get("allowMemberInvites");
    const allowModeratorInvitesRaw = formData.get("allowModeratorInvites");
    const allowMemberSoundUploadRaw = formData.get("allowMemberSoundUpload");
    const allowModeratorSoundUploadRaw = formData.get("allowModeratorSoundUpload");
    const allowCrossServerSoundShareRaw = formData.get("allowCrossServerSoundShare");
    const allowMemberDeleteSoundsRaw = formData.get("allowMemberDeleteSounds");
    const allowModeratorDeleteSoundsRaw = formData.get("allowModeratorDeleteSounds");
    const allowMemberStickerCreateRaw = formData.get("allowMemberStickerCreate");
    const allowModeratorStickerCreateRaw = formData.get("allowModeratorStickerCreate");
    const allowMemberEmojiCreateRaw = formData.get("allowMemberEmojiCreate");
    const allowModeratorEmojiCreateRaw = formData.get("allowModeratorEmojiCreate");
    const avatar = formData.get("avatar");
    const removeServerBanner = formData.get("removeServerBanner")?.toString() === "true";
    const serverBanner = formData.get("serverBanner");

    if (avatar instanceof File && avatar.name.length > 0) {
      newAvatarUrl = await saveServerAvatarFile(avatar);
    }
    if (serverBanner instanceof File && serverBanner.name.length > 0) {
      newServerBannerUrl = await saveServerBannerFile(serverBanner);
    }

    const result = await updateServerSettings(serverId, actorId, {
      name: nameRaw && typeof nameRaw === "string" ? nameRaw : undefined,
      avatarUrl: newAvatarUrl ?? undefined,
      removeAvatar: removeAvatar || undefined,
      serverBannerUrl: newServerBannerUrl ?? undefined,
      removeServerBanner: removeServerBanner || undefined,
      virusTotalEnabled:
        virusTotalEnabledRaw === null ? undefined : virusTotalEnabledRaw.toString() === "true",
      virusTotalApiKey:
        virusTotalApiKeyRaw && typeof virusTotalApiKeyRaw === "string" ? virusTotalApiKeyRaw : undefined,
      allowMemberInvites:
        allowMemberInvitesRaw === null ? undefined : allowMemberInvitesRaw.toString() === "true",
      allowModeratorInvites:
        allowModeratorInvitesRaw === null ? undefined : allowModeratorInvitesRaw.toString() === "true",
      allowMemberSoundUpload:
        allowMemberSoundUploadRaw === null ? undefined : allowMemberSoundUploadRaw.toString() === "true",
      allowModeratorSoundUpload:
        allowModeratorSoundUploadRaw === null ? undefined : allowModeratorSoundUploadRaw.toString() === "true",
      allowCrossServerSoundShare:
        allowCrossServerSoundShareRaw === null ? undefined : allowCrossServerSoundShareRaw.toString() === "true",
      allowMemberDeleteSounds:
        allowMemberDeleteSoundsRaw === null ? undefined : allowMemberDeleteSoundsRaw.toString() === "true",
      allowModeratorDeleteSounds:
        allowModeratorDeleteSoundsRaw === null ? undefined : allowModeratorDeleteSoundsRaw.toString() === "true",
      allowMemberStickerCreate:
        allowMemberStickerCreateRaw === null ? undefined : allowMemberStickerCreateRaw.toString() === "true",
      allowModeratorStickerCreate:
        allowModeratorStickerCreateRaw === null ? undefined : allowModeratorStickerCreateRaw.toString() === "true",
      allowMemberEmojiCreate:
        allowMemberEmojiCreateRaw === null ? undefined : allowMemberEmojiCreateRaw.toString() === "true",
      allowModeratorEmojiCreate:
        allowModeratorEmojiCreateRaw === null ? undefined : allowModeratorEmojiCreateRaw.toString() === "true",
    });

    await deleteServerFileByUrl(result.previousAvatarUrl);
    await deleteServerFileByUrl(result.previousServerBannerUrl);
    const sanitized = sanitizeServerForApi(result.server);
    return NextResponse.json({ server: sanitized });
  } catch (error) {
    if (newAvatarUrl) {
      await deleteServerFileByUrl(newAvatarUrl);
    }
    if (newServerBannerUrl) {
      await deleteServerFileByUrl(newServerBannerUrl);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar servidor." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    const result = await deleteServerByOwner(serverId, authenticatedUserId);
    await deleteServerFileByUrl(result.deletedAvatarUrl);
    await deleteServerFileByUrl(result.deletedServerBannerUrl);
    await Promise.all([
      ...result.deletedAttachmentUrls.map((url) => deleteServerFileByUrl(url)),
      ...result.deletedSoundUrls.map((url) => deleteServerFileByUrl(url)),
      ...result.deletedStickerUrls.map((url) => deleteServerFileByUrl(url)),
      ...result.deletedEmojiUrls.map((url) => deleteServerFileByUrl(url)),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir servidor." },
      { status: getApiErrorStatus(error) },
    );
  }
}
