import { NextRequest, NextResponse } from "next/server";
import { getAuthCookieName, readUserIdFromAuthToken } from "@/lib/auth";
import { getServerAuditLogs } from "@/lib/audit";
import { getRoleForUser } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string }>;
};

const getAuthenticatedUserId = (request: NextRequest): string | null => {
  const token = request.cookies.get(getAuthCookieName())?.value;
  return readUserIdFromAuthToken(token);
};

export async function GET(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = getAuthenticatedUserId(request);
    if (!authenticatedUserId) {
      return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    }

    // Só administradores do próprio servidor podem ver o log de auditoria
    const role = await getRoleForUser(serverId, authenticatedUserId);
    if (role !== "admin") {
      return NextResponse.json({ error: "Acesso negado ao log de auditoria." }, { status: 403 });
    }

    const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "50", 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
    const logs = await getServerAuditLogs(serverId, limit);
    
    return NextResponse.json({ logs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao buscar logs de auditoria." },
      { status: 500 },
    );
  }
}
