import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { deleteCategoryByOwner, updateCategoryByOwner } from "@/lib/store";

const updateCategorySchema = z.object({
  actorId: z.string().min(2),
  name: z.string().min(2).max(30),
});

type Params = {
  params: Promise<{ serverId: string; categoryId: string }>;
};

export async function PATCH(request: NextRequest, { params }: Params) {
  const { serverId, categoryId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = updateCategorySchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    const category = await updateCategoryByOwner(serverId, categoryId, authenticatedUserId, body.name);
    return NextResponse.json({ category });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar categoria." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId, categoryId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const actorId = request.nextUrl.searchParams.get("actorId");
    if (actorId) {
      ensureSameAuthenticatedUser(authenticatedUserId, actorId);
    }

    await deleteCategoryByOwner(serverId, categoryId, authenticatedUserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir categoria." },
      { status: getApiErrorStatus(error) },
    );
  }
}
