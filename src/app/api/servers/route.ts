import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApiAuthError, ensureApiRequest, ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId, sanitizeServerForApi } from "@/lib/api-auth";
import { createServer, listServersByUser } from "@/lib/store";

const createServerSchema = z.object({
  name: z.string().min(2).max(40),
  creatorId: z.string().min(2),
});

const MAX_SERVER_AVATAR_SIZE = 10 * 1024 * 1024;

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100) || "server";

const saveServerAvatarFile = async (file: File): Promise<string> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Foto do servidor deve ser uma imagem.");
  }
  if (file.size <= 0) {
    throw new Error("Arquivo da foto do servidor está vazio.");
  }
  if (file.size > MAX_SERVER_AVATAR_SIZE) {
    throw new Error("Foto do servidor excede o limite de 10MB.");
  }

  const avatarsDir = path.join(process.cwd(), "public", "server-avatars");
  await mkdir(avatarsDir, { recursive: true });

  const extension = path.extname(file.name) || ".img";
  const baseName = path.basename(file.name, extension);
  const safeBaseName = sanitizeFileName(baseName);
  const finalFileName = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;
  const finalPath = path.join(avatarsDir, finalFileName);

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  await writeFile(finalPath, fileBuffer);

  return `/server-avatars/${finalFileName}`;
};

export async function GET(request: NextRequest) {
  try {
    ensureApiRequest(request);
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      ensureSameAuthenticatedUser(authenticatedUserId, userId);
    }

    const servers = await listServersByUser(authenticatedUserId);
    const sanitized = servers.map(sanitizeServerForApi);
    return NextResponse.json({ servers: sanitized });
  } catch (error) {
    if (error instanceof ApiAuthError && error.status === 404 && error.message === "Endpoint não disponível para navegação direta.") {
      return new Response("", {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar servidores." },
      { status: getApiErrorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const name = z.string().min(2).max(40).parse(formData.get("name")?.toString());
      const creatorId = z.string().min(2).parse(formData.get("creatorId")?.toString());
      ensureSameAuthenticatedUser(authenticatedUserId, creatorId);
      const avatar = formData.get("avatar");
      const avatarUrl = avatar instanceof File && avatar.name.length > 0
        ? await saveServerAvatarFile(avatar)
        : null;

      const server = await createServer(name, authenticatedUserId, avatarUrl);
      const sanitized = sanitizeServerForApi(server);
      return NextResponse.json({ server: sanitized }, { status: 201 });
    }

    const body = createServerSchema.parse(await request.json());
    ensureSameAuthenticatedUser(authenticatedUserId, body.creatorId);
    const server = await createServer(body.name, authenticatedUserId, null);
    const sanitized = sanitizeServerForApi(server);
    return NextResponse.json({ server: sanitized }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar servidor." },
      { status: getApiErrorStatus(error) },
    );
  }
}
