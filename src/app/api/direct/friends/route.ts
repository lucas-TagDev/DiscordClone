import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { createDirectFriendRequestByUserId, listDirectFriends, removeDirectFriendByUserId } from "@/lib/store";

const userIdSchema = z.string().trim().min(2);

const addDirectFriendSchema = z.object({
  actorId: z.string().trim().min(2),
  friendUserId: z.string().trim().min(2),
});

const removeDirectFriendSchema = z.object({
  actorId: z.string().trim().min(2),
  friendUserId: z.string().trim().min(2),
});

export async function GET(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      ensureSameAuthenticatedUser(authenticatedUserId, userIdSchema.parse(userId));
    }

    const friends = await listDirectFriends(authenticatedUserId);
    return NextResponse.json({ friends });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar amigos." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = addDirectFriendSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    const result = await createDirectFriendRequestByUserId(authenticatedUserId, body.friendUserId);
    return NextResponse.json({ requestId: result.requestId, conversationId: result.conversationId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao enviar solicitação de amizade." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = removeDirectFriendSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    await removeDirectFriendByUserId(authenticatedUserId, body.friendUserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao remover amigo." },
      { status: getApiErrorStatus(error) },
    );
  }
}
