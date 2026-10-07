import { ChannelType as DbChannelType, MemberRole, Prisma, RestrictionType } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { AppUser, ChannelCategory, ChatAttachment, ChatMessage, Channel, ChannelType, DirectChatMessage, DirectConversation, DirectFriend, DisplayNameStyle, MessageReaction, ModeratorPermissions, Role, Server, ServerBan, ServerEmoji, ServerInvite, ServerMember, ServerSound, ServerSticker } from "@/lib/types";

type MessagePageOptions = {
  limit?: number;
  beforeCreatedAt?: string;
  beforeId?: string;
};

type DirectMessagePageOptions = {
  limit?: number;
  beforeCreatedAt?: string;
  beforeId?: string;
};

export const NO_PASSWORD_HASH = "__NO_PASSWORD__";

const normalizeUserId = (value: string): string => value.trim().toLowerCase();
const normalizeUsername = (value: string): string => value.trim().toLowerCase();
const normalizeDisplayName = (value: string): string => value.trim();
const hasPasswordConfigured = (passwordHash: string): boolean => passwordHash !== NO_PASSWORD_HASH;

const getDisplayNameByUserId = async (userId: string): Promise<string | null> => {
  const user = await db.user.findUnique({
    where: { id: normalizeUserId(userId) },
    select: { displayName: true },
  });

  return user?.displayName ?? null;
};

const USER_ID_DIGITS = 18;
const USER_ID_GENERATION_ATTEMPTS = 50;

const readEnvPositiveInt = (key: string, fallback: number, min: number, max: number): number => {
  const rawValue = process.env[key];
  const parsedValue = Number(rawValue);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  const normalizedValue = Math.floor(parsedValue);
  if (normalizedValue < min || normalizedValue > max) {
    return fallback;
  }

  return normalizedValue;
};

const SPAM_RATE_WINDOW_MS = readEnvPositiveInt("SPAM_RATE_WINDOW_MS", 10_000, 1_000, 120_000);
const SPAM_MAX_MESSAGES_PER_WINDOW = readEnvPositiveInt("SPAM_MAX_MESSAGES_PER_WINDOW", 6, 2, 100);
const SPAM_DUPLICATE_WINDOW_MS = readEnvPositiveInt("SPAM_DUPLICATE_WINDOW_MS", 15_000, 1_000, 180_000);
const SPAM_MAX_IDENTICAL_MESSAGES = readEnvPositiveInt("SPAM_MAX_IDENTICAL_MESSAGES", 2, 1, 20);
const SPAM_TEMP_BLOCK_MS = readEnvPositiveInt("SPAM_TEMP_BLOCK_MS", 15_000, 1_000, 600_000);

type SpamGuardState = {
  timestamps: number[];
  recentFingerprints: Array<{ fingerprint: string; at: number }>;
  blockedUntil: number;
};

const spamGuardStateByScope = new Map<string, SpamGuardState>();

const normalizeSpamFingerprint = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const assertMessageNotSpam = (scope: string, userId: string, content: string) => {
  const now = Date.now();
  const key = `${scope}:${normalizeUserId(userId)}`;
  const state = spamGuardStateByScope.get(key) ?? {
    timestamps: [],
    recentFingerprints: [],
    blockedUntil: 0,
  };

  state.timestamps = state.timestamps.filter((timestamp) => now - timestamp <= SPAM_RATE_WINDOW_MS);
  state.recentFingerprints = state.recentFingerprints.filter((entry) => now - entry.at <= SPAM_DUPLICATE_WINDOW_MS);

  if (state.blockedUntil > now) {
    const waitSeconds = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
    spamGuardStateByScope.set(key, state);
    throw new Error(`Muitas mensagens em sequência. Aguarde ${waitSeconds}s para enviar novamente.`);
  }

  if (state.timestamps.length >= SPAM_MAX_MESSAGES_PER_WINDOW) {
    state.blockedUntil = now + SPAM_TEMP_BLOCK_MS;
    spamGuardStateByScope.set(key, state);
    throw new Error("Detectamos possível spam. Aguarde alguns segundos e tente novamente.");
  }

  const fingerprint = normalizeSpamFingerprint(content) || "[empty]";
  const identicalCount = state.recentFingerprints.filter((entry) => entry.fingerprint === fingerprint).length;
  if (identicalCount >= SPAM_MAX_IDENTICAL_MESSAGES) {
    state.blockedUntil = now + SPAM_TEMP_BLOCK_MS;
    spamGuardStateByScope.set(key, state);
    throw new Error("Mensagem repetida muitas vezes em pouco tempo. Aguarde antes de reenviar.");
  }

  state.timestamps.push(now);
  state.recentFingerprints.push({ fingerprint, at: now });
  spamGuardStateByScope.set(key, state);
};

const generateRandomNumericUserId = (): string => {
  let generated = "";
  while (generated.length < USER_ID_DIGITS) {
    generated += Math.floor(Math.random() * 10).toString();
  }
  return generated.slice(0, USER_ID_DIGITS);
};

const mapChannelType = (type: DbChannelType): ChannelType =>
  type === "voice" ? "voice" : "text";

const mapRole = (role: MemberRole): Role => {
  if (role === "admin") return "admin";
  if (role === "moderator") return "moderator";
  return "member";
};

const normalizePermissions = (permissions?: Partial<ModeratorPermissions>): ModeratorPermissions => ({
  canRemoveMembers: permissions?.canRemoveMembers ?? false,
  canBanUsers: permissions?.canBanUsers ?? false,
  canTimeoutVoice: permissions?.canTimeoutVoice ?? false,
  canDeleteUserMessages: permissions?.canDeleteUserMessages ?? false,
  canKickFromVoice: permissions?.canKickFromVoice ?? false,
  canMoveVoiceUsers: permissions?.canMoveVoiceUsers ?? false,
  canManageInvites: permissions?.canManageInvites ?? false,
});

const getRestrictionReason = (reason: string | null, fallback: string) =>
  reason?.trim() ? `${fallback} Motivo: ${reason.trim()}` : fallback;

const getActiveRestriction = async (
  serverId: string,
  userId: string,
  type: RestrictionType,
) => {
  const now = new Date();
  return db.serverRestriction.findFirst({
    where: {
      serverId,
      userId: normalizeUserId(userId),
      type,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });
};

const ensureNoActiveServerBan = async (serverId: string, userId: string) => {
  const activeBan = await getActiveRestriction(serverId, userId, "server_ban");
  if (!activeBan) {
    return;
  }

  throw new Error(getRestrictionReason(activeBan.reason, "Você foi banido deste servidor."));
};

const getActiveServerBanUserIds = async (serverId: string): Promise<Set<string>> => {
  const now = new Date();
  const activeBans = await db.serverRestriction.findMany({
    where: {
      serverId,
      type: "server_ban",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      userId: true,
    },
  });

  return new Set(activeBans.map((ban) => ban.userId));
};

const mapServer = (server: {
  id: string;
  name: string;
  avatarUrl: string | null;
  serverBannerUrl: string | null;
  ownerId: string;
  virusTotalEnabled: boolean;
  virusTotalApiKey: string | null;
  allowMemberInvites: boolean;
  allowModeratorInvites: boolean;
  allowMemberSoundUpload: boolean;
  allowModeratorSoundUpload: boolean;
  allowCrossServerSoundShare: boolean;
  allowMemberDeleteSounds: boolean;
  allowModeratorDeleteSounds: boolean;
  allowMemberStickerCreate: boolean;
  allowModeratorStickerCreate: boolean;
  allowMemberEmojiCreate: boolean;
  allowModeratorEmojiCreate: boolean;
  messages?: {
    createdAt: Date;
    userId: string;
  }[];
  categories: { id: string; name: string }[];
  stickers: {
    id: string;
    serverId: string;
    createdById: string;
    name: string;
    url: string;
    mimeType: string;
    size: number;
    createdAt: Date;
    createdBy: {
      displayName: string;
    };
  }[];
  emojis: {
    id: string;
    serverId: string;
    createdById: string;
    name: string;
    url: string;
    mimeType: string;
    size: number;
    createdAt: Date;
    createdBy: {
      displayName: string;
    };
  }[];
  channels: {
    id: string;
    name: string;
    type: DbChannelType;
    categoryId: string | null;
    allowMemberView: boolean;
    allowModeratorView: boolean;
    allowMemberAccess: boolean;
    allowModeratorAccess: boolean;
    allowMemberSendMessages: boolean;
    allowModeratorSendMessages: boolean;
    allowMemberSendFiles: boolean;
    allowModeratorSendFiles: boolean;
    allowMemberSendLinks: boolean;
    allowModeratorSendLinks: boolean;
    allowMemberDeleteMessages: boolean;
    allowModeratorDeleteMessages: boolean;
    messages?: {
      createdAt: Date;
      userId: string;
    }[];
  }[];
  members: {
    userId: string;
    role: MemberRole;
    createdAt: Date;
    canRemoveMembers: boolean;
    canBanUsers: boolean;
    canTimeoutVoice: boolean;
    canDeleteUserMessages: boolean;
    canKickFromVoice: boolean;
    canMoveVoiceUsers: boolean;
    canManageInvites: boolean;
    notifySoundEnabled: boolean;
    user: { displayName: string; avatarUrl: string | null };
  }[];
}): Server => ({
  id: server.id,
  name: server.name,
  avatarUrl: server.avatarUrl,
  serverBannerUrl: server.serverBannerUrl,
  ownerId: server.ownerId,
  virusTotalEnabled: server.virusTotalEnabled,
  virusTotalConfigured: !!server.virusTotalApiKey,
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
  lastMessageAt: server.messages?.[0]?.createdAt.toISOString() ?? null,
  lastMessageUserId: server.messages?.[0]?.userId ?? null,
  categories: server.categories.map((category): ChannelCategory => ({
    id: category.id,
    name: category.name,
  })),
  channels: server.channels.map((channel): Channel => ({
    id: channel.id,
    name: channel.name,
    type: mapChannelType(channel.type),
    categoryId: channel.categoryId,
    allowMemberView: channel.allowMemberView,
    allowModeratorView: channel.allowModeratorView,
    allowMemberAccess: channel.allowMemberAccess,
    allowModeratorAccess: channel.allowModeratorAccess,
    allowMemberSendMessages: channel.allowMemberSendMessages,
    allowModeratorSendMessages: channel.allowModeratorSendMessages,
    allowMemberSendFiles: channel.allowMemberSendFiles,
    allowModeratorSendFiles: channel.allowModeratorSendFiles,
    allowMemberSendLinks: channel.allowMemberSendLinks,
    allowModeratorSendLinks: channel.allowModeratorSendLinks,
    allowMemberDeleteMessages: channel.allowMemberDeleteMessages,
    allowModeratorDeleteMessages: channel.allowModeratorDeleteMessages,
    lastMessageAt: channel.messages?.[0]?.createdAt.toISOString() ?? null,
    lastMessageUserId: channel.messages?.[0]?.userId ?? null,
  })),
  stickers: server.stickers.map((sticker): ServerSticker => ({
    id: sticker.id,
    serverId: sticker.serverId,
    createdById: sticker.createdById,
    createdByName: sticker.createdBy.displayName,
    name: sticker.name,
    url: sticker.url,
    mimeType: sticker.mimeType,
    size: sticker.size,
    createdAt: sticker.createdAt.toISOString(),
  })),
  emojis: server.emojis.map((emoji): ServerEmoji => ({
    id: emoji.id,
    serverId: emoji.serverId,
    createdById: emoji.createdById,
    createdByName: emoji.createdBy.displayName,
    name: emoji.name,
    url: emoji.url,
    mimeType: emoji.mimeType,
    size: emoji.size,
    createdAt: emoji.createdAt.toISOString(),
  })),
  members: server.members.map((member): ServerMember => ({
    userId: member.userId,
    role: mapRole(member.role),
    createdAt: member.createdAt.toISOString(),
    userName: member.user.displayName,
    avatarUrl: member.user.avatarUrl,
    permissions: {
      canRemoveMembers: member.canRemoveMembers,
      canBanUsers: member.canBanUsers,
      canTimeoutVoice: member.canTimeoutVoice,
      canDeleteUserMessages: member.canDeleteUserMessages,
      canKickFromVoice: member.canKickFromVoice,
      canMoveVoiceUsers: member.canMoveVoiceUsers,
      canManageInvites: member.canManageInvites,
    },
    notifySoundEnabled: member.notifySoundEnabled,
  })),
});

const assertCanManageInvites = async (serverId: string, actorId: string) => {
  const actor = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizeUserId(actorId),
      },
    },
    select: {
      userId: true,
      role: true,
      server: {
        select: {
          allowMemberInvites: true,
          allowModeratorInvites: true,
        },
      },
    },
  });

  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }

  if (actor.role === "admin") {
    return actor;
  }

  if (actor.role === "moderator") {
    if (!actor.server.allowModeratorInvites) {
      throw new Error("Moderadores não podem gerenciar convites neste servidor.");
    }
    return actor;
  }

  if (actor.role === "member") {
    if (!actor.server.allowMemberInvites) {
      throw new Error("Membros não podem gerenciar convites neste servidor.");
    }
    return actor;
  }

  throw new Error("Você não tem permissão para gerenciar convites.");
};

const getMembershipRecord = async (serverId: string, userId: string) => {
  return db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizeUserId(userId),
      },
    },
  });
};

const ensureServerMember = async (serverId: string, userId: string) => {
  const member = await getMembershipRecord(serverId, userId);
  if (!member) {
    throw new Error("Você não participa desse servidor.");
  }

  return member;
};

const assertServerAdmin = async (serverId: string, actorId: string) => {
  const actor = await getMembershipRecord(serverId, actorId);
  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }

  if (actor.role !== "admin") {
    throw new Error("Apenas administradores podem executar esta ação.");
  }

  return actor;
};

const ensureUserRecord = async (userId: string, displayName?: string) => {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedDisplayName = displayName ? normalizeDisplayName(displayName) : normalizedUserId;

  const existingUser = await db.user.findUnique({ where: { id: normalizedUserId } });
  if (!existingUser) {
    return db.user.create({
      data: {
        id: normalizedUserId,
        username: normalizedUserId,
        displayName: normalizedDisplayName || normalizedUserId,
        passwordHash: NO_PASSWORD_HASH,
      },
    });
  }

  if (displayName && existingUser.displayName !== normalizedDisplayName) {
    return db.user.update({
      where: { id: normalizedUserId },
      data: { displayName: normalizedDisplayName || existingUser.displayName },
    });
  }

  return existingUser;
};

const getServer = async (serverId: string) => {
  const server = await db.server.findUnique({
    where: { id: serverId },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      serverBannerUrl: true,
      ownerId: true,
      virusTotalEnabled: true,
      virusTotalApiKey: true,
      allowMemberInvites: true,
      allowModeratorInvites: true,
      allowMemberSoundUpload: true,
      allowModeratorSoundUpload: true,
      allowCrossServerSoundShare: true,
      allowMemberDeleteSounds: true,
      allowModeratorDeleteSounds: true,
      allowMemberStickerCreate: true,
      allowModeratorStickerCreate: true,
      allowMemberEmojiCreate: true,
      allowModeratorEmojiCreate: true,
      categories: true,
      stickers: {
        include: {
          createdBy: {
            select: {
              displayName: true,
            },
          },
        },
      },
      emojis: {
        include: {
          createdBy: {
            select: {
              displayName: true,
            },
          },
        },
      },
      channels: {
        include: {
          messages: {
            select: {
              createdAt: true,
              userId: true,
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        },
      },
      members: {
        include: {
          user: {
            select: {
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  });

  if (!server) {
    throw new Error("Servidor não encontrado.");
  }
  return server;
};

const getChannel = (server: Server, channelId: string): Channel => {
  const channel = server.channels.find((item) => item.id === channelId);
  if (!channel) {
    throw new Error("Canal não encontrado.");
  }
  return channel;
};

const canRoleAccessChannel = (channel: Channel, role: Role): boolean => {
  if (role === "admin") {
    return true;
  }
  if (role === "moderator") {
    return channel.allowModeratorAccess;
  }
  return channel.allowMemberAccess;
};

const canRoleViewChannel = (channel: Channel, role: Role): boolean => {
  if (role === "admin") {
    return true;
  }
  if (role === "moderator") {
    return channel.allowModeratorView;
  }
  return channel.allowMemberView;
};

const canRoleSendMessagesInChannel = (channel: Channel, role: Role): boolean => {
  if (role === "admin") {
    return true;
  }
  if (role === "moderator") {
    return channel.allowModeratorSendMessages;
  }
  return channel.allowMemberSendMessages;
};

const canRoleSendFilesInChannel = (channel: Channel, role: Role): boolean => {
  if (role === "admin") {
    return true;
  }
  if (role === "moderator") {
    return channel.allowModeratorSendFiles;
  }
  return channel.allowMemberSendFiles;
};

const canRoleSendLinksInChannel = (channel: Channel, role: Role): boolean => {
  if (role === "admin") {
    return true;
  }
  if (role === "moderator") {
    return channel.allowModeratorSendLinks;
  }
  return channel.allowMemberSendLinks;
};

const canRoleDeleteMessagesInChannel = (channel: Channel, role: Role): boolean => {
  if (role === "admin") {
    return true;
  }
  if (role === "moderator") {
    return channel.allowModeratorDeleteMessages;
  }
  return channel.allowMemberDeleteMessages;
};

const hasLinkContent = (content: string): boolean => {
  const linkPattern = /(https?:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,}(?:\/|\b))/i;
  return linkPattern.test(content);
};

const DIRECT_UPLOAD_URL_PATTERN = /\/uploads\/direct\/[^\s]+/gi;

const extractDirectUploadUrls = (content: string): string[] => {
  const matches = content.match(DIRECT_UPLOAD_URL_PATTERN);
  return matches ? Array.from(new Set(matches)) : [];
};

const removeDirectUploadUrlFromContent = (content: string, attachmentUrl: string): string => {
  const lines = content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !line.includes(attachmentUrl));

  return lines.join("\n").trim();
};

const getMember = (server: Server, userId: string): ServerMember | undefined => {
  const normalizedUserId = normalizeUserId(userId);
  return server.members.find((item) => normalizeUserId(item.userId) === normalizedUserId);
};

const parseDisplayNameStyle = (styleJson: string | null | undefined): DisplayNameStyle => {
  if (!styleJson) return {};
  try {
    return JSON.parse(styleJson) as DisplayNameStyle;
  } catch {
    return {};
  }
};

const mapAppUser = (user: {
  id: string;
  displayName: string;
  displayNameStyle?: string | null;
  avatarUrl: string | null;
  joinWithMicEnabled: boolean;
  joinWithCameraEnabled: boolean;
  noiseSuppressionEnabled: boolean;
  chatNotificationSoundEnabled: boolean;
  micGain: number;
  keybinds?: string | null;
}): AppUser => ({
  id: user.id,
  displayName: user.displayName,
  displayNameStyle: parseDisplayNameStyle(user.displayNameStyle),
  avatarUrl: user.avatarUrl,
  joinWithMicEnabled: user.joinWithMicEnabled,
  joinWithCameraEnabled: user.joinWithCameraEnabled,
  noiseSuppressionEnabled: user.noiseSuppressionEnabled,
  chatNotificationSoundEnabled: user.chatNotificationSoundEnabled,
  micGain: user.micGain,
  keybinds: (() => { try { return JSON.parse(user.keybinds || "{}"); } catch { return {}; } })(),
});

const mapServerSound = (sound: {
  id: string;
  serverId: string;
  server: {
    name: string;
  };
  createdById: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  durationSeconds: number;
  gifUrl?: string | null;
  createdAt: Date;
  createdBy: {
    displayName: string;
  };
  favoritedBy?: {
    userId: string;
  }[];
}): ServerSound => ({
  id: sound.id,
  serverId: sound.serverId,
  sourceServerName: sound.server.name,
  createdById: sound.createdById,
  createdByName: sound.createdBy.displayName,
  isFavorite: (sound.favoritedBy?.length ?? 0) > 0,
  name: sound.name,
  url: sound.url,
  mimeType: sound.mimeType,
  size: sound.size,
  durationSeconds: sound.durationSeconds,
  gifUrl: sound.gifUrl ?? null,
  createdAt: sound.createdAt.toISOString(),
});

export const listServersByUser = async (userId: string): Promise<Server[]> => {
  const normalizedUserId = normalizeUserId(userId);
  await ensureUserRecord(normalizedUserId);
  const now = new Date();

  const servers = await db.server.findMany({
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      serverBannerUrl: true,
      ownerId: true,
      virusTotalEnabled: true,
      virusTotalApiKey: true,
      allowMemberInvites: true,
      allowModeratorInvites: true,
      allowMemberSoundUpload: true,
      allowModeratorSoundUpload: true,
      allowCrossServerSoundShare: true,
      allowMemberDeleteSounds: true,
      allowModeratorDeleteSounds: true,
      allowMemberStickerCreate: true,
      allowModeratorStickerCreate: true,
      allowMemberEmojiCreate: true,
      allowModeratorEmojiCreate: true,
      messages: {
        select: {
          createdAt: true,
          userId: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
      categories: true,
      stickers: {
        include: {
          createdBy: {
            select: {
              displayName: true,
            },
          },
        },
      },
      emojis: {
        include: {
          createdBy: {
            select: {
              displayName: true,
            },
          },
        },
      },
      channels: true,
      members: {
        include: {
          user: {
            select: {
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
    where: {
      members: {
        some: {
          userId: normalizedUserId,
        },
      },
      // Exclude servers where the user is banned
      NOT: {
        restrictions: {
          some: {
            userId: normalizedUserId,
            type: "server_ban",
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return servers.map(mapServer);
};

export const createServer = async (
  name: string,
  creatorId: string,
  avatarUrl?: string | null,
): Promise<Server> => {
  const normalizedCreatorId = normalizeUserId(creatorId);
  await ensureUserRecord(normalizedCreatorId);

  const server = await db.server.create({
    data: {
      name,
      avatarUrl: avatarUrl ?? null,
      ownerId: normalizedCreatorId,
      members: {
        create: {
          userId: normalizedCreatorId,
          role: "admin",
        },
      },
      channels: {
        create: [
          { name: "geral", type: "text" },
          { name: "voz-geral", type: "voice" },
        ],
      },
    },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      serverBannerUrl: true,
      ownerId: true,
      virusTotalEnabled: true,
      virusTotalApiKey: true,
      allowMemberInvites: true,
      allowModeratorInvites: true,
      allowMemberSoundUpload: true,
      allowModeratorSoundUpload: true,
      allowCrossServerSoundShare: true,
      allowMemberDeleteSounds: true,
      allowModeratorDeleteSounds: true,
      allowMemberStickerCreate: true,
      allowModeratorStickerCreate: true,
      allowMemberEmojiCreate: true,
      allowModeratorEmojiCreate: true,
      categories: true,
      stickers: {
        include: {
          createdBy: {
            select: {
              displayName: true,
            },
          },
        },
      },
      emojis: {
        include: {
          createdBy: {
            select: {
              displayName: true,
            },
          },
        },
      },
      channels: true,
      members: {
        include: {
          user: {
            select: {
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  });

  return mapServer(server);
};

const assertServerOwner = async (serverId: string, actorId: string) => {
  const server = await db.server.findUnique({
    where: { id: serverId },
    select: { id: true, ownerId: true, avatarUrl: true, serverBannerUrl: true, virusTotalEnabled: true, virusTotalApiKey: true },
  });

  if (!server) {
    throw new Error("Servidor não encontrado.");
  }

  const normalizedActorId = normalizeUserId(actorId);
  if (server.ownerId !== normalizedActorId) {
    throw new Error("Apenas o dono do servidor pode executar esta ação.");
  }

  return server;
};

const assertServerOwnerOrAdmin = async (serverId: string, actorId: string) => {
  const normalizedActorId = normalizeUserId(actorId);
  const server = await db.server.findUnique({
    where: { id: serverId },
    select: {
      id: true,
      ownerId: true,
      members: {
        where: {
          userId: normalizedActorId,
        },
        select: {
          role: true,
        },
        take: 1,
      },
    },
  });

  if (!server) {
    throw new Error("Servidor não encontrado.");
  }

  if (server.ownerId === normalizedActorId) {
    return;
  }

  const actorRole = server.members[0]?.role ?? null;
  if (actorRole !== "admin") {
    throw new Error("Apenas dono ou administradores podem executar esta ação.");
  }
};

const getServerActorAccess = async (serverId: string, actorId: string) => {
  const normalizedActorId = normalizeUserId(actorId);
  const server = await db.server.findUnique({
    where: { id: serverId },
    select: {
      id: true,
      ownerId: true,
      avatarUrl: true,
      serverBannerUrl: true,
      virusTotalEnabled: true,
      virusTotalApiKey: true,
      members: {
        where: {
          userId: normalizedActorId,
        },
        select: {
          role: true,
        },
        take: 1,
      },
    },
  });

  if (!server) {
    throw new Error("Servidor não encontrado.");
  }

  const actorRole = server.ownerId === normalizedActorId ? "admin" : server.members[0]?.role ?? null;
  if (!actorRole) {
    throw new Error("Você não participa deste servidor.");
  }

  return {
    server,
    isOwner: server.ownerId === normalizedActorId,
    canManageBanner: actorRole === "admin" || actorRole === "moderator",
    canManageServerPermissionFlags: actorRole === "admin",
  };
};

export const updateServerSettings = async (
  serverId: string,
  actorId: string,
  payload: {
    name?: string;
    avatarUrl?: string | null;
    removeAvatar?: boolean;
    serverBannerUrl?: string | null;
    removeServerBanner?: boolean;
    virusTotalEnabled?: boolean;
    virusTotalApiKey?: string;
    allowMemberInvites?: boolean;
    allowModeratorInvites?: boolean;
    allowMemberSoundUpload?: boolean;
    allowModeratorSoundUpload?: boolean;
    allowCrossServerSoundShare?: boolean;
    allowMemberDeleteSounds?: boolean;
    allowModeratorDeleteSounds?: boolean;
    allowMemberStickerCreate?: boolean;
    allowModeratorStickerCreate?: boolean;
    allowMemberEmojiCreate?: boolean;
    allowModeratorEmojiCreate?: boolean;
  },
): Promise<{ server: Server; previousAvatarUrl: string | null; previousServerBannerUrl: string | null }> => {
  // Segurança: validar que APENAS usuários autenticados e membros do servidor podem alterar permissões
  if (!actorId || actorId.trim().length === 0) {
    throw new Error("Usuário não autenticado. Ação negada.");
  }

  const normalizedActorId = normalizeUserId(actorId);
  // Esta chamada valida que o usuário é membro do servidor; lança erro se não for
  const { server: current, isOwner, canManageBanner, canManageServerPermissionFlags } = await getServerActorAccess(serverId, actorId);

  const requestedOwnerOnlyChange =
    payload.name !== undefined ||
    payload.avatarUrl !== undefined ||
    payload.removeAvatar !== undefined ||
    payload.virusTotalEnabled !== undefined ||
    payload.virusTotalApiKey !== undefined;

  const requestedPermissionFlagsChange =
    payload.allowMemberInvites !== undefined ||
    payload.allowModeratorInvites !== undefined ||
    payload.allowMemberSoundUpload !== undefined ||
    payload.allowModeratorSoundUpload !== undefined ||
    payload.allowCrossServerSoundShare !== undefined ||
    payload.allowMemberDeleteSounds !== undefined ||
    payload.allowModeratorDeleteSounds !== undefined ||
    payload.allowMemberStickerCreate !== undefined ||
    payload.allowModeratorStickerCreate !== undefined ||
    payload.allowMemberEmojiCreate !== undefined ||
    payload.allowModeratorEmojiCreate !== undefined;

  const requestedBannerChange = payload.serverBannerUrl !== undefined || payload.removeServerBanner !== undefined;

  // Validações de segurança: apenas usuários autenticados com permissões corretas podem alterar
  if (requestedOwnerOnlyChange && !isOwner) {
    throw new Error("Apenas o dono do servidor pode executar esta ação.");
  }

  if (requestedPermissionFlagsChange && !canManageServerPermissionFlags) {
    throw new Error("Apenas dono e administradores podem alterar essas permissões do servidor.");
  }

  if (requestedBannerChange && !canManageBanner) {
    throw new Error("Apenas dono, administradores e moderadores podem alterar o banner do servidor.");
  }

  const updateData: {
    name?: string;
    avatarUrl?: string | null;
    serverBannerUrl?: string | null;
    virusTotalEnabled?: boolean;
    virusTotalApiKey?: string | null;
    allowMemberInvites?: boolean;
    allowModeratorInvites?: boolean;
    allowMemberSoundUpload?: boolean;
    allowModeratorSoundUpload?: boolean;
    allowCrossServerSoundShare?: boolean;
    allowMemberDeleteSounds?: boolean;
    allowModeratorDeleteSounds?: boolean;
    allowMemberStickerCreate?: boolean;
    allowModeratorStickerCreate?: boolean;
    allowMemberEmojiCreate?: boolean;
    allowModeratorEmojiCreate?: boolean;
  } = {};
  if (typeof payload.name === "string") {
    const normalizedName = payload.name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 40) {
      throw new Error("Nome do servidor deve ter entre 2 e 40 caracteres.");
    }
    updateData.name = normalizedName;
  }

  if (payload.removeAvatar) {
    updateData.avatarUrl = null;
  } else if (payload.avatarUrl !== undefined) {
    updateData.avatarUrl = payload.avatarUrl;
  }

  if (payload.removeServerBanner) {
    updateData.serverBannerUrl = null;
  } else if (payload.serverBannerUrl !== undefined) {
    updateData.serverBannerUrl = payload.serverBannerUrl;
  }

  if (typeof payload.virusTotalEnabled === "boolean") {
    updateData.virusTotalEnabled = payload.virusTotalEnabled;
  }

  if (typeof payload.virusTotalApiKey === "string") {
    const trimmedApiKey = payload.virusTotalApiKey.trim();
    if (trimmedApiKey) {
      updateData.virusTotalApiKey = trimmedApiKey;
    }
  }

  const nextVirusTotalEnabled =
    typeof updateData.virusTotalEnabled === "boolean"
      ? updateData.virusTotalEnabled
      : current.virusTotalEnabled;
  const nextVirusTotalApiKey =
    typeof updateData.virusTotalApiKey === "string"
      ? updateData.virusTotalApiKey
      : current.virusTotalApiKey;

  if (nextVirusTotalEnabled && !nextVirusTotalApiKey) {
    throw new Error("Para ativar o scan com VirusTotal, informe uma chave de API válida.");
  }

  if (typeof payload.allowMemberInvites === "boolean") {
    updateData.allowMemberInvites = payload.allowMemberInvites;
  }

  if (typeof payload.allowModeratorInvites === "boolean") {
    updateData.allowModeratorInvites = payload.allowModeratorInvites;
  }

  if (typeof payload.allowMemberSoundUpload === "boolean") {
    updateData.allowMemberSoundUpload = payload.allowMemberSoundUpload;
  }

  if (typeof payload.allowModeratorSoundUpload === "boolean") {
    updateData.allowModeratorSoundUpload = payload.allowModeratorSoundUpload;
  }

  if (typeof payload.allowCrossServerSoundShare === "boolean") {
    updateData.allowCrossServerSoundShare = payload.allowCrossServerSoundShare;
  }

  if (typeof payload.allowMemberDeleteSounds === "boolean") {
    updateData.allowMemberDeleteSounds = payload.allowMemberDeleteSounds;
  }

  if (typeof payload.allowModeratorDeleteSounds === "boolean") {
    updateData.allowModeratorDeleteSounds = payload.allowModeratorDeleteSounds;
  }

  if (typeof payload.allowMemberStickerCreate === "boolean") {
    updateData.allowMemberStickerCreate = payload.allowMemberStickerCreate;
  }

  if (typeof payload.allowModeratorStickerCreate === "boolean") {
    updateData.allowModeratorStickerCreate = payload.allowModeratorStickerCreate;
  }

  if (typeof payload.allowMemberEmojiCreate === "boolean") {
    updateData.allowMemberEmojiCreate = payload.allowMemberEmojiCreate;
  }

  if (typeof payload.allowModeratorEmojiCreate === "boolean") {
    updateData.allowModeratorEmojiCreate = payload.allowModeratorEmojiCreate;
  }

  if (Object.keys(updateData).length === 0) {
    const server = await getServerForUser(serverId, actorId);
    return { server, previousAvatarUrl: null, previousServerBannerUrl: null };
  }

  const updated = await db.server.update({
    where: { id: serverId },
    data: updateData,
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      serverBannerUrl: true,
      ownerId: true,
      virusTotalEnabled: true,
      virusTotalApiKey: true,
      allowMemberInvites: true,
      allowModeratorInvites: true,
      allowMemberSoundUpload: true,
      allowModeratorSoundUpload: true,
      allowCrossServerSoundShare: true,
      allowMemberDeleteSounds: true,
      allowModeratorDeleteSounds: true,
      allowMemberStickerCreate: true,
      allowModeratorStickerCreate: true,
      allowMemberEmojiCreate: true,
      allowModeratorEmojiCreate: true,
      categories: true,
      stickers: {
        include: {
          createdBy: {
            select: {
              displayName: true,
            },
          },
        },
      },
      emojis: {
        include: {
          createdBy: {
            select: {
              displayName: true,
            },
          },
        },
      },
      channels: true,
      members: {
        include: {
          user: {
            select: {
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  });

  const previousAvatarUrl = updateData.avatarUrl !== undefined && updateData.avatarUrl !== current.avatarUrl
    ? current.avatarUrl
    : null;
  const previousServerBannerUrl = updateData.serverBannerUrl !== undefined && updateData.serverBannerUrl !== current.serverBannerUrl
    ? current.serverBannerUrl
    : null;

  const detailKeys = Object.keys(updateData);
  await createAuditLog(
    serverId,
    normalizedActorId,
    "server_updated",
    updated.id,
    updated.name,
    detailKeys.length > 0 ? `Configurações alteradas: ${detailKeys.join(", ")}.` : "Configurações do servidor atualizadas.",
  );

  return {
    server: mapServer(updated),
    previousAvatarUrl,
    previousServerBannerUrl,
  };
};

export const deleteServerByOwner = async (
  serverId: string,
  actorId: string,
): Promise<{
  deletedAvatarUrl: string | null;
  deletedServerBannerUrl: string | null;
  deletedAttachmentUrls: string[];
  deletedSoundUrls: string[];
  deletedStickerUrls: string[];
  deletedEmojiUrls: string[];
}> => {
  const current = await assertServerOwner(serverId, actorId);

  const attachments = await db.messageAttachment.findMany({
    where: {
      message: {
        serverId,
      },
    },
    select: {
      url: true,
    },
  });

  const sounds = await db.serverSound.findMany({
    where: { serverId },
    select: {
      url: true,
    },
  });

  const stickers = await db.serverSticker.findMany({
    where: { serverId },
    select: {
      url: true,
    },
  });

  const emojis = await db.serverEmoji.findMany({
    where: { serverId },
    select: {
      url: true,
    },
  });

  await db.server.delete({
    where: { id: serverId },
  });

  return {
    deletedAvatarUrl: current.avatarUrl,
    deletedServerBannerUrl: current.serverBannerUrl,
    deletedAttachmentUrls: attachments.map((attachment) => attachment.url),
    deletedSoundUrls: sounds.map((sound) => sound.url),
    deletedStickerUrls: stickers.map((sticker) => sticker.url),
    deletedEmojiUrls: emojis.map((emoji) => emoji.url),
  };
};

export const leaveServerByUser = async (
  serverId: string,
  userId: string,
): Promise<void> => {
  const normalizedUserId = normalizeUserId(userId);
  const membership = await getMembershipRecord(serverId, normalizedUserId);

  if (!membership) {
    const now = new Date();
    const activeBan = await db.serverRestriction.findFirst({
      where: {
        serverId,
        userId: normalizedUserId,
        type: "server_ban",
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });

    if (!activeBan) {
      throw new Error("Você não participa desse servidor.");
    }

    await db.serverRestriction.update({
      where: { id: activeBan.id },
      data: { revokedAt: new Date() },
    });
    return;
  }

  const server = await db.server.findUnique({
    where: { id: serverId },
    select: { ownerId: true },
  });

  if (!server) {
    throw new Error("Servidor não encontrado.");
  }

  if (server.ownerId === normalizedUserId) {
    throw new Error("O dono do servidor não pode sair. Exclua o servidor ou transfira a posse primeiro.");
  }

  await db.serverMember.delete({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedUserId,
      },
    },
  });
};

export const getServerForUser = async (serverId: string, userId: string): Promise<Server> => {
  await ensureNoActiveServerBan(serverId, userId);
  const server = mapServer(await getServer(serverId));
  const member = getMember(server, normalizeUserId(userId));
  if (!member) {
    throw new Error("Você não participa desse servidor.");
  }

  const bannedUserIds = await getActiveServerBanUserIds(serverId);
  if (bannedUserIds.size > 0) {
    server.members = server.members.filter((item) => !bannedUserIds.has(normalizeUserId(item.userId)));
  }

  server.channels = server.channels.filter((channel) => canRoleViewChannel(channel, member.role));
  return server;
};

export const getRoleForUser = async (serverId: string, userId: string): Promise<Role | null> => {
  const membership = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizeUserId(userId),
      },
    },
  });

  return membership ? mapRole(membership.role) : null;
};

export const getServerVirusTotalScanConfig = async (
  serverId: string,
  userId: string,
): Promise<{ enabled: boolean; apiKey: string | null }> => {
  await getServerForUser(serverId, userId);

  const server = await db.server.findUnique({
    where: { id: serverId },
    select: {
      virusTotalEnabled: true,
      virusTotalApiKey: true,
    },
  });

  if (!server) {
    throw new Error("Servidor não encontrado.");
  }

  return {
    enabled: server.virusTotalEnabled,
    apiKey: server.virusTotalApiKey,
  };
};

const assertCanCreateSticker = async (serverId: string, actorId: string) => {
  const actor = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizeUserId(actorId),
      },
    },
    select: {
      role: true,
      server: {
        select: {
          allowMemberStickerCreate: true,
          allowModeratorStickerCreate: true,
        },
      },
    },
  });

  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }

  if (actor.role === "admin") {
    return;
  }

  if (actor.role === "moderator" && actor.server.allowModeratorStickerCreate) {
    return;
  }

  if (actor.role === "member" && actor.server.allowMemberStickerCreate) {
    return;
  }

  throw new Error("Você não tem permissão para criar figurinhas neste servidor.");
};

const assertCanCreateEmoji = async (serverId: string, actorId: string) => {
  const actor = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizeUserId(actorId),
      },
    },
    select: {
      role: true,
      server: {
        select: {
          allowMemberEmojiCreate: true,
          allowModeratorEmojiCreate: true,
        },
      },
    },
  });

  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }

  if (actor.role === "admin") {
    return;
  }

  if (actor.role === "moderator" && actor.server.allowModeratorEmojiCreate) {
    return;
  }

  if (actor.role === "member" && actor.server.allowMemberEmojiCreate) {
    return;
  }

  throw new Error("Você não tem permissão para criar emojis neste servidor.");
};

export const listServerStickers = async (serverId: string, userId: string): Promise<ServerSticker[]> => {
  await getServerForUser(serverId, userId);

  const stickers = await db.serverSticker.findMany({
    where: { serverId },
    include: {
      createdBy: {
        select: {
          displayName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return stickers.map((sticker) => ({
    id: sticker.id,
    serverId: sticker.serverId,
    createdById: sticker.createdById,
    createdByName: sticker.createdBy.displayName,
    name: sticker.name,
    url: sticker.url,
    mimeType: sticker.mimeType,
    size: sticker.size,
    createdAt: sticker.createdAt.toISOString(),
  }));
};

export const createServerSticker = async (
  serverId: string,
  actorId: string,
  payload: { name: string; url: string; mimeType: string; size: number },
): Promise<ServerSticker> => {
  await assertCanCreateSticker(serverId, actorId);
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedName = payload.name.trim().toLowerCase().replace(/\s+/g, "-");

  if (!/^[a-z0-9_-]{2,32}$/.test(normalizedName)) {
    throw new Error("Nome da figurinha deve ter de 2 a 32 caracteres (letras, números, _ ou -).");
  }

  const existing = await db.serverSticker.findFirst({
    where: {
      serverId,
      name: {
        equals: normalizedName,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (existing) {
    throw new Error("Já existe uma figurinha com esse nome neste servidor.");
  }

  const created = await db.serverSticker.create({
    data: {
      serverId,
      createdById: normalizedActorId,
      name: normalizedName,
      url: payload.url,
      mimeType: payload.mimeType,
      size: payload.size,
    },
    include: {
      createdBy: {
        select: {
          displayName: true,
        },
      },
    },
  });

  return {
    id: created.id,
    serverId: created.serverId,
    createdById: created.createdById,
    createdByName: created.createdBy.displayName,
    name: created.name,
    url: created.url,
    mimeType: created.mimeType,
    size: created.size,
    createdAt: created.createdAt.toISOString(),
  };
};

export const deleteServerSticker = async (
  serverId: string,
  stickerId: string,
  actorId: string,
): Promise<{ deletedUrl: string }> => {
  const normalizedActorId = normalizeUserId(actorId);
  const actor = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedActorId,
      },
    },
    select: {
      role: true,
      canDeleteUserMessages: true,
    },
  });

  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }

  const canModerateAssetDeletion =
    actor.role === "admin" || (actor.role === "moderator" && actor.canDeleteUserMessages);

  const sticker = await db.serverSticker.findFirst({
    where: {
      id: stickerId,
      serverId,
    },
    select: {
      id: true,
      createdById: true,
      url: true,
    },
  });

  if (!sticker) {
    throw new Error("Figurinha não encontrada.");
  }

  if (sticker.createdById !== normalizedActorId && !canModerateAssetDeletion) {
    throw new Error("Você só pode excluir figurinhas criadas por você.");
  }

  await db.serverSticker.delete({ where: { id: stickerId } });
  return { deletedUrl: sticker.url };
};

export const listServerEmojis = async (serverId: string, userId: string): Promise<ServerEmoji[]> => {
  await getServerForUser(serverId, userId);

  const emojis = await db.serverEmoji.findMany({
    where: { serverId },
    include: {
      createdBy: {
        select: {
          displayName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return emojis.map((emoji) => ({
    id: emoji.id,
    serverId: emoji.serverId,
    createdById: emoji.createdById,
    createdByName: emoji.createdBy.displayName,
    name: emoji.name,
    url: emoji.url,
    mimeType: emoji.mimeType,
    size: emoji.size,
    createdAt: emoji.createdAt.toISOString(),
  }));
};

export const createServerEmoji = async (
  serverId: string,
  actorId: string,
  payload: { name: string; url: string; mimeType: string; size: number },
): Promise<ServerEmoji> => {
  await assertCanCreateEmoji(serverId, actorId);
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedName = payload.name.trim().toLowerCase().replace(/\s+/g, "-");

  if (!/^[a-z0-9_-]{2,32}$/.test(normalizedName)) {
    throw new Error("Nome do emoji deve ter de 2 a 32 caracteres (letras, números, _ ou -).");
  }

  const existing = await db.serverEmoji.findFirst({
    where: {
      serverId,
      name: {
        equals: normalizedName,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (existing) {
    throw new Error("Já existe um emoji com esse nome neste servidor.");
  }

  const created = await db.serverEmoji.create({
    data: {
      serverId,
      createdById: normalizedActorId,
      name: normalizedName,
      url: payload.url,
      mimeType: payload.mimeType,
      size: payload.size,
    },
    include: {
      createdBy: {
        select: {
          displayName: true,
        },
      },
    },
  });

  return {
    id: created.id,
    serverId: created.serverId,
    createdById: created.createdById,
    createdByName: created.createdBy.displayName,
    name: created.name,
    url: created.url,
    mimeType: created.mimeType,
    size: created.size,
    createdAt: created.createdAt.toISOString(),
  };
};

export const deleteServerEmoji = async (
  serverId: string,
  emojiId: string,
  actorId: string,
): Promise<{ deletedUrl: string }> => {
  const normalizedActorId = normalizeUserId(actorId);
  const actor = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedActorId,
      },
    },
    select: {
      role: true,
      canDeleteUserMessages: true,
    },
  });

  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }

  const canModerateAssetDeletion =
    actor.role === "admin" || (actor.role === "moderator" && actor.canDeleteUserMessages);

  const emoji = await db.serverEmoji.findFirst({
    where: {
      id: emojiId,
      serverId,
    },
    select: {
      id: true,
      createdById: true,
      url: true,
    },
  });

  if (!emoji) {
    throw new Error("Emoji não encontrado.");
  }

  if (emoji.createdById !== normalizedActorId && !canModerateAssetDeletion) {
    throw new Error("Você só pode excluir emojis criados por você.");
  }

  await db.serverEmoji.delete({ where: { id: emojiId } });
  return { deletedUrl: emoji.url };
};

export const createChannel = async (
  serverId: string,
  actorId: string,
  name: string,
  type: ChannelType,
  categoryId?: string,
): Promise<Channel> => {
  const normalizedActorId = normalizeUserId(actorId);
  const actor = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedActorId,
      },
    },
  });

  if (!actor || actor.role !== "admin") {
    throw new Error("Apenas administradores podem criar canais.");
  }

  const normalizedCategoryId = categoryId?.trim();
  if (normalizedCategoryId) {
    const category = await db.channelCategory.findUnique({
      where: { id: normalizedCategoryId },
      select: { id: true, serverId: true },
    });
    if (!category || category.serverId !== serverId) {
      throw new Error("Categoria inválida para este servidor.");
    }
  }

  const channel = await db.channel.create({
    data: {
      serverId,
      categoryId: normalizedCategoryId ?? null,
      name,
      type,
    },
  });

  await createAuditLog(
    serverId,
    normalizedActorId,
    "channel_created",
    channel.id,
    channel.name,
    `Canal ${mapChannelType(channel.type) === "voice" ? "de voz" : "de texto"} criado.`,
  );

  return {
    id: channel.id,
    name: channel.name,
    type: mapChannelType(channel.type),
    categoryId: channel.categoryId,
    allowMemberView: channel.allowMemberView,
    allowModeratorView: channel.allowModeratorView,
    allowMemberAccess: channel.allowMemberAccess,
    allowModeratorAccess: channel.allowModeratorAccess,
    allowMemberSendMessages: channel.allowMemberSendMessages,
    allowModeratorSendMessages: channel.allowModeratorSendMessages,
    allowMemberSendFiles: channel.allowMemberSendFiles,
    allowModeratorSendFiles: channel.allowModeratorSendFiles,
    allowMemberSendLinks: channel.allowMemberSendLinks,
    allowModeratorSendLinks: channel.allowModeratorSendLinks,
    allowMemberDeleteMessages: channel.allowMemberDeleteMessages,
    allowModeratorDeleteMessages: channel.allowModeratorDeleteMessages,
  };
};

export const createCategory = async (
  serverId: string,
  actorId: string,
  name: string,
): Promise<ChannelCategory> => {
  await assertServerOwner(serverId, actorId);

  const trimmedName = name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 30) {
    throw new Error("Nome da categoria deve ter entre 2 e 30 caracteres.");
  }

  const category = await db.channelCategory.create({
    data: {
      serverId,
      name: trimmedName,
    },
  });

  await createAuditLog(
    serverId,
    normalizeUserId(actorId),
    "category_created",
    category.id,
    category.name,
    "Categoria criada.",
  );

  return {
    id: category.id,
    name: category.name,
  };
};

export const updateCategoryByOwner = async (
  serverId: string,
  categoryId: string,
  actorId: string,
  name: string,
): Promise<ChannelCategory> => {
  await assertServerOwner(serverId, actorId);

  const existingCategory = await db.channelCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, serverId: true },
  });

  if (!existingCategory || existingCategory.serverId !== serverId) {
    throw new Error("Categoria não encontrada neste servidor.");
  }

  const trimmedName = name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 30) {
    throw new Error("Nome da categoria deve ter entre 2 e 30 caracteres.");
  }

  const category = await db.channelCategory.update({
    where: { id: categoryId },
    data: { name: trimmedName },
  });

  await createAuditLog(
    serverId,
    normalizeUserId(actorId),
    "category_updated",
    category.id,
    category.name,
    "Nome da categoria atualizado.",
  );

  return {
    id: category.id,
    name: category.name,
  };
};

export const deleteCategoryByOwner = async (
  serverId: string,
  categoryId: string,
  actorId: string,
): Promise<void> => {
  await assertServerOwner(serverId, actorId);

  const existingCategory = await db.channelCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, serverId: true },
  });

  if (!existingCategory || existingCategory.serverId !== serverId) {
    throw new Error("Categoria não encontrada neste servidor.");
  }

  await db.$transaction(async (transaction) => {
    await transaction.channel.updateMany({
      where: {
        serverId,
        categoryId,
      },
      data: {
        categoryId: null,
      },
    });

    await transaction.channelCategory.delete({
      where: { id: categoryId },
    });
  });

  await createAuditLog(
    serverId,
    normalizeUserId(actorId),
    "category_deleted",
    categoryId,
    null,
    "Categoria excluída.",
  );
};

const mapInvite = (invite: { id: string; code: string; createdAt: Date }): ServerInvite => ({
  id: invite.id,
  code: invite.code,
  createdAt: invite.createdAt.toISOString(),
});

const generateInviteCode = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export const listServerInvitesByOwner = async (
  serverId: string,
  actorId: string,
): Promise<ServerInvite[]> => {
  await assertCanManageInvites(serverId, actorId);

  const invites = await db.serverInvite.findMany({
    where: {
      serverId,
      revokedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  return invites.map(mapInvite);
};

export const createServerInviteByOwner = async (
  serverId: string,
  actorId: string,
): Promise<ServerInvite> => {
  const actor = await assertCanManageInvites(serverId, actorId);

  const activeCount = await db.serverInvite.count({
    where: {
      serverId,
      revokedAt: null,
    },
  });

  if (activeCount >= 10) {
    throw new Error("Limite máximo de 10 links de convite ativos atingido.");
  }

  let createdInvite: { id: string; code: string; createdAt: Date } | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode();
    try {
      createdInvite = await db.serverInvite.create({
        data: {
          serverId,
          createdById: actor.userId,
          code,
        },
        select: {
          id: true,
          code: true,
          createdAt: true,
        },
      });
      break;
    } catch {
      continue;
    }
  }

  if (!createdInvite) {
    throw new Error("Falha ao gerar link de convite. Tente novamente.");
  }

  return mapInvite(createdInvite);
};

export const revokeServerInviteByOwner = async (
  serverId: string,
  inviteId: string,
  actorId: string,
): Promise<void> => {
  await assertCanManageInvites(serverId, actorId);

  const invite = await db.serverInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, serverId: true, revokedAt: true },
  });

  if (!invite || invite.serverId !== serverId) {
    throw new Error("Convite não encontrado neste servidor.");
  }

  if (invite.revokedAt) {
    return;
  }

  await db.serverInvite.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() },
  });
};

export const acceptInviteLink = async (
  code: string,
  userId: string,
): Promise<{ serverId: string }> => {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    throw new Error("Código de convite inválido.");
  }

  const normalizedUserId = normalizeUserId(userId);
  const user = await db.user.findUnique({
    where: { id: normalizedUserId },
    select: { id: true, passwordHash: true },
  });

  if (!user || !hasPasswordConfigured(user.passwordHash)) {
    throw new Error("Somente usuários com cadastro válido podem usar convites.");
  }

  const invite = await db.serverInvite.findFirst({
    where: {
      code: normalizedCode,
      revokedAt: null,
    },
    select: {
      serverId: true,
    },
  });

  if (!invite) {
    throw new Error("Link de convite inválido ou expirado.");
  }

  await ensureNoActiveServerBan(invite.serverId, normalizedUserId);

  await db.serverMember.upsert({
    where: {
      serverId_userId: {
        serverId: invite.serverId,
        userId: normalizedUserId,
      },
    },
    update: {},
    create: {
      serverId: invite.serverId,
      userId: normalizedUserId,
      role: "member",
      ...normalizePermissions(),
    },
  });

  return { serverId: invite.serverId };
};

export const listServerSounds = async (
  serverId: string,
  userId: string,
): Promise<ServerSound[]> => {
  const normalizedUserId = normalizeUserId(userId);
  await ensureNoActiveServerBan(serverId, normalizedUserId);
  await ensureServerMember(serverId, normalizedUserId);

  const memberships = await db.serverMember.findMany({
    where: {
      userId: normalizedUserId,
    },
    select: {
      serverId: true,
    },
  });

  const memberServerIds = [...new Set(memberships.map((membership) => membership.serverId))];
  const otherServerIds = memberServerIds.filter((memberServerId) => memberServerId !== serverId);

  const sounds = await db.serverSound.findMany({
    where: {
      OR: [
        { serverId },
        {
          serverId: { in: otherServerIds },
          server: {
            allowCrossServerSoundShare: true,
          },
        },
      ],
    },
    include: {
      server: {
        select: {
          name: true,
        },
      },
      createdBy: {
        select: {
          displayName: true,
        },
      },
      favoritedBy: {
        where: {
          userId: normalizedUserId,
        },
        select: {
          userId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const mappedSounds = sounds.map(mapServerSound);
  return mappedSounds.sort((left, right) => {
    if (left.isFavorite !== right.isFavorite) {
      return left.isFavorite ? -1 : 1;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
};

export const setServerSoundFavorite = async (
  serverId: string,
  soundId: string,
  userId: string,
  isFavorite: boolean,
): Promise<{ soundId: string; isFavorite: boolean }> => {
  const normalizedUserId = normalizeUserId(userId);
  await ensureNoActiveServerBan(serverId, normalizedUserId);
  await ensureServerMember(serverId, normalizedUserId);

  const sound = await db.serverSound.findUnique({
    where: { id: soundId },
    select: {
      id: true,
      serverId: true,
      server: {
        select: {
          allowCrossServerSoundShare: true,
        },
      },
    },
  });

  if (!sound) {
    throw new Error("Áudio não encontrado.");
  }

  const canManageFavorite =
    sound.serverId === serverId ||
    !!sound.server.allowCrossServerSoundShare;

  if (!canManageFavorite) {
    throw new Error("Você não pode favoritar este áudio.");
  }

  if (sound.serverId !== serverId) {
    const sourceMembership = await db.serverMember.findUnique({
      where: {
        serverId_userId: {
          serverId: sound.serverId,
          userId: normalizedUserId,
        },
      },
      select: {
        userId: true,
      },
    });

    if (!sourceMembership) {
      throw new Error("Você não pode favoritar este áudio.");
    }
  }

  if (isFavorite) {
    await db.serverSoundFavorite.upsert({
      where: {
        userId_soundId: {
          userId: normalizedUserId,
          soundId: sound.id,
        },
      },
      create: {
        userId: normalizedUserId,
        soundId: sound.id,
      },
      update: {},
    });
  } else {
    await db.serverSoundFavorite.deleteMany({
      where: {
        userId: normalizedUserId,
        soundId: sound.id,
      },
    });
  }

  return {
    soundId: sound.id,
    isFavorite,
  };
};

export const createServerSound = async (
  serverId: string,
  actorId: string,
  payload: {
    name: string;
    url: string;
    mimeType: string;
    size: number;
    durationSeconds: number;
    gifUrl?: string | null;
  },
): Promise<ServerSound> => {
  const normalizedActorId = normalizeUserId(actorId);
  await ensureNoActiveServerBan(serverId, normalizedActorId);
  const actor = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedActorId,
      },
    },
    select: {
      role: true,
      server: {
        select: {
          allowMemberSoundUpload: true,
          allowModeratorSoundUpload: true,
        },
      },
    },
  });

  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }

  if (
    actor.role === "member" &&
    !actor.server.allowMemberSoundUpload
  ) {
    throw new Error("Membros não podem enviar áudio neste servidor.");
  }

  if (
    actor.role === "moderator" &&
    !actor.server.allowModeratorSoundUpload
  ) {
    throw new Error("Moderadores não podem enviar áudio neste servidor.");
  }

  const normalizedName = payload.name.trim();
  if (normalizedName.length < 1 || normalizedName.length > 40) {
    throw new Error("Nome do áudio deve ter entre 1 e 40 caracteres.");
  }
  if (!payload.url.startsWith("/uploads/")) {
    throw new Error("URL do áudio inválida.");
  }
  if (payload.size <= 0) {
    throw new Error("Arquivo de áudio inválido.");
  }
  if (!Number.isFinite(payload.durationSeconds) || payload.durationSeconds <= 0 || payload.durationSeconds > 10) {
    throw new Error("Áudio deve ter no máximo 10 segundos.");
  }

  const created = await db.serverSound.create({
    data: {
      serverId,
      createdById: normalizedActorId,
      name: normalizedName,
      url: payload.url,
      mimeType: payload.mimeType,
      size: payload.size,
      durationSeconds: payload.durationSeconds,
      gifUrl: payload.gifUrl ?? null,
    },
    include: {
      server: {
        select: {
          name: true,
        },
      },
      createdBy: {
        select: {
          displayName: true,
        },
      },
      favoritedBy: {
        where: {
          userId: normalizedActorId,
        },
        select: {
          userId: true,
        },
      },
    },
  });

  return mapServerSound(created);
};

export const deleteServerSound = async (
  serverId: string,
  soundId: string,
  actorId: string,
): Promise<{ deletedUrl: string }> => {
  const normalizedActorId = normalizeUserId(actorId);
  await ensureNoActiveServerBan(serverId, normalizedActorId);

  const actor = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedActorId,
      },
    },
    select: {
      role: true,
      server: {
        select: {
          allowMemberDeleteSounds: true,
          allowModeratorDeleteSounds: true,
        },
      },
    },
  });

  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }
  const sound = await db.serverSound.findUnique({
    where: { id: soundId },
    select: {
      id: true,
      serverId: true,
      createdById: true,
      url: true,
    },
  });

  if (!sound || sound.serverId !== serverId) {
    throw new Error("Áudio não encontrado neste servidor.");
  }

  if (
    actor.role === "member" &&
    !actor.server.allowMemberDeleteSounds
  ) {
    throw new Error("Membros não podem excluir áudio neste servidor.");
  }

  if (
    actor.role === "moderator" &&
    !actor.server.allowModeratorDeleteSounds
  ) {
    throw new Error("Moderadores não podem excluir áudio neste servidor.");
  }

  await db.serverSound.delete({
    where: { id: sound.id },
  });

  return { deletedUrl: sound.url };
};

export const updateServerSoundGif = async (
  serverId: string,
  soundId: string,
  actorId: string,
  gifUrl: string | null,
): Promise<ServerSound> => {
  const normalizedActorId = normalizeUserId(actorId);
  await ensureNoActiveServerBan(serverId, normalizedActorId);

  const actor = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedActorId,
      },
    },
    select: {
      role: true,
      server: {
        select: {
          allowMemberSoundUpload: true,
          allowModeratorSoundUpload: true,
        },
      },
    },
  });

  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }

  if (
    actor.role === "member" &&
    !actor.server.allowMemberSoundUpload
  ) {
    throw new Error("Membros não podem editar áudio neste servidor.");
  }

  if (
    actor.role === "moderator" &&
    !actor.server.allowModeratorSoundUpload
  ) {
    throw new Error("Moderadores não podem editar áudio neste servidor.");
  }

  const sound = await db.serverSound.findUnique({
    where: { id: soundId },
    select: { id: true, serverId: true },
  });

  if (!sound || sound.serverId !== serverId) {
    throw new Error("Áudio não encontrado neste servidor.");
  }

  if (gifUrl !== null && !gifUrl.startsWith("/uploads/")) {
    throw new Error("URL do GIF inválida.");
  }

  const updated = await db.serverSound.update({
    where: { id: soundId },
    data: { gifUrl },
    include: {
      server: {
        select: { name: true },
      },
      createdBy: {
        select: { displayName: true },
      },
      favoritedBy: {
        where: {
          userId: normalizedActorId,
        },
        select: { userId: true },
      },
    },
  });

  return mapServerSound(updated);
};

export const updateChannelByOwner = async (
  serverId: string,
  channelId: string,
  actorId: string,
  payload: {
    name?: string;
    categoryId?: string | null;
    permissions?: {
    allowMemberView: boolean;
    allowModeratorView: boolean;
      allowMemberAccess: boolean;
      allowModeratorAccess: boolean;
      allowMemberSendMessages: boolean;
      allowModeratorSendMessages: boolean;
      allowMemberSendFiles: boolean;
      allowModeratorSendFiles: boolean;
      allowMemberSendLinks: boolean;
      allowModeratorSendLinks: boolean;
      allowMemberDeleteMessages: boolean;
      allowModeratorDeleteMessages: boolean;
    };
  },
): Promise<Channel> => {
  await assertServerOwnerOrAdmin(serverId, actorId);

  const existingChannel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, serverId: true, name: true, type: true },
  });

  if (!existingChannel || existingChannel.serverId !== serverId) {
    throw new Error("Canal não encontrado neste servidor.");
  }

  const updateData: {
    name?: string;
    categoryId?: string | null;
    allowMemberAccess?: boolean;
    allowModeratorAccess?: boolean;
    allowMemberView?: boolean;
    allowModeratorView?: boolean;
    allowMemberSendMessages?: boolean;
    allowModeratorSendMessages?: boolean;
    allowMemberSendFiles?: boolean;
    allowModeratorSendFiles?: boolean;
    allowMemberSendLinks?: boolean;
    allowModeratorSendLinks?: boolean;
    allowMemberDeleteMessages?: boolean;
    allowModeratorDeleteMessages?: boolean;
  } = {};
  if (typeof payload.name === "string") {
    const trimmedName = payload.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 30) {
      throw new Error("Nome do canal deve ter entre 2 e 30 caracteres.");
    }
    updateData.name = trimmedName;
  }

  if (payload.categoryId !== undefined) {
    const normalizedCategoryId = payload.categoryId?.trim() || null;
    if (normalizedCategoryId) {
      const category = await db.channelCategory.findUnique({
        where: { id: normalizedCategoryId },
        select: { id: true, serverId: true },
      });
      if (!category || category.serverId !== serverId) {
        throw new Error("Categoria inválida para este servidor.");
      }
      updateData.categoryId = normalizedCategoryId;
    } else {
      updateData.categoryId = null;
    }
  }

  if (payload.permissions) {
    updateData.allowMemberView = payload.permissions.allowMemberView;
    updateData.allowModeratorView = payload.permissions.allowModeratorView;
    updateData.allowMemberAccess = payload.permissions.allowMemberAccess;
    updateData.allowModeratorAccess = payload.permissions.allowModeratorAccess;
    updateData.allowMemberSendMessages = payload.permissions.allowMemberSendMessages;
    updateData.allowModeratorSendMessages = payload.permissions.allowModeratorSendMessages;
    updateData.allowMemberSendFiles = payload.permissions.allowMemberSendFiles;
    updateData.allowModeratorSendFiles = payload.permissions.allowModeratorSendFiles;
    updateData.allowMemberSendLinks = payload.permissions.allowMemberSendLinks;
    updateData.allowModeratorSendLinks = payload.permissions.allowModeratorSendLinks;
    updateData.allowMemberDeleteMessages = payload.permissions.allowMemberDeleteMessages;
    updateData.allowModeratorDeleteMessages = payload.permissions.allowModeratorDeleteMessages;
  }

  if (Object.keys(updateData).length === 0) {
    const channel = await db.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) {
      throw new Error("Canal não encontrado.");
    }
    return {
      id: channel.id,
      name: channel.name,
      type: mapChannelType(channel.type),
      categoryId: channel.categoryId,
      allowMemberView: channel.allowMemberView,
      allowModeratorView: channel.allowModeratorView,
      allowMemberAccess: channel.allowMemberAccess,
      allowModeratorAccess: channel.allowModeratorAccess,
      allowMemberSendMessages: channel.allowMemberSendMessages,
      allowModeratorSendMessages: channel.allowModeratorSendMessages,
      allowMemberSendFiles: channel.allowMemberSendFiles,
      allowModeratorSendFiles: channel.allowModeratorSendFiles,
      allowMemberSendLinks: channel.allowMemberSendLinks,
      allowModeratorSendLinks: channel.allowModeratorSendLinks,
      allowMemberDeleteMessages: channel.allowMemberDeleteMessages,
      allowModeratorDeleteMessages: channel.allowModeratorDeleteMessages,
    };
  }

  const channel = await db.channel.update({
    where: { id: channelId },
    data: updateData,
  });

  const detailParts: string[] = [];
  if (typeof payload.name === "string") {
    detailParts.push(`Nome alterado para \"${channel.name}\".`);
  }
  if (payload.categoryId !== undefined) {
    detailParts.push(payload.categoryId ? "Canal movido de categoria." : "Canal removido da categoria.");
  }
  if (payload.permissions) {
    detailParts.push("Permissões do canal atualizadas.");
  }

  await createAuditLog(
    serverId,
    normalizeUserId(actorId),
    "channel_updated",
    channel.id,
    channel.name,
    detailParts.join(" ") || "Configurações do canal atualizadas.",
  );

  return {
    id: channel.id,
    name: channel.name,
    type: mapChannelType(channel.type),
    categoryId: channel.categoryId,
    allowMemberView: channel.allowMemberView,
    allowModeratorView: channel.allowModeratorView,
    allowMemberAccess: channel.allowMemberAccess,
    allowModeratorAccess: channel.allowModeratorAccess,
    allowMemberSendMessages: channel.allowMemberSendMessages,
    allowModeratorSendMessages: channel.allowModeratorSendMessages,
    allowMemberSendFiles: channel.allowMemberSendFiles,
    allowModeratorSendFiles: channel.allowModeratorSendFiles,
    allowMemberSendLinks: channel.allowMemberSendLinks,
    allowModeratorSendLinks: channel.allowModeratorSendLinks,
    allowMemberDeleteMessages: channel.allowMemberDeleteMessages,
    allowModeratorDeleteMessages: channel.allowModeratorDeleteMessages,
  };
};

export const deleteChannelByOwner = async (
  serverId: string,
  channelId: string,
  actorId: string,
): Promise<{ deletedAttachmentUrls: string[] }> => {
  await assertServerOwnerOrAdmin(serverId, actorId);

  const existingChannel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, serverId: true, name: true },
  });

  if (!existingChannel || existingChannel.serverId !== serverId) {
    throw new Error("Canal não encontrado neste servidor.");
  }

  const attachments = await db.messageAttachment.findMany({
    where: {
      message: {
        channelId,
      },
    },
    select: { url: true },
  });

  await db.channel.delete({
    where: { id: channelId },
  });

  await createAuditLog(
    serverId,
    normalizeUserId(actorId),
    "channel_deleted",
    existingChannel.id,
    existingChannel.name,
    "Canal excluído.",
  );

  return {
    deletedAttachmentUrls: attachments.map((attachment) => attachment.url),
  };
};

export const upsertMemberRole = async (
  serverId: string,
  actorId: string,
  targetUserId: string,
  role: Role,
  permissions?: Partial<ModeratorPermissions>,
): Promise<ServerMember> => {
  const normalizedActorId = normalizeUserId(actorId);
  const server = await db.server.findUnique({
    where: { id: serverId },
    select: { ownerId: true },
  });

  if (!server) {
    throw new Error("Servidor não encontrado.");
  }

  const isOwner = server.ownerId === normalizedActorId;
  const actor = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedActorId,
      },
    },
  });

  if (!isOwner && (!actor || actor.role !== "admin")) {
    throw new Error("Apenas dono ou administradores podem gerenciar funções.");
  }

  const normalizedTargetUserId = normalizeUserId(targetUserId);
  const targetMember = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedTargetUserId,
      },
    },
    select: { role: true },
  });

  if (!isOwner) {
    if (normalizedTargetUserId === server.ownerId) {
      throw new Error("Administradores não podem alterar o dono do servidor.");
    }
    if (targetMember?.role === "admin") {
      throw new Error("Administradores não podem alterar outros administradores.");
    }
    if (role === "admin") {
      throw new Error("Apenas o dono do servidor pode promover alguém para administrador.");
    }
  }

  await ensureUserRecord(normalizedTargetUserId);

  const member = await db.serverMember.upsert({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedTargetUserId,
      },
    },
    update: {
      role,
      ...(role === "moderator" ? normalizePermissions(permissions) : normalizePermissions()),
    },
    create: {
      serverId,
      userId: normalizedTargetUserId,
      role,
      ...(role === "moderator" ? normalizePermissions(permissions) : normalizePermissions()),
    },
  });

  const action = role === "moderator" ? "member_permissions_updated" : "member_role_updated";
  const details = role === "moderator"
    ? "Cargo/permissões de moderador atualizados."
    : `Cargo atualizado para ${role}.`;

  await createAuditLog(
    serverId,
    normalizedActorId,
    action,
    normalizedTargetUserId,
    null,
    details,
  );

  const profile = await db.user.findUnique({
    where: { id: member.userId },
    select: {
      displayName: true,
      avatarUrl: true,
    },
  });

  return {
    userId: member.userId,
    role: mapRole(member.role),
    userName: profile?.displayName,
    avatarUrl: profile?.avatarUrl ?? null,
    permissions: {
      canRemoveMembers: member.canRemoveMembers,
      canBanUsers: member.canBanUsers,
      canTimeoutVoice: member.canTimeoutVoice,
      canDeleteUserMessages: member.canDeleteUserMessages,
      canKickFromVoice: member.canKickFromVoice,
      canMoveVoiceUsers: member.canMoveVoiceUsers,
      canManageInvites: member.canManageInvites,
    },
    notifySoundEnabled: member.notifySoundEnabled,
  };
};

export const updateMemberNotificationSound = async (
  serverId: string,
  actorId: string,
  notifySoundEnabled: boolean,
): Promise<ServerMember> => {
  const normalizedActorId = normalizeUserId(actorId);
  const member = await db.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedActorId,
      },
    },
    include: {
      user: {
        select: {
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  if (!member) {
    throw new Error("Você não participa desse servidor.");
  }

  const updatedMember = await db.serverMember.update({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedActorId,
      },
    },
    data: {
      notifySoundEnabled,
    },
    include: {
      user: {
        select: {
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  return {
    userId: updatedMember.userId,
    role: mapRole(updatedMember.role),
    userName: updatedMember.user.displayName,
    avatarUrl: updatedMember.user.avatarUrl,
    permissions: {
      canRemoveMembers: updatedMember.canRemoveMembers,
      canBanUsers: updatedMember.canBanUsers,
      canTimeoutVoice: updatedMember.canTimeoutVoice,
      canDeleteUserMessages: updatedMember.canDeleteUserMessages,
      canKickFromVoice: updatedMember.canKickFromVoice,
      canMoveVoiceUsers: updatedMember.canMoveVoiceUsers,
      canManageInvites: updatedMember.canManageInvites,
    },
    notifySoundEnabled: updatedMember.notifySoundEnabled,
  };
};

const createVoiceAction = async (
  serverId: string,
  actorId: string,
  targetUserId: string,
  type: "kick" | "move",
  reason?: string,
  targetChannelId?: string,
) => {
  return db.serverVoiceAction.create({
    data: {
      serverId,
      actorId: normalizeUserId(actorId),
      userId: normalizeUserId(targetUserId),
      type,
      reason: reason?.trim() || null,
      targetChannelId: targetChannelId ?? null,
    },
  });
};

const assertCanModerate = async (
  serverId: string,
  actorId: string,
  permission: keyof ModeratorPermissions,
) => {
  const actor = await getMembershipRecord(serverId, actorId);
  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }

  if (actor.role === "admin") {
    return actor;
  }

  if (actor.role !== "moderator") {
    throw new Error("Você não tem permissão para essa ação.");
  }

  if (!actor[permission]) {
    throw new Error("Você não tem permissão para essa ação.");
  }

  return actor;
};

const assertTargetCanBeModerated = async (
  serverId: string,
  actorId: string,
  targetUserId: string,
  options: { allowModeratorTargets?: boolean } = {},
) => {
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedTargetId = normalizeUserId(targetUserId);

  if (normalizedActorId === normalizedTargetId) {
    throw new Error("Você não pode aplicar essa ação em si mesmo.");
  }

  const server = await db.server.findUnique({
    where: { id: serverId },
    select: { ownerId: true },
  });
  if (!server) {
    throw new Error("Servidor não encontrado.");
  }

  if (server.ownerId === normalizedTargetId) {
    throw new Error("Não é possível moderar o dono do servidor.");
  }

  const actor = await getMembershipRecord(serverId, normalizedActorId);
  const target = await getMembershipRecord(serverId, normalizedTargetId);

  if (!actor) {
    throw new Error("Você não participa desse servidor.");
  }
  if (!target) {
    throw new Error("Usuário alvo não encontrado no servidor.");
  }

  if (actor.role !== "admin") {
    const canModerateTarget =
      target.role === "member" ||
      (options.allowModeratorTargets && target.role === "moderator");

    if (!canModerateTarget) {
      throw new Error(
        target.role === "admin"
          ? "Não é possível moderar um administrador."
          : "Moderadores só podem agir sobre membros.",
      );
    }
  }

  return { actor, target };
};

export const removeUserFromServer = async (
  serverId: string,
  actorId: string,
  targetUserId: string,
  options: { removeMessages: boolean },
): Promise<{ removedMessageAttachmentUrls: string[] }> => {
  const actor = await assertCanModerate(serverId, actorId, "canRemoveMembers");
  await assertTargetCanBeModerated(serverId, actorId, targetUserId);

  if (options.removeMessages && actor.role === "moderator" && !actor.canDeleteUserMessages) {
    throw new Error("Você não tem permissão para remover mensagens do usuário.");
  }

  const normalizedTargetUserId = normalizeUserId(targetUserId);
  const removedMessageAttachmentUrls: string[] = [];

  if (options.removeMessages) {
    const messages = await db.message.findMany({
      where: {
        serverId,
        userId: normalizedTargetUserId,
      },
      include: {
        attachments: true,
      },
    });

    messages.forEach((message) => {
      message.attachments.forEach((attachment) => {
        removedMessageAttachmentUrls.push(attachment.url);
      });
    });

    await db.message.deleteMany({
      where: {
        serverId,
        userId: normalizedTargetUserId,
      },
    });
  }

  await db.serverMember.delete({
    where: {
      serverId_userId: {
        serverId,
        userId: normalizedTargetUserId,
      },
    },
  });

  return { removedMessageAttachmentUrls };
};

export const banUserFromServer = async (
  serverId: string,
  actorId: string,
  targetUserId: string,
  reason?: string,
) => {
  await assertCanModerate(serverId, actorId, "canBanUsers");
  await assertTargetCanBeModerated(serverId, actorId, targetUserId);

  const normalizedTargetUserId = normalizeUserId(targetUserId);
  const activeBan = await getActiveRestriction(serverId, normalizedTargetUserId, "server_ban");
  if (activeBan) {
    throw new Error("Usuário já está banido deste servidor.");
  }

  await db.$transaction(async (transaction) => {
    await transaction.serverRestriction.create({
      data: {
        serverId,
        userId: normalizedTargetUserId,
        actorId: normalizeUserId(actorId),
        type: "server_ban",
        reason: reason?.trim() || null,
      },
    });

    await transaction.serverMember.deleteMany({
      where: {
        serverId,
        userId: normalizedTargetUserId,
      },
    });
  });
};

export const listActiveServerBansByAdmin = async (
  serverId: string,
  actorId: string,
): Promise<ServerBan[]> => {
  await assertServerAdmin(serverId, actorId);

  const now = new Date();
  const bans = await db.serverRestriction.findMany({
    where: {
      serverId,
      type: "server_ban",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: {
      user: {
        select: {
          displayName: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return bans.map((ban) => ({
    id: ban.id,
    serverId: ban.serverId,
    userId: ban.userId,
    userName: ban.user.displayName,
    avatarUrl: ban.user.avatarUrl,
    reason: ban.reason,
    createdAt: ban.createdAt.toISOString(),
    actorId: ban.actorId,
  }));
};

export const revokeServerBanByAdmin = async (
  serverId: string,
  banId: string,
  actorId: string,
): Promise<void> => {
  await assertServerAdmin(serverId, actorId);

  const activeBan = await db.serverRestriction.findFirst({
    where: {
      id: banId,
      serverId,
      type: "server_ban",
      revokedAt: null,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!activeBan) {
    throw new Error("Banimento ativo não encontrado.");
  }

  await db.$transaction(async (transaction) => {
    await transaction.serverRestriction.update({
      where: { id: banId },
      data: {
        revokedAt: new Date(),
      },
    });

    await transaction.serverMember.upsert({
      where: {
        serverId_userId: {
          serverId,
          userId: activeBan.userId,
        },
      },
      update: {},
      create: {
        serverId,
        userId: activeBan.userId,
        role: "member",
        ...normalizePermissions(),
      },
    });
  });
};

export const timeoutUserFromVoice = async (
  serverId: string,
  actorId: string,
  targetUserId: string,
  durationMinutes: number,
  reason?: string,
) => {
  const normalizedActorId = normalizeUserId(actorId);
  await assertCanModerate(serverId, actorId, "canTimeoutVoice");
  await assertTargetCanBeModerated(serverId, actorId, targetUserId);

  const normalizedTargetUserId = normalizeUserId(targetUserId);
  const minutes = Math.max(1, Math.min(4320, Math.floor(durationMinutes)));
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

  await db.serverRestriction.create({
    data: {
      serverId,
      userId: normalizedTargetUserId,
      actorId: normalizedActorId,
      type: "voice_timeout",
      reason: reason?.trim() || null,
      expiresAt,
    },
  });

  const targetName = await getDisplayNameByUserId(normalizedTargetUserId);
  await createAuditLog(
    serverId,
    normalizedActorId,
    "member_voice_timeout",
    normalizedTargetUserId,
    targetName,
    `Usuário silenciado por ${minutes} minuto(s).`,
  );

  return { expiresAt };
};

export const kickUserFromVoice = async (
  serverId: string,
  actorId: string,
  targetUserId: string,
  reason?: string,
) => {
  const normalizedActorId = normalizeUserId(actorId);
  await assertCanModerate(serverId, actorId, "canKickFromVoice");
  await assertTargetCanBeModerated(serverId, actorId, targetUserId);

  const normalizedTargetUserId = normalizeUserId(targetUserId);
  await createVoiceAction(serverId, actorId, targetUserId, "kick", reason);

  const targetName = await getDisplayNameByUserId(normalizedTargetUserId);
  await createAuditLog(
    serverId,
    normalizedActorId,
    "member_voice_kicked",
    normalizedTargetUserId,
    targetName,
    reason?.trim() ? `Motivo: ${reason.trim()}` : "Usuário expulso da chamada.",
  );
};

export const moveUserToVoiceChannel = async (
  serverId: string,
  actorId: string,
  targetUserId: string,
  targetChannelId: string,
  reason?: string,
) => {
  const normalizedActorId = normalizeUserId(actorId);
  await assertCanModerate(serverId, actorId, "canMoveVoiceUsers");
  await assertTargetCanBeModerated(serverId, actorId, targetUserId, { allowModeratorTargets: true });

  const channel = await db.channel.findUnique({
    where: { id: targetChannelId },
    select: { id: true, serverId: true, type: true, name: true },
  });

  if (!channel || channel.serverId !== serverId || channel.type !== "voice") {
    throw new Error("Canal de voz de destino inválido.");
  }

  const normalizedTargetUserId = normalizeUserId(targetUserId);
  await createVoiceAction(serverId, actorId, targetUserId, "move", reason, targetChannelId);

  const targetName = await getDisplayNameByUserId(normalizedTargetUserId);
  const detailBase = `Usuário movido para o canal de voz \"${channel.name}\".`;
  const detail = reason?.trim() ? `${detailBase} Motivo: ${reason.trim()}` : detailBase;
  await createAuditLog(
    serverId,
    normalizedActorId,
    "member_voice_moved",
    normalizedTargetUserId,
    targetName,
    detail,
  );
};

export const consumeNextVoiceAction = async (
  serverId: string,
  userId: string,
): Promise<{ id: string; type: "kick" | "move"; reason: string | null; targetChannelId: string | null } | null> => {
  const normalizedUserId = normalizeUserId(userId);
  await ensureNoActiveServerBan(serverId, normalizedUserId);

  const action = await db.serverVoiceAction.findFirst({
    where: {
      serverId,
      userId: normalizedUserId,
      handledAt: null,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!action) {
    return null;
  }

  await db.serverVoiceAction.update({
    where: { id: action.id },
    data: { handledAt: new Date() },
  });

  return {
    id: action.id,
    type: action.type,
    reason: action.reason,
    targetChannelId: action.targetChannelId,
  };
};

const mapMessage = (message: {
  id: string;
  serverId: string;
  channelId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: Date;
  attachments: { id: string; name: string; url: string; mimeType: string; size: number }[];
  reactions?: {
    id: string;
    emoji: string;
    userId: string;
    createdAt: Date;
    user?: {
      displayName: string;
    };
  }[];
  user?: {
    displayNameStyle: string | null;
  };
}): ChatMessage => {
  let userDisplayNameStyle: DisplayNameStyle | undefined;
  if (message.user?.displayNameStyle) {
    try {
      userDisplayNameStyle = JSON.parse(message.user.displayNameStyle);
    } catch {
      // Invalid JSON, ignore
    }
  }

  return {
    id: message.id,
    serverId: message.serverId,
    channelId: message.channelId,
    userId: message.userId,
    userName: message.userName,
    userDisplayNameStyle,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    attachments: message.attachments.map((attachment): ChatAttachment => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    reactions: (message.reactions ?? []).map((reaction): MessageReaction => ({
      id: reaction.id,
      emoji: reaction.emoji,
      userId: reaction.userId,
      userName: reaction.user?.displayName ?? reaction.userId,
      createdAt: reaction.createdAt.toISOString(),
    })),
  };
};

const getDirectConversationPair = (firstUserId: string, secondUserId: string): [string, string] => {
  const first = normalizeUserId(firstUserId);
  const second = normalizeUserId(secondUserId);
  return first < second ? [first, second] : [second, first];
};

const mapDirectMessage = (message: {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: Date;
  reactions?: {
    id: string;
    emoji: string;
    userId: string;
    createdAt: Date;
    user?: {
      displayName: string;
    };
  }[];
  sender: {
    displayName: string;
    avatarUrl: string | null;
    displayNameStyle: string | null;
  };
}): DirectChatMessage => {
  let senderDisplayNameStyle: DisplayNameStyle | undefined;
  if (message.sender.displayNameStyle) {
    try {
      senderDisplayNameStyle = JSON.parse(message.sender.displayNameStyle);
    } catch {
      // Invalid JSON, ignore
    }
  }

  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: message.sender.displayName,
    senderAvatarUrl: message.sender.avatarUrl,
    senderDisplayNameStyle,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    reactions: (message.reactions ?? []).map((reaction): MessageReaction => ({
      id: reaction.id,
      emoji: reaction.emoji,
      userId: reaction.userId,
      userName: reaction.user?.displayName ?? reaction.userId,
      createdAt: reaction.createdAt.toISOString(),
    })),
  };
};

const ensureDirectConversationParticipant = async (conversationId: string, userId: string) => {
  const normalizedUserId = normalizeUserId(userId);
  const conversation = await db.directConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      participantAId: true,
      participantBId: true,
    },
  });

  if (!conversation) {
    throw new Error("Conversa direta não encontrada.");
  }

  if (conversation.participantAId !== normalizedUserId && conversation.participantBId !== normalizedUserId) {
    throw new Error("Você não participa desta conversa direta.");
  }

  return conversation;
};

const DIRECT_FRIEND_REQUEST_PREFIX = "[system:friend-request]";

const buildDirectFriendRequestSystemMessage = (requestId: string, requesterId: string, receiverId: string, status: "pending" | "accepted" | "rejected"): string =>
  `${DIRECT_FRIEND_REQUEST_PREFIX}|${requestId}|${requesterId}|${receiverId}|${status}`;

const assertDirectUsersAreFriends = async (firstUserId: string, secondUserId: string) => {
  const normalizedFirstUserId = normalizeUserId(firstUserId);
  const normalizedSecondUserId = normalizeUserId(secondUserId);

  const friendship = await db.directFriend.findUnique({
    where: {
      userId_friendUserId: {
        userId: normalizedFirstUserId,
        friendUserId: normalizedSecondUserId,
      },
    },
    select: {
      userId: true,
    },
  });

  if (!friendship) {
    throw new Error("Apenas amigos podem trocar mensagens diretas.");
  }
};

const assertDirectMessageNotBlockedByTarget = async (senderId: string, targetUserId: string) => {
  const normalizedSenderId = normalizeUserId(senderId);
  const normalizedTargetUserId = normalizeUserId(targetUserId);

  const blocked = await db.directBlock.findUnique({
    where: {
      blockerId_targetUserId: {
        blockerId: normalizedTargetUserId,
        targetUserId: normalizedSenderId,
      },
    },
    select: {
      blockerId: true,
    },
  });

  if (blocked) {
    throw new Error("Você foi bloqueado por este usuário e não pode enviar mensagens diretas.");
  }
};

const isDirectMessageBypassRole = async (userId: string): Promise<boolean> => {
  const normalizedUserId = normalizeUserId(userId);

  const member = await db.serverMember.findFirst({
    where: {
      userId: normalizedUserId,
      role: {
        in: ["admin", "moderator"],
      },
    },
    select: {
      userId: true,
    },
  });

  return !!member;
};

const assertDirectMessageNotBlockedBySender = async (senderId: string, targetUserId: string) => {
  const normalizedSenderId = normalizeUserId(senderId);
  const normalizedTargetUserId = normalizeUserId(targetUserId);

  const blocked = await db.directBlock.findUnique({
    where: {
      blockerId_targetUserId: {
        blockerId: normalizedSenderId,
        targetUserId: normalizedTargetUserId,
      },
    },
    select: {
      blockerId: true,
    },
  });

  if (!blocked) {
    return;
  }

  const canBypass = await isDirectMessageBypassRole(normalizedSenderId);
  if (!canBypass) {
    throw new Error("Você bloqueou este usuário. Desbloqueie para enviar mensagens diretas.");
  }
};

export const listDirectBlockedUserIds = async (userId: string): Promise<string[]> => {
  const normalizedUserId = normalizeUserId(userId);

  const blocks = await db.directBlock.findMany({
    where: {
      blockerId: normalizedUserId,
    },
    select: {
      targetUserId: true,
    },
  });

  return blocks.map((item) => item.targetUserId);
};

export const blockDirectUser = async (actorId: string, targetUserId: string): Promise<void> => {
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedTargetUserId = normalizeUserId(targetUserId);

  if (!normalizedTargetUserId || normalizedTargetUserId === normalizedActorId) {
    throw new Error("Usuário alvo inválido para bloqueio.");
  }

  const target = await db.user.findUnique({
    where: { id: normalizedTargetUserId },
    select: { id: true },
  });

  if (!target) {
    throw new Error("Usuário alvo não encontrado.");
  }

  await db.directBlock.upsert({
    where: {
      blockerId_targetUserId: {
        blockerId: normalizedActorId,
        targetUserId: normalizedTargetUserId,
      },
    },
    create: {
      blockerId: normalizedActorId,
      targetUserId: normalizedTargetUserId,
    },
    update: {},
  });
};

export const unblockDirectUser = async (actorId: string, targetUserId: string): Promise<void> => {
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedTargetUserId = normalizeUserId(targetUserId);

  if (!normalizedTargetUserId || normalizedTargetUserId === normalizedActorId) {
    throw new Error("Usuário alvo inválido para desbloqueio.");
  }

  await db.directBlock.deleteMany({
    where: {
      blockerId: normalizedActorId,
      targetUserId: normalizedTargetUserId,
    },
  });
};

export const createOrGetDirectConversation = async (
  userId: string,
  targetUserId: string,
): Promise<DirectConversation> => {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedTargetUserId = normalizeUserId(targetUserId);

  if (!normalizedTargetUserId) {
    throw new Error("Usuário alvo inválido.");
  }

  if (normalizedUserId === normalizedTargetUserId) {
    throw new Error("Você não pode iniciar conversa privada com você mesmo.");
  }

  const [participantAId, participantBId] = getDirectConversationPair(normalizedUserId, normalizedTargetUserId);

  const target = await db.user.findUnique({
    where: { id: normalizedTargetUserId },
    select: {
      id: true,
      displayName: true,
      displayNameStyle: true,
      avatarUrl: true,
    },
  });

  if (!target) {
    throw new Error("Usuário alvo não encontrado.");
  }

  const conversation = await db.directConversation.upsert({
    where: {
      participantAId_participantBId: {
        participantAId,
        participantBId,
      },
    },
    create: {
      participantAId,
      participantBId,
    },
    update: {},
  });

  return {
    id: conversation.id,
    otherUserId: target.id,
    otherUserName: target.displayName,
    otherUserDisplayNameStyle: parseDisplayNameStyle(target.displayNameStyle),
    otherUserAvatarUrl: target.avatarUrl,
    lastMessagePreview: "",
    lastMessageAt: conversation.updatedAt.toISOString(),
  };
};

export const listDirectConversations = async (userId: string): Promise<DirectConversation[]> => {
  const normalizedUserId = normalizeUserId(userId);

  const conversations = await db.directConversation.findMany({
    where: {
      OR: [
        { participantAId: normalizedUserId },
        { participantBId: normalizedUserId },
      ],
    },
    include: {
      participantA: {
        select: {
          id: true,
          displayName: true,
          displayNameStyle: true,
          avatarUrl: true,
        },
      },
      participantB: {
        select: {
          id: true,
          displayName: true,
          displayNameStyle: true,
          avatarUrl: true,
        },
      },
      messages: {
        select: {
          content: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return conversations.map((conversation) => {
    const otherUser =
      conversation.participantAId === normalizedUserId
        ? conversation.participantB
        : conversation.participantA;
    const lastMessage = conversation.messages[0];
    const isUserA = conversation.participantAId === normalizedUserId;
    const lastReadAt = isUserA ? conversation.lastReadAtA : conversation.lastReadAtB;

    return {
      id: conversation.id,
      otherUserId: otherUser.id,
      otherUserName: otherUser.displayName,
      otherUserDisplayNameStyle: parseDisplayNameStyle(otherUser.displayNameStyle),
      otherUserAvatarUrl: otherUser.avatarUrl,
      lastMessagePreview: lastMessage?.content ?? "",
      lastMessageAt: (lastMessage?.createdAt ?? conversation.updatedAt).toISOString(),
      lastReadAt: lastReadAt?.toISOString() ?? null,
    };
  });
};

export const markDirectConversationAsRead = async (
  conversationId: string,
  userId: string,
): Promise<void> => {
  const normalizedUserId = normalizeUserId(userId);

  const conversation = await db.directConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      participantAId: true,
      participantBId: true,
    },
  });

  if (!conversation) {
    throw new Error("Conversa direta não encontrada.");
  }

  if (
    conversation.participantAId !== normalizedUserId &&
    conversation.participantBId !== normalizedUserId
  ) {
    throw new Error("Você não participa dessa conversa.");
  }

  const isUserA = conversation.participantAId === normalizedUserId;

  await db.directConversation.update({
    where: { id: conversationId },
    data: isUserA ? { lastReadAtA: new Date() } : { lastReadAtB: new Date() },
  });
};

export const listDirectFriends = async (userId: string): Promise<DirectFriend[]> => {
  const normalizedUserId = normalizeUserId(userId);

  const links = await db.directFriend.findMany({
    where: {
      userId: normalizedUserId,
    },
    include: {
      friend: {
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return links.map((link) => ({
    userId: link.friend.id,
    userName: link.friend.displayName,
    avatarUrl: link.friend.avatarUrl,
    createdAt: link.createdAt.toISOString(),
  }));
};

export const addDirectFriendByUserId = async (userId: string, friendUserId: string): Promise<DirectFriend> => {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedFriendUserId = normalizeUserId(friendUserId);

  if (!normalizedFriendUserId || normalizedFriendUserId === normalizedUserId) {
    throw new Error("ID de amigo inválido.");
  }

  const friend = await db.user.findUnique({
    where: { id: normalizedFriendUserId },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
    },
  });

  if (!friend) {
    throw new Error("Usuário não encontrado para adicionar como amigo.");
  }

  const created = await db.directFriend.upsert({
    where: {
      userId_friendUserId: {
        userId: normalizedUserId,
        friendUserId: normalizedFriendUserId,
      },
    },
    create: {
      userId: normalizedUserId,
      friendUserId: normalizedFriendUserId,
    },
    update: {},
    include: {
      friend: {
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  return {
    userId: created.friend.id,
    userName: created.friend.displayName,
    avatarUrl: created.friend.avatarUrl,
    createdAt: created.createdAt.toISOString(),
  };
};

export const createDirectFriendRequestByUserId = async (
  userId: string,
  friendUserId: string,
): Promise<{ requestId: string; conversationId: string }> => {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedFriendUserId = normalizeUserId(friendUserId);

  if (!normalizedFriendUserId || normalizedFriendUserId === normalizedUserId) {
    throw new Error("ID de amigo inválido.");
  }

  const friend = await db.user.findUnique({
    where: { id: normalizedFriendUserId },
    select: {
      id: true,
    },
  });

  if (!friend) {
    throw new Error("Usuário não encontrado para enviar solicitação.");
  }

  const existingFriendship = await db.directFriend.findUnique({
    where: {
      userId_friendUserId: {
        userId: normalizedUserId,
        friendUserId: normalizedFriendUserId,
      },
    },
    select: {
      userId: true,
    },
  });

  if (existingFriendship) {
    throw new Error("Este usuário já é seu amigo.");
  }

  const existingPending = await db.directFriendRequest.findFirst({
    where: {
      status: "pending",
      OR: [
        {
          requesterId: normalizedUserId,
          receiverId: normalizedFriendUserId,
        },
        {
          requesterId: normalizedFriendUserId,
          receiverId: normalizedUserId,
        },
      ],
    },
    select: {
      id: true,
    },
  });

  if (existingPending) {
    throw new Error("Já existe uma solicitação de amizade pendente entre vocês.");
  }

  const [participantAId, participantBId] = getDirectConversationPair(normalizedUserId, normalizedFriendUserId);

  const result = await db.$transaction(async (tx) => {
    const conversation = await tx.directConversation.upsert({
      where: {
        participantAId_participantBId: {
          participantAId,
          participantBId,
        },
      },
      create: {
        participantAId,
        participantBId,
      },
      update: {},
      select: {
        id: true,
      },
    });

    const request = await tx.directFriendRequest.create({
      data: {
        requesterId: normalizedUserId,
        receiverId: normalizedFriendUserId,
        status: "pending",
      },
      select: {
        id: true,
      },
    });

    await tx.directMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: normalizedUserId,
        content: buildDirectFriendRequestSystemMessage(request.id, normalizedUserId, normalizedFriendUserId, "pending"),
      },
    });

    await tx.directConversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    return {
      requestId: request.id,
      conversationId: conversation.id,
    };
  });

  return result;
};

export const respondToDirectFriendRequest = async (
  actorId: string,
  requestId: string,
  action: "accept" | "reject",
): Promise<void> => {
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedRequestId = requestId.trim();

  if (!normalizedRequestId) {
    throw new Error("Solicitação inválida.");
  }

  await db.$transaction(async (tx) => {
    const request = await tx.directFriendRequest.findUnique({
      where: {
        id: normalizedRequestId,
      },
      select: {
        id: true,
        requesterId: true,
        receiverId: true,
        status: true,
      },
    });

    if (!request) {
      throw new Error("Solicitação de amizade não encontrada.");
    }

    if (request.receiverId !== normalizedActorId) {
      throw new Error("Apenas o destinatário pode responder à solicitação.");
    }

    if (request.status !== "pending") {
      throw new Error("Esta solicitação já foi respondida.");
    }

    const nextStatus = action === "accept" ? "accepted" : "rejected";

    await tx.directFriendRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: nextStatus,
        respondedAt: new Date(),
      },
    });

    if (nextStatus === "accepted") {
      await tx.directFriend.upsert({
        where: {
          userId_friendUserId: {
            userId: request.requesterId,
            friendUserId: request.receiverId,
          },
        },
        create: {
          userId: request.requesterId,
          friendUserId: request.receiverId,
        },
        update: {},
      });

      await tx.directFriend.upsert({
        where: {
          userId_friendUserId: {
            userId: request.receiverId,
            friendUserId: request.requesterId,
          },
        },
        create: {
          userId: request.receiverId,
          friendUserId: request.requesterId,
        },
        update: {},
      });
    }

    const [participantAId, participantBId] = getDirectConversationPair(request.requesterId, request.receiverId);

    const conversation = await tx.directConversation.upsert({
      where: {
        participantAId_participantBId: {
          participantAId,
          participantBId,
        },
      },
      create: {
        participantAId,
        participantBId,
      },
      update: {
        updatedAt: new Date(),
      },
      select: {
        id: true,
      },
    });

    await tx.directMessage.updateMany({
      where: {
        conversationId: conversation.id,
        content: {
          contains: `${DIRECT_FRIEND_REQUEST_PREFIX}|${request.id}|`,
        },
      },
      data: {
        content: buildDirectFriendRequestSystemMessage(request.id, request.requesterId, request.receiverId, nextStatus),
      },
    });

    await tx.directMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: normalizedActorId,
        content:
          nextStatus === "accepted"
            ? "[system] Solicitação de amizade aceita."
            : "[system] Solicitação de amizade rejeitada.",
      },
    });
  });
};

export const removeDirectFriendByUserId = async (userId: string, friendUserId: string): Promise<void> => {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedFriendUserId = normalizeUserId(friendUserId);

  if (!normalizedFriendUserId || normalizedFriendUserId === normalizedUserId) {
    throw new Error("ID de amigo inválido.");
  }

  await db.directFriend.deleteMany({
    where: {
      OR: [
        {
          userId: normalizedUserId,
          friendUserId: normalizedFriendUserId,
        },
        {
          userId: normalizedFriendUserId,
          friendUserId: normalizedUserId,
        },
      ],
    },
  });
};

export const listDirectMessagesPage = async (
  conversationId: string,
  userId: string,
  options: DirectMessagePageOptions = {},
): Promise<{ messages: DirectChatMessage[]; hasMore: boolean }> => {
  await ensureDirectConversationParticipant(conversationId, userId);

  const safeLimit = Math.max(1, Math.min(100, options.limit ?? 30));

  const whereClause = {
    conversationId,
    ...(options.beforeCreatedAt
      ? {
          OR: [
            {
              createdAt: {
                lt: new Date(options.beforeCreatedAt),
              },
            },
            ...(options.beforeId
              ? [
                  {
                    createdAt: new Date(options.beforeCreatedAt),
                    id: {
                      lt: options.beforeId,
                    },
                  },
                ]
              : []),
          ],
        }
      : {}),
  };

  const messages = await db.directMessage.findMany({
    where: whereClause,
    include: {
      reactions: {
        include: {
          user: {
            select: {
              displayName: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }],
      },
      sender: {
        select: {
          displayName: true,
          avatarUrl: true,
          displayNameStyle: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: safeLimit + 1,
  });

  const hasMore = messages.length > safeLimit;
  const page = hasMore ? messages.slice(0, safeLimit) : messages;

  return {
    messages: [...page].reverse().map(mapDirectMessage),
    hasMore,
  };
};

export const createDirectMessage = async (
  userId: string,
  payload: {
    content: string;
    conversationId?: string;
    targetUserId?: string;
  },
): Promise<{ message: DirectChatMessage; conversationId: string }> => {
  const normalizedUserId = normalizeUserId(userId);
  const content = payload.content.trim();
  let otherParticipantId = "";

  if (!content) {
    throw new Error("Conteúdo da mensagem não pode ser vazio.");
  }

  let conversationId = payload.conversationId?.trim();
  if (!conversationId) {
    const targetUserId = payload.targetUserId?.trim();
    if (!targetUserId) {
      throw new Error("Informe a conversa ou o usuário alvo.");
    }
    otherParticipantId = normalizeUserId(targetUserId);
    const conversation = await createOrGetDirectConversation(normalizedUserId, targetUserId);
    conversationId = conversation.id;
  } else {
    const conversation = await ensureDirectConversationParticipant(conversationId, normalizedUserId);
    otherParticipantId =
      conversation.participantAId === normalizedUserId
        ? conversation.participantBId
        : conversation.participantAId;
  }

  await assertDirectMessageNotBlockedBySender(normalizedUserId, otherParticipantId);
  await assertDirectMessageNotBlockedByTarget(normalizedUserId, otherParticipantId);
  await assertDirectUsersAreFriends(normalizedUserId, otherParticipantId);
  assertMessageNotSpam(`direct:${conversationId}`, normalizedUserId, content);

  const created = await db.directMessage.create({
    data: {
      conversationId,
      senderId: normalizedUserId,
      content,
    },
    include: {
      sender: {
        select: {
          displayName: true,
          avatarUrl: true,
          displayNameStyle: true,
        },
      },
    },
  });

  await db.directConversation.update({
    where: { id: conversationId },
    data: {
      updatedAt: new Date(),
    },
  });

  return {
    message: mapDirectMessage(created),
    conversationId,
  };
};

export const clearDirectConversationMessages = async (
  conversationId: string,
  actorId: string,
): Promise<{ removedAttachmentUrls: string[] }> => {
  const normalizedActorId = normalizeUserId(actorId);
  const conversation = await ensureDirectConversationParticipant(conversationId, normalizedActorId);

  const messages = await db.directMessage.findMany({
    where: {
      conversationId: conversation.id,
    },
    select: {
      id: true,
      content: true,
    },
  });

  const removedAttachmentUrls = messages.flatMap((message) => extractDirectUploadUrls(message.content));

  await db.directMessage.deleteMany({
    where: {
      conversationId: conversation.id,
    },
  });

  await db.directConversation.update({
    where: {
      id: conversation.id,
    },
    data: {
      updatedAt: new Date(),
    },
  });

  return {
    removedAttachmentUrls,
  };
};

export const deleteDirectConversationById = async (
  conversationId: string,
  actorId: string,
): Promise<{ removedAttachmentUrls: string[] }> => {
  const normalizedActorId = normalizeUserId(actorId);
  const conversation = await ensureDirectConversationParticipant(conversationId, normalizedActorId);

  const messages = await db.directMessage.findMany({
    where: {
      conversationId: conversation.id,
    },
    select: {
      content: true,
    },
  });

  const removedAttachmentUrls = messages.flatMap((message) => extractDirectUploadUrls(message.content));

  await db.directConversation.delete({
    where: {
      id: conversation.id,
    },
  });

  return {
    removedAttachmentUrls,
  };
};

export const updateDirectMessageContent = async (
  messageId: string,
  actorId: string,
  content: string,
): Promise<DirectChatMessage> => {
  const normalizedActorId = normalizeUserId(actorId);
  const nextContent = content.trim();

  if (!nextContent) {
    throw new Error("A mensagem não pode ficar vazia.");
  }

  const existingMessage = await db.directMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      senderId: true,
      conversationId: true,
    },
  });

  if (!existingMessage) {
    throw new Error("Mensagem direta não encontrada.");
  }

  await ensureDirectConversationParticipant(existingMessage.conversationId, normalizedActorId);

  if (existingMessage.senderId !== normalizedActorId) {
    throw new Error("Você só pode editar sua própria mensagem.");
  }

  const updatedMessage = await db.directMessage.update({
    where: { id: messageId },
    data: {
      content: nextContent,
    },
    include: {
      sender: {
        select: {
          displayName: true,
          avatarUrl: true,
          displayNameStyle: true,
        },
      },
    },
  });

  await db.directConversation.update({
    where: { id: existingMessage.conversationId },
    data: { updatedAt: new Date() },
  });

  return mapDirectMessage(updatedMessage);
};

export const deleteDirectAttachmentFromMessage = async (
  messageId: string,
  actorId: string,
  attachmentUrl: string,
): Promise<{ attachmentUrl: string; message: DirectChatMessage }> => {
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedAttachmentUrl = attachmentUrl.trim();

  if (!normalizedAttachmentUrl.startsWith("/uploads/direct/")) {
    throw new Error("URL de arquivo inválida.");
  }

  const existingMessage = await db.directMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      senderId: true,
      conversationId: true,
      content: true,
    },
  });

  if (!existingMessage) {
    throw new Error("Mensagem direta não encontrada.");
  }

  await ensureDirectConversationParticipant(existingMessage.conversationId, normalizedActorId);

  if (existingMessage.senderId !== normalizedActorId) {
    throw new Error("Você só pode excluir arquivos da sua própria mensagem.");
  }

  const currentAttachmentUrls = extractDirectUploadUrls(existingMessage.content);
  if (!currentAttachmentUrls.includes(normalizedAttachmentUrl)) {
    throw new Error("Arquivo não encontrado nesta mensagem.");
  }

  const nextContent = removeDirectUploadUrlFromContent(existingMessage.content, normalizedAttachmentUrl);

  const updatedMessage = await db.directMessage.update({
    where: { id: messageId },
    data: {
      content: nextContent,
    },
    include: {
      sender: {
        select: {
          displayName: true,
          avatarUrl: true,
          displayNameStyle: true,
        },
      },
    },
  });

  return {
    attachmentUrl: normalizedAttachmentUrl,
    message: mapDirectMessage(updatedMessage),
  };
};

export const deleteDirectMessage = async (
  messageId: string,
  actorId: string,
): Promise<{ removedAttachmentUrls: string[] }> => {
  const normalizedActorId = normalizeUserId(actorId);

  const existingMessage = await db.directMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      senderId: true,
      conversationId: true,
      content: true,
    },
  });

  if (!existingMessage) {
    throw new Error("Mensagem direta não encontrada.");
  }

  await ensureDirectConversationParticipant(existingMessage.conversationId, normalizedActorId);

  if (existingMessage.senderId !== normalizedActorId) {
    throw new Error("Você só pode excluir sua própria mensagem.");
  }

  const removedAttachmentUrls = extractDirectUploadUrls(existingMessage.content);

  await db.directMessage.delete({
    where: { id: messageId },
  });

  return { removedAttachmentUrls };
};

export const listMessagesPage = async (
  serverId: string,
  channelId: string,
  userId: string,
  options: MessagePageOptions = {},
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> => {
  const server = await getServerForUser(serverId, userId);
  const channel = getChannel(server, channelId);
  const member = getMember(server, userId);
  if (channel.type !== "text") {
    throw new Error("Apenas canais de texto possuem mensagens.");
  }
  if (!member || !canRoleAccessChannel(channel, member.role)) {
    throw new Error("Seu cargo não pode acessar este canal.");
  }

  const safeLimit = Math.max(1, Math.min(100, options.limit ?? 30));

  const whereClause = {
    serverId,
    channelId,
    ...(options.beforeCreatedAt
      ? {
          OR: [
            {
              createdAt: {
                lt: new Date(options.beforeCreatedAt),
              },
            },
            ...(options.beforeId
              ? [
                  {
                    createdAt: new Date(options.beforeCreatedAt),
                    id: {
                      lt: options.beforeId,
                    },
                  },
                ]
              : []),
          ],
        }
      : {}),
  };

  const messages = await db.message.findMany({
    where: whereClause,
    include: {
      attachments: true,
      reactions: {
        include: {
          user: {
            select: {
              displayName: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }],
      },
      user: {
        select: {
          displayNameStyle: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: safeLimit + 1,
  });

  const hasMore = messages.length > safeLimit;
  const page = hasMore ? messages.slice(0, safeLimit) : messages;
  const chronologicallyOrdered = [...page].reverse();

  return {
    messages: chronologicallyOrdered.map(mapMessage),
    hasMore,
  };
};

export const listMessages = async (serverId: string, channelId: string, userId: string): Promise<ChatMessage[]> => {
  const page = await listMessagesPage(serverId, channelId, userId, { limit: 100 });
  return page.messages;
};

export const createMessage = async (
  serverId: string,
  channelId: string,
  userId: string,
  userName: string,
  content: string,
  attachments: Omit<ChatAttachment, "id">[] = [],
): Promise<ChatMessage> => {
  const normalizedUserId = normalizeUserId(userId);
  const server = await getServerForUser(serverId, normalizedUserId);
  const channel = getChannel(server, channelId);
  const member = getMember(server, normalizedUserId);
  if (channel.type !== "text") {
    throw new Error("Apenas canais de texto aceitam mensagens.");
  }
  if (!member) {
    throw new Error("Você não participa desse servidor.");
  }
  if (!canRoleAccessChannel(channel, member.role)) {
    throw new Error("Seu cargo não pode acessar este canal.");
  }
  if (!canRoleSendMessagesInChannel(channel, member.role)) {
    throw new Error("Seu cargo não pode enviar mensagens neste canal.");
  }
  if (attachments.length > 0 && !canRoleSendFilesInChannel(channel, member.role)) {
    throw new Error("Seu cargo não pode enviar arquivos neste canal.");
  }
  if (hasLinkContent(content) && !canRoleSendLinksInChannel(channel, member.role)) {
    throw new Error("Seu cargo não pode enviar links neste canal.");
  }

  assertMessageNotSpam(`server:${serverId}:channel:${channelId}`, normalizedUserId, content);

  await ensureUserRecord(normalizedUserId, userName);

  const message = await db.message.create({
    data: {
      serverId,
      channelId,
      userId: normalizedUserId,
      userName: normalizeDisplayName(userName) || normalizedUserId,
      content,
      attachments: attachments.length
        ? {
            create: attachments.map((attachment) => ({
              name: attachment.name,
              url: attachment.url,
              mimeType: attachment.mimeType,
              size: attachment.size,
            })),
          }
        : undefined,
    },
    include: {
      attachments: true,
      user: {
        select: {
          displayNameStyle: true,
        },
      },
    },
  });

  return mapMessage(message);
};

export const updateMessageContent = async (
  serverId: string,
  channelId: string,
  messageId: string,
  actorId: string,
  content: string,
): Promise<ChatMessage> => {
  const normalizedActorId = normalizeUserId(actorId);
  const server = await getServerForUser(serverId, normalizedActorId);
  const channel = getChannel(server, channelId);
  const actorMember = getMember(server, normalizedActorId);
  if (channel.type !== "text") {
    throw new Error("Apenas mensagens de canais de texto podem ser editadas.");
  }
  if (!actorMember) {
    throw new Error("Você não participa desse servidor.");
  }
  if (!canRoleAccessChannel(channel, actorMember.role)) {
    throw new Error("Seu cargo não pode acessar este canal.");
  }

  const message = await db.message.findFirst({
    where: {
      id: messageId,
      serverId,
      channelId,
    },
    include: {
      attachments: true,
      user: {
        select: {
          displayNameStyle: true,
        },
      },
    },
  });

  if (!message) {
    throw new Error("Mensagem não encontrada.");
  }

  const canModerateOtherMessages =
    actorMember.role === "admin" ||
    (actorMember.role === "moderator" && !!actorMember.permissions?.canDeleteUserMessages);
  const isOwnMessage = message.userId === normalizedActorId;

  if (!isOwnMessage && !canModerateOtherMessages) {
    throw new Error("Você só pode editar sua própria mensagem.");
  }

  if (isOwnMessage) {
    if (!canRoleSendMessagesInChannel(channel, actorMember.role)) {
      throw new Error("Seu cargo não pode enviar mensagens neste canal.");
    }
    if (hasLinkContent(content) && !canRoleSendLinksInChannel(channel, actorMember.role)) {
      throw new Error("Seu cargo não pode enviar links neste canal.");
    }
  }

  const updated = await db.message.update({
    where: { id: messageId },
    data: { content },
    include: {
      attachments: true,
      user: {
        select: {
          displayNameStyle: true,
        },
      },
    },
  });

  return {
    id: updated.id,
    serverId: updated.serverId,
    channelId: updated.channelId,
    userId: updated.userId,
    userName: updated.userName,
    content: updated.content,
    createdAt: updated.createdAt.toISOString(),
    attachments: updated.attachments.map((attachment): ChatAttachment => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
  };
};

export const deleteMessage = async (
  serverId: string,
  channelId: string,
  messageId: string,
  actorId: string,
): Promise<string[]> => {
  const normalizedActorId = normalizeUserId(actorId);
  const server = await getServerForUser(serverId, normalizedActorId);
  const channel = getChannel(server, channelId);
  const actorMember = getMember(server, normalizedActorId);
  if (channel.type !== "text") {
    throw new Error("Apenas mensagens de canais de texto podem ser excluídas.");
  }
  if (!actorMember) {
    throw new Error("Você não participa desse servidor.");
  }
  if (!canRoleAccessChannel(channel, actorMember.role)) {
    throw new Error("Seu cargo não pode acessar este canal.");
  }

  const message = await db.message.findFirst({
    where: {
      id: messageId,
      serverId,
      channelId,
    },
    include: {
      attachments: true,
    },
  });

  if (!message) {
    throw new Error("Mensagem não encontrada.");
  }

  const canModerateOtherMessages =
    actorMember.role === "admin" ||
    (actorMember.role === "moderator" && !!actorMember.permissions?.canDeleteUserMessages);
  const isOwnMessage = message.userId === normalizedActorId;

  if (!isOwnMessage && !canModerateOtherMessages) {
    throw new Error("Você só pode excluir sua própria mensagem.");
  }

  if (isOwnMessage && !canRoleDeleteMessagesInChannel(channel, actorMember.role)) {
    throw new Error("Seu cargo não pode excluir mensagens neste canal.");
  }

  const attachmentUrls = message.attachments.map((attachment) => attachment.url);
  await db.message.delete({ where: { id: messageId } });
  return attachmentUrls;
};

export const deleteAttachmentFromMessage = async (
  serverId: string,
  channelId: string,
  messageId: string,
  attachmentId: string,
  actorId: string,
): Promise<{ attachmentUrl: string; message: ChatMessage }> => {
  const normalizedActorId = normalizeUserId(actorId);
  const server = await getServerForUser(serverId, normalizedActorId);
  const channel = getChannel(server, channelId);
  const actorMember = getMember(server, normalizedActorId);
  if (channel.type !== "text") {
    throw new Error("Apenas anexos de canais de texto podem ser excluídos.");
  }
  if (!actorMember) {
    throw new Error("Você não participa desse servidor.");
  }
  if (!canRoleAccessChannel(channel, actorMember.role)) {
    throw new Error("Seu cargo não pode acessar este canal.");
  }

  const message = await db.message.findFirst({
    where: {
      id: messageId,
      serverId,
      channelId,
    },
    include: {
      attachments: true,
      user: {
        select: {
          displayNameStyle: true,
        },
      },
    },
  });

  if (!message) {
    throw new Error("Mensagem não encontrada.");
  }

  const canModerateOtherMessages =
    actorMember.role === "admin" ||
    (actorMember.role === "moderator" && !!actorMember.permissions?.canDeleteUserMessages);
  const isOwnMessage = message.userId === normalizedActorId;

  if (!isOwnMessage && !canModerateOtherMessages) {
    throw new Error("Você só pode excluir anexos da sua própria mensagem.");
  }

  if (isOwnMessage && !canRoleDeleteMessagesInChannel(channel, actorMember.role)) {
    throw new Error("Seu cargo não pode excluir mensagens neste canal.");
  }

  const attachment = message.attachments.find((item) => item.id === attachmentId);
  if (!attachment) {
    throw new Error("Anexo não encontrado.");
  }

  await db.messageAttachment.delete({
    where: { id: attachmentId },
  });

  const updatedMessage = await db.message.findUnique({
    where: { id: messageId },
    include: {
      attachments: true,
      user: {
        select: {
          displayNameStyle: true,
        },
      },
    },
  });

  if (!updatedMessage) {
    throw new Error("Mensagem não encontrada.");
  }

  let userDisplayNameStyle: DisplayNameStyle | undefined;
  if (updatedMessage.user?.displayNameStyle) {
    try {
      userDisplayNameStyle = JSON.parse(updatedMessage.user.displayNameStyle);
    } catch {
      // Invalid JSON, ignore
    }
  }

  return {
    attachmentUrl: attachment.url,
    message: {
      id: updatedMessage.id,
      serverId: updatedMessage.serverId,
      channelId: updatedMessage.channelId,
      userId: updatedMessage.userId,
      userName: updatedMessage.userName,
      userDisplayNameStyle,
      content: updatedMessage.content,
      createdAt: updatedMessage.createdAt.toISOString(),
      attachments: updatedMessage.attachments.map((item): ChatAttachment => ({
        id: item.id,
        name: item.name,
        url: item.url,
        mimeType: item.mimeType,
        size: item.size,
      })),
    },
  };
};

export const registerUser = async (
  username: string,
  displayName: string,
  password: string,
): Promise<AppUser> => {
  const normalizedUsername = normalizeUsername(username);
  const normalizedDisplayName = normalizeDisplayName(displayName);
  const passwordHash = await hash(password, 10);

  const existingUsername = await db.user.findUnique({
    where: { username: normalizedUsername },
    select: { id: true },
  });

  if (existingUsername) {
    throw new Error("Este usuário já está em uso.");
  }

  for (let attempt = 0; attempt < USER_ID_GENERATION_ATTEMPTS; attempt += 1) {
    const generatedUserId = generateRandomNumericUserId();

    try {
      const user = await db.user.create({
        data: {
          id: generatedUserId,
          username: normalizedUsername,
          displayName: normalizedDisplayName || generatedUserId,
          passwordHash,
          joinWithMicEnabled: true,
          joinWithCameraEnabled: false,
          noiseSuppressionEnabled: true,
          chatNotificationSoundEnabled: true,
        },
      });

      return mapAppUser(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const targets = Array.isArray(error.meta?.target)
          ? error.meta.target.map((value) => String(value))
          : [];

        if (targets.includes("username")) {
          throw new Error("Este usuário já está em uso.");
        }

        continue;
      }
      throw error;
    }
  }

  throw new Error("Não foi possível gerar um identificador único. Tente novamente.");

};

export const authenticateUser = async (
  username: string,
  password: string,
): Promise<AppUser> => {
  const normalizedUsername = normalizeUsername(username);
  const user = await db.user.findUnique({ where: { username: normalizedUsername } });

  if (!user || !hasPasswordConfigured(user.passwordHash)) {
    throw new Error("Usuário ou senha inválidos.");
  }

  const isPasswordValid = await compare(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new Error("Usuário ou senha inválidos.");
  }

  return mapAppUser(user);
};

export const getUserProfile = async (userId: string): Promise<AppUser> => {
  const normalizedUserId = normalizeUserId(userId);
  const user = await db.user.findUnique({
    where: { id: normalizedUserId },
    select: {
      id: true,
      displayName: true,
      displayNameStyle: true,
      avatarUrl: true,
      joinWithMicEnabled: true,
      joinWithCameraEnabled: true,
      noiseSuppressionEnabled: true,
      chatNotificationSoundEnabled: true,
      micGain: true,
      keybinds: true,
    },
  });

  if (!user) {
    throw new Error("Usuário não encontrado.");
  }

  return mapAppUser(user);
};

export const updateOwnUserSettings = async (
  actorId: string,
  targetUserId: string,
  payload: {
    displayName?: string;
    displayNameStyle?: DisplayNameStyle;
    password?: string;
    joinWithMicEnabled?: boolean;
    joinWithCameraEnabled?: boolean;
    noiseSuppressionEnabled?: boolean;
    chatNotificationSoundEnabled?: boolean;
    micGain?: number;
    keybinds?: Record<string, string>;
  },
): Promise<AppUser> => {
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedTargetUserId = normalizeUserId(targetUserId);

  if (normalizedActorId !== normalizedTargetUserId) {
    throw new Error("Você só pode alterar seu próprio perfil.");
  }

  const existingUser = await db.user.findUnique({
    where: { id: normalizedTargetUserId },
    select: {
      id: true,
      displayName: true,
      displayNameStyle: true,
      avatarUrl: true,
      passwordHash: true,
      joinWithMicEnabled: true,
      joinWithCameraEnabled: true,
      noiseSuppressionEnabled: true,
      chatNotificationSoundEnabled: true,
      micGain: true,
      keybinds: true,
    },
  });

  if (!existingUser) {
    throw new Error("Usuário não encontrado.");
  }

  const updateData: {
    displayName?: string;
    displayNameStyle?: string;
    passwordHash?: string;
    joinWithMicEnabled?: boolean;
    joinWithCameraEnabled?: boolean;
    noiseSuppressionEnabled?: boolean;
    chatNotificationSoundEnabled?: boolean;
    micGain?: number;
    keybinds?: string;
  } = {};

  if (typeof payload.displayName === "string") {
    const normalizedDisplayName = normalizeDisplayName(payload.displayName);
    if (!normalizedDisplayName || normalizedDisplayName.length > 40) {
      throw new Error("Nome deve ter entre 1 e 40 caracteres.");
    }
    updateData.displayName = normalizedDisplayName;
  }

  if (payload.displayNameStyle !== undefined) {
    updateData.displayNameStyle = JSON.stringify(payload.displayNameStyle || {});
  }

  if (typeof payload.password === "string") {
    const trimmedPassword = payload.password.trim();
    if (trimmedPassword.length < 6 || trimmedPassword.length > 128) {
      throw new Error("A nova senha deve ter entre 6 e 128 caracteres.");
    }
    updateData.passwordHash = await hash(trimmedPassword, 10);
  }

  if (typeof payload.joinWithMicEnabled === "boolean") {
    updateData.joinWithMicEnabled = payload.joinWithMicEnabled;
  }

  if (typeof payload.joinWithCameraEnabled === "boolean") {
    updateData.joinWithCameraEnabled = payload.joinWithCameraEnabled;
  }

  if (typeof payload.noiseSuppressionEnabled === "boolean") {
    updateData.noiseSuppressionEnabled = payload.noiseSuppressionEnabled;
  }

  if (typeof payload.chatNotificationSoundEnabled === "boolean") {
    updateData.chatNotificationSoundEnabled = payload.chatNotificationSoundEnabled;
  }

  if (typeof payload.micGain === "number" && Number.isFinite(payload.micGain)) {
    updateData.micGain = Math.max(0, Math.min(300, Math.round(payload.micGain)));
  }

  if (payload.keybinds !== undefined) {
    updateData.keybinds = JSON.stringify(payload.keybinds);
  }

  if (Object.keys(updateData).length === 0) {
    return mapAppUser(existingUser);
  }

  const updatedUser = await db.user.update({
    where: { id: normalizedTargetUserId },
    data: updateData,
    select: {
      id: true,
      displayName: true,
      displayNameStyle: true,
      avatarUrl: true,
      joinWithMicEnabled: true,
      joinWithCameraEnabled: true,
      noiseSuppressionEnabled: true,
      chatNotificationSoundEnabled: true,
      micGain: true,
      keybinds: true,
    },
  });

  return mapAppUser(updatedUser);
};

export const updateUserAvatar = async (
  actorId: string,
  targetUserId: string,
  avatarUrl: string,
): Promise<{ user: AppUser; previousAvatarUrl: string | null }> => {
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedTargetUserId = normalizeUserId(targetUserId);

  if (normalizedActorId !== normalizedTargetUserId) {
    throw new Error("Você só pode alterar seu próprio avatar.");
  }

  const existingUser = await db.user.findUnique({
    where: { id: normalizedTargetUserId },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      joinWithMicEnabled: true,
      joinWithCameraEnabled: true,
      noiseSuppressionEnabled: true,
      chatNotificationSoundEnabled: true,
      micGain: true,
      keybinds: true,
    },
  });

  if (!existingUser) {
    throw new Error("Usuário não encontrado.");
  }

  const updatedUser = await db.user.update({
    where: { id: normalizedTargetUserId },
    data: { avatarUrl },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      joinWithMicEnabled: true,
      joinWithCameraEnabled: true,
      noiseSuppressionEnabled: true,
      chatNotificationSoundEnabled: true,
      micGain: true,
      keybinds: true,
    },
  });

  return {
    user: mapAppUser(updatedUser),
    previousAvatarUrl: existingUser.avatarUrl,
  };
};

export const updateUserProfileCardGif = async (
  actorId: string,
  targetUserId: string,
  profileCardGifUrl: string | null,
): Promise<{ user: AppUser; previousProfileCardGifUrl: string | null }> => {
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedTargetUserId = normalizeUserId(targetUserId);

  if (normalizedActorId !== normalizedTargetUserId) {
    throw new Error("Você só pode alterar o GIF do seu próprio perfil.");
  }

  const existingUser = await db.user.findUnique({
    where: { id: normalizedTargetUserId },
    select: {
      id: true,
      displayName: true,
      displayNameStyle: true,
      avatarUrl: true,
      joinWithMicEnabled: true,
      joinWithCameraEnabled: true,
      noiseSuppressionEnabled: true,
      chatNotificationSoundEnabled: true,
      keybinds: true,
    },
  });

  if (!existingUser) {
    throw new Error("Usuário não encontrado.");
  }

  const previousStyle = parseDisplayNameStyle(existingUser.displayNameStyle);
  const previousProfileCardGifUrl = typeof previousStyle.profileCardGifUrl === "string"
    ? previousStyle.profileCardGifUrl
    : null;

  const nextStyle: DisplayNameStyle = {
    ...previousStyle,
  };

  if (profileCardGifUrl) {
    nextStyle.profileCardGifUrl = profileCardGifUrl;
  } else {
    delete nextStyle.profileCardGifUrl;
  }

  const updatedUser = await db.user.update({
    where: { id: normalizedTargetUserId },
    data: {
      displayNameStyle: JSON.stringify(nextStyle),
    },
    select: {
      id: true,
      displayName: true,
      displayNameStyle: true,
      avatarUrl: true,
      joinWithMicEnabled: true,
      joinWithCameraEnabled: true,
      noiseSuppressionEnabled: true,
      chatNotificationSoundEnabled: true,
      micGain: true,
      keybinds: true,
    },
  });

  return {
    user: mapAppUser(updatedUser),
    previousProfileCardGifUrl,
  };
};

export const deleteOwnUserAccount = async (
  actorId: string,
  targetUserId: string,
): Promise<{ previousAvatarUrl: string | null }> => {
  const normalizedActorId = normalizeUserId(actorId);
  const normalizedTargetUserId = normalizeUserId(targetUserId);

  if (normalizedActorId !== normalizedTargetUserId) {
    throw new Error("Você só pode excluir sua própria conta.");
  }

  const existingUser = await db.user.findUnique({
    where: { id: normalizedTargetUserId },
    select: {
      id: true,
      avatarUrl: true,
    },
  });

  if (!existingUser) {
    throw new Error("Usuário não encontrado.");
  }

  const deactivatedDisplayName = "Usuário removido";

  await db.user.update({
    where: { id: normalizedTargetUserId },
    data: {
      username: null,
      displayName: deactivatedDisplayName,
      avatarUrl: null,
      passwordHash: NO_PASSWORD_HASH,
      joinWithMicEnabled: true,
      joinWithCameraEnabled: false,
      noiseSuppressionEnabled: true,
      chatNotificationSoundEnabled: true,
    },
  });

  return {
    previousAvatarUrl: existingUser.avatarUrl,
  };
};

export const ensureVoiceAccess = async (serverId: string, channelId: string, userId: string): Promise<string> => {
  await ensureNoActiveServerBan(serverId, userId);
  const activeVoiceTimeout = await getActiveRestriction(serverId, userId, "voice_timeout");
  if (activeVoiceTimeout) {
    const until = activeVoiceTimeout.expiresAt
      ? ` Até ${activeVoiceTimeout.expiresAt.toLocaleString("pt-BR")}.`
      : "";
    throw new Error(getRestrictionReason(activeVoiceTimeout.reason, `Você está impedido de entrar em chamadas de voz.${until}`));
  }

  const server = await getServerForUser(serverId, userId);
  const channel = getChannel(server, channelId);
  const member = getMember(server, userId);
  if (channel.type !== "voice") {
    throw new Error("Token LiveKit só pode ser gerado para canal de voz.");
  }
  if (!member || !canRoleAccessChannel(channel, member.role)) {
    throw new Error("Seu cargo não pode acessar este canal de voz.");
  }

  return `${serverId}:${channelId}`;
};

// ---------------------------------------------------------------
// Reações em mensagens
// ---------------------------------------------------------------

const normalizeEmojiForReaction = (emoji: string): string => emoji.trim();

export const addMessageReaction = async (
  serverId: string,
  channelId: string,
  messageId: string,
  userId: string,
  emoji: string,
): Promise<MessageReaction> => {
  const normalizedUserId = normalizeUserId(userId);
  const server = await getServerForUser(serverId, normalizedUserId);
  const channel = getChannel(server, channelId);
  const member = getMember(server, normalizedUserId);
  if (channel.type !== "text") {
    throw new Error("Reações só são permitidas em mensagens de canais de texto.");
  }
  if (!member || !canRoleAccessChannel(channel, member.role)) {
    throw new Error("Seu cargo não pode acessar este canal.");
  }

  const message = await db.message.findUnique({ where: { id: messageId } });
  if (!message || message.serverId !== serverId || message.channelId !== channelId) {
    throw new Error("Mensagem não encontrada.");
  }

  const normalizedEmoji = normalizeEmojiForReaction(emoji);
  if (!normalizedEmoji) {
    throw new Error("Emoji inválido.");
  }

  const existingReaction = await db.messageReaction.findUnique({
    where: {
      messageId_userId_emoji: {
        messageId,
        userId: normalizedUserId,
        emoji: normalizedEmoji,
      },
    },
    include: {
      user: {
        select: { displayName: true },
      },
    },
  });

  if (existingReaction) {
    return mapReactionToApi(existingReaction);
  }

  const reaction = await db.messageReaction.create({
    data: {
      messageId,
      userId: normalizedUserId,
      emoji: normalizedEmoji,
    },
    include: {
      user: {
        select: { displayName: true },
      },
    },
  });

  return mapReactionToApi(reaction);
};

export const removeMessageReaction = async (
  serverId: string,
  channelId: string,
  messageId: string,
  userId: string,
  emoji: string,
): Promise<void> => {
  const normalizedUserId = normalizeUserId(userId);
  const server = await getServerForUser(serverId, normalizedUserId);
  const channel = getChannel(server, channelId);
  const member = getMember(server, normalizedUserId);
  if (channel.type !== "text") {
    throw new Error("Reações só são permitidas em mensagens de canais de texto.");
  }
  if (!member || !canRoleAccessChannel(channel, member.role)) {
    throw new Error("Seu cargo não pode acessar este canal.");
  }

  const message = await db.message.findUnique({ where: { id: messageId } });
  if (!message || message.serverId !== serverId || message.channelId !== channelId) {
    throw new Error("Mensagem não encontrada.");
  }

  const normalizedEmoji = normalizeEmojiForReaction(emoji);

  await db.messageReaction.deleteMany({
    where: {
      messageId,
      userId: normalizedUserId,
      emoji: normalizedEmoji,
    },
  });
};

const mapReactionToApi = (reaction: {
  id: string;
  emoji: string;
  userId: string;
  createdAt: Date;
  user?: {
    displayName: string;
  };
}): MessageReaction => ({
  id: reaction.id,
  emoji: reaction.emoji,
  userId: reaction.userId,
  userName: reaction.user?.displayName ?? reaction.userId,
  createdAt: reaction.createdAt.toISOString(),
});

export const addDirectMessageReaction = async (
  messageId: string,
  userId: string,
  emoji: string,
): Promise<MessageReaction> => {
  const normalizedUserId = normalizeUserId(userId);

  const message = await db.directMessage.findUnique({ where: { id: messageId } });
  if (!message) {
    throw new Error("Mensagem não encontrada.");
  }

  await ensureDirectConversationParticipant(message.conversationId, normalizedUserId);

  const normalizedEmoji = normalizeEmojiForReaction(emoji);
  if (!normalizedEmoji) {
    throw new Error("Emoji inválido.");
  }

  const existingReaction = await db.directMessageReaction.findUnique({
    where: {
      messageId_userId_emoji: {
        messageId,
        userId: normalizedUserId,
        emoji: normalizedEmoji,
      },
    },
    include: {
      user: {
        select: { displayName: true },
      },
    },
  });

  if (existingReaction) {
    return mapReactionToApi(existingReaction);
  }

  const reaction = await db.directMessageReaction.create({
    data: {
      messageId,
      userId: normalizedUserId,
      emoji: normalizedEmoji,
    },
    include: {
      user: {
        select: { displayName: true },
      },
    },
  });

  return mapReactionToApi(reaction);
};

export const removeDirectMessageReaction = async (
  messageId: string,
  userId: string,
  emoji: string,
): Promise<void> => {
  const normalizedUserId = normalizeUserId(userId);

  const message = await db.directMessage.findUnique({ where: { id: messageId } });
  if (!message) {
    throw new Error("Mensagem não encontrada.");
  }

  await ensureDirectConversationParticipant(message.conversationId, normalizedUserId);

  const normalizedEmoji = normalizeEmojiForReaction(emoji);

  await db.directMessageReaction.deleteMany({
    where: {
      messageId,
      userId: normalizedUserId,
      emoji: normalizedEmoji,
    },
  });
};
