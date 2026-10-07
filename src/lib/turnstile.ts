/**
 * Valida um token do Cloudflare Turnstile
 * @param token - Token recebido do frontend
 * @param remoteIp - IP do cliente (opcional)
 * @returns true se válido, false caso contrário
 */
export async function verifyTurnstileToken(token: string, remoteIp?: string): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  
  if (!secretKey) {
    console.error("TURNSTILE_SECRET_KEY não configurada");
    return false;
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) {
      formData.append("remoteip", remoteIp);
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const data = await response.json() as { success: boolean };
    return data.success;
  } catch (error) {
    console.error("Erro ao verificar Turnstile:", error);
    return false;
  }
}

/**
 * Verifica se o Turnstile está habilitado
 */
export function isTurnstileEnabled(): boolean {
  return process.env.ENABLE_TURNSTILE === "true";
}
