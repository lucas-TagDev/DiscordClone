import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId, sanitizeChatMessageForApi } from "@/lib/api-auth";
import { deleteMessage, updateMessageContent } from "@/lib/store";

// Limite de mensagem configurável via .env
const MAX_MESSAGE_LENGTH = Number(process.env.NEXT_PUBLIC_MAX_MESSAGE_LENGTH ?? "2000");

const updateMessageSchema = z.object({
  actorId: z.string().min(2),
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

type Params = {
  params: Promise<{ serverId: string; channelId: string; messageId: string }>;
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

export async function PATCH(request: NextRequest, { params }: Params) {
  const { serverId, channelId, messageId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = updateMessageSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    const message = await updateMessageContent(serverId, channelId, messageId, authenticatedUserId, body.content);
    const sanitized = sanitizeChatMessageForApi(message);
    return NextResponse.json({ message: sanitized });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao editar mensagem." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId, channelId, messageId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    const attachmentUrls = await deleteMessage(serverId, channelId, messageId, authenticatedUserId);
    await Promise.all(attachmentUrls.map((url) => deleteUploadFile(url)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir mensagem." },
      { status: getApiErrorStatus(error) },
    );
  }
}
