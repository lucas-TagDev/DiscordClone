import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { createChannel } from "@/lib/store";

const createChannelSchema = z.object({
  actorId: z.string().min(2),
  name: z.string().min(2).max(30),
  type: z.enum(["text", "voice"]),
  categoryId: z.string().min(2).optional().nullable(),
});

type Params = {
  params: Promise<{ serverId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = createChannelSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    const channel = await createChannel(serverId, authenticatedUserId, body.name, body.type, body.categoryId ?? undefined);
    return NextResponse.json({ channel }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar canal." },
      { status: getApiErrorStatus(error) },
    );
  }
}
