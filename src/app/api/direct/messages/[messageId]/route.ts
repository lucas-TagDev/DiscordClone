import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId, sanitizeDirectMessageForApi } from "@/lib/api-auth";
import { deleteDirectAttachmentFromMessage, deleteDirectMessage, updateDirectMessageContent } from "@/lib/store";

// Limite de mensagem configurável via .env
const MAX_MESSAGE_LENGTH = Number(process.env.NEXT_PUBLIC_MAX_MESSAGE_LENGTH ?? "2000");

const updateDirectMessageSchema = z.object({
  actorId: z.string().trim().min(2),
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

const deleteDirectAttachmentSchema = z.object({
  actorId: z.string().trim().min(2),
  attachmentUrl: z.string().trim().min(1).optional(),
});

type Params = {
  params: Promise<{ messageId: string }>;
};

const deleteUploadFile = async (fileUrl: string) => {
  if (!fileUrl.startsWith("/uploads/direct/")) {
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
  const { messageId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = updateDirectMessageSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    const message = await updateDirectMessageContent(messageId, authenticatedUserId, body.content);
    const sanitized = sanitizeDirectMessageForApi(message);
    return NextResponse.json({ message: sanitized });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao editar mensagem direta." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { messageId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = deleteDirectAttachmentSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);

    if (body.attachmentUrl) {
      const result = await deleteDirectAttachmentFromMessage(messageId, authenticatedUserId, body.attachmentUrl);
      await deleteUploadFile(result.attachmentUrl);
      const sanitized = sanitizeDirectMessageForApi(result.message);
      return NextResponse.json({ message: sanitized });
    }

    const result = await deleteDirectMessage(messageId, authenticatedUserId);
    await Promise.all(result.removedAttachmentUrls.map((url) => deleteUploadFile(url)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir arquivo da mensagem direta." },
      { status: getApiErrorStatus(error) },
    );
  }
}
