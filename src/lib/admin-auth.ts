import { db } from "@/lib/db";
import { ApiAuthError } from "@/lib/api-auth";

export const isUserAdmin = async (userId: string): Promise<boolean> => {
  if (!userId) return false;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });

  return user?.isAdmin ?? false;
};

export const requireAdminUser = async (userId: string): Promise<void> => {
  const isAdmin = await isUserAdmin(userId);
  if (!isAdmin) {
    throw new ApiAuthError("Acesso negado. Apenas administradores podem acessar este recurso.", 403);
  }
};
