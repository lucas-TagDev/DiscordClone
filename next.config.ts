import type { NextConfig } from "next";

const envAllowedOrigins = process.env.ALLOWED_DEV_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // O SDK de áudio do LiveKit é um addon nativo: precisa ficar fora do bundle do servidor.
  serverExternalPackages: ["@livekit/rtc-node"],
  allowedDevOrigins: envAllowedOrigins?.length
    ? envAllowedOrigins
    : [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://192.168.3.41:3000",
        "http://192.168.3.41:3001",
      ],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb" as `${number}${"kb" | "mb" | "gb"}`,
    },
  },
  async headers() {
    return [
      {
        // Cabeçalhos básicos de segurança em todas as páginas
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // Arquivos enviados pelos usuários: nunca executam script, mesmo se abertos direto
        source: "/uploads/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // script-src 'none' bloqueia JavaScript; imagens, vídeos e PDFs continuam abrindo normalmente
          { key: "Content-Security-Policy", value: "script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
