import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { setServerSoundFavorite } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string; soundId: string }>;
};

const favoriteSchema = z.object({
  userId: z.string().trim().min(2),
  isFavorite: z.boolean(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId, soundId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = favoriteSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.userId);
    const result = await setServerSoundFavorite(serverId, soundId, authenticatedUserId, body.isFavorite);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar favorito." },
      { status: getApiErrorStatus(error) },
    );
  }
}
