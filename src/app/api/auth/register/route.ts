import { NextResponse } from "next/server";
import { z } from "zod";
import { registerUser } from "@/lib/store";
import { createAuthToken, getAuthCookieName, getAuthTokenTtlSeconds } from "@/lib/auth";
import { isTurnstileEnabled, verifyTurnstileToken } from "@/lib/turnstile";

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "Usuário deve conter apenas letras, números, ponto, hífen ou underscore."),
  displayName: z.string().trim().min(1).max(40),
  password: z.string().min(6).max(128),
  turnstileToken: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = registerSchema.parse(await request.json());

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

    const user = await registerUser(body.username, body.displayName, body.password);
    const response = NextResponse.json({ user }, { status: 201 });
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
      { error: error instanceof Error ? error.message : "Falha ao cadastrar usuário." },
      { status: 400 },
    );
  }
}
