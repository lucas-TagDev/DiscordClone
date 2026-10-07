import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";
import { requireAuthenticatedUserId } from "@/lib/api-auth";
import { ensureVoiceAccess, getUserProfile } from "@/lib/store";

const tokenSchema = z.object({
  serverId: z.string().min(2),
  channelId: z.string().min(2),
  sessionId: z.string().min(8).optional(),
});

export async function POST(request: NextRequest) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL ?? process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    return NextResponse.json(
      { error: "Defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no .env.local." },
      { status: 500 },
    );
  }

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = tokenSchema.parse(await request.json());
    const user = await getUserProfile(authenticatedUserId);
    const roomName = await ensureVoiceAccess(body.serverId, body.channelId, authenticatedUserId);
    const identity = body.sessionId ? `${authenticatedUserId}::${body.sessionId}` : authenticatedUserId;

    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity,
      name: user.displayName,
      ttl: "2h",
    });

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return NextResponse.json({
      token: await accessToken.toJwt(),
      serverUrl: livekitUrl,
      roomName,
    });
  } catch (error) {
    const status = error instanceof Error && error.message.includes("Sessão inválida") ? 401 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao gerar token." }, { status });
  }
}
