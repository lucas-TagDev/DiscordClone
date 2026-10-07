import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId, sanitizeChatMessageForApi } from "@/lib/api-auth";
import { deleteAttachmentFromMessage } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string; channelId: string; messageId: string; attachmentId: string }>;
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

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId, channelId, messageId, attachmentId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    const result = await deleteAttachmentFromMessage(serverId, channelId, messageId, attachmentId, authenticatedUserId);
    await deleteUploadFile(result.attachmentUrl);
    const sanitized = sanitizeChatMessageForApi(result.message);
    return NextResponse.json({ message: sanitized });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir anexo." },
      { status: getApiErrorStatus(error) },
    );
  }
}
