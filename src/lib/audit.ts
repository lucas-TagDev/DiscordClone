import { db } from "./db";
import type { AuditLogAction, ServerAuditLog } from "./types";

const isMissingAuditTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeCode = (error as { code?: unknown }).code;
  if (maybeCode === "P2021") {
    return true;
  }

  const maybeMessage = (error as { message?: unknown }).message;
  return typeof maybeMessage === "string" && maybeMessage.includes("ServerAuditLog");
};

/**
 * Cria um log de auditoria para uma ação no servidor
 */
export async function createAuditLog(
  serverId: string,
  actorId: string,
  action: AuditLogAction,
  targetId: string | null = null,
  targetName: string | null = null,
  details: string | null = null
): Promise<void> {
  try {
    await db.serverAuditLog.create({
      data: {
        serverId,
        actorId,
        action,
        targetId,
        targetName,
        details,
      },
    });
  } catch (error) {
    if (isMissingAuditTableError(error)) {
      return;
    }
    console.error("Erro ao criar log de auditoria:", error);
  }
}

/**
 * Busca logs de auditoria de um servidor
 */
export async function getServerAuditLogs(
  serverId: string,
  limit: number = 50
): Promise<ServerAuditLog[]> {
  let logs: Array<{
    id: string;
    serverId: string;
    actorId: string;
    action: string;
    targetId: string | null;
    targetName: string | null;
    details: string | null;
    createdAt: Date;
    actor: {
      displayName: string;
    };
  }> = [];
  try {
    logs = await db.serverAuditLog.findMany({
      where: { serverId },
      include: {
        actor: {
          select: {
            displayName: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: Math.min(limit, 100), // máximo 100 logs
    });
  } catch (error) {
    if (isMissingAuditTableError(error)) {
      return [];
    }
    throw error;
  }

  return logs.map((log) => ({
    id: log.id,
    serverId: log.serverId,
    actorId: log.actorId,
    actorName: log.actor.displayName,
    action: log.action as AuditLogAction,
    targetId: log.targetId,
    targetName: log.targetName,
    details: log.details,
    createdAt: log.createdAt.toISOString(),
  }));
}
