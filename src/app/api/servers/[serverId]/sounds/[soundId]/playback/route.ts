import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUserId, getApiErrorStatus } from "@/lib/api-auth";
import { db } from "@/lib/db";

type Params = {
  params: Promise<{ soundId: string }>;
};

const recordPlaybackSchema = z.object({
  serverId: z.string().trim().min(1),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { soundId } = await params;

  try {
    const userId = requireAuthenticatedUserId(request);
    const body = recordPlaybackSchema.parse(await request.json());

    // Verificar se o áudio existe
    const sound = await db.serverSound.findUnique({
      where: { id: soundId },
      select: { id: true, serverId: true },
    });

    if (!sound) {
      return NextResponse.json(
        { error: "Áudio não encontrado." },
        { status: 404 },
      );
    }

    if (sound.serverId !== body.serverId) {
      return NextResponse.json(
        { error: "Áudio não pertence a este servidor." },
        { status: 400 },
      );
    }

    // Registrar o playback
    const playback = await db.serverSoundPlayback.create({
      data: {
        soundId,
        userId,
        serverId: body.serverId,
      },
      select: {
        id: true,
        playedAt: true,
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    return NextResponse.json(playback);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar playback." },
      { status: getApiErrorStatus(error) },
    );
  }
}
