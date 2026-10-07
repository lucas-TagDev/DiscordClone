import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { deleteOwnUserAccount, getUserProfile, updateOwnUserSettings } from "@/lib/store";

type Params = {
  params: Promise<{ userId: string }>;
};

const updateUserSettingsSchema = z.object({
  actorId: z.string().trim().min(2).max(40),
  displayName: z.string().trim().min(1).max(40).optional(),
  displayNameStyle: z.record(z.string(), z.any()).optional(), // { color?, fontFamily?, bold?, animation? }
  password: z.string().min(6).max(128).optional(),
  joinWithMicEnabled: z.boolean().optional(),
  joinWithCameraEnabled: z.boolean().optional(),
  noiseSuppressionEnabled: z.boolean().optional(),
  chatNotificationSoundEnabled: z.boolean().optional(),
  micGain: z.number().int().min(0).max(300).optional(),
  keybinds: z.record(z.string(), z.string()).optional(),
});

const deleteOwnUserSchema = z.object({
  actorId: z.string().trim().min(2).max(40),
});

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

export async function GET(request: NextRequest, { params }: Params) {
  const { userId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    ensureSameAuthenticatedUser(authenticatedUserId, userId);
    const user = await getUserProfile(userId);
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar perfil." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { userId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    ensureSameAuthenticatedUser(authenticatedUserId, userId);
    const body = updateUserSettingsSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    const user = await updateOwnUserSettings(body.actorId, userId, {
      displayName: body.displayName,
      displayNameStyle: body.displayNameStyle,
      password: body.password,
      joinWithMicEnabled: body.joinWithMicEnabled,
      joinWithCameraEnabled: body.joinWithCameraEnabled,
      noiseSuppressionEnabled: body.noiseSuppressionEnabled,
      chatNotificationSoundEnabled: body.chatNotificationSoundEnabled,
      micGain: body.micGain,
      keybinds: body.keybinds,
    });

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar perfil." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { userId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    ensureSameAuthenticatedUser(authenticatedUserId, userId);
    const body = deleteOwnUserSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    const result = await deleteOwnUserAccount(body.actorId, userId);
    await deleteAvatarFile(result.previousAvatarUrl);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir conta." },
      { status: getApiErrorStatus(error) },
    );
  }
}
