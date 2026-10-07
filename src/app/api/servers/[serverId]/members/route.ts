import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthCookieName, readUserIdFromAuthToken } from "@/lib/auth";
import { updateMemberNotificationSound, upsertMemberRole } from "@/lib/store";

const memberSchema = z.object({
  actorId: z.string().min(2),
  targetUserId: z.string().min(2),
  role: z.enum(["admin", "moderator", "member"]),
  permissions: z.object({
    canRemoveMembers: z.boolean(),
    canBanUsers: z.boolean(),
    canTimeoutVoice: z.boolean(),
    canDeleteUserMessages: z.boolean(),
    canKickFromVoice: z.boolean(),
    canMoveVoiceUsers: z.boolean(),
    canManageInvites: z.boolean(),
  }).optional(),
});

const memberNotificationSchema = z.object({
  actorId: z.string().min(2),
  notifySoundEnabled: z.boolean(),
});

type Params = {
  params: Promise<{ serverId: string }>;
};

const getAuthenticatedUserId = (request: NextRequest): string => {
  const token = request.cookies.get(getAuthCookieName())?.value;
  const authenticatedUserId = readUserIdFromAuthToken(token);

  if (!authenticatedUserId) {
    throw new Error("Sessão inválida ou expirada.");
  }

  return authenticatedUserId;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = getAuthenticatedUserId(request);
    const body = memberSchema.parse(await request.json());
    if (authenticatedUserId !== body.actorId.trim().toLowerCase()) {
      return NextResponse.json({ error: "Ação não autorizada para este usuário." }, { status: 403 });
    }
    const member = await upsertMemberRole(serverId, body.actorId, body.targetUserId, body.role, body.permissions);
    return NextResponse.json({ member });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao atualizar membro.";
    const status = message.includes("Sessão inválida") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = getAuthenticatedUserId(request);
    const body = memberNotificationSchema.parse(await request.json());
    if (authenticatedUserId !== body.actorId.trim().toLowerCase()) {
      return NextResponse.json({ error: "Ação não autorizada para este usuário." }, { status: 403 });
    }
    const member = await updateMemberNotificationSound(serverId, body.actorId, body.notifySoundEnabled);
    return NextResponse.json({ member });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao atualizar notificacoes.";
    const status = message.includes("Sessão inválida") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
