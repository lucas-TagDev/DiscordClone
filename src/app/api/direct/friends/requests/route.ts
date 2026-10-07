import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { respondToDirectFriendRequest } from "@/lib/store";

const directFriendRequestResponseSchema = z.object({
  actorId: z.string().trim().min(2),
  requestId: z.string().trim().min(2),
  action: z.enum(["accept", "reject"]),
});

export async function PATCH(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = directFriendRequestResponseSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    await respondToDirectFriendRequest(authenticatedUserId, body.requestId, body.action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao responder solicitação de amizade." },
      { status: getApiErrorStatus(error) },
    );
  }
}
