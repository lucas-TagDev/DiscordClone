import { getClientIp } from "@/lib/client-ip";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateUser } from "@/lib/store";
import { createAuthToken, getAuthCookieName, getAuthTokenTtlSeconds } from "@/lib/auth";
import { isTurnstileEnabled, verifyTurnstileToken } from "@/lib/turnstile";
import { clearLoginFailures, getLoginRetryAfterSeconds, registerLoginFailure } from "@/lib/login-rate-limit";

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "Usuário inválido."),
  password: z.string().min(6).max(128),
  turnstileToken: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const clientIpForLimit = getClientIp(request.headers);
  try {
    const body = loginSchema.parse(await request.json());

    const retryAfterSeconds = getLoginRetryAfterSeconds(body.username, clientIpForLimit);
    if (retryAfterSeconds > 0) {
      const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
      return NextResponse.json(
        { error: `Muitas tentativas de login. Tente novamente em ${minutes} minuto(s).` },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      );
    }

    // Validar Turnstile se estiver habilitado
    if (isTurnstileEnabled()) {
      if (!body.turnstileToken) {
        return NextResponse.json(
          { error: "Verificação de segurança obrigatória." },
          { status: 400 },
        );
      }

      const clientIp = getClientIp(request.headers) ?? undefined;
      const isValid = await verifyTurnstileToken(body.turnstileToken, clientIp);
      
      if (!isValid) {
        return NextResponse.json(
          { error: "Verificação de segurança falhou. Tente novamente." },
          { status: 400 },
        );
      }
    }

    let user;
    try {
      user = await authenticateUser(body.username, body.password, clientIpForLimit);
    } catch (authError) {
      registerLoginFailure(body.username, clientIpForLimit);
      throw authError;
    }
    clearLoginFailures(body.username);
    const response = NextResponse.json({ user });
    response.cookies.set({
      name: getAuthCookieName(),
      value: createAuthToken(user.id),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: getAuthTokenTtlSeconds(),
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao autenticar usuário." },
      { status: 401 },
    );
  }
}
