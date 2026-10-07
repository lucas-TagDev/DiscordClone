import { NextRequest, NextResponse } from "next/server";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { revokeServerBanByAdmin } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string; banId: string }>;
};

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId, banId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    await revokeServerBanByAdmin(serverId, banId, authenticatedUserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao remover banimento." },
      { status: getApiErrorStatus(error) },
    );
  }
}
