import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateUser } from "@/lib/store";
import { createAuthToken, getAuthCookieName, getAuthTokenTtlSeconds } from "@/lib/auth";
import { isTurnstileEnabled, verifyTurnstileToken } from "@/lib/turnstile";

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
  try {
    const body = loginSchema.parse(await request.json());

    // Validar Turnstile se estiver habilitado
    if (isTurnstileEnabled()) {
      if (!body.turnstileToken) {
        return NextResponse.json(
          { error: "Verificação de segurança obrigatória." },
          { status: 400 },
        );
      }

      const clientIp = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const isValid = await verifyTurnstileToken(body.turnstileToken, clientIp);
      
      if (!isValid) {
        return NextResponse.json(
          { error: "Verificação de segurança falhou. Tente novamente." },
          { status: 400 },
        );
      }
    }

    const user = await authenticateUser(body.username, body.password);
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
