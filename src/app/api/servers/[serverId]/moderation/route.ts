import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getAuthCookieName, readUserIdFromAuthToken } from "@/lib/auth";
import {
  banUserFromServer,
  kickUserFromVoice,
  moveUserToVoiceChannel,
  removeUserFromServer,
  timeoutUserFromVoice,
} from "@/lib/store";

// Limites configuráveis via .env
const MAX_MODERATION_REASON_LENGTH = Number(process.env.NEXT_PUBLIC_MAX_MODERATION_REASON_LENGTH ?? "400");
const MAX_TIMEOUT_MINUTES = Number(process.env.NEXT_PUBLIC_MAX_TIMEOUT_MINUTES ?? "4320");

const moderationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("remove-user"),
    actorId: z.string().min(2),
    targetUserId: z.string().min(2),
    removeMessages: z.boolean().default(false),
    reason: z.string().max(MAX_MODERATION_REASON_LENGTH).optional(),
  }),
  z.object({
    action: z.literal("ban-user"),
    actorId: z.string().min(2),
    targetUserId: z.string().min(2),
    reason: z.string().max(MAX_MODERATION_REASON_LENGTH).optional(),
  }),
  z.object({
    action: z.literal("voice-timeout"),
    actorId: z.string().min(2),
    targetUserId: z.string().min(2),
    durationMinutes: z.number().int().min(1).max(MAX_TIMEOUT_MINUTES),
    reason: z.string().max(MAX_MODERATION_REASON_LENGTH).optional(),
  }),
  z.object({
    action: z.literal("voice-kick"),
    actorId: z.string().min(2),
    targetUserId: z.string().min(2),
    reason: z.string().max(MAX_MODERATION_REASON_LENGTH).optional(),
  }),
  z.object({
    action: z.literal("voice-move"),
    actorId: z.string().min(2),
    targetUserId: z.string().min(2),
    targetChannelId: z.string().min(2),
    reason: z.string().max(MAX_MODERATION_REASON_LENGTH).optional(),
  }),
]);

type Params = {
  params: Promise<{ serverId: string }>;
};

const getAuthenticatedUserId = (request: NextRequest): string => {
  const token = request.cookies.get(getAuthCookieName())?.value;
  const authenticatedUserId = readUserIdFromAuthToken(token);

  if (!authenticatedUserId) {
    throw new Error("Sessão inválida ou expirada.");
  }

  return authenticatedUserId;
};

const deleteUploadFile = async (fileUrl: string) => {
  if (!fileUrl.startsWith("/uploads/")) {
    return;
  }

  const normalized = path.normalize(fileUrl.replace(/^\/+/, ""));
  if (!normalized.startsWith("uploads")) {
    return;
  }

  const fullPath = path.join(process.cwd(), "public", normalized.replace(/^uploads[\\/]/, "uploads/"));
  await unlink(fullPath).catch(() => undefined);
};

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = getAuthenticatedUserId(request);
    const body = moderationSchema.parse(await request.json());
    if (authenticatedUserId !== body.actorId.trim().toLowerCase()) {
      return NextResponse.json({ error: "Ação não autorizada para este usuário." }, { status: 403 });
    }

    if (body.action === "remove-user") {
      const result = await removeUserFromServer(serverId, body.actorId, body.targetUserId, {
        removeMessages: body.removeMessages,
      });
      await Promise.all(result.removedMessageAttachmentUrls.map((url) => deleteUploadFile(url)));
      return NextResponse.json({ ok: true, action: body.action });
    }

    if (body.action === "ban-user") {
      await banUserFromServer(serverId, body.actorId, body.targetUserId, body.reason);
      return NextResponse.json({ ok: true, action: body.action });
    }

    if (body.action === "voice-kick") {
      await kickUserFromVoice(serverId, body.actorId, body.targetUserId, body.reason);
      return NextResponse.json({ ok: true, action: body.action });
    }

    if (body.action === "voice-move") {
      await moveUserToVoiceChannel(serverId, body.actorId, body.targetUserId, body.targetChannelId, body.reason);
      return NextResponse.json({ ok: true, action: body.action });
    }

    const result = await timeoutUserFromVoice(
      serverId,
      body.actorId,
      body.targetUserId,
      body.durationMinutes,
      body.reason,
    );
    return NextResponse.json({ ok: true, action: body.action, expiresAt: result.expiresAt.toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na moderação.";
    const status = message.includes("Sessão inválida") ? 401 : 400;
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
