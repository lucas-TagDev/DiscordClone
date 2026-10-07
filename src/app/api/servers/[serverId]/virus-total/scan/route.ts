import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getServerVirusTotalScanConfig } from "@/lib/store";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";

const scanRequestSchema = z.object({
  userId: z.string().trim().min(2),
  fileUrl: z.string().trim().min(1),
});

type Params = {
  params: Promise<{ serverId: string }>;
};
const VT_DIRECT_UPLOAD_MAX_BYTES = 32 * 1024 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type VirusTotalStats = {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
  timeout: number;
  failure: number;
};

const toNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const parseVirusTotalStats = (stats: unknown): VirusTotalStats | null => {
  if (!stats || typeof stats !== "object") {
    return null;
  }

  const source = stats as Record<string, unknown>;
  return {
    malicious: toNumber(source.malicious),
    suspicious: toNumber(source.suspicious),
    harmless: toNumber(source.harmless),
    undetected: toNumber(source.undetected),
    timeout: toNumber(source.timeout),
    failure: toNumber(source.failure),
  };
};

const getVerdictFromStats = (stats: VirusTotalStats): "clean" | "unsafe" =>
  stats.malicious > 0 || stats.suspicious > 0 ? "unsafe" : "clean";

const buildResultFromStats = (fileHash: string, stats: VirusTotalStats) => ({
  verdict: getVerdictFromStats(stats),
  scanEnabled: true,
  sha256: fileHash,
  stats,
});

const resolveUploadFilePath = (fileUrl: string): string => {
  if (!fileUrl.startsWith("/uploads/")) {
    throw new Error("Arquivo inválido para análise.");
  }

  const normalized = path.normalize(fileUrl.replace(/^\/+/, ""));
  if (!normalized.startsWith("uploads")) {
    throw new Error("Caminho de arquivo inválido.");
  }

  const safeRelative = normalized.replace(/^uploads[\\/]/, "uploads/");
  return path.join(process.cwd(), "public", safeRelative);
};

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const body = scanRequestSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.userId);
    const scanConfig = await getServerVirusTotalScanConfig(serverId, authenticatedUserId);

    if (!scanConfig.enabled) {
      return NextResponse.json({ verdict: "disabled", scanEnabled: false });
    }

    const serverApiKey = scanConfig.apiKey;

    if (!serverApiKey) {
      return NextResponse.json(
        { error: "Scan VirusTotal ativado, mas a chave não está configurada no servidor." },
        { status: 400 },
      );
    }

    const fullPath = resolveUploadFilePath(body.fileUrl);
    const fileBuffer = await readFile(fullPath);
    const fileHash = createHash("sha256").update(fileBuffer).digest("hex");

    const response = await fetch(`https://www.virustotal.com/api/v3/files/${fileHash}`, {
      method: "GET",
      headers: {
        "x-apikey": serverApiKey,
      },
      cache: "no-store",
    });

    if (response.status === 404) {
      if (fileBuffer.length > VT_DIRECT_UPLOAD_MAX_BYTES) {
        return NextResponse.json({
          verdict: "unknown",
          scanEnabled: true,
          sha256: fileHash,
          message: "Arquivo sem relatório no VirusTotal e excede 32MB para envio automático na API gratuita.",
        });
      }

      const formData = new FormData();
      const blob = new Blob([new Uint8Array(fileBuffer)], { type: "application/octet-stream" });
      formData.append("file", blob, path.basename(fullPath));

      const uploadResponse = await fetch("https://www.virustotal.com/api/v3/files", {
        method: "POST",
        headers: {
          "x-apikey": serverApiKey,
        },
        body: formData,
        cache: "no-store",
      });

      if (!uploadResponse.ok) {
        const uploadFailurePayload = await uploadResponse.json().catch(() => null);
        const uploadFailureMessage =
          (uploadFailurePayload && typeof uploadFailurePayload.error?.message === "string" && uploadFailurePayload.error.message) ||
          "Falha ao enviar arquivo para análise no VirusTotal.";

        return NextResponse.json({
          verdict: "unknown",
          scanEnabled: true,
          sha256: fileHash,
          message: uploadFailureMessage,
        });
      }

      const uploadPayload = await uploadResponse.json() as {
        data?: {
          id?: string;
        };
      };

      const analysisId = uploadPayload.data?.id;
      if (!analysisId) {
        return NextResponse.json({
          verdict: "unknown",
          scanEnabled: true,
          sha256: fileHash,
          message: "Arquivo enviado para análise, mas o ID de análise não foi retornado.",
        });
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          await sleep(3000);
        }

        const analysisResponse = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, {
          method: "GET",
          headers: {
            "x-apikey": serverApiKey,
          },
          cache: "no-store",
        });

        if (!analysisResponse.ok) {
          continue;
        }

        const analysisPayload = await analysisResponse.json() as {
          data?: {
            attributes?: {
              status?: string;
              stats?: unknown;
            };
          };
        };

        const status = analysisPayload.data?.attributes?.status;
        const stats = parseVirusTotalStats(analysisPayload.data?.attributes?.stats);

        if (status === "completed" && stats) {
          return NextResponse.json(buildResultFromStats(fileHash, stats));
        }
      }

      return NextResponse.json({
        verdict: "unknown",
        scanEnabled: true,
        sha256: fileHash,
        message: "Arquivo enviado para análise no VirusTotal. Tente novamente em alguns segundos para obter o veredito final.",
      });
    }

    if (!response.ok) {
      const failurePayload = await response.json().catch(() => null);
      const failureMessage =
        (failurePayload && typeof failurePayload.error?.message === "string" && failurePayload.error.message) ||
        "Falha ao consultar VirusTotal.";
      return NextResponse.json({ error: failureMessage }, { status: 400 });
    }

    const vtPayload = await response.json() as {
      data?: {
        attributes?: {
          last_analysis_stats?: unknown;
        };
      };
    };

    const stats = parseVirusTotalStats(vtPayload.data?.attributes?.last_analysis_stats);
    if (!stats) {
      return NextResponse.json({
        verdict: "unknown",
        scanEnabled: true,
        sha256: fileHash,
        message: "Relatório do VirusTotal indisponível para este arquivo.",
      });
    }

    return NextResponse.json(buildResultFromStats(fileHash, stats));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao analisar arquivo com VirusTotal." },
      { status: getApiErrorStatus(error) },
    );
  }
}
