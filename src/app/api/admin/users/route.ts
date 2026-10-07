import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuthenticatedUserId, getApiErrorStatus } from "@/lib/api-auth";
import { requireAdminUser } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const adminId = requireAuthenticatedUserId(request);
    await requireAdminUser(adminId);

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
    const pageSize = Math.min(50, parseInt(url.searchParams.get("pageSize") || "20"));
    const searchTerm = url.searchParams.get("search") || "";

    const skip = (page - 1) * pageSize;

    const where: Prisma.UserWhereInput = searchTerm
      ? {
          OR: [
            { username: { contains: searchTerm, mode: Prisma.QueryMode.insensitive } },
            { displayName: { contains: searchTerm, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        skip,
        take: pageSize,
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          isAdmin: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      db.user.count({ where }),
    ]);

    return NextResponse.json({
      users,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar usuários." },
      { status: getApiErrorStatus(error) },
    );
  }
}
