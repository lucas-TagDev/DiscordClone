export type Role = "admin" | "moderator" | "member";

export type ModeratorPermissions = {
  canRemoveMembers: boolean;
  canBanUsers: boolean;
  canTimeoutVoice: boolean;
  canDeleteUserMessages: boolean;
  canKickFromVoice: boolean;
  canMoveVoiceUsers: boolean;
  canManageInvites: boolean;
};

export type ChannelType = "text" | "voice";

export type UserProfile = {
  id: string;
  name: string;
};

export type ServerMember = {
  userId: string;
  role: Role;
  createdAt?: string;
  userName?: string;
  avatarUrl?: string | null;
  permissions?: ModeratorPermissions;
  notifySoundEnabled?: boolean;
};

export type RestrictionType = "server_ban" | "voice_timeout";

export type DisplayNameStyle = {
  color?: string; // hex color (e.g., "#FF0000")
  fontFamily?: string; // "sans", "serif", "mono", "cursive"
  bold?: boolean;
  animation?: string; // "none", "pulse", "glow", "rainbow"
  gradientEnabled?: boolean; // ativa gradiente arco-íris
  backgroundColor?: string; // cor de fundo (e.g., "#1a1a2e")
  backgroundOpacity?: number; // 0-100
  showBackground?: boolean; // mostra fundo
  profileCardGifUrl?: string; // GIF exibido atrás do card no hover (DM)
};

export type AppUser = {
  id: string;
  displayName: string;
  displayNameStyle?: DisplayNameStyle;
  avatarUrl: string | null;
  joinWithMicEnabled: boolean;
  joinWithCameraEnabled: boolean;
  noiseSuppressionEnabled: boolean;
  chatNotificationSoundEnabled: boolean;
  micGain: number;
  keybinds: Record<string, string>;
};

export type Channel = {
  id: string;
  name: string;
  type: ChannelType;
  categoryId?: string | null;
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
  lastMessageAt?: string | null;
  lastMessageUserId?: string | null;
};

export type ChannelCategory = {
  id: string;
  name: string;
};

export type Server = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  serverBannerUrl?: string | null;
  ownerId: string;
  virusTotalEnabled: boolean;
  virusTotalConfigured: boolean;
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
  lastMessageAt?: string | null;
  lastMessageUserId?: string | null;
  categories: ChannelCategory[];
  members: ServerMember[];
  channels: Channel[];
  stickers: ServerSticker[];
  emojis: ServerEmoji[];
};

export type ServerSticker = {
  id: string;
  serverId: string;
  createdById: string;
  createdByName: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type ServerEmoji = {
  id: string;
  serverId: string;
  createdById: string;
  createdByName: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type MessageReaction = {
  id: string;
  emoji: string;
  userId: string;
  userName: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  serverId: string;
  channelId: string;
  userId: string;
  userName: string;
  userDisplayNameStyle?: DisplayNameStyle;
  content: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  reactions?: MessageReaction[];
};

export type ChatAttachment = {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
};

export type DirectConversation = {
  id: string;
  otherUserId: string;
  otherUserName: string;
  otherUserDisplayNameStyle?: DisplayNameStyle;
  otherUserAvatarUrl: string | null;
  lastMessagePreview: string;
  lastMessageAt: string;
  lastReadAt?: string | null;
};

export type DirectFriend = {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  createdAt: string;
};

export type DirectChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl: string | null;
  senderDisplayNameStyle?: DisplayNameStyle;
  content: string;
  createdAt: string;
  reactions?: MessageReaction[];
};

export type ServerInvite = {
  id: string;
  code: string;
  createdAt: string;
};

export type ServerSound = {
  id: string;
  serverId: string;
  sourceServerName: string;
  createdById: string;
  createdByName: string;
  isFavorite: boolean;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  durationSeconds: number;
  gifUrl?: string | null;
  createdAt: string;
};

export type ServerBan = {
  id: string;
  serverId: string;
  userId: string;
  userName: string;
  avatarUrl: string | null;
  reason: string | null;
  createdAt: string;
  actorId: string;
};

export type AuditLogAction =
  | "member_kicked"
  | "member_banned"
  | "member_unbanned"
  | "member_role_updated"
  | "member_permissions_updated"
  | "member_voice_kicked"
  | "member_voice_moved"
  | "member_voice_timeout"
  | "channel_created"
  | "channel_updated"
  | "channel_deleted"
  | "category_created"
  | "category_updated"
  | "category_deleted"
  | "message_deleted"
  | "invite_created"
  | "invite_deleted"
  | "server_updated";

export type ServerAuditLog = {
  id: string;
  serverId: string;
  actorId: string;
  actorName: string;
  action: AuditLogAction;
  targetId: string | null;
  targetName: string | null;
  details: string | null;
  createdAt: string;
};
