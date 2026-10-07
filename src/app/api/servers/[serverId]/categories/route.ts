import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { createCategory } from "@/lib/store";

const createCategorySchema = z.object({
  actorId: z.string().min(2),
  name: z.string().min(2).max(30),
});

type Params = {
  params: Promise<{ serverId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = createCategorySchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.actorId);
    const category = await createCategory(serverId, authenticatedUserId, body.name);
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar categoria." },
      { status: getApiErrorStatus(error) },
    );
  }
}
