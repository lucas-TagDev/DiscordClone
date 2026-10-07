import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { createServerInviteByOwner, listServerInvitesByOwner } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string }>;
};

const createInviteSchema = z.object({
  actorId: z.string().min(2),
});

export async function GET(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    const invites = await listServerInvitesByOwner(serverId, authenticatedUserId);
    return NextResponse.json({ invites });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar convites." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = createInviteSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    const invite = await createServerInviteByOwner(serverId, authenticatedUserId);
    return NextResponse.json({ invite }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao gerar convite." },
      { status: getApiErrorStatus(error) },
    );
  }
}
