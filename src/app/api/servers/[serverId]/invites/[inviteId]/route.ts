import { NextRequest, NextResponse } from "next/server";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { revokeServerInviteByOwner } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string; inviteId: string }>;
};

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId, inviteId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    await revokeServerInviteByOwner(serverId, inviteId, authenticatedUserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir convite." },
      { status: getApiErrorStatus(error) },
    );
  }
}
