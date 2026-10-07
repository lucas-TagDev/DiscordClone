import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { addMessageReaction, removeMessageReaction } from "@/lib/store";

const reactionSchema = z.object({
  userId: z.string().min(2),
  emoji: z.string().trim().min(1).max(64),
});

type Params = {
  params: Promise<{ serverId: string; channelId: string; messageId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId, channelId, messageId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = reactionSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.userId);

    const reaction = await addMessageReaction(serverId, channelId, messageId, body.userId, body.emoji);
    return NextResponse.json({ reaction });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao adicionar reação." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId, channelId, messageId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = reactionSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.userId);

    await removeMessageReaction(serverId, channelId, messageId, body.userId, body.emoji);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao remover reação." },
      { status: getApiErrorStatus(error) },
    );
  }
}
