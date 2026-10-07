import { NextRequest, NextResponse } from "next/server";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { listActiveServerBansByAdmin } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    const bans = await listActiveServerBansByAdmin(serverId, authenticatedUserId);
    return NextResponse.json({ bans });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar banidos." },
      { status: getApiErrorStatus(error) },
    );
  }
}
