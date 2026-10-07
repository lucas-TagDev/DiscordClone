import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUserId } from "@/lib/api-auth";
import { acceptInviteLink } from "@/lib/store";

type Params = {
  params: Promise<{ code: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { code } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const result = await acceptInviteLink(code, authenticatedUserId);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof Error && error.message.includes("Sessão inválida") ? 401 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao aceitar convite." }, { status });
  }
}
