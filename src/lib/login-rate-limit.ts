// Limite simples de tentativas de login erradas (em memória, por processo).
// Bloqueia por IP e por usuário para dificultar adivinhação de senha.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_USERNAME = 8;
const MAX_FAILURES_PER_IP = 25;

type Bucket = { count: number; firstAt: number };
const failures = new Map<string, Bucket>();

const keyFor = (kind: "ip" | "user", value: string) => `${kind}:${value.trim().toLowerCase()}`;

const getActiveBucket = (key: string, now: number): Bucket | null => {
  const bucket = failures.get(key);
  if (!bucket) return null;
  if (now - bucket.firstAt > WINDOW_MS) {
    failures.delete(key);
    return null;
  }
  return bucket;
};

/** Retorna quantos segundos faltam para liberar, ou 0 se pode tentar. */
export const getLoginRetryAfterSeconds = (username: string, ip: string | null, now = Date.now()): number => {
  const checks: Array<[string, number]> = [[keyFor("user", username), MAX_FAILURES_PER_USERNAME]];
  if (ip) checks.push([keyFor("ip", ip), MAX_FAILURES_PER_IP]);

  let retryAfterMs = 0;
  for (const [key, max] of checks) {
    const bucket = getActiveBucket(key, now);
    if (bucket && bucket.count >= max) {
      retryAfterMs = Math.max(retryAfterMs, bucket.firstAt + WINDOW_MS - now);
    }
  }
  return Math.ceil(retryAfterMs / 1000);
};

export const registerLoginFailure = (username: string, ip: string | null, now = Date.now()): void => {
  const keys = [keyFor("user", username)];
  if (ip) keys.push(keyFor("ip", ip));
  for (const key of keys) {
    const bucket = getActiveBucket(key, now);
    if (bucket) {
      bucket.count += 1;
    } else {
      failures.set(key, { count: 1, firstAt: now });
    }
  }

  // Evita crescer sem limite
  if (failures.size > 50_000) {
    for (const [key, bucket] of failures) {
      if (now - bucket.firstAt > WINDOW_MS) failures.delete(key);
    }
  }
};

export const clearLoginFailures = (username: string): void => {
  failures.delete(keyFor("user", username));
};
