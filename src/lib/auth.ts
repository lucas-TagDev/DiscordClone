import { createHmac, timingSafeEqual } from "node:crypto";

const AUTH_COOKIE_NAME = "twinslkit_auth";
const AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 12;

const toBase64Url = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

const fromBase64Url = (value: string): string => Buffer.from(value, "base64url").toString("utf8");

const getAuthSecret = (): string => {
  const secret = process.env.AUTH_SECRET ?? process.env.LIVEKIT_API_SECRET;
  if (!secret || secret.trim().length < 16) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET (ou LIVEKIT_API_SECRET) precisa estar configurado com pelo menos 16 caracteres.");
    }

    return "twinslkit-dev-auth-secret";
  }

  return secret;
};

const signPayload = (payload: string): string => {
  return createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
};

export const createAuthToken = (userId: string, now = Date.now()): string => {
  const normalizedUserId = userId.trim().toLowerCase();
  const exp = Math.floor(now / 1000) + AUTH_TOKEN_TTL_SECONDS;
  const encodedUserId = toBase64Url(normalizedUserId);
  const encodedExp = toBase64Url(String(exp));
  const payload = `${encodedUserId}.${encodedExp}`;
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
};

export const readUserIdFromAuthToken = (token: string | undefined | null, now = Date.now()): string | null => {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedUserId, encodedExp, signature] = parts;
  const payload = `${encodedUserId}.${encodedExp}`;
  const expectedSignature = signPayload(payload);

  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  const userId = fromBase64Url(encodedUserId).trim().toLowerCase();
  const exp = Number(fromBase64Url(encodedExp));

  if (!userId || !Number.isFinite(exp)) {
    return null;
  }

  if (Math.floor(now / 1000) > exp) {
    return null;
  }

  return userId;
};

export const getAuthCookieName = (): string => AUTH_COOKIE_NAME;

export const getAuthTokenTtlSeconds = (): number => AUTH_TOKEN_TTL_SECONDS;
