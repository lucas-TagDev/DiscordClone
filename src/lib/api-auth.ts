import { NextRequest } from "next/server";
import { getAuthCookieName, readUserIdFromAuthToken } from "@/lib/auth";
import { Server, ChatMessage, DirectChatMessage } from "@/lib/types";

export class ApiAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const normalizeUserId = (value: string): string => value.trim().toLowerCase();

export const requireAuthenticatedUserId = (request: NextRequest): string => {
  const token = request.cookies.get(getAuthCookieName())?.value;
  const authenticatedUserId = readUserIdFromAuthToken(token);

  if (!authenticatedUserId) {
    throw new ApiAuthError("Sessão inválida ou expirada.", 401);
  }

  return authenticatedUserId;
};

export const ensureSameAuthenticatedUser = (authenticatedUserId: string, providedUserId: string): string => {
  const normalizedProvidedUserId = normalizeUserId(providedUserId);

  if (normalizeUserId(authenticatedUserId) !== normalizedProvidedUserId) {
    throw new ApiAuthError("Ação não autorizada para este usuário.", 403);
  }

  return normalizedProvidedUserId;
};

export const getApiErrorStatus = (error: unknown, fallbackStatus = 400): number => {
  if (error instanceof ApiAuthError) {
    return error.status;
  }

  return fallbackStatus;
};

export const ensureApiRequest = (request: NextRequest): void => {
  const mode = (request.headers.get("sec-fetch-mode") ?? "").toLowerCase();
  const dest = (request.headers.get("sec-fetch-dest") ?? "").toLowerCase();
  const accept = (request.headers.get("accept") ?? "").toLowerCase();

  const isBrowserNavigation = mode === "navigate" || dest === "document" || accept.includes("text/html");
  if (isBrowserNavigation) {
    throw new ApiAuthError("Endpoint não disponível para navegação direta.", 404);
  }
};

/**
 * Sanitiza dados do servidor para retornar apenas informações públicas/seguras
 * Remove: ownerId, virusTotalApiKey, permissões detalhadas, etc
 */
export const sanitizeServerForApi = (server: Server) => ({
  id: server.id,
  ownerId: server.ownerId,
  name: server.name,
  avatarUrl: server.avatarUrl,
  serverBannerUrl: server.serverBannerUrl,
  virusTotalEnabled: server.virusTotalEnabled,
  virusTotalConfigured: server.virusTotalConfigured,
  allowMemberInvites: server.allowMemberInvites,
  allowModeratorInvites: server.allowModeratorInvites,
  allowMemberSoundUpload: server.allowMemberSoundUpload,
  allowModeratorSoundUpload: server.allowModeratorSoundUpload,
  allowCrossServerSoundShare: server.allowCrossServerSoundShare,
  allowMemberDeleteSounds: server.allowMemberDeleteSounds,
  allowModeratorDeleteSounds: server.allowModeratorDeleteSounds,
  allowMemberStickerCreate: server.allowMemberStickerCreate,
  allowModeratorStickerCreate: server.allowModeratorStickerCreate,
  allowMemberEmojiCreate: server.allowMemberEmojiCreate,
  allowModeratorEmojiCreate: server.allowModeratorEmojiCreate,
  categories: server.categories,
  channels: server.channels,
  members: server.members.map((m) => ({
    userId: m.userId,
    role: m.role,
    createdAt: m.createdAt,
    userName: m.userName,
    avatarUrl: m.avatarUrl,
    permissions: m.permissions,
    notifySoundEnabled: m.notifySoundEnabled,
  })),
  stickers: server.stickers,
  emojis: server.emojis,
});

/**
 * Sanitiza mensagens de canal para remover dados sensíveis
 */
export const sanitizeChatMessageForApi = (message: ChatMessage): ChatMessage => ({
  id: message.id,
  serverId: message.serverId,
  channelId: message.channelId,
  userId: message.userId,
  userName: message.userName,
  userDisplayNameStyle: message.userDisplayNameStyle,
  content: message.content,
  attachments: message.attachments,
  createdAt: message.createdAt,
});

/**
 * Sanitiza mensagens diretas para remover dados sensíveis
 */
export const sanitizeDirectMessageForApi = (message: DirectChatMessage): DirectChatMessage => ({
  id: message.id,
  conversationId: message.conversationId,
  senderId: message.senderId,
  senderName: message.senderName,
  senderAvatarUrl: message.senderAvatarUrl,
  senderDisplayNameStyle: message.senderDisplayNameStyle,
  content: message.content,
  createdAt: message.createdAt,
});
