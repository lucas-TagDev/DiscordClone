import { isIP } from "node:net";

// The reverse proxy must overwrite these headers with the actual client address.
export const getClientIp = (headers: Headers): string | null => {
  for (const value of [headers.get("x-real-ip"), headers.get("x-forwarded-for")?.split(",")[0]]) {
    const candidate = value?.trim();
    if (candidate && isIP(candidate)) return candidate;
  }
  return null;
};
