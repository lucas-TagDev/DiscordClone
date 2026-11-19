import { db } from "@/lib/db";

// Grava no máximo uma vez por minuto por usuário, para não escrever no banco a cada requisição.
const TOUCH_INTERVAL_MS = 60_000;
const lastTouchByUserId = new Map<string, number>();

/**
 * Atualiza User.lastSeenAt ("última vez ativo") sem bloquear a requisição.
 * Falhas são ignoradas: é só informativo.
 */
export const touchUserLastSeen = (userId: string): void => {
  const now = Date.now();
  const previous = lastTouchByUserId.get(userId) ?? 0;
  if (now - previous < TOUCH_INTERVAL_MS) {
    return;
  }
  lastTouchByUserId.set(userId, now);

  void db.user
    .update({ where: { id: userId }, data: { lastSeenAt: new Date(now) } })
    .catch(() => {
      // usuário inexistente ou banco indisponível: tenta de novo na próxima janela
      lastTouchByUserId.delete(userId);
    });
};
