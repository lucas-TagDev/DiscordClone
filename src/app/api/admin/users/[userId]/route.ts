import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUserId, getApiErrorStatus } from "@/lib/api-auth";
import { requireAdminUser } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { hash } from "bcryptjs";
import { z } from "zod";

type Params = {
  params: Promise<{ userId: string }>;
};

const updateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "Usuário inválido.")
    .optional(),
  displayName: z.string().trim().min(1).max(50).optional(),
  password: z.string().min(6).max(128).optional(),
  isAdmin: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const { userId: targetUserId } = await params;

  try {
    const adminId = requireAuthenticatedUserId(request);
    await requireAdminUser(adminId);

    // Verificar se o usuário alvo existe
    const targetUser = await db.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, username: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const body = updateUserSchema.parse(await request.json());
    const updateData: any = {};

    if (body.displayName !== undefined) {
      updateData.displayName = body.displayName;
    }

    if (body.isAdmin !== undefined) {
      updateData.isAdmin = body.isAdmin;
    }

    // Verificar se o novo username já existe
    if (body.username !== undefined) {
      const existing = await db.user.findUnique({
        where: { username: body.username.toLowerCase() },
      });

      if (existing && existing.id !== targetUserId) {
        return NextResponse.json(
          { error: "Este nome de usuário já está em uso." },
          { status: 400 },
        );
      }

      updateData.username = body.username.toLowerCase();
    }

    // Atualizar senha se fornecida
    if (body.password !== undefined) {
      updateData.passwordHash = await hash(body.password, 10);
    }

    const updatedUser = await db.user.update({
      where: { id: targetUserId },
      data: updateData,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar usuário." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { userId: targetUserId } = await params;

  try {
    const adminId = requireAuthenticatedUserId(request);
    await requireAdminUser(adminId);

    // Não permitir que um admin se delete
    if (adminId === targetUserId) {
      return NextResponse.json(
        { error: "Você não pode deletar sua própria conta." },
        { status: 400 },
      );
    }

    const deletedUser = await db.user.delete({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        displayName: true,
      },
    });

    return NextResponse.json({
      message: "Usuário deletado com sucesso.",
      user: deletedUser,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao deletar usuário." },
      { status: getApiErrorStatus(error) },
    );
  }
}
