import { NextRequest, NextResponse } from "next/server";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { leaveServerByUser } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string }>;
};

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      ensureSameAuthenticatedUser(authenticatedUserId, userId);
    }

    await leaveServerByUser(serverId, authenticatedUserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao sair do servidor." },
      { status: getApiErrorStatus(error) },
    );
  }
}
