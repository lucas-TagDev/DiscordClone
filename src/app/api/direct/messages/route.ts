import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId, sanitizeDirectMessageForApi } from "@/lib/api-auth";
import { createDirectMessage, listDirectMessagesPage } from "@/lib/store";
import { parseMultipartFormData, saveParsedFile } from "@/lib/parse-multipart";

// Limites configuráveis via .env
const MAX_MESSAGE_LENGTH = Number(process.env.NEXT_PUBLIC_MAX_MESSAGE_LENGTH ?? "2000");
const getMaxFileSizeBytes = (): number => {
  const rawValue = process.env.CHANNEL_UPLOAD_MAX_FILE_SIZE_MB ?? process.env.NEXT_PUBLIC_CHANNEL_UPLOAD_MAX_FILE_SIZE_MB;
  const parsedMb = Number(rawValue);
  if (!Number.isFinite(parsedMb) || parsedMb <= 0) {
    return 50 * 1024 * 1024;
  }
  return Math.floor(parsedMb * 1024 * 1024);
};

const MAX_FILE_SIZE = getMaxFileSizeBytes();
const MAX_FILE_SIZE_MB_LABEL = `${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")}`;

const createDirectMessageSchema = z.object({
  userId: z.string().trim().min(2),
  content: z.string().trim().max(MAX_MESSAGE_LENGTH),
  conversationId: z.string().trim().optional(),
  targetUserId: z.string().trim().optional(),
});

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "30");
  const beforeCreatedAt = request.nextUrl.searchParams.get("beforeCreatedAt") ?? undefined;
  const beforeId = request.nextUrl.searchParams.get("beforeId") ?? undefined;

  if (!conversationId) {
    return NextResponse.json({ error: "Parâmetro conversationId é obrigatório." }, { status: 400 });
  }

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      ensureSameAuthenticatedUser(authenticatedUserId, userId);
    }

    const page = await listDirectMessagesPage(conversationId, authenticatedUserId, {
      limit,
      beforeCreatedAt,
      beforeId,
    });
    return NextResponse.json(page);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao buscar mensagens diretas." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      // Use streaming multipart parser instead of request.formData() to support large files
      const { fields, files: parsedFiles } = await parseMultipartFormData(request, MAX_FILE_SIZE);

      const userId = z.string().trim().min(2).parse(fields.userId);
      ensureSameAuthenticatedUser(authenticatedUserId, userId);
      const conversationId = fields.conversationId?.trim() || undefined;
      const targetUserId = fields.targetUserId?.trim() || undefined;
      const content = z.string().max(MAX_MESSAGE_LENGTH).parse(fields.content ?? "");

      const trimmedContent = content.trim();
      if (!trimmedContent && parsedFiles.length === 0) {
        return NextResponse.json({ error: "Envie texto, link ou arquivo." }, { status: 400 });
      }

      // Check file sizes
      const oversizedFiles = parsedFiles.filter((f) => f.size > MAX_FILE_SIZE);
      if (oversizedFiles.length > 0) {
        return NextResponse.json(
          { error: `Arquivos excedem o limite de ${MAX_FILE_SIZE_MB_LABEL}MB: ${oversizedFiles.map((f) => f.name).join(", ")}` },
          { status: 400 },
        );
      }

      const attachments = await Promise.all(parsedFiles.map((file) => saveParsedFile(file, "direct")));
      const attachmentLines = attachments.map(
        (attachment) => `[file]|${attachment.name}|${attachment.size}|${attachment.url}`,
      );
      const composedContent = [trimmedContent, ...attachmentLines].filter(Boolean).join("\n");

      const result = await createDirectMessage(authenticatedUserId, {
        content: composedContent,
        conversationId,
        targetUserId,
      });

      const sanitized = {
        ...result,
        message: sanitizeDirectMessageForApi(result.message),
      };
      return NextResponse.json(sanitized, { status: 201 });
    }

    const body = createDirectMessageSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.userId);

    if (!body.content) {
      return NextResponse.json({ error: "Conteúdo da mensagem não pode ser vazio." }, { status: 400 });
    }

    const result = await createDirectMessage(authenticatedUserId, {
      content: body.content,
      conversationId: body.conversationId,
      targetUserId: body.targetUserId,
    });

    const sanitized = {
      ...result,
      message: sanitizeDirectMessageForApi(result.message),
    };
    return NextResponse.json(sanitized, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao enviar mensagem direta." },
      { status: getApiErrorStatus(error) },
    );
  }
}
