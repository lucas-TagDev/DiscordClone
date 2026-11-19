import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUserId, getApiErrorStatus } from "@/lib/api-auth";
import { requireAdminUser } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    await requireAdminUser(requireAuthenticatedUserId(request));
    const { userId } = await params;
    const parsedPage = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const pageSize = 20;
    const [logs, total] = await Promise.all([
      db.userAccessLog.findMany({
        where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, event: true, ip: true, createdAt: true },
      }),
      db.userAccessLog.count({ where: { userId } }),
    ]);
    return NextResponse.json({ logs, page, pages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar acessos." },
      { status: getApiErrorStatus(error) });
  }
}
