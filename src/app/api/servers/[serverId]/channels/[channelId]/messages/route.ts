import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId, sanitizeChatMessageForApi } from "@/lib/api-auth";
import { isMusicCommand, maybeHandleMusicCommand } from "@/lib/music-bot/manager";
import { createMessage, listMessagesPage } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";

// Limites configuráveis via .env
const MAX_MESSAGE_LENGTH = Number(process.env.NEXT_PUBLIC_MAX_MESSAGE_LENGTH ?? "2000");
const DEFAULT_MAX_FILE_SIZE = (Number(process.env.CHANNEL_UPLOAD_MAX_FILE_SIZE_MB ?? "50")) * 1024 * 1024;

const createMessageSchema = z.object({
  userId: z.string().min(2),
  userName: z.string().min(1).max(40),
  content: z.string().max(MAX_MESSAGE_LENGTH).default(""),
});

const getMaxFileSize = (): number => {
  const rawValue = process.env.CHANNEL_UPLOAD_MAX_FILE_SIZE_MB ?? process.env.NEXT_PUBLIC_CHANNEL_UPLOAD_MAX_FILE_SIZE_MB;
  const parsedMb = Number(rawValue);
  if (!Number.isFinite(parsedMb) || parsedMb <= 0) {
    return DEFAULT_MAX_FILE_SIZE;
  }

  return Math.floor(parsedMb * 1024 * 1024);
};

const MAX_FILE_SIZE = getMaxFileSize();
const MAX_FILE_SIZE_MB_LABEL = `${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")}`;

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120) || "arquivo";

const saveUploadedFile = async (file: File): Promise<{ name: string; url: string; mimeType: string; size: number }> => {
  if (file.size <= 0) {
    throw new Error("Arquivo vazio não é permitido.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`Arquivo ${file.name} excede ${MAX_FILE_SIZE_MB_LABEL}MB.`);
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  const extension = path.extname(file.name);
  const baseName = path.basename(file.name, extension);
  const safeBaseName = sanitizeFileName(baseName);
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;
  const finalPath = path.join(uploadsDir, finalFileName);

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  await writeFile(finalPath, fileBuffer);

  return {
    name: file.name,
    url: `/uploads/${finalFileName}`,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };
};

type Params = {
  params: Promise<{ serverId: string; channelId: string }>;
};

/**
 * Os comandos de música rodam em paralelo para não atrasar a resposta do envio.
 */
const dispatchMusicCommand = (serverId: string, channelId: string, message: ChatMessage): void => {
  if (!isMusicCommand(message.content)) {
    return;
  }

  void maybeHandleMusicCommand({
    serverId,
    channelId,
    userId: message.userId,
    userName: message.userName,
    content: message.content,
  }).catch(() => undefined);
};

export async function GET(request: NextRequest, { params }: Params) {
  const { serverId, channelId } = await params;
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "30");
  const beforeCreatedAt = request.nextUrl.searchParams.get("beforeCreatedAt") ?? undefined;
  const beforeId = request.nextUrl.searchParams.get("beforeId") ?? undefined;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      ensureSameAuthenticatedUser(authenticatedUserId, userId);
    }

    const page = await listMessagesPage(serverId, channelId, authenticatedUserId, {
      limit,
      beforeCreatedAt,
      beforeId,
    });
    return NextResponse.json(page);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao buscar mensagens." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { serverId, channelId } = await params;

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const userId = z.string().min(2).parse(formData.get("userId")?.toString());
      const userName = z.string().min(1).max(40).parse(formData.get("userName")?.toString());
      ensureSameAuthenticatedUser(authenticatedUserId, userId);
      const content = z.string().max(2000).parse(formData.get("content")?.toString() ?? "");
      const files = formData
        .getAll("files")
        .filter((entry): entry is File => entry instanceof File && entry.name.length > 0);

      if (!content.trim() && files.length === 0) {
        return NextResponse.json({ error: "Envie texto ou ao menos um arquivo." }, { status: 400 });
      }

      const attachments = await Promise.all(files.map((file) => saveUploadedFile(file)));
      const message = await createMessage(serverId, channelId, authenticatedUserId, userName, content.trim(), attachments);
      const sanitized = sanitizeChatMessageForApi(message);
      dispatchMusicCommand(serverId, channelId, sanitized);
      return NextResponse.json({ message: sanitized }, { status: 201 });
    }

    const body = createMessageSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.userId);
    if (!body.content.trim()) {
      return NextResponse.json({ error: "Conteúdo da mensagem não pode ser vazio." }, { status: 400 });
    }

    const message = await createMessage(serverId, channelId, authenticatedUserId, body.userName, body.content.trim());
    const sanitized = sanitizeChatMessageForApi(message);
    dispatchMusicCommand(serverId, channelId, sanitized);
    return NextResponse.json({ message: sanitized }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao enviar mensagem." },
      { status: getApiErrorStatus(error) },
    );
  }
}
