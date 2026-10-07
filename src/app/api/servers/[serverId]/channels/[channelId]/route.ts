import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { deleteChannelByOwner, updateChannelByOwner } from "@/lib/store";

const updateChannelSchema = z.object({
  actorId: z.string().min(2),
  name: z.string().min(2).max(30).optional(),
  categoryId: z.string().min(2).nullable().optional(),
  permissions: z.object({
    allowMemberView: z.boolean(),
    allowModeratorView: z.boolean(),
    allowMemberAccess: z.boolean(),
    allowModeratorAccess: z.boolean(),
    allowMemberSendMessages: z.boolean(),
    allowModeratorSendMessages: z.boolean(),
    allowMemberSendFiles: z.boolean(),
    allowModeratorSendFiles: z.boolean(),
    allowMemberSendLinks: z.boolean(),
    allowModeratorSendLinks: z.boolean(),
    allowMemberDeleteMessages: z.boolean(),
    allowModeratorDeleteMessages: z.boolean(),
  }).optional(),
});

const deleteFileByUrl = async (fileUrl: string | null) => {
  if (!fileUrl || !fileUrl.startsWith("/uploads/")) {
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
  params: Promise<{ serverId: string; channelId: string }>;
};

export async function PATCH(request: NextRequest, { params }: Params) {
  const { serverId, channelId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = updateChannelSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    const channel = await updateChannelByOwner(serverId, channelId, authenticatedUserId, {
      name: body.name,
      categoryId: body.categoryId,
      permissions: body.permissions,
    });
    return NextResponse.json({ channel });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar canal." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId, channelId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    const result = await deleteChannelByOwner(serverId, channelId, authenticatedUserId);
    await Promise.all(result.deletedAttachmentUrls.map((url) => deleteFileByUrl(url)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir canal." },
      { status: getApiErrorStatus(error) },
    );
  }
}
