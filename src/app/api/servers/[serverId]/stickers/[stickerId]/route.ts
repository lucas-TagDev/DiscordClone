import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { deleteServerSticker } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string; stickerId: string }>;
};

const deleteStickerFileByUrl = async (fileUrl: string) => {
  if (!fileUrl.startsWith("/uploads/stickers/")) {
    return;
  }

  const normalized = path.normalize(fileUrl.replace(/^\/+/, ""));
  if (!normalized.startsWith(path.normalize("uploads/stickers"))) {
    return;
  }

  const fullPath = path.join(process.cwd(), "public", normalized);
  await unlink(fullPath).catch(() => undefined);
};

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId, stickerId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    const result = await deleteServerSticker(serverId, stickerId, authenticatedUserId);
    await deleteStickerFileByUrl(result.deletedUrl);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao remover figurinha." },
      { status: getApiErrorStatus(error) },
    );
  }
}
