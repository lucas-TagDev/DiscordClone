import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUserId, getApiErrorStatus } from "@/lib/api-auth";
import { db } from "@/lib/db";

type Params = {
  params: Promise<{ soundId: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
  const { soundId } = await params;

  try {
    const userId = requireAuthenticatedUserId(request);

    const url = new URL(request.url);
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50"));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0"));

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

    // Buscar histórico de playback
    const [playbacks, total] = await Promise.all([
      db.serverSoundPlayback.findMany({
        where: { soundId },
        select: {
          id: true,
          playedAt: true,
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { playedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      db.serverSoundPlayback.count({ where: { soundId } }),
    ]);

    return NextResponse.json({
      playbacks,
      pagination: {
        limit,
        offset,
        total,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao buscar histórico." },
      { status: getApiErrorStatus(error) },
    );
  }
}
