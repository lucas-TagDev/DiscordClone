import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { blockDirectUser, listDirectBlockedUserIds, unblockDirectUser } from "@/lib/store";

const userIdSchema = z.string().trim().min(2);

const toggleDirectBlockSchema = z.object({
  actorId: z.string().trim().min(2),
  targetUserId: z.string().trim().min(2),
});

export async function GET(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      ensureSameAuthenticatedUser(authenticatedUserId, userIdSchema.parse(userId));
    }

    const blockedUserIds = await listDirectBlockedUserIds(authenticatedUserId);
    return NextResponse.json({ blockedUserIds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar usuários bloqueados." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = toggleDirectBlockSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    await blockDirectUser(authenticatedUserId, body.targetUserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao bloquear usuário." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = toggleDirectBlockSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    await unblockDirectUser(authenticatedUserId, body.targetUserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao desbloquear usuário." },
      { status: getApiErrorStatus(error) },
    );
  }
}
