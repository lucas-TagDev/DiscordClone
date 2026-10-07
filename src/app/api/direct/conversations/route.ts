import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { createOrGetDirectConversation, listDirectConversations } from "@/lib/store";

const createConversationSchema = z.object({
  userId: z.string().trim().min(2),
  targetUserId: z.string().trim().min(2),
});

export async function GET(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      ensureSameAuthenticatedUser(authenticatedUserId, userId);
    }

    const conversations = await listDirectConversations(authenticatedUserId);
    return NextResponse.json({ conversations });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar conversas diretas." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = createConversationSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.userId);
    const conversation = await createOrGetDirectConversation(authenticatedUserId, body.targetUserId);
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao iniciar conversa direta." },
      { status: getApiErrorStatus(error) },
    );
  }
}
