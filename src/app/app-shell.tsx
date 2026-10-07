"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { ClipboardEvent, FormEvent, MouseEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import Picker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import { VoiceRoom } from "@/components/voice-room";
import { StyledDisplayName } from "@/components/styled-display-name";
import { MicLevelMeter } from "@/components/mic-level-meter";
import { LinkPreview } from "@/components/link-preview";
import { SpoilerText } from "@/components/spoiler-text";
import { MessageReactions } from "@/components/message-reactions";
import { Channel, ChannelCategory, ChannelType, ChatMessage, DirectChatMessage, DirectConversation, DirectFriend, DisplayNameStyle, MessageReaction, ModeratorPermissions, Role, Server, ServerAuditLog, ServerBan, ServerEmoji, ServerInvite, ServerSticker } from "@/lib/types";

type ServerDetailsResponse = {
  server: Server;
  currentRole: Role | null;
};

type AuthResponse = {
  user: {
    id: string;
    displayName: string;
    displayNameStyle?: DisplayNameStyle;
    avatarUrl: string | null;
    joinWithMicEnabled: boolean;
    joinWithCameraEnabled: boolean;
    noiseSuppressionEnabled: boolean;
    chatNotificationSoundEnabled: boolean;
    micGain: number;
  };
};

type MessagePageResponse = {
  messages: ChatMessage[];
  hasMore: boolean;
  error?: string;
};

type DirectMessagePageResponse = {
  messages: DirectChatMessage[];
  hasMore: boolean;
  error?: string;
};

type DirectFriendsResponse = {
  friends: DirectFriend[];
  error?: string;
};

type DirectFriendRequestMarker = {
  requestId: string;
  requesterId: string;
  receiverId: string;
  status: "pending" | "accepted" | "rejected";
};

type VoicePresenceMember = {
  identity: string;
  userId: string;
  userName: string;
  micEnabled?: boolean;
  cameraEnabled?: boolean;
};

export function AppShell() {
  const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "TwinSLKIt";
  const appInitials =
    appName
      .split(/\s+/)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "TS";

  const [userId, setUserId] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [userName, setUserName] = useState("Visitante");
  const [displayNameColor, setDisplayNameColor] = useState("#ffffff");
  const [displayNameFontFamily, setDisplayNameFontFamily] = useState("sans");
  const [displayNameBold, setDisplayNameBold] = useState(false);
  const [displayNameAnimation, setDisplayNameAnimation] = useState("none");
  const [displayNameGradientEnabled, setDisplayNameGradientEnabled] = useState(false);
  const [displayNameBackgroundColor, setDisplayNameBackgroundColor] = useState("#1a1a2e");
  const [displayNameBackgroundOpacity, setDisplayNameBackgroundOpacity] = useState(60);
  const [displayNameShowBackground, setDisplayNameShowBackground] = useState(false);
  const [displayNameProfileCardGifUrl, setDisplayNameProfileCardGifUrl] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newOwnPassword, setNewOwnPassword] = useState("");
  const [confirmOwnPassword, setConfirmOwnPassword] = useState("");
  const [joinWithMicEnabled, setJoinWithMicEnabled] = useState(true);
  const [joinWithCameraEnabled, setJoinWithCameraEnabled] = useState(false);
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(true);
  const [noiseSuppressionMode, setNoiseSuppressionMode] = useState<"rnnoise" | "deepfilter">("rnnoise");
  const [micGain, setMicGain] = useState(100);
  const [micLevelMeterActive, setMicLevelMeterActive] = useState(false);
  const [chatNotificationSoundEnabled, setChatNotificationSoundEnabled] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileWidgetId, setTurnstileWidgetId] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileRenderedRef = useRef(false);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const isTurnstileEnabled = turnstileSiteKey && process.env.NEXT_PUBLIC_ENABLE_TURNSTILE === "true";
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarInputKey, setAvatarInputKey] = useState(0);
  const [profileCardGifFile, setProfileCardGifFile] = useState<File | null>(null);
  const [profileCardGifInputKey, setProfileCardGifInputKey] = useState(0);
  const [voiceSessionId, setVoiceSessionId] = useState("");
  const [servers, setServers] = useState<Server[]>([]);
  const [visibleServerCount, setVisibleServerCount] = useState(30);
  const [appMode, setAppMode] = useState<"server" | "direct">("server");
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [serverDetails, setServerDetails] = useState<ServerDetailsResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [newServerMessageCount, setNewServerMessageCount] = useState(0);
  const [newDirectMessageCount, setNewDirectMessageCount] = useState(0);
  const [directConversations, setDirectConversations] = useState<DirectConversation[]>([]);
  const [visibleDirectConversationCount, setVisibleDirectConversationCount] = useState(30);
  const [directFriends, setDirectFriends] = useState<DirectFriend[]>([]);
  const [showDirectFriendsModal, setShowDirectFriendsModal] = useState(false);
  const [directFriendSearchTerm, setDirectFriendSearchTerm] = useState("");
  const [sidebarMemberSearchTerm, setSidebarMemberSearchTerm] = useState("");
  const [isMembersPanelOpen, setIsMembersPanelOpen] = useState(true);
  const [settingsMemberSearchTerm, setSettingsMemberSearchTerm] = useState("");
  const [visibleDirectFriendsCount, setVisibleDirectFriendsCount] = useState(30);
  const [newDirectFriendUserId, setNewDirectFriendUserId] = useState("");
  const [blockedDirectUserIds, setBlockedDirectUserIds] = useState<string[]>([]);
  const [selectedDirectConversationId, setSelectedDirectConversationId] = useState<string | null>(null);
  const [directMessages, setDirectMessages] = useState<DirectChatMessage[]>([]);
  const [hasMoreDirectMessages, setHasMoreDirectMessages] = useState(false);
  const [isLoadingOlderDirectMessages, setIsLoadingOlderDirectMessages] = useState(false);
  const [newDirectMessage, setNewDirectMessage] = useState("");
  const [activeDirectCustomPreview, setActiveDirectCustomPreview] = useState<"sticker" | "emoji" | null>(null);
  const [directStickerPreviewPage, setDirectStickerPreviewPage] = useState(0);
  const [directEmojiPreviewPage, setDirectEmojiPreviewPage] = useState(0);
  const [showDirectEmojiMartPicker, setShowDirectEmojiMartPicker] = useState(false);
  const [editingDirectMessageId, setEditingDirectMessageId] = useState<string | null>(null);
  const [editingDirectMessageContent, setEditingDirectMessageContent] = useState("");
  const [selectedDirectFiles, setSelectedDirectFiles] = useState<File[]>([]);
  const [selectedDirectFilePreviewByKey, setSelectedDirectFilePreviewByKey] = useState<Record<string, string>>({});
  const [directFileInputKey, setDirectFileInputKey] = useState(0);
  const [directUnreadByConversationId, setDirectUnreadByConversationId] = useState<Record<string, number>>({});
  const [knownDirectLastMessageAtByConversationId, setKnownDirectLastMessageAtByConversationId] = useState<Record<string, string>>({});
  const [isDirectProfileCardHovered, setIsDirectProfileCardHovered] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [newServerAvatarFile, setNewServerAvatarFile] = useState<File | null>(null);
  const [newServerAvatarInputKey, setNewServerAvatarInputKey] = useState(0);
  const [showCreateServerModal, setShowCreateServerModal] = useState(false);
  const [serverContextMenu, setServerContextMenu] = useState<{ serverId: string; x: number; y: number } | null>(null);
  const [directConversationContextMenu, setDirectConversationContextMenu] = useState<{
    conversationId: string;
    x: number;
    y: number;
  } | null>(null);
  const [settingsPanelMode, setSettingsPanelMode] = useState<"all" | "server">("all");
  const [serverSettingsName, setServerSettingsName] = useState("");
  const [serverSettingsAvatarFile, setServerSettingsAvatarFile] = useState<File | null>(null);
  const [serverSettingsAvatarInputKey, setServerSettingsAvatarInputKey] = useState(0);
  const [serverSettingsBannerFile, setServerSettingsBannerFile] = useState<File | null>(null);
  const [serverSettingsBannerInputKey, setServerSettingsBannerInputKey] = useState(0);
  // Estados atuais de permissão
  const [serverSettingsAllowMemberInvites, setServerSettingsAllowMemberInvites] = useState(false);
  const [serverSettingsAllowModeratorInvites, setServerSettingsAllowModeratorInvites] = useState(false);
  const [serverSettingsAllowMemberSoundUpload, setServerSettingsAllowMemberSoundUpload] = useState(true);
  const [serverSettingsAllowModeratorSoundUpload, setServerSettingsAllowModeratorSoundUpload] = useState(true);
  const [serverSettingsAllowCrossServerSoundShare, setServerSettingsAllowCrossServerSoundShare] = useState(false);
  const [serverSettingsAllowMemberDeleteSounds, setServerSettingsAllowMemberDeleteSounds] = useState(false);
  const [serverSettingsAllowModeratorDeleteSounds, setServerSettingsAllowModeratorDeleteSounds] = useState(true);
  const [serverSettingsAllowMemberStickerCreate, setServerSettingsAllowMemberStickerCreate] = useState(false);
  const [serverSettingsAllowModeratorStickerCreate, setServerSettingsAllowModeratorStickerCreate] = useState(true);
  const [serverSettingsAllowMemberEmojiCreate, setServerSettingsAllowMemberEmojiCreate] = useState(false);
  const [serverSettingsAllowModeratorEmojiCreate, setServerSettingsAllowModeratorEmojiCreate] = useState(true);
  
  // Estados originais de permissão (para detectar mudanças)
  const [originalServerSettings, setOriginalServerSettings] = useState({
    allowMemberInvites: false,
    allowModeratorInvites: false,
    allowMemberSoundUpload: true,
    allowModeratorSoundUpload: true,
    allowCrossServerSoundShare: false,
    allowMemberDeleteSounds: false,
    allowModeratorDeleteSounds: true,
    allowMemberStickerCreate: false,
    allowModeratorStickerCreate: true,
    allowMemberEmojiCreate: false,
    allowModeratorEmojiCreate: true,
  });
  
  const [serverSettingsNotifySoundEnabled, setServerSettingsNotifySoundEnabled] = useState(true);
  const [serverSettingsVirusTotalEnabled, setServerSettingsVirusTotalEnabled] = useState(false);
  const [serverSettingsVirusTotalApiKey, setServerSettingsVirusTotalApiKey] = useState("");
  const [newStickerName, setNewStickerName] = useState("");
  const [newStickerFile, setNewStickerFile] = useState<File | null>(null);
  const [newStickerInputKey, setNewStickerInputKey] = useState(0);
  const [newEmojiName, setNewEmojiName] = useState("");
  const [newEmojiFile, setNewEmojiFile] = useState<File | null>(null);
  const [newEmojiInputKey, setNewEmojiInputKey] = useState(0);
  const [serverInvites, setServerInvites] = useState<ServerInvite[]>([]);
  const [serverBans, setServerBans] = useState<ServerBan[]>([]);
  const [serverAuditLogs, setServerAuditLogs] = useState<ServerAuditLog[]>([]);
  const [auditLogsError, setAuditLogsError] = useState<string | null>(null);
  const [auditLogSearchQuery, setAuditLogSearchQuery] = useState("");
  const [auditLogFilterDate, setAuditLogFilterDate] = useState("");
  const [auditLogFilterTimeStart, setAuditLogFilterTimeStart] = useState("");
  const [auditLogFilterTimeEnd, setAuditLogFilterTimeEnd] = useState("");
  const [auditLogCurrentPage, setAuditLogCurrentPage] = useState(1);
  const [serverUnreadById, setServerUnreadById] = useState<Record<string, number>>({});
  const [channelUnreadById, setChannelUnreadById] = useState<Record<string, number>>({});
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(null);
  const [isJoiningInvite, setIsJoiningInvite] = useState(false);

  useEffect(() => {
    if (isTurnstileEnabled && turnstileContainerRef.current && !turnstileRenderedRef.current) {
      const loadTurnstile = () => {
        if (typeof window !== "undefined" && (window as any).turnstile) {
          try {
            const widgetId = (window as any).turnstile.render(turnstileContainerRef.current, {
              sitekey: turnstileSiteKey,
              callback: (token: string) => {
                console.log("Turnstile token received");
                setTurnstileToken(token);
              },
              "error-callback": () => {
                console.error("Turnstile error");
                setTurnstileToken(null);
              },
              "expired-callback": () => {
                console.warn("Turnstile token expired");
                setTurnstileToken(null);
              },
            });
            setTurnstileWidgetId(widgetId);
            turnstileRenderedRef.current = true;
          } catch (error) {
            console.error("Error rendering Turnstile widget:", error);
          }
        } else {
          setTimeout(loadTurnstile, 500);
        }
      };
      loadTurnstile();
    }
  }, [isTurnstileEnabled, turnstileSiteKey]);

  const [channelAreaContextMenu, setChannelAreaContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showCreateItemModal, setShowCreateItemModal] = useState(false);
  const [createItemKind, setCreateItemKind] = useState<"text" | "voice" | "category">("text");
  const [createItemName, setCreateItemName] = useState("");
  const [createItemCategoryId, setCreateItemCategoryId] = useState<string>("");
  const [channelContextMenu, setChannelContextMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);
  const [showChannelActionModal, setShowChannelActionModal] = useState(false);
  const [showMemberRoleModal, setShowMemberRoleModal] = useState(false);
  const [channelActionMode, setChannelActionMode] = useState<"rename" | "move" | "permissions">("rename");
  const [channelActionChannelId, setChannelActionChannelId] = useState<string | null>(null);
  const [channelActionName, setChannelActionName] = useState("");
  const [channelActionCategoryId, setChannelActionCategoryId] = useState<string>("");
  const [channelActionPermissions, setChannelActionPermissions] = useState<{
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
  }>({
    allowMemberView: true,
    allowModeratorView: true,
    allowMemberAccess: true,
    allowModeratorAccess: true,
    allowMemberSendMessages: true,
    allowModeratorSendMessages: true,
    allowMemberSendFiles: true,
    allowModeratorSendFiles: true,
    allowMemberSendLinks: true,
    allowModeratorSendLinks: true,
    allowMemberDeleteMessages: true,
    allowModeratorDeleteMessages: true,
  });
  const [categoryContextMenu, setCategoryContextMenu] = useState<{ categoryId: string; x: number; y: number } | null>(null);
  const [memberContextMenu, setMemberContextMenu] = useState<{
    targetUserId: string;
    targetUserName: string;
    targetRole: Role;
    targetPermissions?: ModeratorPermissions;
    x: number;
    y: number;
  } | null>(null);
  const [channelMessageUserCard, setChannelMessageUserCard] = useState<{
    targetUserId: string;
    targetUserName: string;
    targetAvatarUrl: string | null;
    targetDisplayNameStyle?: DisplayNameStyle;
    x: number;
    y: number;
  } | null>(null);
  const [bannedUserContextMenu, setBannedUserContextMenu] = useState<{
    banId: string;
    userName: string;
    x: number;
    y: number;
  } | null>(null);
  const [showCategoryRenameModal, setShowCategoryRenameModal] = useState(false);
  const [categoryRenameId, setCategoryRenameId] = useState<string | null>(null);
  const [categoryRenameName, setCategoryRenameName] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState<ChannelType>("text");
  const [newMemberId, setNewMemberId] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<Role>("member");
  const [editMemberUserId, setEditMemberUserId] = useState("");
  const [editMemberUserName, setEditMemberUserName] = useState("");
  const [editMemberRole, setEditMemberRole] = useState<Role>("member");
  const [editModeratorPermissions, setEditModeratorPermissions] = useState<ModeratorPermissions>({
    canRemoveMembers: false,
    canBanUsers: false,
    canTimeoutVoice: false,
    canDeleteUserMessages: false,
    canKickFromVoice: false,
    canMoveVoiceUsers: false,
    canManageInvites: false,
  });
  const [newModeratorPermissions, setNewModeratorPermissions] = useState<ModeratorPermissions>({
    canRemoveMembers: false,
    canBanUsers: false,
    canTimeoutVoice: false,
    canDeleteUserMessages: false,
    canKickFromVoice: false,
    canMoveVoiceUsers: false,
    canManageInvites: false,
  });
  const [moderationTargetId, setModerationTargetId] = useState("");
  const [moderationAction, setModerationAction] = useState<"remove-user" | "ban-user" | "voice-timeout" | "voice-kick" | "voice-move">("ban-user");
  const [moderationTargetChannelId, setModerationTargetChannelId] = useState("");
  const [moderationDurationMinutes, setModerationDurationMinutes] = useState(10);
  const [moderationReason, setModerationReason] = useState("");
  const [moderationRemoveMessages, setModerationRemoveMessages] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [activeCustomPreview, setActiveCustomPreview] = useState<"sticker" | "emoji" | null>(null);
  const [serverStickerPreviewPage, setServerStickerPreviewPage] = useState(0);
  const [serverEmojiPreviewPage, setServerEmojiPreviewPage] = useState(0);
  const [showEmojiMartPicker, setShowEmojiMartPicker] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedFilePreviewByKey, setSelectedFilePreviewByKey] = useState<Record<string, string>>({});
  const [fileInputKey, setFileInputKey] = useState(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState("");
  const [voiceToken, setVoiceToken] = useState<string | null>(null);
  const [voiceServerUrl, setVoiceServerUrl] = useState<string | null>(null);
  const [activeVoiceServerId, setActiveVoiceServerId] = useState<string | null>(null);
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<string | null>(null);
  const [activeVoiceChannelName, setActiveVoiceChannelName] = useState<string | null>(null);
  const [voicePresenceByChannel, setVoicePresenceByChannel] = useState<Record<string, VoicePresenceMember[]>>({});
  const [voiceListeningByUserId, setVoiceListeningByUserId] = useState<Record<string, boolean>>({});
  const [visibleServerChannelCount, setVisibleServerChannelCount] = useState(60);
  const [visibleSidebarMemberCount, setVisibleSidebarMemberCount] = useState(50);
  const [visibleSettingsMemberCount, setVisibleSettingsMemberCount] = useState(50);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorOpacity, setErrorOpacity] = useState(0);
  const [busy, setBusy] = useState(false);
  const [serverUploadProgress, setServerUploadProgress] = useState<number | null>(null);
  const [directUploadProgress, setDirectUploadProgress] = useState<number | null>(null);
  const [isSecureContextValue, setIsSecureContextValue] = useState(true);
  const [dangerousDownloadPrompt, setDangerousDownloadPrompt] = useState<{ url: string; name: string } | null>(null);
  const [virusTotalDownloadPrompt, setVirusTotalDownloadPrompt] = useState<{
    url: string;
    name: string;
    status: "loading" | "result" | "error";
    verdict?: "clean" | "unsafe" | "unknown";
    message?: string;
    stats?: {
      malicious: number;
      suspicious: number;
      harmless: number;
      undetected: number;
      timeout: number;
      failure: number;
    };
  } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const directMessagesContainerRef = useRef<HTMLDivElement | null>(null);
  const channelMessageUserCardRef = useRef<HTMLDivElement | null>(null);
  const selectedServerIdRef = useRef<string | null>(null);
  const selectedChannelIdRef = useRef<string | null>(null);
  const selectedDirectConversationIdRef = useRef<string | null>(null);
  const appModeRef = useRef<"server" | "direct">("server");
  const userIdRef = useRef<string>("");
  const voiceTokenRef = useRef<string | null>(null);
  const directUnreadByConversationIdRef = useRef<Record<string, number>>({});
  const knownDirectLastMessageAtByConversationIdRef = useRef<Record<string, string>>({});
  const knownLatestChannelMessageAtRef = useRef<Record<string, string>>({});
  const knownLatestDirectMessageAtRef = useRef<Record<string, string>>({});
  const knownServerChannelLastMessageAtRef = useRef<Record<string, string>>({});
  const knownServerLastMessageAtByIdRef = useRef<Record<string, string>>({});
  const serverUnreadByIdRef = useRef<Record<string, number>>({});
  const channelUnreadByIdRef = useRef<Record<string, number>>({});
  const chatNotificationAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceMoveAudioRef = useRef<HTMLAudioElement | null>(null);
  const voicePresenceByChannelRef = useRef<Record<string, Set<string>>>({});
  const chatNotificationSoundEnabledRef = useRef(true);
  const chatNotificationUnlockedRef = useRef(false);
  const shouldAutoScrollMessagesRef = useRef(true);
  const shouldAutoScrollDirectMessagesRef = useRef(true);
  const serverDetailsRequestIdRef = useRef(0);
  const messagesRequestIdRef = useRef(0);
  const directMessagesRequestIdRef = useRef(0);
  const voiceConnectRequestIdRef = useRef(0);
  const isLoadingOlderMessagesRef = useRef(false);
  const isLoadingOlderDirectMessagesRef = useRef(false);

  const handleVoiceLeave = useCallback(() => {
    setVoiceToken(null);
    setVoiceServerUrl(null);
    setActiveVoiceServerId(null);
    setActiveVoiceChannelId(null);
    setActiveVoiceChannelName(null);
    setVoiceListeningByUserId({});
  }, []);

  const isVoiceConnected = !!voiceToken && !!voiceServerUrl;

  const selectedChannel = useMemo<Channel | null>(() => {
    if (!serverDetails || !selectedChannelId) {
      return null;
    }
    return serverDetails.server.channels.find((channel) => channel.id === selectedChannelId) ?? null;
  }, [serverDetails, selectedChannelId]);

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) ?? null,
    [selectedServerId, servers],
  );

  const selectedDirectConversation = useMemo(
    () => directConversations.find((conversation) => conversation.id === selectedDirectConversationId) ?? null,
    [directConversations, selectedDirectConversationId],
  );

  const directUnreadTotal = useMemo(
    () => Object.values(directUnreadByConversationId).reduce((total, count) => total + count, 0),
    [directUnreadByConversationId],
  );

  const visibleServers = useMemo(
    () => servers.slice(0, visibleServerCount),
    [servers, visibleServerCount],
  );

  const hasMoreVisibleServers = visibleServers.length < servers.length;

  const loadMoreVisibleServers = useCallback(() => {
    setVisibleServerCount((current) => Math.min(current + 30, servers.length));
  }, [servers.length]);

  const visibleDirectConversations = useMemo(
    () => directConversations.slice(0, visibleDirectConversationCount),
    [directConversations, visibleDirectConversationCount],
  );

  const hasMoreVisibleDirectConversations = visibleDirectConversations.length < directConversations.length;

  const loadMoreVisibleDirectConversations = useCallback(() => {
    setVisibleDirectConversationCount((current) => Math.min(current + 30, directConversations.length));
  }, [directConversations.length]);

  const channelUploadMaxFileSizeMb = useMemo(() => {
    const parsed = Number(process.env.NEXT_PUBLIC_CHANNEL_UPLOAD_MAX_FILE_SIZE_MB);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 50;
    }
    return parsed;
  }, []);

  const channelUploadMaxFileSizeBytes = useMemo(
    () => Math.floor(channelUploadMaxFileSizeMb * 1024 * 1024),
    [channelUploadMaxFileSizeMb],
  );

  const hasSelectedServerDetails =
    !!selectedServerId &&
    !!serverDetails &&
    serverDetails.server.id === selectedServerId;

  const isSelectedServerOwner = !!selectedServer && selectedServer.ownerId === userId;

  const contextMenuServer = useMemo(
    () => (serverContextMenu ? servers.find((server) => server.id === serverContextMenu.serverId) ?? null : null),
    [serverContextMenu, servers],
  );

  const directFriendUserIdSet = useMemo(
    () => new Set(directFriends.map((friend) => friend.userId.trim().toLowerCase())),
    [directFriends],
  );

  const filteredDirectFriends = useMemo(() => {
    const normalizedTerm = directFriendSearchTerm.trim().toLowerCase();
    if (!normalizedTerm) {
      return directFriends;
    }

    return directFriends.filter((friend) =>
      friend.userName.trim().toLowerCase().includes(normalizedTerm) ||
      friend.userId.trim().toLowerCase().includes(normalizedTerm),
    );
  }, [directFriendSearchTerm, directFriends]);

  const visibleDirectFriends = useMemo(
    () => filteredDirectFriends.slice(0, visibleDirectFriendsCount),
    [filteredDirectFriends, visibleDirectFriendsCount],
  );

  const hasMoreVisibleDirectFriends = visibleDirectFriends.length < filteredDirectFriends.length;

  const contextMenuDirectConversation = useMemo(
    () => (directConversationContextMenu
      ? directConversations.find((conversation) => conversation.id === directConversationContextMenu.conversationId) ?? null
      : null),
    [directConversationContextMenu, directConversations],
  );

  const loadMoreVisibleDirectFriends = useCallback(() => {
    setVisibleDirectFriendsCount((current) => Math.min(current + 30, filteredDirectFriends.length));
  }, [filteredDirectFriends.length]);

  const categories = useMemo<ChannelCategory[]>(() => serverDetails?.server.categories ?? [], [serverDetails]);

  const categorizedChannelGroups = useMemo(() => {
    const channels = serverDetails?.server.channels ?? [];
    const grouped = categories
      .map((category) => ({
        category,
        text: channels.filter((channel) => channel.type === "text" && channel.categoryId === category.id),
        voice: channels.filter((channel) => channel.type === "voice" && channel.categoryId === category.id),
      }))
      .filter((group) => group.text.length > 0 || group.voice.length > 0);

    const uncategorizedText = channels.filter((channel) => channel.type === "text" && !channel.categoryId);
    const uncategorizedVoice = channels.filter((channel) => channel.type === "voice" && !channel.categoryId);

    return {
      grouped,
      uncategorizedText,
      uncategorizedVoice,
    };
  }, [categories, serverDetails]);

  const totalServerChannelCount = useMemo(
    () =>
      categorizedChannelGroups.grouped.reduce((total, group) => total + group.text.length + group.voice.length, 0) +
      categorizedChannelGroups.uncategorizedText.length +
      categorizedChannelGroups.uncategorizedVoice.length,
    [categorizedChannelGroups],
  );

  const visibleCategorizedChannelGroups = useMemo(() => {
    let remaining = visibleServerChannelCount;

    const grouped = categorizedChannelGroups.grouped
      .map((group) => {
        if (remaining <= 0) {
          return { ...group, text: [], voice: [] };
        }

        const visibleText = group.text.slice(0, remaining);
        remaining -= visibleText.length;

        const visibleVoice = group.voice.slice(0, remaining);
        remaining -= visibleVoice.length;

        return {
          ...group,
          text: visibleText,
          voice: visibleVoice,
        };
      })
      .filter((group) => group.text.length > 0 || group.voice.length > 0);

    const uncategorizedText = categorizedChannelGroups.uncategorizedText.slice(0, remaining);
    remaining -= uncategorizedText.length;
    const uncategorizedVoice = categorizedChannelGroups.uncategorizedVoice.slice(0, remaining);

    return {
      grouped,
      uncategorizedText,
      uncategorizedVoice,
    };
  }, [categorizedChannelGroups, visibleServerChannelCount]);

  const hasMoreVisibleServerChannels = visibleServerChannelCount < totalServerChannelCount;

  const loadMoreVisibleServerChannels = useCallback(() => {
    setVisibleServerChannelCount((current) => Math.min(current + 40, totalServerChannelCount));
  }, [totalServerChannelCount]);

  const serverMembers = useMemo(
    () => serverDetails?.server.members ?? [],
    [serverDetails],
  );

  const filteredSidebarMembers = useMemo(() => {
    const normalizedTerm = sidebarMemberSearchTerm.trim().toLowerCase();
    if (!normalizedTerm) {
      return serverMembers;
    }

    return serverMembers.filter((member) =>
      (member.userName || "Usuário").trim().toLowerCase().includes(normalizedTerm) ||
      member.userId.trim().toLowerCase().includes(normalizedTerm),
    );
  }, [sidebarMemberSearchTerm, serverMembers]);

  const filteredSettingsMembers = useMemo(() => {
    const normalizedTerm = settingsMemberSearchTerm.trim().toLowerCase();
    if (!normalizedTerm) {
      return serverMembers;
    }

    return serverMembers.filter((member) =>
      (member.userName || "Usuário").trim().toLowerCase().includes(normalizedTerm) ||
      member.userId.trim().toLowerCase().includes(normalizedTerm),
    );
  }, [settingsMemberSearchTerm, serverMembers]);

  const visibleSidebarMembers = useMemo(
    () => filteredSidebarMembers.slice(0, visibleSidebarMemberCount),
    [filteredSidebarMembers, visibleSidebarMemberCount],
  );

  const visibleSettingsMembers = useMemo(
    () => filteredSettingsMembers.slice(0, visibleSettingsMemberCount),
    [filteredSettingsMembers, visibleSettingsMemberCount],
  );

  const hasMoreVisibleSidebarMembers = visibleSidebarMembers.length < filteredSidebarMembers.length;
  const hasMoreVisibleSettingsMembers = visibleSettingsMembers.length < filteredSettingsMembers.length;

  const loadMoreVisibleSidebarMembers = useCallback(() => {
    setVisibleSidebarMemberCount((current) => Math.min(current + 40, filteredSidebarMembers.length));
  }, [filteredSidebarMembers.length]);

  const loadMoreVisibleSettingsMembers = useCallback(() => {
    setVisibleSettingsMemberCount((current) => Math.min(current + 40, filteredSettingsMembers.length));
  }, [filteredSettingsMembers.length]);

  const formatMemberSince = useCallback((createdAt?: string) => {
    if (!createdAt) {
      return "Data indisponível";
    }

    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
      return "Data indisponível";
    }

    const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }, []);

  const userDisplayNameStyle: DisplayNameStyle = useMemo(() => ({
    color: displayNameColor,
    fontFamily: displayNameFontFamily,
    bold: displayNameBold,
    animation: displayNameAnimation,
    gradientEnabled: displayNameGradientEnabled,
    backgroundColor: displayNameBackgroundColor,
    backgroundOpacity: displayNameBackgroundOpacity,
    showBackground: displayNameShowBackground,
    profileCardGifUrl: displayNameProfileCardGifUrl ?? undefined,
  }), [
    displayNameColor,
    displayNameFontFamily,
    displayNameBold,
    displayNameAnimation,
    displayNameGradientEnabled,
    displayNameBackgroundColor,
    displayNameBackgroundOpacity,
    displayNameShowBackground,
    displayNameProfileCardGifUrl,
  ]);

  const getDisplayNameClasses = useCallback(() => {
    const classes: string[] = [];
    
    if (displayNameBold) {
      classes.push("display-name-bold");
    }
    
    if (displayNameFontFamily === "serif") {
      classes.push("display-name-serif");
    } else if (displayNameFontFamily === "mono") {
      classes.push("display-name-mono");
    } else if (displayNameFontFamily === "cursive") {
      classes.push("display-name-cursive");
    } else {
      classes.push("display-name-sans");
    }
    
    if (displayNameAnimation !== "none") {
      classes.push(`display-name-${displayNameAnimation}`);
    }
    
    return classes.join(" ");
  }, [displayNameBold, displayNameFontFamily, displayNameAnimation]);

  const getDisplayNameStyles = useCallback(() => {
    return {
      color: displayNameColor,
    };
  }, [displayNameColor]);

  const currentMember = useMemo(
    () =>
      serverDetails?.server.members.find(
        (member) => member.userId.trim().toLowerCase() === userId.trim().toLowerCase(),
      ) ?? null,
    [serverDetails, userId],
  );

  const memberInfoByUserId = useMemo(() => {
    const members = serverDetails?.server.members ?? [];
    return members.reduce<Record<string, { name: string; avatarUrl: string | null }>>((acc, member) => {
      acc[member.userId.trim().toLowerCase()] = {
        name: member.userName || "Usuário",
        avatarUrl: member.avatarUrl ?? null,
      };
      return acc;
    }, {});
  }, [serverDetails]);

  const stickerByName = useMemo(() => {
    const stickers = serverDetails?.server.stickers ?? [];
    return stickers.reduce<Record<string, ServerSticker>>((acc, sticker) => {
      acc[sticker.name.trim().toLowerCase()] = sticker;
      return acc;
    }, {});
  }, [serverDetails?.server.stickers]);

  const emojiByName = useMemo(() => {
    const emojis = serverDetails?.server.emojis ?? [];
    return emojis.reduce<Record<string, ServerEmoji>>((acc, emoji) => {
      acc[emoji.name.trim().toLowerCase()] = emoji;
      return acc;
    }, {});
  }, [serverDetails?.server.emojis]);

  const directStickers = useMemo(
    () => servers.flatMap((server) => server.stickers.map((sticker) => ({ ...sticker, serverName: server.name }))),
    [servers],
  );

  const directEmojis = useMemo(
    () => servers.flatMap((server) => server.emojis.map((emoji) => ({ ...emoji, serverName: server.name }))),
    [servers],
  );

  const directStickerByName = useMemo(() => {
    return directStickers.reduce<Record<string, ServerSticker>>((acc, sticker) => {
      const key = sticker.name.trim().toLowerCase();
      if (!acc[key]) {
        acc[key] = sticker;
      }
      return acc;
    }, {});
  }, [directStickers]);

  const directEmojiByName = useMemo(() => {
    return directEmojis.reduce<Record<string, ServerEmoji>>((acc, emoji) => {
      const key = emoji.name.trim().toLowerCase();
      if (!acc[key]) {
        acc[key] = emoji;
      }
      return acc;
    }, {});
  }, [directEmojis]);

  const previewItemsPerPage = 9;

  const serverStickerPageCount = useMemo(
    () => Math.max(1, Math.ceil((serverDetails?.server.stickers?.length ?? 0) / previewItemsPerPage)),
    [serverDetails?.server.stickers?.length],
  );

  const serverEmojiPageCount = useMemo(
    () => Math.max(1, Math.ceil((serverDetails?.server.emojis?.length ?? 0) / previewItemsPerPage)),
    [serverDetails?.server.emojis?.length],
  );

  const directStickerPageCount = useMemo(
    () => Math.max(1, Math.ceil(directStickers.length / previewItemsPerPage)),
    [directStickers.length],
  );

  const directEmojiPageCount = useMemo(
    () => Math.max(1, Math.ceil(directEmojis.length / previewItemsPerPage)),
    [directEmojis.length],
  );

  const pagedServerStickers = useMemo(() => {
    const all = serverDetails?.server.stickers ?? [];
    const start = serverStickerPreviewPage * previewItemsPerPage;
    return all.slice(start, start + previewItemsPerPage);
  }, [serverDetails?.server.stickers, serverStickerPreviewPage]);

  const pagedServerEmojis = useMemo(() => {
    const all = serverDetails?.server.emojis ?? [];
    const start = serverEmojiPreviewPage * previewItemsPerPage;
    return all.slice(start, start + previewItemsPerPage);
  }, [serverDetails?.server.emojis, serverEmojiPreviewPage]);

  const pagedDirectStickers = useMemo(() => {
    const start = directStickerPreviewPage * previewItemsPerPage;
    return directStickers.slice(start, start + previewItemsPerPage);
  }, [directStickers, directStickerPreviewPage]);

  const pagedDirectEmojis = useMemo(() => {
    const start = directEmojiPreviewPage * previewItemsPerPage;
    return directEmojis.slice(start, start + previewItemsPerPage);
  }, [directEmojis, directEmojiPreviewPage]);

  const canKickFromVoice =
    serverDetails?.currentRole === "admin" ||
    (serverDetails?.currentRole === "moderator" && !!currentMember?.permissions?.canKickFromVoice);

  const canMoveVoiceUsers =
    serverDetails?.currentRole === "admin" ||
    (serverDetails?.currentRole === "moderator" && !!currentMember?.permissions?.canMoveVoiceUsers);

  const canManageInvites =
    hasSelectedServerDetails && (
      serverDetails?.currentRole === "admin" ||
      (serverDetails?.currentRole === "moderator" && !!serverDetails?.server.allowModeratorInvites) ||
      (serverDetails?.currentRole === "member" && !!serverDetails?.server.allowMemberInvites)
    );

  const canManageBans = serverDetails?.currentRole === "admin";
  const canManageBansForSelectedServer = hasSelectedServerDetails && canManageBans;

  const canUploadServerSounds =
    serverDetails?.currentRole === "admin" ||
    (serverDetails?.currentRole === "moderator" && !!serverDetails?.server.allowModeratorSoundUpload) ||
    (serverDetails?.currentRole === "member" && !!serverDetails?.server.allowMemberSoundUpload);

  const canDeleteServerSounds =
    serverDetails?.currentRole === "admin" ||
    (serverDetails?.currentRole === "moderator" && !!serverDetails?.server.allowModeratorDeleteSounds) ||
    (serverDetails?.currentRole === "member" && !!serverDetails?.server.allowMemberDeleteSounds);

  const canCreateServerStickers =
    serverDetails?.currentRole === "admin" ||
    (serverDetails?.currentRole === "moderator" && !!serverDetails?.server.allowModeratorStickerCreate) ||
    (serverDetails?.currentRole === "member" && !!serverDetails?.server.allowMemberStickerCreate);

  const canCreateServerEmojis =
    serverDetails?.currentRole === "admin" ||
    (serverDetails?.currentRole === "moderator" && !!serverDetails?.server.allowModeratorEmojiCreate) ||
    (serverDetails?.currentRole === "member" && !!serverDetails?.server.allowMemberEmojiCreate);

  const canManageServerBanner =
    isSelectedServerOwner ||
    serverDetails?.currentRole === "admin" ||
    serverDetails?.currentRole === "moderator";

  const canBanUsers =
    serverDetails?.currentRole === "admin" ||
    (serverDetails?.currentRole === "moderator" && !!currentMember?.permissions?.canBanUsers);

  const canPunishUsers =
    serverDetails?.currentRole === "admin" ||
    (serverDetails?.currentRole === "moderator" && !!currentMember?.permissions?.canTimeoutVoice);

  const canModerateUserMessages =
    serverDetails?.currentRole === "admin" ||
    (serverDetails?.currentRole === "moderator" && !!currentMember?.permissions?.canDeleteUserMessages);

  const canManageChannels = isSelectedServerOwner || serverDetails?.currentRole === "admin";
  const canManageMemberRoles = isSelectedServerOwner || serverDetails?.currentRole === "admin";

  const canCurrentRoleAccessChannel = useCallback((channel: Channel) => {
    if (serverDetails?.currentRole === "admin") {
      return true;
    }
    if (serverDetails?.currentRole === "moderator") {
      return channel.allowModeratorAccess;
    }
    return channel.allowMemberAccess;
  }, [serverDetails?.currentRole]);

  const contextMenuChannel = useMemo(
    () => (channelContextMenu ? serverDetails?.server.channels.find((channel) => channel.id === channelContextMenu.channelId) ?? null : null),
    [channelContextMenu, serverDetails],
  );

  const actionModalChannel = useMemo(
    () => (channelActionChannelId ? serverDetails?.server.channels.find((channel) => channel.id === channelActionChannelId) ?? null : null),
    [channelActionChannelId, serverDetails],
  );

  const contextMenuCategory = useMemo(
    () => (categoryContextMenu ? categories.find((category) => category.id === categoryContextMenu.categoryId) ?? null : null),
    [categories, categoryContextMenu],
  );

  const renameModalCategory = useMemo(
    () => (categoryRenameId ? categories.find((category) => category.id === categoryRenameId) ?? null : null),
    [categories, categoryRenameId],
  );

  useEffect(() => {
    const savedId = window.sessionStorage.getItem("twinslkit:userId") ?? "";
    const savedName = window.sessionStorage.getItem("twinslkit:userName") ?? "Visitante";
    const savedVoiceSessionId = window.sessionStorage.getItem("twinslkit:voiceSessionId") ?? crypto.randomUUID();
    const savedAuthUserId = window.sessionStorage.getItem("twinslkit:authUserId");
    const savedAvatarUrl = window.sessionStorage.getItem("twinslkit:userAvatarUrl");
    setUserId(savedAuthUserId ?? savedId);
    setUserName(savedName);
    setUserAvatarUrl(savedAvatarUrl || null);
    setVoiceSessionId(savedVoiceSessionId);
    setIsSecureContextValue(window.isSecureContext);
    setIsAuthenticated(!!savedAuthUserId);

    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get("invite");
    if (inviteCode?.trim()) {
      setPendingInviteCode(inviteCode.trim());
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setDirectUnreadByConversationId({});
      setKnownDirectLastMessageAtByConversationId({});
      return;
    }

    const storedUnread = window.sessionStorage.getItem(`twinslkit:directUnread:${userId}`);
    const storedKnown = window.sessionStorage.getItem(`twinslkit:directKnownLast:${userId}`);

    if (storedUnread) {
      try {
        setDirectUnreadByConversationId(JSON.parse(storedUnread) as Record<string, number>);
      } catch {
        setDirectUnreadByConversationId({});
      }
    } else {
      setDirectUnreadByConversationId({});
    }

    if (storedKnown) {
      try {
        setKnownDirectLastMessageAtByConversationId(JSON.parse(storedKnown) as Record<string, string>);
      } catch {
        setKnownDirectLastMessageAtByConversationId({});
      }
    } else {
      setKnownDirectLastMessageAtByConversationId({});
    }

  }, [userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    window.sessionStorage.setItem("twinslkit:userId", userId);
    window.sessionStorage.setItem("twinslkit:userName", userName);
    if (userAvatarUrl) {
      window.sessionStorage.setItem("twinslkit:userAvatarUrl", userAvatarUrl);
    } else {
      window.sessionStorage.removeItem("twinslkit:userAvatarUrl");
    }
    if (voiceSessionId) {
      window.sessionStorage.setItem("twinslkit:voiceSessionId", voiceSessionId);
    }
  }, [userAvatarUrl, userId, userName, voiceSessionId]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    window.sessionStorage.setItem(`twinslkit:directUnread:${userId}`, JSON.stringify(directUnreadByConversationId));
  }, [directUnreadByConversationId, userId]);

  // Modo de supressão de ruído (rnnoise = leve, deepfilter = qualidade) - persistido por usuário
  useEffect(() => {
    if (!userId) {
      return;
    }
    try {
      const stored = window.localStorage.getItem(`twinslkit:noiseMode:${userId}`);
      if (stored === "rnnoise" || stored === "deepfilter") {
        setNoiseSuppressionMode(stored);
      }
    } catch {
      // ignore storage failures
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    try {
      window.localStorage.setItem(`twinslkit:noiseMode:${userId}`, noiseSuppressionMode);
    } catch {
      // ignore storage failures
    }
  }, [noiseSuppressionMode, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    window.sessionStorage.setItem(`twinslkit:directKnownLast:${userId}`, JSON.stringify(knownDirectLastMessageAtByConversationId));
  }, [knownDirectLastMessageAtByConversationId, userId]);

  useEffect(() => {
    selectedServerIdRef.current = selectedServerId;
    knownServerChannelLastMessageAtRef.current = {};
  }, [selectedServerId]);

  useEffect(() => {
    selectedChannelIdRef.current = selectedChannelId;
    shouldAutoScrollMessagesRef.current = true;
  }, [selectedChannelId]);

  useEffect(() => {
    selectedDirectConversationIdRef.current = selectedDirectConversationId;
    shouldAutoScrollDirectMessagesRef.current = true;
  }, [selectedDirectConversationId]);

  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const audio = new Audio("/chatnot.mp3");
    audio.preload = "auto";
    chatNotificationAudioRef.current = audio;

    const voiceMoveAudio = new Audio("/sounds/move.mp3");
    voiceMoveAudio.preload = "auto";
    voiceMoveAudioRef.current = voiceMoveAudio;

    const unlockAudio = () => {
      if (chatNotificationUnlockedRef.current) {
        return;
      }

      const unlockTargets = [chatNotificationAudioRef.current, voiceMoveAudioRef.current].filter(Boolean) as HTMLAudioElement[];
      if (!unlockTargets.length) {
        return;
      }

      unlockTargets.forEach((target) => {
        target.muted = true;
        void target.play().then(() => {
          target.pause();
          target.currentTime = 0;
          target.muted = false;
          chatNotificationUnlockedRef.current = true;
        }).catch(() => {
          return;
        });
      });
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      chatNotificationAudioRef.current = null;
      voiceMoveAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated && userId) {
      return;
    }

    knownLatestChannelMessageAtRef.current = {};
    knownLatestDirectMessageAtRef.current = {};
    knownServerChannelLastMessageAtRef.current = {};
  }, [isAuthenticated, userId]);

  useEffect(() => {
    voiceTokenRef.current = voiceToken;
  }, [voiceToken]);

  useEffect(() => {
    directUnreadByConversationIdRef.current = directUnreadByConversationId;
  }, [directUnreadByConversationId]);

  useEffect(() => {
    serverUnreadByIdRef.current = serverUnreadById;
  }, [serverUnreadById]);

  useEffect(() => {
    knownDirectLastMessageAtByConversationIdRef.current = knownDirectLastMessageAtByConversationId;
  }, [knownDirectLastMessageAtByConversationId]);

  useEffect(() => {
    chatNotificationSoundEnabledRef.current = chatNotificationSoundEnabled;
  }, [chatNotificationSoundEnabled]);

  useEffect(() => {
    if (!error) {
      return;
    }

    setErrorOpacity(1);

    const accessDeniedAudio = new Audio("/accessdenied.mp3");
    accessDeniedAudio.play().catch(() => {
      // Silently fail if audio won't play (e.g., user hasn't interacted with page yet)
    });

    const hideTimeout = setTimeout(() => {
      setErrorOpacity(0);
    }, 10000);

    const removeTimeout = setTimeout(() => {
      setError(null);
      setErrorOpacity(0);
    }, 10600);

    return () => {
      clearTimeout(hideTimeout);
      clearTimeout(removeTimeout);
    };
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      setSelectedFilePreviewByKey({});
      return;
    }

    void Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<[string, string]>((resolve) => {
            const reader = new FileReader();
            const fileKey = `${file.name}-${file.lastModified}-${file.size}`;
            reader.onload = () => resolve([fileKey, String(reader.result ?? "")]);
            reader.onerror = () => resolve([fileKey, ""]);
            reader.readAsDataURL(file);
          }),
      ),
    ).then((entries) => {
      if (cancelled) {
        return;
      }

      const next = entries.reduce<Record<string, string>>((acc, [key, value]) => {
        if (value) {
          acc[key] = value;
        }
        return acc;
      }, {});

      setSelectedFilePreviewByKey(next);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedFiles]);

  useEffect(() => {
    let cancelled = false;
    const imageFiles = selectedDirectFiles.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      setSelectedDirectFilePreviewByKey({});
      return;
    }

    void Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<[string, string]>((resolve) => {
            const reader = new FileReader();
            const fileKey = `${file.name}-${file.lastModified}-${file.size}`;
            reader.onload = () => resolve([fileKey, String(reader.result ?? "")]);
            reader.onerror = () => resolve([fileKey, ""]);
            reader.readAsDataURL(file);
          }),
      ),
    ).then((entries) => {
      if (cancelled) {
        return;
      }

      const next = entries.reduce<Record<string, string>>((acc, [key, value]) => {
        if (value) {
          acc[key] = value;
        }
        return acc;
      }, {});

      setSelectedDirectFilePreviewByKey(next);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedDirectFiles]);

  useEffect(() => {
    if (!showSettingsPanel || settingsPanelMode !== "server" || !serverDetails) {
      return;
    }

    const currentMember = serverDetails.server.members.find((member) => member.userId === userId) ?? null;
    setServerSettingsName(serverDetails.server.name ?? "");
    setServerSettingsAllowMemberInvites(!!serverDetails.server.allowMemberInvites);
    setServerSettingsAllowModeratorInvites(!!serverDetails.server.allowModeratorInvites);
    setServerSettingsAllowMemberSoundUpload(!!serverDetails.server.allowMemberSoundUpload);
    setServerSettingsAllowModeratorSoundUpload(!!serverDetails.server.allowModeratorSoundUpload);
    setServerSettingsAllowCrossServerSoundShare(!!serverDetails.server.allowCrossServerSoundShare);
    setServerSettingsAllowMemberDeleteSounds(!!serverDetails.server.allowMemberDeleteSounds);
    setServerSettingsAllowModeratorDeleteSounds(!!serverDetails.server.allowModeratorDeleteSounds);
    setServerSettingsAllowMemberStickerCreate(!!serverDetails.server.allowMemberStickerCreate);
    setServerSettingsAllowModeratorStickerCreate(!!serverDetails.server.allowModeratorStickerCreate);
    setServerSettingsAllowMemberEmojiCreate(!!serverDetails.server.allowMemberEmojiCreate);
    setServerSettingsAllowModeratorEmojiCreate(!!serverDetails.server.allowModeratorEmojiCreate);
    
    // Salvar valores originais para detectar mudanças
    setOriginalServerSettings({
      allowMemberInvites: !!serverDetails.server.allowMemberInvites,
      allowModeratorInvites: !!serverDetails.server.allowModeratorInvites,
      allowMemberSoundUpload: !!serverDetails.server.allowMemberSoundUpload,
      allowModeratorSoundUpload: !!serverDetails.server.allowModeratorSoundUpload,
      allowCrossServerSoundShare: !!serverDetails.server.allowCrossServerSoundShare,
      allowMemberDeleteSounds: !!serverDetails.server.allowMemberDeleteSounds,
      allowModeratorDeleteSounds: !!serverDetails.server.allowModeratorDeleteSounds,
      allowMemberStickerCreate: !!serverDetails.server.allowMemberStickerCreate,
      allowModeratorStickerCreate: !!serverDetails.server.allowModeratorStickerCreate,
      allowMemberEmojiCreate: !!serverDetails.server.allowMemberEmojiCreate,
      allowModeratorEmojiCreate: !!serverDetails.server.allowModeratorEmojiCreate,
    });
    
    setServerSettingsNotifySoundEnabled(currentMember?.notifySoundEnabled ?? true);
    setServerSettingsVirusTotalEnabled(!!serverDetails.server.virusTotalEnabled);
    setServerSettingsVirusTotalApiKey("");
    setServerSettingsAvatarFile(null);
    setServerSettingsAvatarInputKey((value) => value + 1);
    setServerSettingsBannerFile(null);
    setServerSettingsBannerInputKey((value) => value + 1);
    setNewStickerName("");
    setNewStickerFile(null);
    setNewStickerInputKey((value) => value + 1);
    setNewEmojiName("");
    setNewEmojiFile(null);
    setNewEmojiInputKey((value) => value + 1);
    setServerStickerPreviewPage(0);
    setServerEmojiPreviewPage(0);
  }, [
    settingsPanelMode,
    showSettingsPanel,
    serverDetails?.server.id,
    serverDetails?.server.name,
    serverDetails?.server.allowMemberInvites,
    serverDetails?.server.allowModeratorInvites,
    serverDetails?.server.allowMemberSoundUpload,
    serverDetails?.server.allowModeratorSoundUpload,
    serverDetails?.server.allowCrossServerSoundShare,
    serverDetails?.server.allowMemberDeleteSounds,
    serverDetails?.server.allowModeratorDeleteSounds,
    serverDetails?.server.allowMemberStickerCreate,
    serverDetails?.server.allowModeratorStickerCreate,
    serverDetails?.server.allowMemberEmojiCreate,
    serverDetails?.server.allowModeratorEmojiCreate,
    serverDetails?.server.virusTotalEnabled,
    serverDetails?.server.members,
    userId,
  ]);

  useEffect(() => {
    setDirectStickerPreviewPage(0);
    setDirectEmojiPreviewPage(0);
  }, [selectedDirectConversationId]);

  useEffect(() => {
    setDirectStickerPreviewPage((current) => Math.min(current, Math.max(0, directStickerPageCount - 1)));
  }, [directStickerPageCount]);

  useEffect(() => {
    setDirectEmojiPreviewPage((current) => Math.min(current, Math.max(0, directEmojiPageCount - 1)));
  }, [directEmojiPageCount]);

  useEffect(() => {
    setServerStickerPreviewPage((current) => Math.min(current, Math.max(0, serverStickerPageCount - 1)));
  }, [serverStickerPageCount]);

  useEffect(() => {
    setServerEmojiPreviewPage((current) => Math.min(current, Math.max(0, serverEmojiPageCount - 1)));
  }, [serverEmojiPageCount]);

  useEffect(() => {
    if (!serverContextMenu) {
      return;
    }

    const closeMenu = () => setServerContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [serverContextMenu]);

  useEffect(() => {
    if (!directConversationContextMenu) {
      return;
    }

    const closeMenu = () => setDirectConversationContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [directConversationContextMenu]);

  useEffect(() => {
    if (!showDirectFriendsModal) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowDirectFriendsModal(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showDirectFriendsModal]);

  useEffect(() => {
    if (!showDirectFriendsModal) {
      setDirectFriendSearchTerm("");
      setVisibleDirectFriendsCount(30);
      return;
    }

    setVisibleDirectFriendsCount(30);
  }, [showDirectFriendsModal]);

  useEffect(() => {
    setVisibleDirectFriendsCount(30);
  }, [directFriendSearchTerm]);

  useEffect(() => {
    setVisibleSidebarMemberCount(50);
  }, [sidebarMemberSearchTerm]);

  useEffect(() => {
    setVisibleSettingsMemberCount(50);
  }, [settingsMemberSearchTerm]);

  useEffect(() => {
    setSidebarMemberSearchTerm("");
    setSettingsMemberSearchTerm("");
    setVisibleServerChannelCount(60);
    setVisibleSidebarMemberCount(50);
    setVisibleSettingsMemberCount(50);
  }, [selectedServerId]);

  useEffect(() => {
    if (!channelAreaContextMenu) {
      return;
    }

    const closeMenu = () => setChannelAreaContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [channelAreaContextMenu]);

  useEffect(() => {
    if (!channelContextMenu) {
      return;
    }

    const closeMenu = () => setChannelContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [channelContextMenu]);

  useEffect(() => {
    if (!categoryContextMenu) {
      return;
    }

    const closeMenu = () => setCategoryContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [categoryContextMenu]);

  useEffect(() => {
    if (!memberContextMenu) {
      return;
    }

    const closeMenu = () => setMemberContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [memberContextMenu]);

  useEffect(() => {
    if (!channelMessageUserCard) {
      return;
    }

    const closeCard = () => setChannelMessageUserCard(null);

    const closeCardOnPointerDownCapture = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setChannelMessageUserCard(null);
        return;
      }

      if (channelMessageUserCardRef.current?.contains(target)) {
        return;
      }

      setChannelMessageUserCard(null);
    };

    const closeCardOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChannelMessageUserCard(null);
      }
    };

    window.addEventListener("resize", closeCard);
    window.addEventListener("scroll", closeCard, true);
    window.addEventListener("contextmenu", closeCard);
    document.addEventListener("mousedown", closeCardOnPointerDownCapture, true);
    document.addEventListener("touchstart", closeCardOnPointerDownCapture, true);
    document.addEventListener("keydown", closeCardOnEscape, true);

    return () => {
      window.removeEventListener("resize", closeCard);
      window.removeEventListener("scroll", closeCard, true);
      window.removeEventListener("contextmenu", closeCard);
      document.removeEventListener("mousedown", closeCardOnPointerDownCapture, true);
      document.removeEventListener("touchstart", closeCardOnPointerDownCapture, true);
      document.removeEventListener("keydown", closeCardOnEscape, true);
    };
  }, [channelMessageUserCard]);

  useEffect(() => {
    if (!bannedUserContextMenu) {
      return;
    }

    const closeMenu = () => setBannedUserContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [bannedUserContextMenu]);

  const playChatNotification = useCallback((force?: boolean) => {
    if (!force && !chatNotificationSoundEnabledRef.current) {
      return;
    }

    const audio = chatNotificationAudioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = 0;
    void audio.play().catch(() => {
      return;
    });
  }, []);

  const playVoiceMoveSound = useCallback(() => {
    const audio = voiceMoveAudioRef.current;
    if (audio) {
      audio.currentTime = 0;
      void audio.play().catch(() => {
        playSynthesizedVoiceMoveBeep();
      });
      return;
    }

    playSynthesizedVoiceMoveBeep();
  }, []);

  // Beep de fallback caso o arquivo /sounds/move.mp3 não exista
  const playSynthesizedVoiceMoveBeep = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    const audioContext = new AudioContextClass();
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(520, now);
    oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.15);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gainNode.gain.setValueAtTime(0.25, now + 0.1);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.25);

    window.setTimeout(() => {
      void audioContext.close().catch(() => undefined);
    }, 400);
  }, []);

  const loadUserProfile = useCallback(async (currentUserId: string) => {
    const response = await fetch(`/api/users/${encodeURIComponent(currentUserId)}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      return;
    }

    setUserName(payload.user.displayName);
    setUserAvatarUrl(payload.user.avatarUrl ?? null);
    if (payload.user.displayNameStyle) {
      setDisplayNameColor(payload.user.displayNameStyle.color ?? "#ffffff");
      setDisplayNameFontFamily(payload.user.displayNameStyle.fontFamily ?? "sans");
      setDisplayNameBold(payload.user.displayNameStyle.bold ?? false);
      setDisplayNameAnimation(payload.user.displayNameStyle.animation ?? "none");
      setDisplayNameGradientEnabled(payload.user.displayNameStyle.gradientEnabled ?? false);
      setDisplayNameBackgroundColor(payload.user.displayNameStyle.backgroundColor ?? "#1a1a2e");
      setDisplayNameBackgroundOpacity(payload.user.displayNameStyle.backgroundOpacity ?? 60);
      setDisplayNameShowBackground(payload.user.displayNameStyle.showBackground ?? false);
      setDisplayNameProfileCardGifUrl(payload.user.displayNameStyle.profileCardGifUrl ?? null);
    }
    setJoinWithMicEnabled(payload.user.joinWithMicEnabled ?? true);
    setJoinWithCameraEnabled(payload.user.joinWithCameraEnabled ?? false);
    setNoiseSuppressionEnabled(payload.user.noiseSuppressionEnabled ?? true);
    setChatNotificationSoundEnabled(payload.user.chatNotificationSoundEnabled ?? true);
    setMicGain(payload.user.micGain ?? 100);
  }, []);

  const loadServers = useCallback(async (currentUserId: string) => {
    const response = await fetch(`/api/servers?userId=${encodeURIComponent(currentUserId)}`);
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Falha ao carregar servidores.");
      return;
    }

    const nextServers = payload.servers as Server[];
    const normalizedCurrentUserId = currentUserId.trim().toLowerCase();
    const previousLastById = knownServerLastMessageAtByIdRef.current;
    const nextLastById: Record<string, string> = { ...previousLastById };
    const previousUnread = serverUnreadByIdRef.current;
    const nextUnread: Record<string, number> = { ...previousUnread };
    let shouldPlayNotification = false;

    nextServers.forEach((server) => {
      const lastMessageAt = server.lastMessageAt ?? "";
      if (!lastMessageAt) {
        return;
      }

      const previousLastMessageAt = previousLastById[server.id];
      const lastMessageUserId = server.lastMessageUserId?.trim().toLowerCase();
      const isFromOtherUser = !!lastMessageUserId && lastMessageUserId !== normalizedCurrentUserId;
      const isActiveServer = appModeRef.current === "server" && selectedServerIdRef.current === server.id;

      if (previousLastMessageAt && lastMessageAt > previousLastMessageAt && isFromOtherUser) {
        if (!isActiveServer) {
          nextUnread[server.id] = (nextUnread[server.id] ?? 0) + 1;
          const currentMember = server.members.find((member) => member.userId === currentUserId);
          if (currentMember?.notifySoundEnabled ?? true) {
            shouldPlayNotification = true;
          }
        }
      }

      nextLastById[server.id] =
        previousLastMessageAt && previousLastMessageAt > lastMessageAt ? previousLastMessageAt : lastMessageAt;
    });

    knownServerLastMessageAtByIdRef.current = nextLastById;
    setServerUnreadById(nextUnread);
    if (shouldPlayNotification) {
      playChatNotification(true);
    }

    setServers((currentValue) => {
      if (JSON.stringify(currentValue) === JSON.stringify(nextServers)) {
        return currentValue;
      }
      return nextServers;
    });
    const serverExists = nextServers.some((server: Server) => server.id === selectedServerId);
    if (!serverExists) {
      setSelectedServerId(nextServers[0]?.id ?? null);
    }
  }, [playChatNotification, selectedServerId]);

  const loadServerDetails = useCallback(async (serverId: string, currentUserId: string) => {
    const requestId = ++serverDetailsRequestIdRef.current;
    const response = await fetch(
      `/api/servers/${serverId}?userId=${encodeURIComponent(currentUserId)}`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Falha ao carregar servidor.");

      if (selectedServerIdRef.current === serverId) {
        if (activeVoiceServerId === serverId) {
          handleVoiceLeave();
        }
        setServerDetails(null);
        setSelectedChannelId(null);
        setServerInvites([]);
        setServerBans([]);
      }

      return;
    }

    if (requestId !== serverDetailsRequestIdRef.current) {
      return;
    }

    const nextServer = payload.server as Server;
    const previousChannelLastById = knownServerChannelLastMessageAtRef.current;
    const nextChannelLastById: Record<string, string> = { ...previousChannelLastById };
    const normalizedCurrentUserId = currentUserId.trim().toLowerCase();
    const previousChannelUnread = channelUnreadByIdRef.current;
    const nextChannelUnread: Record<string, number> = { ...previousChannelUnread };
    let shouldPlayNotification = false;

    nextServer.channels.forEach((channel) => {
      if (channel.type !== "text") {
        return;
      }

      const lastMessageAt = channel.lastMessageAt ?? "";
      if (!lastMessageAt) {
        return;
      }

      const previousLastMessageAt = previousChannelLastById[channel.id];
      if (previousLastMessageAt && lastMessageAt > previousLastMessageAt) {
        const lastMessageUserId = channel.lastMessageUserId?.trim().toLowerCase();
        const isFromOtherUser = !!lastMessageUserId && lastMessageUserId !== normalizedCurrentUserId;
        const isActiveChannel = appModeRef.current === "server" && selectedChannelIdRef.current === channel.id;

        if (isFromOtherUser) {
          // Indicador visual de mensagens novas no canal de texto
          if (!isActiveChannel) {
            nextChannelUnread[channel.id] = (nextChannelUnread[channel.id] ?? 0) + 1;
          }
          shouldPlayNotification = true;
        }
      }

      nextChannelLastById[channel.id] =
        previousLastMessageAt && previousLastMessageAt > lastMessageAt ? previousLastMessageAt : lastMessageAt;
    });

    knownServerChannelLastMessageAtRef.current = nextChannelLastById;
    channelUnreadByIdRef.current = nextChannelUnread;
    setChannelUnreadById(nextChannelUnread);
    setServerDetails(payload);
    if (shouldPlayNotification) {
      playChatNotification(true);
    }
    const canAccessChannel = (channel: Channel): boolean => {
      if (payload.currentRole === "admin") {
        return true;
      }
      if (payload.currentRole === "moderator") {
        return channel.allowModeratorAccess;
      }
      return channel.allowMemberAccess;
    };

    const selectedStillExists = payload.server.channels.some(
      (channel: Channel) => channel.id === selectedChannelIdRef.current,
    );
    const selectedStillAccessible = payload.server.channels.some(
      (channel: Channel) => channel.id === selectedChannelIdRef.current && canAccessChannel(channel),
    );

    if (
      !selectedChannelIdRef.current ||
      !selectedStillExists ||
      !selectedStillAccessible
    ) {
      const firstAccessible = payload.server.channels.find((channel: Channel) => canAccessChannel(channel));
      setSelectedChannelId(firstAccessible?.id ?? payload.server.channels[0]?.id ?? null);
    }
  }, [activeVoiceServerId, handleVoiceLeave, playChatNotification]);

  const loadServerInvites = useCallback(async (serverId: string, actorId: string) => {
    const response = await fetch(
      `/api/servers/${serverId}/invites?actorId=${encodeURIComponent(actorId)}`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok) {
      setServerInvites([]);
      return;
    }

    setServerInvites(payload.invites as ServerInvite[]);
  }, []);

  const loadServerBans = useCallback(async (serverId: string, actorId: string) => {
    const response = await fetch(
      `/api/servers/${serverId}/bans?actorId=${encodeURIComponent(actorId)}`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok) {
      setServerBans([]);
      return;
    }

    setServerBans(payload.bans as ServerBan[]);
  }, []);

  const loadServerAuditLogs = useCallback(async (serverId: string) => {
    const response = await fetch(
      `/api/servers/${serverId}/audit-logs?limit=50`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok) {
      setServerAuditLogs([]);
      setAuditLogsError(payload.error ?? "Falha ao carregar logs de auditoria.");
      return;
    }

    setServerAuditLogs(payload.logs as ServerAuditLog[]);
    setAuditLogsError(null);
  }, []);

  const loadVoicePresence = useCallback(async (serverId: string, currentUserId: string) => {
    const response = await fetch(
      `/api/servers/${serverId}/voice-presence?userId=${encodeURIComponent(currentUserId)}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      return;
    }

    const payload = await response.json() as { channels?: Record<string, VoicePresenceMember[]> };
    setVoicePresenceByChannel(payload.channels ?? {});
  }, []);

  const refreshVoicePresenceNow = useCallback(() => {
    if (!selectedServerId || !userId || !isAuthenticated) {
      return;
    }

    void loadVoicePresence(selectedServerId, userId);
  }, [isAuthenticated, loadVoicePresence, selectedServerId, userId]);

  const onVoiceListeningStateChanged = useCallback((stateByUserId: Record<string, boolean>) => {
    setVoiceListeningByUserId(stateByUserId);
  }, []);

  const loadMessages = useCallback(async (
    serverId: string,
    channelId: string,
    currentUserId: string,
    options?: { beforeCreatedAt?: string; beforeId?: string; appendOlder?: boolean },
  ) => {
    const requestId = ++messagesRequestIdRef.current;
    const query = new URLSearchParams({
      userId: currentUserId,
      limit: "30",
    });
    if (options?.beforeCreatedAt) {
      query.set("beforeCreatedAt", options.beforeCreatedAt);
    }
    if (options?.beforeId) {
      query.set("beforeId", options.beforeId);
    }

    const response = await fetch(
      `/api/servers/${serverId}/channels/${channelId}/messages?${query.toString()}`,
      { cache: "no-store" },
    );
    const payload = await response.json() as MessagePageResponse;
    if (!response.ok) {
      setError(payload.error ?? "Falha ao carregar mensagens.");
      return;
    }

    if (requestId !== messagesRequestIdRef.current) {
      return;
    }

    setHasMoreMessages(payload.hasMore);
    if (options?.appendOlder) {
      setMessages((currentValue) => {
        const existingIds = new Set(currentValue.map((message) => message.id));
        const older = payload.messages.filter((message) => !existingIds.has(message.id));
        return [...older, ...currentValue];
      });
      return;
    }

    const previousLatestMessageAt = knownLatestChannelMessageAtRef.current[channelId];
    const nextLatestMessageAt = payload.messages[payload.messages.length - 1]?.createdAt;
    if (nextLatestMessageAt) {
      if (previousLatestMessageAt) {
        const normalizedCurrentUserId = currentUserId.trim().toLowerCase();
        const hasNewIncomingMessage = payload.messages.some(
          (message) => message.createdAt > previousLatestMessageAt && message.userId.trim().toLowerCase() !== normalizedCurrentUserId,
        );
        if (hasNewIncomingMessage) {
          playChatNotification();
        }
        // Balão "novas mensagens": só conta se o usuário NÃO está no fundo do chat
        if (hasNewIncomingMessage && !shouldAutoScrollMessagesRef.current) {
          const newCount = payload.messages.filter(
            (message) => message.createdAt > previousLatestMessageAt && message.userId.trim().toLowerCase() !== normalizedCurrentUserId,
          ).length;
          setNewServerMessageCount((current) => current + Math.max(1, newCount));
        }
      }
      knownLatestChannelMessageAtRef.current[channelId] =
        previousLatestMessageAt && previousLatestMessageAt > nextLatestMessageAt
          ? previousLatestMessageAt
          : nextLatestMessageAt;
    }

    // Se o usuário está lendo o histórico (rolou para cima), NÃO sobrescreve
    // as mensagens atuais — apenas atualiza notificação/balão. Isso evita que
    // o polling resete o histórico carregado.
    if (!shouldAutoScrollMessagesRef.current) {
      return;
    }

    setMessages(payload.messages);

    requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container && shouldAutoScrollMessagesRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, [playChatNotification]);

  const loadDirectConversations = useCallback(async (currentUserId: string) => {
    const response = await fetch(
      `/api/direct/conversations?userId=${encodeURIComponent(currentUserId)}`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Falha ao carregar conversas diretas.");
      return;
    }

    const nextConversations = payload.conversations as DirectConversation[];
    const selectedConversationId = selectedDirectConversationIdRef.current;
    const nextSelectedConversationId =
      selectedConversationId && nextConversations.some((conversation) => conversation.id === selectedConversationId)
        ? selectedConversationId
        : (nextConversations[0]?.id ?? null);

    setDirectConversations(nextConversations);
    setSelectedDirectConversationId((currentValue) => {
      if (!nextConversations.length) {
        return null;
      }
      if (currentValue && nextConversations.some((conversation) => conversation.id === currentValue)) {
        return currentValue;
      }
      return nextConversations[0].id;
    });

    const currentKnown = knownDirectLastMessageAtByConversationIdRef.current;
    const currentUnread = directUnreadByConversationIdRef.current;
    const nextKnown: Record<string, string> = {};
    const nextUnread: Record<string, number> = {};
    let shouldPlayNotification = false;

    nextConversations.forEach((conversation) => {
      const previousKnownLastMessageAt = currentKnown[conversation.id];
      const hasMessagePreview = conversation.lastMessagePreview.trim().length > 0;
      const hasNewLastMessage =
        !!previousKnownLastMessageAt &&
        conversation.lastMessageAt > previousKnownLastMessageAt &&
        hasMessagePreview;
      const isConversationOpen =
        appModeRef.current === "direct" &&
        !!nextSelectedConversationId &&
        conversation.id === nextSelectedConversationId;

      // Fonte da verdade do servidor: se lastReadAt existe e é >= lastMessageAt, está lida
      const serverLastReadAt = conversation.lastReadAt;
      const hasUnreadFromServer =
        hasMessagePreview &&
        (!serverLastReadAt || conversation.lastMessageAt > serverLastReadAt);

      nextKnown[conversation.id] = previousKnownLastMessageAt
        ? (conversation.lastMessageAt > previousKnownLastMessageAt ? conversation.lastMessageAt : previousKnownLastMessageAt)
        : conversation.lastMessageAt;

      if (isConversationOpen) {
        nextUnread[conversation.id] = 0;
        return;
      }

      if (hasNewLastMessage) {
        nextUnread[conversation.id] = (currentUnread[conversation.id] ?? 0) + 1;
        shouldPlayNotification = true;
        return;
      }

      const shouldBootstrapUnread =
        !previousKnownLastMessageAt &&
        hasUnreadFromServer &&
        !isConversationOpen &&
        (currentUnread[conversation.id] ?? 0) === 0;

      if (shouldBootstrapUnread) {
        nextUnread[conversation.id] = 1;
        return;
      }

      nextUnread[conversation.id] = currentUnread[conversation.id] ?? 0;
    });

    directUnreadByConversationIdRef.current = nextUnread;
    knownDirectLastMessageAtByConversationIdRef.current = nextKnown;
    setDirectUnreadByConversationId(nextUnread);
    setKnownDirectLastMessageAtByConversationId(nextKnown);
    if (shouldPlayNotification) {
      playChatNotification();
    }
  }, [playChatNotification]);

  const loadDirectBlocks = useCallback(async (currentUserId: string) => {
    const response = await fetch(
      `/api/direct/blocks?userId=${encodeURIComponent(currentUserId)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setBlockedDirectUserIds([]);
      return;
    }

    setBlockedDirectUserIds((payload.blockedUserIds as string[]) ?? []);
  }, []);

  const loadDirectFriends = useCallback(async (currentUserId: string) => {
    const response = await fetch(
      `/api/direct/friends?userId=${encodeURIComponent(currentUserId)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({})) as DirectFriendsResponse;

    if (!response.ok) {
      setDirectFriends([]);
      return;
    }

    setDirectFriends(Array.isArray(payload.friends) ? payload.friends : []);
  }, []);

  const loadDirectMessages = useCallback(async (
    conversationId: string,
    currentUserId: string,
    options?: { beforeCreatedAt?: string; beforeId?: string; appendOlder?: boolean },
  ) => {
    const requestId = ++directMessagesRequestIdRef.current;
    const query = new URLSearchParams({
      userId: currentUserId,
      conversationId,
      limit: "30",
    });
    if (options?.beforeCreatedAt) {
      query.set("beforeCreatedAt", options.beforeCreatedAt);
    }
    if (options?.beforeId) {
      query.set("beforeId", options.beforeId);
    }

    const response = await fetch(`/api/direct/messages?${query.toString()}`, { cache: "no-store" });
    const payload = await response.json() as DirectMessagePageResponse;
    if (!response.ok) {
      setError(payload.error ?? "Falha ao carregar mensagens diretas.");
      return;
    }

    if (requestId !== directMessagesRequestIdRef.current) {
      return;
    }

    setHasMoreDirectMessages(payload.hasMore);
    if (options?.appendOlder) {
      setDirectMessages((currentValue) => {
        const existingIds = new Set(currentValue.map((message) => message.id));
        const older = payload.messages.filter((message) => !existingIds.has(message.id));
        return [...older, ...currentValue];
      });
      return;
    }

    const previousLatestMessageAt = knownLatestDirectMessageAtRef.current[conversationId];
    const nextLatestMessageAt = payload.messages[payload.messages.length - 1]?.createdAt;
    if (nextLatestMessageAt) {
      if (previousLatestMessageAt) {
        const normalizedCurrentUserId = currentUserId.trim().toLowerCase();
        const hasNewIncomingMessage = payload.messages.some(
          (message) => message.createdAt > previousLatestMessageAt && message.senderId.trim().toLowerCase() !== normalizedCurrentUserId,
        );
        if (hasNewIncomingMessage) {
          playChatNotification();
          // Balão "novas mensagens": só conta se o usuário NÃO está no fundo do chat
          if (!shouldAutoScrollDirectMessagesRef.current) {
            const newCount = payload.messages.filter(
              (message) => message.createdAt > previousLatestMessageAt && message.senderId.trim().toLowerCase() !== normalizedCurrentUserId,
            ).length;
            setNewDirectMessageCount((current) => current + Math.max(1, newCount));
          }
          // Persistir a leitura no servidor (conversa está aberta)
          void fetch(`/api/direct/conversations/${conversationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actorId: currentUserId }),
          }).catch(() => undefined);
        }
      }
      knownLatestDirectMessageAtRef.current[conversationId] =
        previousLatestMessageAt && previousLatestMessageAt > nextLatestMessageAt
          ? previousLatestMessageAt
          : nextLatestMessageAt;
    }

    // Se o usuário está lendo o histórico (rolou para cima), NÃO sobrescreve
    // as mensagens atuais — apenas atualiza notificação/balão.
    if (!shouldAutoScrollDirectMessagesRef.current) {
      return;
    }

    setDirectMessages(payload.messages);

    requestAnimationFrame(() => {
      const container = directMessagesContainerRef.current;
      if (container && shouldAutoScrollDirectMessagesRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, [playChatNotification]);

  useEffect(() => {
    if (!userId || !isAuthenticated) {
      setServers([]);
      setDirectConversations([]);
      setDirectFriends([]);
      setShowDirectFriendsModal(false);
      setDirectFriendSearchTerm("");
      setVisibleDirectFriendsCount(30);
      setNewDirectFriendUserId("");
      setBlockedDirectUserIds([]);
      setSelectedDirectConversationId(null);
      setDirectMessages([]);
      setSelectedDirectFiles([]);
      setDirectFileInputKey((value) => value + 1);
      setDirectUnreadByConversationId({});
      setKnownDirectLastMessageAtByConversationId({});
      setServerUnreadById({});
      knownServerLastMessageAtByIdRef.current = {};
      setChannelUnreadById({});
      channelUnreadByIdRef.current = {};
      knownServerChannelLastMessageAtRef.current = {};
      setSelectedServerId(null);
      setServerDetails(null);
      setVoicePresenceByChannel({});
      setSelectedChannelId(null);
      setMessages([]);
      return;
    }
    void loadUserProfile(userId);
    void loadServers(userId);
    void loadDirectConversations(userId);
    void loadDirectFriends(userId);
    void loadDirectBlocks(userId);

    const timer = setInterval(() => {
      void loadServers(userId);
      void loadDirectConversations(userId);
      void loadDirectFriends(userId);
      void loadDirectBlocks(userId);
    }, 2000);

    return () => clearInterval(timer);
  }, [isAuthenticated, loadDirectBlocks, loadDirectConversations, loadDirectFriends, loadServers, loadUserProfile, userId]);

  useEffect(() => {
    if (!isAuthenticated || !userId || !selectedDirectConversationId || appMode !== "direct") {
      if (!selectedDirectConversationId) {
        setDirectMessages([]);
        setHasMoreDirectMessages(false);
      }
      return;
    }

    setNewDirectMessageCount(0);
    void loadDirectMessages(selectedDirectConversationId, userId);
    const timer = setInterval(() => {
      if (isLoadingOlderDirectMessagesRef.current) {
        return;
      }
      void loadDirectMessages(selectedDirectConversationId, userId);
    }, 2500);

    return () => clearInterval(timer);
  }, [appMode, isAuthenticated, loadDirectMessages, selectedDirectConversationId, userId]);

  useEffect(() => {
    if (appMode !== "direct" || !selectedDirectConversationId) {
      return;
    }

    setDirectUnreadByConversationId((currentValue) => {
      if (!currentValue[selectedDirectConversationId]) {
        return currentValue;
      }
      const nextValue = {
        ...currentValue,
        [selectedDirectConversationId]: 0,
      };
      directUnreadByConversationIdRef.current = nextValue;
      return nextValue;
    });
  }, [appMode, selectedDirectConversationId]);

  useEffect(() => {
    if (appMode !== "server" || !selectedServerId) {
      return;
    }

    setServerUnreadById((currentValue) => {
      if (!currentValue[selectedServerId]) {
        return currentValue;
      }
      const nextValue = {
        ...currentValue,
        [selectedServerId]: 0,
      };
      serverUnreadByIdRef.current = nextValue;
      return nextValue;
    });

    const selectedServer = servers.find((server) => server.id === selectedServerId);
    if (selectedServer?.lastMessageAt) {
      knownServerLastMessageAtByIdRef.current = {
        ...knownServerLastMessageAtByIdRef.current,
        [selectedServerId]: selectedServer.lastMessageAt,
      };
    }
  }, [appMode, selectedServerId, servers]);

  useEffect(() => {
    setEditingDirectMessageId(null);
    setEditingDirectMessageContent("");
  }, [selectedDirectConversationId]);

  useEffect(() => {
    if (!selectedServerId || !userId || !isAuthenticated) {
      setServerDetails(null);
      setServerInvites([]);
      setVoicePresenceByChannel({});
      return;
    }
    void loadServerDetails(selectedServerId, userId);
  }, [isAuthenticated, loadServerDetails, selectedServerId, userId]);

  useEffect(() => {
    if (!selectedServerId || !userId || !isAuthenticated) {
      return;
    }

    void loadVoicePresence(selectedServerId, userId);
    const timer = setInterval(() => {
      void loadVoicePresence(selectedServerId, userId);
    }, 3000);

    return () => clearInterval(timer);
  }, [isAuthenticated, loadVoicePresence, selectedServerId, userId]);

  useEffect(() => {
    if (!activeVoiceChannelId || !isVoiceConnected || !userId) {
      return;
    }

    const members = voicePresenceByChannel[activeVoiceChannelId] ?? [];
    const currentIds = new Set(members.map((member) => member.userId));
    const previousIds = voicePresenceByChannelRef.current[activeVoiceChannelId];

    if (!previousIds) {
      voicePresenceByChannelRef.current[activeVoiceChannelId] = currentIds;
      return;
    }

    // Som de entrada agora é gerenciado pelo voice-room (sounds/join.mp3), não mais aqui

    voicePresenceByChannelRef.current[activeVoiceChannelId] = currentIds;
  }, [activeVoiceChannelId, isVoiceConnected, userId, voicePresenceByChannel]);

  useEffect(() => {
    if (!selectedServerId || !userId || !isAuthenticated) {
      return;
    }

    // Não recarregar dados enquanto o painel de configurações está aberto
    if (showSettingsPanel) {
      return;
    }

    const timer = setInterval(() => {
      void loadServerDetails(selectedServerId, userId);
    }, 2000);

    return () => clearInterval(timer);
  }, [isAuthenticated, loadServerDetails, selectedServerId, userId, showSettingsPanel]);

  useEffect(() => {
    if (!isAuthenticated || !userId || !pendingInviteCode || isJoiningInvite) {
      return;
    }

    const acceptInvite = async () => {
      setIsJoiningInvite(true);
      const response = await fetch(`/api/invites/${encodeURIComponent(pendingInviteCode)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const payload = await response.json().catch(() => ({}));
      setIsJoiningInvite(false);

      if (!response.ok) {
        setError(payload.error ?? "Falha ao aceitar convite.");
        setPendingInviteCode(null);
      } else {
        await loadServers(userId);
        if (payload.serverId) {
          setSelectedServerId(payload.serverId as string);
        }
        setPendingInviteCode(null);
      }

      const url = new URL(window.location.href);
      url.searchParams.delete("invite");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    };

    void acceptInvite();
  }, [isAuthenticated, isJoiningInvite, loadServers, pendingInviteCode, userId]);

  useEffect(() => {
    if (!showSettingsPanel || settingsPanelMode !== "server" || !canManageInvites || !selectedServerId || !userId) {
      if (!showSettingsPanel || settingsPanelMode !== "server") {
        setServerInvites([]);
      }
      return;
    }

    void loadServerInvites(selectedServerId, userId);
  }, [canManageInvites, loadServerInvites, selectedServerId, settingsPanelMode, showSettingsPanel, userId]);

  useEffect(() => {
    if (!showSettingsPanel || settingsPanelMode !== "server" || !canManageBansForSelectedServer || !selectedServerId || !userId) {
      if (!showSettingsPanel || settingsPanelMode !== "server") {
        setServerBans([]);
      }
      return;
    }

    void loadServerBans(selectedServerId, userId);
  }, [canManageBansForSelectedServer, loadServerBans, selectedServerId, settingsPanelMode, showSettingsPanel, userId]);

  useEffect(() => {
    if (!showSettingsPanel || settingsPanelMode !== "server" || !canManageChannels || !selectedServerId) {
      if (!showSettingsPanel || settingsPanelMode !== "server") {
        setServerAuditLogs([]);
        setAuditLogsError(null);
        setAuditLogSearchQuery("");
        setAuditLogFilterDate("");
        setAuditLogFilterTimeStart("");
        setAuditLogFilterTimeEnd("");
        setAuditLogCurrentPage(1);
      }
      return;
    }

    void loadServerAuditLogs(selectedServerId);
  }, [canManageChannels, loadServerAuditLogs, selectedServerId, settingsPanelMode, showSettingsPanel]);

  useEffect(() => {
    if (!isAuthenticated || !selectedChannelId || selectedChannel?.type !== "text" || !selectedServerId || !userId) {
      setMessages([]);
      setHasMoreMessages(false);
      setNewServerMessageCount(0);
      return;
    }

    setNewServerMessageCount(0);
    void loadMessages(selectedServerId, selectedChannelId, userId);

    const timer = setInterval(() => {
      // A ref síncrona impede o polling de rodar durante o carregamento de
      // mensagens antigas (appendOlder), evitando que o requestId seja
      // incrementado e descarte o histórico carregado.
      if (isLoadingOlderMessagesRef.current) {
        return;
      }
      void loadMessages(selectedServerId, selectedChannelId, userId);
    }, 2500);

    return () => clearInterval(timer);
  }, [isAuthenticated, loadMessages, selectedChannel?.type, selectedChannelId, selectedServerId, userId]);

  const loadOlderMessages = async () => {
    if (
      isLoadingOlderMessages ||
      isLoadingOlderMessagesRef.current ||
      !hasMoreMessages ||
      !selectedServerId ||
      !selectedChannel ||
      selectedChannel.type !== "text" ||
      !userId ||
      messages.length === 0
    ) {
      return;
    }

    const oldestMessage = messages[0];
    const container = messagesContainerRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    const previousTop = container?.scrollTop ?? 0;

    setIsLoadingOlderMessages(true);
    isLoadingOlderMessagesRef.current = true;
    try {
      await loadMessages(selectedServerId, selectedChannel.id, userId, {
        beforeCreatedAt: oldestMessage.createdAt,
        beforeId: oldestMessage.id,
        appendOlder: true,
      });
    } finally {
      isLoadingOlderMessagesRef.current = false;
      setIsLoadingOlderMessages(false);
    }

    requestAnimationFrame(() => {
      const currentContainer = messagesContainerRef.current;
      if (!currentContainer) {
        return;
      }
      const newHeight = currentContainer.scrollHeight;
      currentContainer.scrollTop = newHeight - previousHeight + previousTop;
    });
  };

  const onMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const nearBottom = container.scrollHeight - (container.scrollTop + container.clientHeight) < 80;
    shouldAutoScrollMessagesRef.current = nearBottom;
    if (nearBottom && newServerMessageCount > 0) {
      setNewServerMessageCount(0);
    }

    if (container.scrollTop > 160) {
      return;
    }

    void loadOlderMessages();
  };

  const scrollServerMessagesToBottom = () => {
    shouldAutoScrollMessagesRef.current = true;
    setNewServerMessageCount(0);
    requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  };

  const scrollDirectMessagesToBottom = () => {
    shouldAutoScrollDirectMessagesRef.current = true;
    setNewDirectMessageCount(0);
    requestAnimationFrame(() => {
      const container = directMessagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  };

  const handleAuth = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedAuthUsername = authUsername.trim();
    const trimmedName = userName.trim();
    const trimmedPassword = password.trim();

    if (!trimmedPassword) {
      setError("Informe a senha.");
      return;
    }

    if (authMode === "login" && !trimmedAuthUsername) {
      setError("Informe seu usuário para login.");
      return;
    }

    if (authMode === "register") {
      if (!trimmedAuthUsername) {
        setError("Informe um usuário para cadastro.");
        return;
      }
      if (!trimmedName) {
        setError("Informe seu nome para cadastro.");
        return;
      }
      if (trimmedPassword !== confirmPassword.trim()) {
        setError("A confirmação de senha não confere.");
        return;
      }
    }

    // Validar Turnstile se estiver habilitado
    let token: string | null = null;
    if (isTurnstileEnabled) {
      if (turnstileWidgetId !== null && typeof window !== "undefined" && (window as any).turnstile) {
        token = (window as any).turnstile.getResponse(turnstileWidgetId);
      }
      if (!token) {
        setError("Por favor, resolva o desafio de segurança.");
        return;
      }
    }

    setBusy(true);
    setError(null);

    const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const bodyBase =
      authMode === "register"
        ? { username: trimmedAuthUsername, displayName: trimmedName, password: trimmedPassword }
        : { username: trimmedAuthUsername, password: trimmedPassword };
    const body = token ? { ...bodyBase, turnstileToken: token } : bodyBase;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as AuthResponse & { error?: string };
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha na autenticação.");
      // Reset Turnstile widget on error
      if (turnstileWidgetId !== null && typeof window !== "undefined" && (window as any).turnstile) {
        (window as any).turnstile.reset(turnstileWidgetId);
      }
      setTurnstileToken(null);
      return;
    }

    setUserId(payload.user.id);
    setUserName(payload.user.displayName);
    setUserAvatarUrl(payload.user.avatarUrl ?? null);
    if (payload.user.displayNameStyle) {
      setDisplayNameColor(payload.user.displayNameStyle.color ?? "#ffffff");
      setDisplayNameFontFamily(payload.user.displayNameStyle.fontFamily ?? "sans");
      setDisplayNameBold(payload.user.displayNameStyle.bold ?? false);
      setDisplayNameAnimation(payload.user.displayNameStyle.animation ?? "none");
      setDisplayNameGradientEnabled(payload.user.displayNameStyle.gradientEnabled ?? false);
      setDisplayNameBackgroundColor(payload.user.displayNameStyle.backgroundColor ?? "#1a1a2e");
      setDisplayNameBackgroundOpacity(payload.user.displayNameStyle.backgroundOpacity ?? 60);
      setDisplayNameShowBackground(payload.user.displayNameStyle.showBackground ?? false);
      setDisplayNameProfileCardGifUrl(payload.user.displayNameStyle.profileCardGifUrl ?? null);
    }
    setJoinWithMicEnabled(payload.user.joinWithMicEnabled ?? true);
    setJoinWithCameraEnabled(payload.user.joinWithCameraEnabled ?? false);
    setNoiseSuppressionEnabled(payload.user.noiseSuppressionEnabled ?? true);
    setChatNotificationSoundEnabled(payload.user.chatNotificationSoundEnabled ?? true);
    setMicGain(payload.user.micGain ?? 100);
    setPassword("");
    setConfirmPassword("");
    // Reset Turnstile widget after successful auth
    if (turnstileWidgetId !== null && typeof window !== "undefined" && (window as any).turnstile) {
      (window as any).turnstile.reset(turnstileWidgetId);
    }
    setTurnstileToken(null);
    setIsAuthenticated(true);
    window.sessionStorage.setItem("twinslkit:authUserId", payload.user.id);
    setError(null);
    await loadServers(payload.user.id);
  };

  const logout = () => {
    void fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    handleVoiceLeave();
    setIsAuthenticated(false);
    setServers([]);
    setVoicePresenceByChannel({});
    setSelectedServerId(null);
    setSelectedChannelId(null);
    setServerDetails(null);
    setMessages([]);
    setPassword("");
    setConfirmPassword("");
    setUserAvatarUrl(null);
    setAvatarFile(null);
    setAvatarInputKey((value) => value + 1);
    window.sessionStorage.removeItem("twinslkit:authUserId");
    window.sessionStorage.removeItem("twinslkit:userAvatarUrl");
  };

  const deleteOwnAccount = async () => {
    if (!isAuthenticated || !userId) {
      return;
    }

    const confirmed = window.confirm(
      "Tem certeza que deseja excluir sua conta? Seus dados de perfil serão removidos e você será desconectado.",
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: userId }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao excluir conta.");
      return;
    }

    logout();
    setShowSettingsPanel(false);
    setSettingsPanelMode("all");
    setAuthMode("login");
    setAuthUsername("");
    setUserName("Visitante");
    setNewOwnPassword("");
    setConfirmOwnPassword("");
    setError("Conta excluída com sucesso.");
  };

  const uploadAvatar = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAuthenticated || !userId || !avatarFile) {
      return;
    }

    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("actorId", userId);
    formData.append("avatar", avatarFile);

    const response = await fetch(`/api/users/${encodeURIComponent(userId)}/avatar`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao atualizar avatar.");
      return;
    }

    setUserAvatarUrl(payload.user.avatarUrl ?? null);
    setJoinWithMicEnabled(payload.user.joinWithMicEnabled ?? true);
    setJoinWithCameraEnabled(payload.user.joinWithCameraEnabled ?? false);
    setNoiseSuppressionEnabled(payload.user.noiseSuppressionEnabled ?? true);
    setChatNotificationSoundEnabled(payload.user.chatNotificationSoundEnabled ?? true);
    setMicGain(payload.user.micGain ?? 100);
    setAvatarFile(null);
    setAvatarInputKey((value) => value + 1);
    if (selectedServerId) {
      await loadServerDetails(selectedServerId, userId).catch(() => undefined);
    }
  };

  const uploadProfileCardGif = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAuthenticated || !userId || !profileCardGifFile) {
      return;
    }

    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("actorId", userId);
    formData.append("gif", profileCardGifFile);

    const response = await fetch(`/api/users/${encodeURIComponent(userId)}/profile-gif`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao atualizar GIF do card.");
      return;
    }

    setDisplayNameProfileCardGifUrl(payload.user.displayNameStyle?.profileCardGifUrl ?? null);
    setProfileCardGifFile(null);
    setProfileCardGifInputKey((value) => value + 1);
    await loadDirectConversations(userId).catch(() => undefined);
  };

  const removeProfileCardGif = async () => {
    if (!isAuthenticated || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/users/${encodeURIComponent(userId)}/profile-gif`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: userId }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao remover GIF do card.");
      return;
    }

    setDisplayNameProfileCardGifUrl(null);
    await loadDirectConversations(userId).catch(() => undefined);
  };

  const createServer = async (event: FormEvent) => {
    event.preventDefault();
    if (!newServerName.trim() || !userId || !isAuthenticated) {
      return;
    }
    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("name", newServerName.trim());
    formData.append("creatorId", userId);
    if (newServerAvatarFile) {
      formData.append("avatar", newServerAvatarFile);
    }

    const response = await fetch("/api/servers", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao criar servidor.");
      return;
    }

    setNewServerName("");
    setNewServerAvatarFile(null);
    setNewServerAvatarInputKey((value) => value + 1);
    setShowCreateServerModal(false);
    await loadServers(userId);
    setSelectedServerId(payload.server.id);
  };

  const saveServerSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !isAuthenticated || !userId) {
      return;
    }

    const isOwnerEditingServerSettings = isSelectedServerOwner;

    const trimmedName = serverSettingsName.trim();
    if (isOwnerEditingServerSettings && !trimmedName) {
      setError("Informe um nome para o servidor.");
      return;
    }

    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("actorId", userId);

    if (isOwnerEditingServerSettings) {
      formData.append("name", trimmedName);
    }

    // Apenas enviar campos que realmente foram alterados
    if (serverSettingsAllowMemberInvites !== originalServerSettings.allowMemberInvites) {
      formData.append("allowMemberInvites", String(serverSettingsAllowMemberInvites));
    }
    if (serverSettingsAllowModeratorInvites !== originalServerSettings.allowModeratorInvites) {
      formData.append("allowModeratorInvites", String(serverSettingsAllowModeratorInvites));
    }
    if (serverSettingsAllowMemberSoundUpload !== originalServerSettings.allowMemberSoundUpload) {
      formData.append("allowMemberSoundUpload", String(serverSettingsAllowMemberSoundUpload));
    }
    if (serverSettingsAllowModeratorSoundUpload !== originalServerSettings.allowModeratorSoundUpload) {
      formData.append("allowModeratorSoundUpload", String(serverSettingsAllowModeratorSoundUpload));
    }
    if (serverSettingsAllowCrossServerSoundShare !== originalServerSettings.allowCrossServerSoundShare) {
      formData.append("allowCrossServerSoundShare", String(serverSettingsAllowCrossServerSoundShare));
    }
    if (serverSettingsAllowMemberDeleteSounds !== originalServerSettings.allowMemberDeleteSounds) {
      formData.append("allowMemberDeleteSounds", String(serverSettingsAllowMemberDeleteSounds));
    }
    if (serverSettingsAllowModeratorDeleteSounds !== originalServerSettings.allowModeratorDeleteSounds) {
      formData.append("allowModeratorDeleteSounds", String(serverSettingsAllowModeratorDeleteSounds));
    }
    if (serverSettingsAllowMemberStickerCreate !== originalServerSettings.allowMemberStickerCreate) {
      formData.append("allowMemberStickerCreate", String(serverSettingsAllowMemberStickerCreate));
    }
    if (serverSettingsAllowModeratorStickerCreate !== originalServerSettings.allowModeratorStickerCreate) {
      formData.append("allowModeratorStickerCreate", String(serverSettingsAllowModeratorStickerCreate));
    }
    if (serverSettingsAllowMemberEmojiCreate !== originalServerSettings.allowMemberEmojiCreate) {
      formData.append("allowMemberEmojiCreate", String(serverSettingsAllowMemberEmojiCreate));
    }
    if (serverSettingsAllowModeratorEmojiCreate !== originalServerSettings.allowModeratorEmojiCreate) {
      formData.append("allowModeratorEmojiCreate", String(serverSettingsAllowModeratorEmojiCreate));
    }

    if (isOwnerEditingServerSettings) {
      formData.append("virusTotalEnabled", String(serverSettingsVirusTotalEnabled));
      formData.append("virusTotalApiKey", serverSettingsVirusTotalApiKey);
      if (serverSettingsAvatarFile) {
        formData.append("avatar", serverSettingsAvatarFile);
      }
    }

    if (serverSettingsBannerFile) {
      formData.append("serverBanner", serverSettingsBannerFile);
    }

    const response = await fetch(`/api/servers/${selectedServerId}`, {
      method: "PATCH",
      body: formData,
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao atualizar servidor.");
      return;
    }

    if (payload.server) {
      setServerDetails((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          server: payload.server as Server,
        };
      });
    }

    setServerSettingsAvatarFile(null);
    setServerSettingsAvatarInputKey((value) => value + 1);
    setServerSettingsBannerFile(null);
    setServerSettingsBannerInputKey((value) => value + 1);
    await loadServers(userId);
    await loadServerDetails(selectedServerId, userId);
  };

  const saveServerNotificationSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !isAuthenticated || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/servers/${selectedServerId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        notifySoundEnabled: serverSettingsNotifySoundEnabled,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao salvar notificacoes do servidor.");
      return;
    }

    const nextNotifySoundEnabled = payload.member?.notifySoundEnabled ?? serverSettingsNotifySoundEnabled;
    setServerSettingsNotifySoundEnabled(nextNotifySoundEnabled);

    setServerDetails((current) => {
      if (!current) {
        return current;
      }

      const nextMembers = current.server.members.map((member) =>
        member.userId === userId
          ? { ...member, notifySoundEnabled: nextNotifySoundEnabled }
          : member,
      );

      return {
        ...current,
        server: {
          ...current.server,
          members: nextMembers,
        },
      };
    });

    setServers((current) =>
      current.map((server) =>
        server.id === selectedServerId
          ? {
              ...server,
              members: server.members.map((member) =>
                member.userId === userId
                  ? { ...member, notifySoundEnabled: nextNotifySoundEnabled }
                  : member,
              ),
            }
          : server,
      ),
    );
  };

  const removeServerAvatar = async () => {
    if (!selectedServerId || !isAuthenticated || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("actorId", userId);
    formData.append("removeAvatar", "true");
    formData.append("name", serverSettingsName.trim() || serverDetails?.server.name || "servidor");

    const response = await fetch(`/api/servers/${selectedServerId}`, {
      method: "PATCH",
      body: formData,
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao remover foto do servidor.");
      return;
    }

    setServerSettingsAvatarFile(null);
    setServerSettingsAvatarInputKey((value) => value + 1);
    await loadServers(userId);
    await loadServerDetails(selectedServerId, userId);
  };

  const uploadServerBanner = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !isAuthenticated || !userId || !serverSettingsBannerFile) {
      return;
    }

    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("actorId", userId);
    formData.append("serverBanner", serverSettingsBannerFile);

    const response = await fetch(`/api/servers/${selectedServerId}`, {
      method: "PATCH",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao atualizar banner do servidor.");
      return;
    }

    setServerSettingsBannerFile(null);
    setServerSettingsBannerInputKey((value) => value + 1);
    await loadServers(userId);
    await loadServerDetails(selectedServerId, userId);
  };

  const removeServerBanner = async () => {
    if (!selectedServerId || !isAuthenticated || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("actorId", userId);
    formData.append("removeServerBanner", "true");

    const response = await fetch(`/api/servers/${selectedServerId}`, {
      method: "PATCH",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao remover banner do servidor.");
      return;
    }

    setServerSettingsBannerFile(null);
    setServerSettingsBannerInputKey((value) => value + 1);
    await loadServers(userId);
    await loadServerDetails(selectedServerId, userId);
  };

  const createSticker = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !userId || !newStickerFile || !canCreateServerStickers) {
      return;
    }

    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("actorId", userId);
    formData.append("name", newStickerName.trim());
    formData.append("sticker", newStickerFile);

    const response = await fetch(`/api/servers/${selectedServerId}/stickers`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao criar figurinha.");
      return;
    }

    setNewStickerName("");
    setNewStickerFile(null);
    setNewStickerInputKey((value) => value + 1);
    await loadServerDetails(selectedServerId, userId);
  };

  const deleteSticker = async (sticker: ServerSticker) => {
    if (!selectedServerId || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(
      `/api/servers/${selectedServerId}/stickers/${sticker.id}?actorId=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao remover figurinha.");
      return;
    }

    await loadServerDetails(selectedServerId, userId);
  };

  const createEmoji = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !userId || !newEmojiFile || !canCreateServerEmojis) {
      return;
    }

    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("actorId", userId);
    formData.append("name", newEmojiName.trim());
    formData.append("emoji", newEmojiFile);

    const response = await fetch(`/api/servers/${selectedServerId}/emojis`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao criar emoji.");
      return;
    }

    setNewEmojiName("");
    setNewEmojiFile(null);
    setNewEmojiInputKey((value) => value + 1);
    await loadServerDetails(selectedServerId, userId);
  };

  const deleteEmoji = async (emoji: ServerEmoji) => {
    if (!selectedServerId || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(
      `/api/servers/${selectedServerId}/emojis/${emoji.id}?actorId=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao remover emoji.");
      return;
    }

    await loadServerDetails(selectedServerId, userId);
  };

  const createInviteLink = async () => {
    if (!selectedServerId || !isAuthenticated || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/servers/${selectedServerId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: userId }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao gerar convite.");
      return;
    }

    await loadServerInvites(selectedServerId, userId);
  };

  const deleteInviteLink = async (inviteId: string) => {
    if (!selectedServerId || !isAuthenticated || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(
      `/api/servers/${selectedServerId}/invites/${inviteId}?actorId=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao excluir convite.");
      return;
    }

    await loadServerInvites(selectedServerId, userId);
  };

  const unbanServerUser = async (banId: string, userName: string) => {
    if (!selectedServerId || !isAuthenticated || !userId) {
      return;
    }

    const confirmed = window.confirm(`Remover banimento de ${userName}?`);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(
      `/api/servers/${selectedServerId}/bans/${banId}?actorId=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao remover banimento.");
      return;
    }

    setBannedUserContextMenu(null);
    await loadServerBans(selectedServerId, userId);
    await loadServerDetails(selectedServerId, userId);
    await loadServers(userId);
  };

  const deleteServerById = async (serverId: string) => {
    if (!isAuthenticated || !userId) {
      return;
    }

    const confirmed = window.confirm(
      "Tem certeza que deseja excluir este servidor? Esta ação é irreversível e vai apagar todos os canais, mensagens, membros, anexos e configurações.",
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/servers/${serverId}?actorId=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao excluir servidor.");
      return;
    }

    if (selectedServerId === serverId) {
      handleVoiceLeave();
      setShowSettingsPanel(false);
      setSelectedChannelId(null);
      setServerDetails(null);
    }

    setServerContextMenu(null);
    await loadServers(userId);
  };

  const leaveCurrentServer = async () => {
    if (!selectedServerId || !isAuthenticated || !userId) {
      return;
    }

    const confirmed = window.confirm("Tem certeza que deseja sair deste servidor?");
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(
      `/api/servers/${selectedServerId}/leave?userId=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao sair do servidor.");
      return;
    }

    if (activeVoiceServerId === selectedServerId) {
      handleVoiceLeave();
    }

    setShowSettingsPanel(false);
    setServerDetails(null);
    setSelectedChannelId(null);
    setServerInvites([]);
    setServerBans([]);
    await loadServers(userId);
  };

  const createChannel = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !newChannelName.trim() || !isAuthenticated) {
      return;
    }
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/servers/${selectedServerId}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: userId, name: newChannelName.trim(), type: newChannelType }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao criar canal.");
      return;
    }

    setNewChannelName("");
    await loadServerDetails(selectedServerId, userId);
    setSelectedChannelId(payload.channel.id);
  };

  const openCreateItemModal = (kind: "text" | "voice" | "category") => {
    setCreateItemKind(kind);
    setCreateItemName("");
    setCreateItemCategoryId("");
    setChannelAreaContextMenu(null);
    setShowCreateItemModal(true);
  };

  const createItemFromModal = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !isAuthenticated || !userId || !createItemName.trim()) {
      return;
    }

    setBusy(true);
    setError(null);

    if (createItemKind === "category") {
      const response = await fetch(`/api/servers/${selectedServerId}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: userId, name: createItemName.trim() }),
      });
      const payload = await response.json();
      setBusy(false);

      if (!response.ok) {
        setError(payload.error ?? "Falha ao criar categoria.");
        return;
      }

      setShowCreateItemModal(false);
      await loadServerDetails(selectedServerId, userId);
      return;
    }

    const response = await fetch(`/api/servers/${selectedServerId}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        name: createItemName.trim(),
        type: createItemKind,
        categoryId: createItemCategoryId || null,
      }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao criar canal.");
      return;
    }

    setShowCreateItemModal(false);
    await loadServerDetails(selectedServerId, userId);
    setSelectedChannelId(payload.channel.id);
  };

  const openChannelActionModal = (mode: "rename" | "move" | "permissions") => {
    if (!contextMenuChannel) {
      return;
    }
    setChannelActionMode(mode);
    setChannelActionChannelId(contextMenuChannel.id);
    setChannelActionName(contextMenuChannel.name);
    setChannelActionCategoryId(contextMenuChannel.categoryId ?? "");
    setChannelActionPermissions({
      allowMemberView: contextMenuChannel.allowMemberView,
      allowModeratorView: contextMenuChannel.allowModeratorView,
      allowMemberAccess: contextMenuChannel.allowMemberAccess,
      allowModeratorAccess: contextMenuChannel.allowModeratorAccess,
      allowMemberSendMessages: contextMenuChannel.allowMemberSendMessages,
      allowModeratorSendMessages: contextMenuChannel.allowModeratorSendMessages,
      allowMemberSendFiles: contextMenuChannel.allowMemberSendFiles,
      allowModeratorSendFiles: contextMenuChannel.allowModeratorSendFiles,
      allowMemberSendLinks: contextMenuChannel.allowMemberSendLinks,
      allowModeratorSendLinks: contextMenuChannel.allowModeratorSendLinks,
      allowMemberDeleteMessages: contextMenuChannel.allowMemberDeleteMessages,
      allowModeratorDeleteMessages: contextMenuChannel.allowModeratorDeleteMessages,
    });
    setShowChannelActionModal(true);
    setChannelContextMenu(null);
  };

  const submitChannelAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !actionModalChannel || !isAuthenticated || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const body =
      channelActionMode === "rename"
        ? { actorId: userId, name: channelActionName.trim() }
        : channelActionMode === "move"
          ? { actorId: userId, categoryId: channelActionCategoryId || null }
          : { actorId: userId, permissions: channelActionPermissions };

    const response = await fetch(`/api/servers/${selectedServerId}/channels/${actionModalChannel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao atualizar canal.");
      return;
    }

    setShowChannelActionModal(false);
    setChannelActionChannelId(null);
    await loadServerDetails(selectedServerId, userId);
  };

  const deleteChannel = async () => {
    if (!selectedServerId || !contextMenuChannel || !isAuthenticated || !userId) {
      return;
    }

    const confirmed = window.confirm("Tem certeza que deseja excluir este canal? Mensagens e arquivos do canal serão apagados.");
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(
      `/api/servers/${selectedServerId}/channels/${contextMenuChannel.id}?actorId=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao excluir canal.");
      return;
    }

    if (selectedChannelId === contextMenuChannel.id) {
      setSelectedChannelId(null);
    }
    setChannelContextMenu(null);
    await loadServerDetails(selectedServerId, userId);
  };

  const openCategoryRenameModal = () => {
    if (!contextMenuCategory) {
      return;
    }
    setCategoryRenameId(contextMenuCategory.id);
    setCategoryRenameName(contextMenuCategory.name);
    setShowCategoryRenameModal(true);
    setCategoryContextMenu(null);
  };

  const submitCategoryRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !renameModalCategory || !isAuthenticated || !userId || !categoryRenameName.trim()) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/servers/${selectedServerId}/categories/${renameModalCategory.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: userId, name: categoryRenameName.trim() }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao renomear categoria.");
      return;
    }

    setShowCategoryRenameModal(false);
    setCategoryRenameId(null);
    await loadServerDetails(selectedServerId, userId);
  };

  const deleteCategory = async () => {
    if (!selectedServerId || !contextMenuCategory || !isAuthenticated || !userId) {
      return;
    }

    const confirmed = window.confirm("Excluir esta categoria? Os canais dela serão movidos para 'Sem categoria'.");
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(
      `/api/servers/${selectedServerId}/categories/${contextMenuCategory.id}?actorId=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao excluir categoria.");
      return;
    }

    setCategoryContextMenu(null);
    await loadServerDetails(selectedServerId, userId);
  };

  const saveMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !newMemberId.trim() || !isAuthenticated) {
      return;
    }
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/servers/${selectedServerId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        targetUserId: newMemberId.trim(),
        role: newMemberRole,
        permissions: newMemberRole === "moderator" ? newModeratorPermissions : undefined,
      }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao atualizar membro.");
      return;
    }

    setNewMemberId("");
    if (newMemberRole !== "moderator") {
      setNewModeratorPermissions({
        canRemoveMembers: false,
        canBanUsers: false,
        canTimeoutVoice: false,
        canDeleteUserMessages: false,
        canKickFromVoice: false,
        canMoveVoiceUsers: false,
        canManageInvites: false,
      });
    }
    await loadServerDetails(selectedServerId, userId);
    await loadServers(userId);
  };

  const openMemberRoleModal = () => {
    if (!memberContextMenu) {
      return;
    }
    setEditMemberUserId(memberContextMenu.targetUserId);
    setEditMemberUserName(memberContextMenu.targetUserName);
    setEditMemberRole(memberContextMenu.targetRole);
    setEditModeratorPermissions(memberContextMenu.targetPermissions ?? {
      canRemoveMembers: false,
      canBanUsers: false,
      canTimeoutVoice: false,
      canDeleteUserMessages: false,
      canKickFromVoice: false,
      canMoveVoiceUsers: false,
      canManageInvites: false,
    });
    setMemberContextMenu(null);
    setShowMemberRoleModal(true);
  };

  const saveEditedMemberRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !editMemberUserId.trim() || !isAuthenticated) {
      return;
    }
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/servers/${selectedServerId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        targetUserId: editMemberUserId.trim(),
        role: editMemberRole,
        permissions: editMemberRole === "moderator" ? editModeratorPermissions : undefined,
      }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao atualizar membro.");
      return;
    }

    setShowMemberRoleModal(false);
    setEditMemberUserId("");
    setEditMemberUserName("");
    await loadServerDetails(selectedServerId, userId);
    await loadServers(userId);
  };

  const runModerationAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !moderationTargetId.trim()) {
      return;
    }
    if (moderationAction === "voice-move" && !moderationTargetChannelId) {
      setError("Selecione o canal de voz de destino para mover o usuário.");
      return;
    }

    setBusy(true);
    setError(null);

    const payload: {
      action: "remove-user" | "ban-user" | "voice-timeout" | "voice-kick" | "voice-move";
      actorId: string;
      targetUserId: string;
      reason?: string;
      removeMessages?: boolean;
      durationMinutes?: number;
      targetChannelId?: string;
    } = {
      action: moderationAction,
      actorId: userId,
      targetUserId: moderationTargetId.trim(),
      reason: moderationReason.trim() || undefined,
    };

    if (moderationAction === "remove-user") {
      payload.removeMessages = moderationRemoveMessages;
    }
    if (moderationAction === "voice-timeout") {
      payload.durationMinutes = moderationDurationMinutes;
    }
    if (moderationAction === "voice-move") {
      payload.targetChannelId = moderationTargetChannelId;
    }

    const response = await fetch(`/api/servers/${selectedServerId}/moderation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const responsePayload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(responsePayload.error ?? "Falha na ação de moderação.");
      return;
    }

    setModerationTargetId("");
    setModerationReason("");
    setModerationRemoveMessages(false);
    setModerationDurationMinutes(10);
    setModerationTargetChannelId("");
    await loadServerDetails(selectedServerId, userId);
    await loadServers(userId);
  };

  const runVoiceCardModerationAction = async (payload: {
    action: "voice-kick" | "voice-move";
    targetUserId: string;
    targetChannelId?: string;
  }) => {
    if (!selectedServerId) {
      return;
    }

    const reason = window.prompt("Motivo (opcional):")?.trim();

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/servers/${selectedServerId}/moderation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: payload.action,
        actorId: userId,
        targetUserId: payload.targetUserId,
        targetChannelId: payload.targetChannelId,
        reason: reason || undefined,
      }),
    });
    const responsePayload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(responsePayload.error ?? "Falha na ação de voz.");
      return;
    }
  };

  const runQuickMemberModerationAction = async (payload: {
    action: "ban-user" | "voice-timeout";
    targetUserId: string;
    targetUserName: string;
  }) => {
    if (!selectedServerId || !userId || payload.targetUserId.trim().toLowerCase() === userId.trim().toLowerCase()) {
      return;
    }

    const confirmLabel = payload.action === "ban-user"
      ? `Banir ${payload.targetUserName} do servidor?`
      : `Aplicar castigo de voz em ${payload.targetUserName}?`;
    const confirmed = window.confirm(confirmLabel);
    if (!confirmed) {
      return;
    }

    let durationMinutes: number | undefined;
    if (payload.action === "voice-timeout") {
      const durationRaw = window.prompt("Duração do castigo em minutos (1 a 4320)", "10");
      if (durationRaw === null) {
        return;
      }
      const parsedDuration = Number(durationRaw);
      if (!Number.isFinite(parsedDuration) || parsedDuration < 1 || parsedDuration > 4320) {
        setError("Duração inválida. Informe um número entre 1 e 4320 minutos.");
        return;
      }
      durationMinutes = Math.floor(parsedDuration);
    }

    const reasonPrompt = payload.action === "ban-user"
      ? "Motivo do banimento (opcional):"
      : "Motivo do castigo (opcional):";
    const reason = window.prompt(reasonPrompt)?.trim();

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/servers/${selectedServerId}/moderation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: payload.action,
        actorId: userId,
        targetUserId: payload.targetUserId,
        reason: reason || undefined,
        durationMinutes,
      }),
    });
    const responsePayload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(responsePayload.error ?? "Falha na ação de moderação.");
      return;
    }

    setMemberContextMenu(null);
    await loadServerDetails(selectedServerId, userId);
    await loadServers(userId);
  };

  const selectDirectConversation = (conversationId: string) => {
    setSelectedDirectConversationId(conversationId);
    setDirectUnreadByConversationId((currentValue) => {
      if (!currentValue[conversationId]) {
        return currentValue;
      }
      const nextValue = {
        ...currentValue,
        [conversationId]: 0,
      };
      directUnreadByConversationIdRef.current = nextValue;
      return nextValue;
    });

    // Persistir a leitura no servidor para sobreviver a fechar/reabrir o navegador
    void fetch(`/api/direct/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: userId }),
    }).catch(() => undefined);
  };

  const postFormDataWithProgress = useCallback(
    (url: string, formData: FormData, onProgress: (value: number) => void): Promise<Response> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable || event.total <= 0) {
            return;
          }

          const nextValue = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
          onProgress(nextValue);
        };

        xhr.onerror = () => {
          reject(new Error("Falha no envio."));
        };

        xhr.onload = () => {
          const rawHeaders = xhr.getAllResponseHeaders();
          const headers = new Headers();

          rawHeaders
            .trim()
            .split(/[\r\n]+/)
            .forEach((line) => {
              const separatorIndex = line.indexOf(":");
              if (separatorIndex <= 0) {
                return;
              }

              const headerName = line.slice(0, separatorIndex).trim();
              const headerValue = line.slice(separatorIndex + 1).trim();
              if (headerName) {
                headers.append(headerName, headerValue);
              }
            });

          resolve(
            new Response(xhr.responseText, {
              status: xhr.status,
              statusText: xhr.statusText,
              headers,
            }),
          );
        };

        xhr.send(formData);
      });
    },
    [],
  );

  const openDirectConversation = async (targetUserId: string) => {
    if (!isAuthenticated || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch("/api/direct/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        targetUserId,
      }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao abrir conversa direta.");
      return;
    }

    const createdConversation = payload.conversation as DirectConversation;
    setDirectConversations((currentValue) => {
      const withoutCurrent = currentValue.filter((conversation) => conversation.id !== createdConversation.id);
      return [createdConversation, ...withoutCurrent];
    });
    selectDirectConversation(createdConversation.id);
    setAppMode("direct");
    setShowSettingsPanel(false);
  };

  const sendDirectMessage = async (event: FormEvent) => {
    event.preventDefault();

    if (!isAuthenticated || !userId || !selectedDirectConversationId) {
      return;
    }

    const trimmedContent = newDirectMessage.trim();
    if (!trimmedContent && selectedDirectFiles.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (selectedDirectFiles.length > 0) {
        setDirectUploadProgress(0);
      }

      const response =
        selectedDirectFiles.length > 0
          ? await (async () => {
              const formData = new FormData();
              formData.append("userId", userId);
              formData.append("conversationId", selectedDirectConversationId);
              formData.append("content", trimmedContent);
              selectedDirectFiles.forEach((file) => formData.append("files", file));
              return postFormDataWithProgress("/api/direct/messages", formData, setDirectUploadProgress);
            })()
          : await fetch("/api/direct/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId,
                conversationId: selectedDirectConversationId,
                content: trimmedContent,
              }),
            });
      const payload = await response.json();
      setBusy(false);

      if (!response.ok) {
        setError(payload.error ?? "Falha ao enviar mensagem direta.");
        return;
      }

      setNewDirectMessage("");
      setSelectedDirectFiles([]);
      setDirectFileInputKey((value) => value + 1);
      setDirectUnreadByConversationId((currentValue) => {
        if (!currentValue[selectedDirectConversationId]) {
          return currentValue;
        }
        const nextValue = {
          ...currentValue,
          [selectedDirectConversationId]: 0,
        };
        directUnreadByConversationIdRef.current = nextValue;
        return nextValue;
      });
      await loadDirectMessages(selectedDirectConversationId, userId);
      await loadDirectConversations(userId);
    } catch {
      setBusy(false);
      setError("Falha de conexão ao enviar mensagem direta.");
    } finally {
      setDirectUploadProgress(null);
    }
  };

  const toggleDirectBlock = async () => {
    if (!selectedDirectConversation || !userId) {
      return;
    }

    const targetUserId = selectedDirectConversation.otherUserId;
    const isBlocked = blockedDirectUserIds.includes(targetUserId);

    setBusy(true);
    setError(null);

    const response = await fetch("/api/direct/blocks", {
      method: isBlocked ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        targetUserId,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? (isBlocked ? "Falha ao desbloquear usuário." : "Falha ao bloquear usuário."));
      return;
    }

    await loadDirectBlocks(userId);
  };

  const sendDirectFriendRequest = async (friendUserId: string) => {
    if (!userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch("/api/direct/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        friendUserId,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao enviar solicitação de amizade.");
      return;
    }

    await loadDirectConversations(userId);
    await loadDirectFriends(userId);
  };

  const addDirectFriendById = async (event: FormEvent) => {
    event.preventDefault();

    if (!userId) {
      return;
    }

    const trimmedFriendUserId = newDirectFriendUserId.trim();
    if (!trimmedFriendUserId) {
      return;
    }

    setNewDirectFriendUserId("");
    await sendDirectFriendRequest(trimmedFriendUserId);
  };

  const openFriendConversation = async (friendUserId: string) => {
    const existingConversation = directConversations.find((conversation) => conversation.otherUserId === friendUserId);
    if (existingConversation) {
      selectDirectConversation(existingConversation.id);
      setAppMode("direct");
      setShowSettingsPanel(false);
      return;
    }

    await openDirectConversation(friendUserId);
  };

  const removeDirectFriend = async (friendUserId: string) => {
    if (!userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch("/api/direct/friends", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        friendUserId,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao remover amigo.");
      return;
    }

    await loadDirectFriends(userId);
  };

  const respondToDirectFriendRequest = async (requestId: string, action: "accept" | "reject") => {
    if (!userId || !selectedDirectConversationId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch("/api/direct/friends/requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        requestId,
        action,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao responder solicitação de amizade.");
      return;
    }

    await loadDirectFriends(userId);
    await loadDirectConversations(userId);
    await loadDirectMessages(selectedDirectConversationId, userId);
  };

  const clearDirectConversationMessages = async (conversationId: string) => {
    if (!userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/direct/conversations/${conversationId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        mode: "clearMessages",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao limpar mensagens da conversa.");
      return;
    }

    if (selectedDirectConversationId === conversationId) {
      setDirectMessages([]);
      setHasMoreDirectMessages(false);
    }
    await loadDirectConversations(userId);
  };

  const deleteDirectConversation = async (conversationId: string) => {
    if (!userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/direct/conversations/${conversationId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        mode: "deleteConversation",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao excluir conversa direta.");
      return;
    }

    if (selectedDirectConversationId === conversationId) {
      setSelectedDirectConversationId(null);
      setDirectMessages([]);
      setHasMoreDirectMessages(false);
    }

    await loadDirectConversations(userId);
  };

  const startEditingDirectMessage = (message: DirectChatMessage) => {
    setEditingDirectMessageId(message.id);
    setEditingDirectMessageContent(message.content);
  };

  const cancelEditingDirectMessage = () => {
    setEditingDirectMessageId(null);
    setEditingDirectMessageContent("");
  };

  const saveEditedDirectMessage = async (messageId: string) => {
    const nextContent = editingDirectMessageContent.trim();
    if (!nextContent) {
      setError("A mensagem editada não pode ficar vazia.");
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/direct/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        content: nextContent,
      }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao editar mensagem direta.");
      return;
    }

    setDirectMessages((current) =>
      current.map((message) => (message.id === messageId ? payload.message as DirectChatMessage : message)),
    );
    cancelEditingDirectMessage();
    await loadDirectConversations(userId);
  };

  const removeDirectAttachment = async (messageId: string, attachmentUrl: string) => {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/direct/messages/${messageId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        attachmentUrl,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao excluir arquivo da mensagem direta.");
      return;
    }

    setDirectMessages((current) =>
      current.map((message) => (message.id === messageId ? payload.message as DirectChatMessage : message)),
    );
    await loadDirectConversations(userId);
  };

  const removeDirectMessage = async (messageId: string) => {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/direct/messages/${messageId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao excluir mensagem direta.");
      return;
    }

    setDirectMessages((current) => current.filter((message) => message.id !== messageId));
    if (editingDirectMessageId === messageId) {
      cancelEditingDirectMessage();
    }
    await loadDirectConversations(userId);
  };

  const loadOlderDirectMessages = async () => {
    if (
      isLoadingOlderDirectMessages ||
      isLoadingOlderDirectMessagesRef.current ||
      !hasMoreDirectMessages ||
      !selectedDirectConversationId ||
      !userId ||
      directMessages.length === 0
    ) {
      return;
    }

    const oldestMessage = directMessages[0];
    const container = directMessagesContainerRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    const previousTop = container?.scrollTop ?? 0;

    setIsLoadingOlderDirectMessages(true);
    isLoadingOlderDirectMessagesRef.current = true;
    try {
      await loadDirectMessages(selectedDirectConversationId, userId, {
        beforeCreatedAt: oldestMessage.createdAt,
        beforeId: oldestMessage.id,
        appendOlder: true,
      });
    } finally {
      isLoadingOlderDirectMessagesRef.current = false;
      setIsLoadingOlderDirectMessages(false);
    }

    requestAnimationFrame(() => {
      const currentContainer = directMessagesContainerRef.current;
      if (!currentContainer) {
        return;
      }
      const newHeight = currentContainer.scrollHeight;
      currentContainer.scrollTop = newHeight - previousHeight + previousTop;
    });
  };

  const onDirectMessagesScroll = () => {
    const container = directMessagesContainerRef.current;
    if (!container) {
      return;
    }

    const nearBottom = container.scrollHeight - (container.scrollTop + container.clientHeight) < 80;
    shouldAutoScrollDirectMessagesRef.current = nearBottom;
    if (nearBottom && newDirectMessageCount > 0) {
      setNewDirectMessageCount(0);
    }

    if (container.scrollTop > 160) {
      return;
    }

    void loadOlderDirectMessages();
  };

  const appendTokenToNewMessage = (token: string) => {
    setNewMessage((previous) => {
      const trimmed = previous.trimEnd();
      if (!trimmed) {
        return `${token} `;
      }
      return `${trimmed} ${token} `;
    });
  };

  const toggleSpoilerWrap = (message: string, setMessage: (value: string) => void) => {
    const trimmed = message.trim();
    if (!trimmed) {
      setMessage("||texto oculto|| ");
      return;
    }

    const fullyWrapped = /^\|\|[\s\S]*\|\|$/.test(trimmed);
    if (fullyWrapped) {
      setMessage(trimmed.replace(/^\|\|/, "").replace(/\|\|$/, "").trim());
      return;
    }

    setMessage(`||${trimmed}|| `);
  };

  const onStandardEmojiSelect = (emoji: { native?: string }) => {
    if (!emoji.native) {
      return;
    }

    appendTokenToNewMessage(emoji.native);
  };

  const appendTokenToDirectMessage = (token: string) => {
    setNewDirectMessage((previous) => {
      const trimmed = previous.trimEnd();
      if (!trimmed) {
        return `${token} `;
      }
      return `${trimmed} ${token} `;
    });
  };

  const onDirectStandardEmojiSelect = (emoji: { native?: string }) => {
    if (!emoji.native) {
      return;
    }

    appendTokenToDirectMessage(emoji.native);
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAuthenticated || !selectedServerId || !selectedChannel || selectedChannel.type !== "text") {
      return;
    }

    const textContent = newMessage.trim();
    if (!textContent && selectedFiles.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const endpoint = `/api/servers/${selectedServerId}/channels/${selectedChannel.id}/messages`;
      if (selectedFiles.length > 0) {
        setServerUploadProgress(0);
      }

      const response =
        selectedFiles.length > 0
          ? await (async () => {
              const formData = new FormData();
              formData.append("userId", userId);
              formData.append("userName", userName);
              formData.append("content", textContent);
              selectedFiles.forEach((file) => formData.append("files", file));
              return postFormDataWithProgress(endpoint, formData, setServerUploadProgress);
            })()
          : await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, userName, content: textContent }),
            });

      const payload = await response.json();
      setBusy(false);

      if (!response.ok) {
        setError(payload.error ?? "Falha ao enviar mensagem.");
        return;
      }

      setNewMessage("");
      setSelectedFiles([]);
      setFileInputKey((value) => value + 1);
      await loadMessages(selectedServerId, selectedChannel.id, userId);
    } catch {
      setBusy(false);
      setError("Falha de conexão ao enviar mensagem.");
    } finally {
      setServerUploadProgress(null);
    }
  };

  const toggleServerMessageReaction = async (messageId: string, emoji: string) => {
    if (!isAuthenticated || !selectedServerId || !selectedChannel || selectedChannel.type !== "text" || !userId) {
      return;
    }

    const message = messages.find((item) => item.id === messageId);
    const hasReacted = message?.reactions?.some(
      (reaction) => reaction.emoji === emoji && reaction.userId.trim().toLowerCase() === userId.trim().toLowerCase(),
    );

    try {
      const endpoint = `/api/servers/${selectedServerId}/channels/${selectedChannel.id}/messages/${messageId}/reactions`;
      const response = await fetch(endpoint, {
        method: hasReacted ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, emoji }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Falha ao reagir à mensagem.");
        return;
      }

      await loadMessages(selectedServerId, selectedChannel.id, userId);
    } catch {
      setError("Falha de conexão ao reagir à mensagem.");
    }
  };

  const toggleDirectMessageReaction = async (messageId: string, emoji: string) => {
    if (!isAuthenticated || !selectedDirectConversationId || !userId) {
      return;
    }

    const message = directMessages.find((item) => item.id === messageId);
    const hasReacted = message?.reactions?.some(
      (reaction) => reaction.emoji === emoji && reaction.userId.trim().toLowerCase() === userId.trim().toLowerCase(),
    );

    try {
      const endpoint = `/api/direct/messages/${messageId}/reactions`;
      const response = await fetch(endpoint, {
        method: hasReacted ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, emoji }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Falha ao reagir à mensagem.");
        return;
      }

      await loadDirectMessages(selectedDirectConversationId, userId);
    } catch {
      setError("Falha de conexão ao reagir à mensagem.");
    }
  };

  const parseMessageSegmentsWithCodeBlocks = (
    text: string,
  ): Array<{ type: "text"; value: string } | { type: "code"; value: string; language: string }> => {
    const detectCodeLanguage = (value: string): string => {
      const trimmed = value.trim();
      if (!trimmed) {
        return "";
      }

      if (/<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<\/\w+>/i.test(trimmed)) {
        return "html";
      }
      if (/\b(select|insert|update|delete|from|where|join|group by|order by)\b/i.test(trimmed)) {
        return "sql";
      }
      if (/\b(def\s+\w+\(|import\s+\w+|from\s+\w+\s+import|print\()/i.test(trimmed)) {
        return "python";
      }
      if (/\b(const|let|var|function|=>|console\.|import\s+|export\s+)\b/i.test(trimmed)) {
        return "javascript";
      }
      return "";
    };

    const looksLikeCodeSnippet = (value: string): boolean => {
      const trimmed = value.trim();
      if (!trimmed) {
        return false;
      }

      const htmlTagCount = (trimmed.match(/<\/?[a-z][^>]*>/gi) ?? []).length;
      if (htmlTagCount >= 3) {
        return true;
      }

      const hasLineBreak = trimmed.includes("\n");
      const codeKeywordCount =
        (trimmed.match(/\b(function|const|let|var|class|import|export|return|if|else|for|while|try|catch|def|SELECT|INSERT|UPDATE|DELETE)\b/gim) ?? []).length;
      const codeSymbolCount = (trimmed.match(/[{};=<>()[\]]/g) ?? []).length;

      if (hasLineBreak && codeSymbolCount >= 8) {
        return true;
      }

      return codeKeywordCount >= 2 && codeSymbolCount >= 6;
    };

    const segments: Array<{ type: "text"; value: string } | { type: "code"; value: string; language: string }> = [];
    const codeBlockRegex = /```([a-z0-9_+-]*)?[ \t]*\n?([\s\S]*?)```/gi;
    let currentIndex = 0;
    let match = codeBlockRegex.exec(text);

    while (match) {
      const [fullMatch, rawLanguage, codeContent] = match;
      const start = match.index;
      const end = start + fullMatch.length;

      if (start > currentIndex) {
        segments.push({ type: "text", value: text.slice(currentIndex, start) });
      }

      segments.push({
        type: "code",
        value: codeContent ?? "",
        language: (rawLanguage ?? "").trim().toLowerCase(),
      });

      currentIndex = end;
      match = codeBlockRegex.exec(text);
    }

    if (currentIndex < text.length) {
      segments.push({ type: "text", value: text.slice(currentIndex) });
    }

    if (segments.length === 0) {
      if (looksLikeCodeSnippet(text)) {
        return [{ type: "code", value: text, language: detectCodeLanguage(text) }];
      }
      return [{ type: "text", value: text }];
    }

    return segments;
  };

  const renderTokenizedMessageText = (
    text: string,
    keyPrefix: string,
    stickersByNameMap: Record<string, ServerSticker>,
    emojisByNameMap: Record<string, ServerEmoji>,
  ): ReactNode[] => {
    const tokenRegex = /(\[sticker:[a-z0-9_-]{2,32}\]|:[a-z0-9_-]{2,32}:|https?:\/\/[^\s]+|\/uploads\/[^\s]+)/gi;
    const parts = text.split(tokenRegex);

    return parts.map((part, index) => {
      const normalizedPart = part.trim().toLowerCase();
      const stickerMatch = normalizedPart.match(/^\[sticker:([a-z0-9_-]{2,32})\]$/i);
      if (stickerMatch) {
        const sticker = stickersByNameMap[stickerMatch[1].toLowerCase()];
        if (sticker) {
          return (
            <img
              key={`${keyPrefix}-sticker-${sticker.id}-${index}`}
              src={sticker.url}
              alt={`figurinha ${sticker.name}`}
              className="inline-block max-h-20 rounded border border-[#1F2023] align-middle"
            />
          );
        }
      }

      const emojiMatch = normalizedPart.match(/^:([a-z0-9_-]{2,32}):$/i);
      if (emojiMatch) {
        const emoji = emojisByNameMap[emojiMatch[1].toLowerCase()];
        if (emoji) {
          return (
            <img
              key={`${keyPrefix}-emoji-${emoji.id}-${index}`}
              src={emoji.url}
              alt={`emoji ${emoji.name}`}
              className="inline-block h-5 w-5 rounded-sm align-text-bottom"
            />
          );
        }
      }

      if (/^(https?:\/\/\S+|\/uploads\/\S+)$/i.test(part)) {
        if (isGifUrl(part)) {
          return null;
        }

        return (
          <a
            key={`${keyPrefix}-link-${part}-${index}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-[#949CF7] underline break-all"
          >
            {part}
          </a>
        );
      }

      // Renderiza spoilers no formato ||texto oculto||
      const spoilerParts = part.split(/(\|\|[\s\S]*?\|\|)/g);
      if (spoilerParts.length > 1) {
        return (
          <span key={`${keyPrefix}-spoiler-wrap-${index}`} className="break-all [overflow-wrap:anywhere]">
            {spoilerParts.map((spoilerPart, spoilerIndex) => {
              const spoilerMatch = spoilerPart.match(/^\|\|([\s\S]*?)\|\|$/);
              if (!spoilerMatch) {
                return (
                  <span key={`${keyPrefix}-spoiler-text-${index}-${spoilerIndex}`}>{spoilerPart}</span>
                );
              }
              return (
                <SpoilerText
                  key={`${keyPrefix}-spoiler-${index}-${spoilerIndex}`}
                  text={spoilerMatch[1]}
                />
              );
            })}
          </span>
        );
      }

      return <span key={`${keyPrefix}-text-${index}`} className="break-all [overflow-wrap:anywhere]">{part}</span>;
    });
  };

  const renderMessageTextWithSafeCodeBlocks = (
    text: string,
    keyPrefix: string,
    stickersByNameMap: Record<string, ServerSticker>,
    emojisByNameMap: Record<string, ServerEmoji>,
  ): ReactNode[] => {
    const segments = parseMessageSegmentsWithCodeBlocks(text);

    return segments.map((segment, segmentIndex) => {
      if (segment.type === "code") {
        return (
          <div
            key={`${keyPrefix}-code-${segmentIndex}`}
            className="my-2 rounded border border-[#1F2023] bg-[#2B2D31] overflow-x-auto"
          >
            {segment.language && (
              <div className="border-b border-[#1F2023] px-2 py-1 text-[11px] uppercase tracking-wide text-[#949BA4]">
                {segment.language}
              </div>
            )}
            <pre className="px-3 py-2 text-xs text-[#F2F3F5] whitespace-pre-wrap break-words">
              <code>{segment.value}</code>
            </pre>
          </div>
        );
      }

      return (
        <span key={`${keyPrefix}-segment-${segmentIndex}`} className="break-all [overflow-wrap:anywhere]">
          {renderTokenizedMessageText(segment.value, `${keyPrefix}-segment-${segmentIndex}`, stickersByNameMap, emojisByNameMap)}
        </span>
      );
    });
  };

  const renderServerMessageText = (text: string) => {
    return renderMessageTextWithSafeCodeBlocks(text, "server", stickerByName, emojiByName);
  };

  const getUrlsFromText = (text: string): string[] => {
    const matches = text.match(/https?:\/\/[^\s]+|\/uploads\/[^\s]+/gi);
    return matches ? Array.from(new Set(matches)) : [];
  };

  const isGifUrl = (url: string): boolean => /\.gif(\?.*)?$/i.test(url);

  const renderServerGifLinksFromText = (text: string) => {
    const gifUrls = getUrlsFromText(text).filter((url) => isGifUrl(url));

    if (gifUrls.length === 0) {
      return null;
    }

    return (
      <div className="mt-2 space-y-2">
        {gifUrls.map((url) => (
          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block w-fit">
            <img
              src={url}
              alt="GIF enviado"
              className="max-h-72 rounded border border-[#1F2023]"
            />
          </a>
        ))}
      </div>
    );
  };

  const getDirectAttachmentEntries = (text: string): Array<{ url: string; name: string; size?: number }> => {
    const lines = text.split("\n");
    const entries: Array<{ url: string; name: string; size?: number }> = [];

    lines.forEach((line) => {
      const metadataMatch = line.match(/^\[file\]\|(.+)\|(\d+)\|(\/uploads\/direct\/\S+)$/i);
      if (metadataMatch) {
        entries.push({
          name: metadataMatch[1].trim(),
          size: Number(metadataMatch[2]),
          url: metadataMatch[3].trim(),
        });
        return;
      }

      const namedMatch = line.match(/^(.+?):\s*(\/uploads\/direct\/\S+)$/i);
      if (namedMatch) {
        entries.push({
          name: namedMatch[1].trim(),
          url: namedMatch[2].trim(),
        });
        return;
      }

      const urlOnlyMatch = line.match(/(\/uploads\/direct\/\S+)/i);
      if (urlOnlyMatch) {
        const fileName = urlOnlyMatch[1].split("/").pop() || "arquivo";
        entries.push({
          name: fileName,
          url: urlOnlyMatch[1].trim(),
        });
      }
    });

    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.url)) {
        return false;
      }
      seen.add(entry.url);
      return true;
    });
  };

  const getDirectMessageTextOnly = (text: string): string =>
    text
      .split("\n")
      .filter((line) => !/\/uploads\/direct\/\S+/i.test(line) && !/^\[file\]\|/i.test(line))
      .join("\n")
      .trim();

  const parseDirectFriendRequestMarker = (text: string): DirectFriendRequestMarker | null => {
    const markerMatch = text.trim().match(/^\[system:friend-request\]\|([^|]+)\|([^|]+)\|([^|]+)\|(pending|accepted|rejected)$/i);
    if (!markerMatch) {
      return null;
    }

    return {
      requestId: markerMatch[1],
      requesterId: markerMatch[2],
      receiverId: markerMatch[3],
      status: markerMatch[4].toLowerCase() as DirectFriendRequestMarker["status"],
    };
  };

  const renderDirectFriendRequestMessage = (marker: DirectFriendRequestMarker) => {
    const isReceiver = marker.receiverId === userId;
    const isRequester = marker.requesterId === userId;

    if (marker.status === "pending") {
      return (
        <div className="mt-1 rounded border border-[#3F4147] bg-[#2B2D31]/80 px-2 py-2 text-xs space-y-2">
          <p className="text-[#DBDEE1]">
            Solicitação de amizade pendente.
          </p>
          {isReceiver && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void respondToDirectFriendRequest(marker.requestId, "accept")}
                className="rounded bg-[#23A559] hover:bg-emerald-500 px-2 py-1 text-[11px] disabled:opacity-60"
              >
                Aceitar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void respondToDirectFriendRequest(marker.requestId, "reject")}
                className="rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-[11px] disabled:opacity-60"
              >
                Rejeitar
              </button>
            </div>
          )}
          {isRequester && <p className="text-[#949BA4]">Aguardando resposta do destinatário.</p>}
        </div>
      );
    }

    return (
      <div className="mt-1 rounded border border-[#3F4147] bg-[#2B2D31]/70 px-2 py-2 text-xs text-[#B5BAC1]">
        {marker.status === "accepted"
          ? "Solicitação de amizade aceita."
          : "Solicitação de amizade rejeitada."}
      </div>
    );
  };

  const getFileExtensionLabel = (fileName: string): string => {
    const parts = fileName.split(".");
    if (parts.length <= 1) {
      return "ARQUIVO";
    }
    return parts[parts.length - 1].toUpperCase();
  };

  const formatUploadLimitMbLabel = (sizeMb: number): string => sizeMb.toFixed(1).replace(/\.0$/, "");

  const getPendingFileKey = (file: File): string => `${file.name}-${file.lastModified}-${file.size}`;

  const splitFilesByUploadLimit = (files: File[]) => {
    const allowedFiles = files.filter((file) => file.size <= channelUploadMaxFileSizeBytes);
    const blockedFiles = files.filter((file) => file.size > channelUploadMaxFileSizeBytes);
    return { allowedFiles, blockedFiles };
  };

  const applyServerFileSelection = (files: File[], append: boolean) => {
    const { allowedFiles, blockedFiles } = splitFilesByUploadLimit(files);

    if (blockedFiles.length > 0) {
      setError(
        `Alguns arquivos excedem o limite de ${formatUploadLimitMbLabel(channelUploadMaxFileSizeMb)}MB por arquivo: ${blockedFiles.map((file) => file.name).join(", ")}`,
      );
    }

    setSelectedFiles((current) => {
      if (!append) {
        return allowedFiles;
      }
      return [...current, ...allowedFiles];
    });
  };

  const applyDirectFileSelection = (files: File[], append: boolean) => {
    const { allowedFiles, blockedFiles } = splitFilesByUploadLimit(files);

    if (blockedFiles.length > 0) {
      setError(
        `Alguns arquivos excedem o limite de ${formatUploadLimitMbLabel(channelUploadMaxFileSizeMb)}MB por arquivo: ${blockedFiles.map((file) => file.name).join(", ")}`,
      );
    }

    setSelectedDirectFiles((current) => {
      if (!append) {
        return allowedFiles;
      }
      return [...current, ...allowedFiles];
    });
  };

  const onServerMessagePaste = (event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const pastedImageFiles = Array.from(event.clipboardData.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (pastedImageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    applyServerFileSelection(pastedImageFiles, true);
  };

  const onDirectMessagePaste = (event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!selectedDirectConversationId) {
      return;
    }

    const pastedImageFiles = Array.from(event.clipboardData.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (pastedImageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    applyDirectFileSelection(pastedImageFiles, true);
  };

  const removeSelectedServerFile = (fileKey: string) => {
    setSelectedFiles((current) => current.filter((file) => getPendingFileKey(file) !== fileKey));
  };

  const removeSelectedDirectFile = (fileKey: string) => {
    setSelectedDirectFiles((current) => current.filter((file) => getPendingFileKey(file) !== fileKey));
  };

  const isPotentiallyDangerousExtension = (fileName: string): boolean => {
    const lowerName = fileName.trim().toLowerCase();
    const extension = lowerName.includes(".") ? lowerName.slice(lowerName.lastIndexOf(".")) : "";
    const dangerousExtensions = new Set([
      ".exe", ".msi", ".msp", ".com", ".bat", ".cmd", ".pif", ".scr", ".cpl",
      ".js", ".jse", ".vbs", ".vbe", ".wsf", ".wsh", ".ps1", ".psm1", ".psd1",
      ".jar", ".apk", ".appx", ".appxbundle", ".msix", ".msixbundle", ".gadget",
      ".sh", ".bash", ".zsh", ".run", ".bin", ".reg",
    ]);

    return dangerousExtensions.has(extension);
  };

  const startFileDownload = (url: string, fileName: string) => {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const onAttachmentDownloadClick = (
    event: MouseEvent<HTMLAnchorElement>,
    attachment: { url: string; name: string },
  ) => {
    const shouldScanWithVirusTotal =
      appMode === "server" &&
      !!selectedServerId &&
      !!serverDetails?.server.virusTotalEnabled &&
      attachment.url.startsWith("/uploads/");

    if (shouldScanWithVirusTotal) {
      event.preventDefault();
      setVirusTotalDownloadPrompt({
        url: attachment.url,
        name: attachment.name,
        status: "loading",
      });

      void (async () => {
        try {
          const response = await fetch(`/api/servers/${selectedServerId}/virus-total/scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              fileUrl: attachment.url,
            }),
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setVirusTotalDownloadPrompt({
              url: attachment.url,
              name: attachment.name,
              status: "error",
              message: payload.error ?? "Falha ao consultar VirusTotal.",
            });
            return;
          }

          if (payload.verdict === "disabled") {
            setVirusTotalDownloadPrompt(null);
            if (isPotentiallyDangerousExtension(attachment.name)) {
              setDangerousDownloadPrompt({ url: attachment.url, name: attachment.name });
              return;
            }
            startFileDownload(attachment.url, attachment.name);
            return;
          }

          setVirusTotalDownloadPrompt({
            url: attachment.url,
            name: attachment.name,
            status: "result",
            verdict: payload.verdict,
            message: payload.message,
            stats: payload.stats,
          });
        } catch {
          setVirusTotalDownloadPrompt({
            url: attachment.url,
            name: attachment.name,
            status: "error",
            message: "Falha ao consultar VirusTotal.",
          });
        }
      })();
      return;
    }

    if (isPotentiallyDangerousExtension(attachment.name)) {
      event.preventDefault();
      setDangerousDownloadPrompt({
        url: attachment.url,
        name: attachment.name,
      });
    }
  };

  const isDirectImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
  const isDirectVideoUrl = (url: string) => /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url);
  const isDirectAudioUrl = (url: string) => /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(url);

  const renderDirectMediaFromText = (text: string) => {
    const urls = getUrlsFromText(text);

    const mediaUrls = urls.filter((url) => isDirectImageUrl(url) || isDirectVideoUrl(url) || isDirectAudioUrl(url));
    if (!mediaUrls.length) {
      return null;
    }

    return (
      <div className="mt-2 space-y-2">
        {mediaUrls.map((url) => {
          if (isDirectImageUrl(url)) {
            return (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <img
                  src={url}
                  alt="Mídia enviada"
                  className="max-h-72 rounded border border-[#1F2023]"
                />
              </a>
            );
          }

          if (isDirectVideoUrl(url)) {
            return (
              <video
                key={url}
                controls
                className="max-h-80 rounded border border-[#1F2023] w-full"
                src={url}
              />
            );
          }

          return (
            <audio
              key={url}
              controls
              className="w-full"
              src={url}
            />
          );
        })}
      </div>
    );
  };

  const renderDirectFileAttachmentsFromText = (text: string) => {
    const nonMediaAttachments = getDirectAttachmentEntries(text)
      .filter((attachment) => !isDirectImageUrl(attachment.url) && !isDirectVideoUrl(attachment.url) && !isDirectAudioUrl(attachment.url));

    if (!nonMediaAttachments.length) {
      return null;
    }

    return (
      <div className="mt-2 space-y-2">
        {nonMediaAttachments.map((attachment) => (
          <a
            key={attachment.url}
            href={attachment.url}
            download={attachment.name}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => onAttachmentDownloadClick(event, attachment)}
            className="block rounded border border-[#1F2023] bg-[#2B2D31] px-2 py-2 hover:bg-[#383A40]"
          >
            <div className="font-medium break-all">{attachment.name}</div>
            <div className="text-xs text-[#949BA4]">
              {getFileExtensionLabel(attachment.name)}
              {typeof attachment.size === "number" && Number.isFinite(attachment.size)
                ? ` · ${formatBytes(attachment.size)}`
                : " · tamanho não informado"}
            </div>
            <div className="text-xs text-[#80848E]">Clique para baixar arquivo</div>
          </a>
        ))}
      </div>
    );
  };

  const renderDirectMessageText = (text: string) => {
    return renderMessageTextWithSafeCodeBlocks(text, "direct", directStickerByName, directEmojiByName);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const startEditingMessage = (message: ChatMessage) => {
    setEditingMessageId(message.id);
    setEditingMessageContent(message.content);
  };

  const cancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingMessageContent("");
  };

  const saveEditedMessage = async (messageId: string) => {
    if (!selectedServerId || !selectedChannel || selectedChannel.type !== "text") {
      return;
    }

    const nextContent = editingMessageContent.trim();
    if (!nextContent) {
      setError("A mensagem editada não pode ficar vazia.");
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(
      `/api/servers/${selectedServerId}/channels/${selectedChannel.id}/messages/${messageId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: userId, content: nextContent }),
      },
    );
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao editar mensagem.");
      return;
    }

    setMessages((current) =>
      current.map((message) => (message.id === messageId ? payload.message as ChatMessage : message)),
    );
    cancelEditingMessage();
  };

  const removeMessage = async (messageId: string) => {
    if (!selectedServerId || !selectedChannel || selectedChannel.type !== "text") {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(
      `/api/servers/${selectedServerId}/channels/${selectedChannel.id}/messages/${messageId}?actorId=${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
      },
    );
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao excluir mensagem.");
      return;
    }

    setMessages((current) => current.filter((message) => message.id !== messageId));
    if (editingMessageId === messageId) {
      cancelEditingMessage();
    }
  };

  const removeAttachment = async (messageId: string, attachmentId: string) => {
    if (!selectedServerId || !selectedChannel || selectedChannel.type !== "text") {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(
      `/api/servers/${selectedServerId}/channels/${selectedChannel.id}/messages/${messageId}/attachments/${attachmentId}?actorId=${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
      },
    );
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao excluir anexo.");
      return;
    }

    setMessages((current) =>
      current.map((message) => (message.id === messageId ? payload.message as ChatMessage : message)),
    );
  };

  const connectToVoiceChannel = useCallback(async (channelId: string) => {
    if (!isAuthenticated || !selectedServerId || !serverDetails) {
      return;
    }
    const requestId = ++voiceConnectRequestIdRef.current;

    const targetServerId = selectedServerId;

    const channel = serverDetails.server.channels.find(
      (item) => item.id === channelId && item.type === "voice",
    );
    if (!channel) {
      setError("Canal de voz de destino não encontrado.");
      return;
    }

    if (!isSecureContextValue) {
      setError("Microfone/câmera exigem HTTPS (ou localhost). Abra por https:// ou use http://localhost.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Navegador sem suporte a captura de mídia neste contexto.");
      return;
    }

    if (activeVoiceChannelId && activeVoiceChannelId !== channel.id) {
      handleVoiceLeave();
    }

    setBusy(true);
    setError(null);

    const response = await fetch("/api/livekit/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId: targetServerId,
        channelId: channel.id,
        userId,
        userName,
        sessionId: voiceSessionId,
      }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao entrar no canal de voz.");
      return;
    }

    if (requestId !== voiceConnectRequestIdRef.current) {
      return;
    }

    setVoiceToken(payload.token);
    setVoiceServerUrl(payload.serverUrl);
    setActiveVoiceServerId(targetServerId);
    setActiveVoiceChannelId(channel.id);
    setActiveVoiceChannelName(channel.name);
    setSelectedChannelId(channel.id);
  }, [activeVoiceChannelId, handleVoiceLeave, isAuthenticated, isSecureContextValue, selectedServerId, serverDetails, userId, userName, voiceSessionId]);

  const handleVoiceRoomDisconnected = useCallback((disconnectedToken: string) => {
    if (voiceTokenRef.current !== disconnectedToken) {
      return;
    }
    handleVoiceLeave();
  }, [handleVoiceLeave]);

  useEffect(() => {
    if (!isAuthenticated || !selectedServerId || !userId) {
      return;
    }

    const checkVoiceActions = async () => {
      const response = await fetch(
        `/api/servers/${selectedServerId}/voice-actions/next?userId=${encodeURIComponent(userId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok || !payload.action) {
        return;
      }

      if (payload.action.type === "kick") {
        if (activeVoiceChannelId) {
          handleVoiceLeave();
          setError(payload.action.reason ? `Você foi expulso da chamada. Motivo: ${payload.action.reason}` : "Você foi expulso da chamada.");
        }
        return;
      }

      if (payload.action.type === "move" && payload.action.targetChannelId) {
        playVoiceMoveSound();
        await connectToVoiceChannel(payload.action.targetChannelId);
        if (payload.action.reason) {
          setError(`Você foi movido de canal. Motivo: ${payload.action.reason}`);
        }
      }
    };

    void checkVoiceActions();
    const timer = window.setInterval(() => {
      void checkVoiceActions();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [activeVoiceChannelId, connectToVoiceChannel, handleVoiceLeave, isAuthenticated, playVoiceMoveSound, selectedServerId, userId]);

  const enterVoice = async () => {
    if (!isAuthenticated || !selectedChannel || selectedChannel.type !== "voice") {
      return;
    }
    await connectToVoiceChannel(selectedChannel.id);
  };

  const selectTextChannel = (channelId: string) => {
    setSelectedChannelId(channelId);
    // Zera o indicador de mensagens novas deste canal
    setChannelUnreadById((currentValue) => {
      if (!currentValue[channelId]) {
        return currentValue;
      }
      const nextValue = {
        ...currentValue,
        [channelId]: 0,
      };
      channelUnreadByIdRef.current = nextValue;
      return nextValue;
    });
  };

  const saveOwnProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAuthenticated || !userId) {
      return;
    }

    const trimmedName = userName.trim();
    if (!trimmedName) {
      setError("Informe um nome válido.");
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        displayName: trimmedName,
        displayNameStyle: {
          color: displayNameColor,
          fontFamily: displayNameFontFamily,
          bold: displayNameBold,
          animation: displayNameAnimation,
          gradientEnabled: displayNameGradientEnabled,
          backgroundColor: displayNameBackgroundColor,
          backgroundOpacity: displayNameBackgroundOpacity,
          showBackground: displayNameShowBackground,
          profileCardGifUrl: displayNameProfileCardGifUrl ?? undefined,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao atualizar nome.");
      return;
    }

    setUserName(payload.user.displayName);
    if (payload.user.displayNameStyle) {
      setDisplayNameColor(payload.user.displayNameStyle.color ?? "#ffffff");
      setDisplayNameFontFamily(payload.user.displayNameStyle.fontFamily ?? "sans");
      setDisplayNameBold(payload.user.displayNameStyle.bold ?? false);
      setDisplayNameAnimation(payload.user.displayNameStyle.animation ?? "none");
      setDisplayNameGradientEnabled(payload.user.displayNameStyle.gradientEnabled ?? false);
      setDisplayNameBackgroundColor(payload.user.displayNameStyle.backgroundColor ?? "#1a1a2e");
      setDisplayNameBackgroundOpacity(payload.user.displayNameStyle.backgroundOpacity ?? 60);
      setDisplayNameShowBackground(payload.user.displayNameStyle.showBackground ?? false);
      setDisplayNameProfileCardGifUrl(payload.user.displayNameStyle.profileCardGifUrl ?? null);
    }
    setJoinWithMicEnabled(payload.user.joinWithMicEnabled ?? true);
    setJoinWithCameraEnabled(payload.user.joinWithCameraEnabled ?? false);
    setNoiseSuppressionEnabled(payload.user.noiseSuppressionEnabled ?? true);
    setChatNotificationSoundEnabled(payload.user.chatNotificationSoundEnabled ?? true);
    setMicGain(payload.user.micGain ?? 100);
  };

  const updateOwnPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAuthenticated || !userId) {
      return;
    }

    const trimmedPassword = newOwnPassword.trim();
    if (trimmedPassword.length < 6) {
      setError("A nova senha deve ter no mínimo 6 caracteres.");
      return;
    }

    if (trimmedPassword !== confirmOwnPassword.trim()) {
      setError("A confirmação da nova senha não confere.");
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        password: trimmedPassword,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao alterar senha.");
      return;
    }

    setNewOwnPassword("");
    setConfirmOwnPassword("");
  };

  const saveVoiceJoinPreferences = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAuthenticated || !userId) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId: userId,
        joinWithMicEnabled,
        joinWithCameraEnabled,
        noiseSuppressionEnabled,
        chatNotificationSoundEnabled,
        micGain,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Falha ao salvar preferências de voz.");
      return;
    }

    setJoinWithMicEnabled(payload.user.joinWithMicEnabled ?? true);
    setJoinWithCameraEnabled(payload.user.joinWithCameraEnabled ?? false);
    setNoiseSuppressionEnabled(payload.user.noiseSuppressionEnabled ?? true);
    setChatNotificationSoundEnabled(payload.user.chatNotificationSoundEnabled ?? true);
    setMicGain(payload.user.micGain ?? 100);
  };

  const selectVoiceChannel = async (channelId: string) => {
    setSelectedChannelId(channelId);
    // Se já está conectado NESSE canal, não faz nada
    if (isVoiceConnected && activeVoiceChannelId === channelId) {
      return;
    }
    // Caso contrário, entra direto no canal de voz (mesmo se não estiver conectado)
    await connectToVoiceChannel(channelId);
  };

  const switchAuthMode = (mode: "login" | "register") => {
    setAuthMode(mode);
    setError(null);
    if (turnstileWidgetId !== null && typeof window !== "undefined" && (window as any).turnstile) {
      (window as any).turnstile.reset(turnstileWidgetId);
    }
    setTurnstileToken(null);
  };

  return (
    <div className="min-h-screen bg-[#313338] text-[#dbdee1]">
      {!isAuthenticated && (
        <div className="mx-auto flex h-screen max-w-5xl items-center">
          <div className="w-full overflow-hidden rounded-md bg-[#313338] shadow-2xl">
            <div className="grid min-h-[560px] grid-cols-1 md:grid-cols-2">
              <section className="flex items-center justify-center bg-[#313338] px-8 py-10 md:px-12">
                <div className="w-full max-w-sm">
                  <div className="mb-6 space-y-1">
                    <p className="text-xs uppercase tracking-[0.2em] text-[#949BA4]">{appName}</p>
                    <h1 className="text-4xl font-semibold text-[#F2F3F5] transition-all duration-300">
                      {authMode === "login" ? "Fazer login" : "Criar conta"}
                    </h1>
                  </div>

                  {error && (
                    <p
                      style={{ opacity: errorOpacity, transition: "opacity 0.3s ease" }}
                      className="mb-4 rounded-md border border-[#F23F42]/30 bg-[#F23F42]/10 px-3 py-2 text-sm"
                    >
                      {error}
                    </p>
                  )}

                  <form onSubmit={handleAuth} className="space-y-3">
                    <div className="grid gap-3">
                      <input
                        className="h-10 w-full rounded-[3px] border-none bg-[#1E1F22] px-3 text-sm outline-none text-[#DBDEE1] placeholder:text-[#87898C]"
                        value={authUsername}
                        onChange={(event) => setAuthUsername(event.target.value)}
                        placeholder={authMode === "login" ? "Usuário" : "Usuário para login"}
                      />

                      <div
                        className={`grid gap-3 overflow-hidden transition-all duration-500 ${
                          authMode === "register" ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
                        }`}
                      >
                        <input
                          className="h-10 w-full rounded-[3px] border-none bg-[#1E1F22] px-3 text-sm outline-none text-[#DBDEE1] placeholder:text-[#87898C]"
                          value={userName}
                          onChange={(event) => setUserName(event.target.value)}
                          placeholder="Nome de exibição"
                        />
                      </div>

                      <input
                        type="password"
                        className="h-10 w-full rounded-[3px] border-none bg-[#1E1F22] px-3 text-sm outline-none text-[#DBDEE1] placeholder:text-[#87898C]"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Senha"
                      />

                      <div
                        className={`overflow-hidden transition-all duration-500 ${
                          authMode === "register" ? "max-h-16 opacity-100" : "max-h-0 opacity-0"
                        }`}
                      >
                        <input
                          type="password"
                          className="h-10 w-full rounded-[3px] border-none bg-[#1E1F22] px-3 text-sm outline-none text-[#DBDEE1] placeholder:text-[#87898C]"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          placeholder="Confirmar senha"
                        />
                      </div>
                    </div>

                    {isTurnstileEnabled && turnstileSiteKey && (
                      <div className="flex justify-center pt-1">
                        <div ref={turnstileContainerRef} />
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={busy}
                      className="mt-1 h-11 w-full rounded-[3px] bg-[#5865F2] px-3 text-sm font-medium text-white transition hover:bg-[#4752C4] disabled:opacity-60"
                    >
                      {authMode === "login" ? "Entrar" : "Cadastrar"}
                    </button>
                  </form>
                </div>
              </section>

              <section className="relative overflow-hidden bg-[#5865F2] text-white">
                <div
                  className={`absolute -bottom-16 h-64 w-64 rounded-full bg-[#5865F2]/40 blur-3xl transition-all duration-700 ${
                    authMode === "login" ? "right-8" : "left-8"
                  }`}
                />
                <div className="relative flex h-full items-center justify-center px-8 py-10 md:px-12">
                  <div
                    className={`w-full max-w-sm text-center transition-all duration-500 ${
                      authMode === "login" ? "translate-x-0 opacity-100" : "translate-x-1 opacity-100"
                    }`}
                  >
                    <h2 className="text-4xl font-semibold">
                      {authMode === "login" ? "Não tem uma conta?" : "Já tem uma conta?"}
                    </h2>
                    <p className="mt-4 text-sm text-white/80">
                      {authMode === "login"
                        ? "Crie sua conta para entrar na comunidade e participar dos canais."
                        : "Entre com suas credenciais para voltar aos seus servidores e conversas."}
                    </p>
                    <button
                      type="button"
                      onClick={() => switchAuthMode(authMode === "login" ? "register" : "login")}
                      className="mt-8 h-11 w-full rounded-[3px] border border-white/30 bg-transparent px-3 text-sm font-medium text-white transition hover:bg-white/10"
                    >
                      {authMode === "login" ? "Cadastre-se" : "Entrar"}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {isAuthenticated && (
      <div className={`relative h-screen overflow-hidden grid grid-cols-[72px_240px_1fr] ${isMembersPanelOpen ? "max-w-[2400px] mx-auto" : ""}`}>
        <aside className="bg-[#1E1F22] pt-3 pb-3 flex flex-col items-center gap-2 min-h-0 overflow-hidden">
          <div className="h-12 w-12 rounded-[24px] bg-[#5865F2] hover:rounded-[16px] transition-all duration-200 flex items-center justify-center font-semibold text-sm cursor-pointer">{appInitials}</div>
          <button
            type="button"
            onClick={() => {
              setAppMode("direct");
              setShowSettingsPanel(false);
            }}
            className={`mx-auto block h-12 w-12 text-xs font-semibold transition-all duration-200 ${
              appMode === "direct"
                ? "bg-[#5865F2] text-white rounded-[16px]"
                : "bg-[#313338] text-[#dcddde] hover:bg-[#5865F2] hover:text-white rounded-[24px] hover:rounded-[16px]"
            }`}
            title="Mensagens diretas"
          >
            <span className="relative inline-flex h-full w-full items-center justify-center">
              DM
              {directUnreadTotal > 0 && (
                <span className="absolute -right-2 -top-1 min-w-5 rounded-full bg-[#F23F42] px-1 text-[10px] leading-5 text-white">
                  {directUnreadTotal > 99 ? "99+" : directUnreadTotal}
                </span>
              )}
            </span>
          </button>
          <div className="h-[2px] w-8 bg-[#3F4147] rounded-full mx-auto" />
          <div
            className="no-scrollbar flex-1 w-full overflow-y-auto space-y-2 px-3"
            onScroll={(event) => {
              const target = event.currentTarget;
              const nearBottom = target.scrollHeight - (target.scrollTop + target.clientHeight) < 80;
              if (nearBottom && hasMoreVisibleServers) {
                loadMoreVisibleServers();
              }
            }}
          >
            {visibleServers.map((server) => (
              <button
                key={server.id}
                title={server.name}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setServerContextMenu({ serverId: server.id, x: event.clientX, y: event.clientY });
                }}
                onClick={() => {
                  setAppMode("server");
                  setSelectedChannelId(null);
                  setChannelUnreadById({});
                  channelUnreadByIdRef.current = {};
                  setSelectedServerId(server.id);
                }}
                className={`mx-auto block h-12 w-12 text-xs font-semibold transition-all duration-200 ${
                  appMode === "server" && selectedServerId === server.id
                    ? "bg-[#5865F2] text-white rounded-[16px]"
                    : "bg-[#313338] text-[#dcddde] hover:bg-[#5865F2] hover:text-white rounded-[24px] hover:rounded-[16px]"
                }`}
              >
                <span className="relative inline-flex h-full w-full items-center justify-center">
                  {server.avatarUrl ? (
                    <img
                      src={server.avatarUrl}
                      alt={server.name}
                      className="h-12 w-12 rounded-[inherit] object-cover"
                    />
                  ) : (
                    server.name.slice(0, 2).toUpperCase()
                  )}
                  {(serverUnreadById[server.id] ?? 0) > 0 && (
                    <span className="absolute -right-2 -top-1 min-w-5 rounded-full bg-[#F23F42] px-1 text-[10px] leading-5 text-white">
                      {(serverUnreadById[server.id] ?? 0) > 99 ? "99+" : (serverUnreadById[server.id] ?? 0)}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {hasMoreVisibleServers && (
              <p className="px-1 text-center text-[10px] text-[#80848E]">Role para carregar mais servidores...</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowCreateServerModal(true)}
            disabled={busy}
            className="h-12 w-12 rounded-[24px] hover:rounded-[16px] bg-[#313338] hover:bg-[#23A559] text-[#23A559] hover:text-white text-2xl transition-all duration-200 disabled:opacity-60 mx-auto flex items-center justify-center"
          >
            +
          </button>
        </aside>

        <aside className="bg-[#2B2D31] flex flex-col min-h-0">
          {appMode === "server" && serverDetails?.server.serverBannerUrl && (
            <div className="h-[120px] w-full overflow-hidden bg-[#1E1F22] shrink-0">
              <img
                src={serverDetails.server.serverBannerUrl}
                alt={`Banner do servidor ${serverDetails.server.name}`}
                className="h-full w-full object-cover"
              />
            </div>
          )}
          <div className="h-12 px-4 flex items-center border-b border-[#1F2023] shadow-sm shrink-0">
            <h2 className="font-semibold text-[15px] text-white truncate">
              {appMode === "direct" ? "Mensagens diretas" : serverDetails?.server.name ?? "Sem servidor"}
            </h2>
          </div>

          {appMode === "server" ? (
          <div
            className="no-scrollbar flex-1 overflow-y-auto pt-3 px-2 space-y-4"
            onScroll={(event) => {
              const target = event.currentTarget;
              const nearBottom = target.scrollHeight - (target.scrollTop + target.clientHeight) < 80;
              if (nearBottom && hasMoreVisibleServerChannels) {
                loadMoreVisibleServerChannels();
              }
            }}
            onContextMenu={(event) => {
              if (!canManageChannels) {
                return;
              }
              event.preventDefault();
              setChannelAreaContextMenu({ x: event.clientX, y: event.clientY });
            }}
          >
            {visibleCategorizedChannelGroups.grouped.map((group) => (
              <div key={group.category.id}>
                <div
                  className="text-[11px] font-bold uppercase tracking-wide text-[#949BA4] mb-1 px-1 flex items-center"
                  onContextMenu={(event) => {
                    if (!canManageChannels) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    setCategoryContextMenu({ categoryId: group.category.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  {group.category.name.toUpperCase()}
                </div>
                <div className="space-y-1">
                  {group.text.map((channel) => (
                    <button
                      key={channel.id}
                      onContextMenu={(event) => {
                        if (!canManageChannels) {
                          return;
                        }
                        event.preventDefault();
                        setChannelContextMenu({ channelId: channel.id, x: event.clientX, y: event.clientY });
                      }}
                      onClick={() => {
                        if (!canCurrentRoleAccessChannel(channel)) {
                          setError("Este canal está bloqueado para o seu cargo.");
                          return;
                        }
                        selectTextChannel(channel.id);
                      }}
                      className={`w-full text-left rounded-[4px] px-2 py-[6px] text-[15px] flex items-center justify-between gap-2 ${
                        selectedChannelId === channel.id ? "bg-[#404249] text-white" : "text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1]"
                      }`}
                    >
                      <span className="truncate"># {channel.name} {!canCurrentRoleAccessChannel(channel) ? "🔒" : ""}</span>
                      {(channelUnreadById[channel.id] ?? 0) > 0 && selectedChannelId !== channel.id && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#5865F2] px-1 text-[10px] font-bold text-white">
                          {(channelUnreadById[channel.id] ?? 0) > 99 ? "99+" : channelUnreadById[channel.id]}
                        </span>
                      )}
                    </button>
                  ))}
                  {group.voice.map((channel) => (
                    <div key={channel.id} className="space-y-1">
                    <button
                      onContextMenu={(event) => {
                        if (!canManageChannels) {
                          return;
                        }
                        event.preventDefault();
                        setChannelContextMenu({ channelId: channel.id, x: event.clientX, y: event.clientY });
                      }}
                      onClick={() => {
                        if (!canCurrentRoleAccessChannel(channel)) {
                          setError("Este canal de voz está bloqueado para o seu cargo.");
                          return;
                        }
                        void selectVoiceChannel(channel.id);
                      }}
                      className={`w-full text-left rounded-[4px] px-2 py-[6px] text-[15px] flex items-center justify-between ${
                        selectedChannelId === channel.id ? "bg-[#404249] text-white" : "text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1]"
                      }`}
                    >
                      <span>🔊 {channel.name} {!canCurrentRoleAccessChannel(channel) ? "🔒" : ""}</span>
                      {activeVoiceChannelId === channel.id && <span className="text-[10px] text-[#23A559] font-semibold">AO VIVO</span>}
                    </button>
                    {(voicePresenceByChannel[channel.id]?.length ?? 0) > 0 && (
                      <div className="ml-5 mt-1 space-y-1">
                        {(voicePresenceByChannel[channel.id] ?? []).map((voiceMember) => {
                          const memberInfo = memberInfoByUserId[voiceMember.userId];
                          const displayName = memberInfo?.name || voiceMember.userName || voiceMember.userId;

                          return (
                            <div key={`${channel.id}-${voiceMember.identity}`} className="flex items-center gap-2 text-xs text-[#949BA4]">
                              {memberInfo?.avatarUrl ? (
                                <img
                                  src={memberInfo.avatarUrl}
                                  alt={displayName}
                                  className="h-5 w-5 rounded-full object-cover"
                                />
                              ) : (
                                <span className="text-[#80848E]">•</span>
                              )}
                              <span className="truncate max-w-[90px]" title={displayName}>{displayName}</span>
                              <span className="shrink-0 flex items-center gap-0.5">
                                <span title={voiceMember.micEnabled ? "Microfone ativo" : "Microfone silenciado"}>
                                  {voiceMember.micEnabled ? "🎤" : "🔇"}
                                </span>
                                <span title={voiceMember.cameraEnabled ? "Câmera ativa" : "Câmera inativa"}>
                                  {voiceMember.cameraEnabled ? "📷" : "🚫"}
                                </span>
                                <span title={(voiceListeningByUserId[voiceMember.userId] ?? true) ? "Escutando" : "Sem áudio da sala"}>
                                  {(voiceListeningByUserId[voiceMember.userId] ?? true) ? "👂" : "🙉"}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {(visibleCategorizedChannelGroups.uncategorizedText.length > 0 || visibleCategorizedChannelGroups.uncategorizedVoice.length > 0) && (
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#949BA4] mb-1 px-1 flex items-center">SEM CATEGORIA</div>
                <div className="space-y-1">
                  {visibleCategorizedChannelGroups.uncategorizedText.map((channel) => (
                    <button
                      key={channel.id}
                      onContextMenu={(event) => {
                        if (!canManageChannels) {
                          return;
                        }
                        event.preventDefault();
                        setChannelContextMenu({ channelId: channel.id, x: event.clientX, y: event.clientY });
                      }}
                      onClick={() => {
                        if (!canCurrentRoleAccessChannel(channel)) {
                          setError("Este canal está bloqueado para o seu cargo.");
                          return;
                        }
                        selectTextChannel(channel.id);
                      }}
                      className={`w-full text-left rounded-[4px] px-2 py-[6px] text-[15px] flex items-center justify-between gap-2 ${
                        selectedChannelId === channel.id ? "bg-[#404249] text-white" : "text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1]"
                      }`}
                    >
                      <span className="truncate"># {channel.name} {!canCurrentRoleAccessChannel(channel) ? "🔒" : ""}</span>
                      {(channelUnreadById[channel.id] ?? 0) > 0 && selectedChannelId !== channel.id && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#5865F2] px-1 text-[10px] font-bold text-white">
                          {(channelUnreadById[channel.id] ?? 0) > 99 ? "99+" : channelUnreadById[channel.id]}
                        </span>
                      )}
                    </button>
                  ))}
                  {visibleCategorizedChannelGroups.uncategorizedVoice.map((channel) => (
                    <div key={channel.id} className="space-y-1">
                    <button
                      onContextMenu={(event) => {
                        if (!canManageChannels) {
                          return;
                        }
                        event.preventDefault();
                        setChannelContextMenu({ channelId: channel.id, x: event.clientX, y: event.clientY });
                      }}
                      onClick={() => {
                        if (!canCurrentRoleAccessChannel(channel)) {
                          setError("Este canal de voz está bloqueado para o seu cargo.");
                          return;
                        }
                        void selectVoiceChannel(channel.id);
                      }}
                      className={`w-full text-left rounded-[4px] px-2 py-[6px] text-[15px] flex items-center justify-between ${
                        selectedChannelId === channel.id ? "bg-[#404249] text-white" : "text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1]"
                      }`}
                    >
                      <span>🔊 {channel.name} {!canCurrentRoleAccessChannel(channel) ? "🔒" : ""}</span>
                      {activeVoiceChannelId === channel.id && <span className="text-[10px] text-[#23A559] font-semibold">AO VIVO</span>}
                    </button>
                    {(voicePresenceByChannel[channel.id]?.length ?? 0) > 0 && (
                      <div className="ml-5 mt-1 space-y-1">
                        {(voicePresenceByChannel[channel.id] ?? []).map((voiceMember) => {
                          const memberInfo = memberInfoByUserId[voiceMember.userId];
                          const displayName = memberInfo?.name || voiceMember.userName || voiceMember.userId;

                          return (
                            <div key={`${channel.id}-${voiceMember.identity}`} className="flex items-center gap-2 text-xs text-[#949BA4]">
                              {memberInfo?.avatarUrl ? (
                                <img
                                  src={memberInfo.avatarUrl}
                                  alt={displayName}
                                  className="h-5 w-5 rounded-full object-cover"
                                />
                              ) : (
                                <span className="text-[#80848E]">•</span>
                              )}
                              <span className="truncate max-w-[90px]" title={displayName}>{displayName}</span>
                              <span className="shrink-0 flex items-center gap-0.5">
                                <span title={voiceMember.micEnabled ? "Microfone ativo" : "Microfone silenciado"}>
                                  {voiceMember.micEnabled ? "🎤" : "🔇"}
                                </span>
                                <span title={voiceMember.cameraEnabled ? "Câmera ativa" : "Câmera inativa"}>
                                  {voiceMember.cameraEnabled ? "📷" : "🚫"}
                                </span>
                                <span title={(voiceListeningByUserId[voiceMember.userId] ?? true) ? "Escutando" : "Sem áudio da sala"}>
                                  {(voiceListeningByUserId[voiceMember.userId] ?? true) ? "👂" : "🙉"}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {totalServerChannelCount === 0 && (
              <p className="text-xs text-[#80848E]">Sem canais. Clique com botão direito para criar.</p>
            )}

            {hasMoreVisibleServerChannels && (
              <p className="text-xs text-[#80848E] text-center py-1">Role para carregar mais canais...</p>
            )}
          </div>
          ) : (
            <div
              className="no-scrollbar flex-1 overflow-y-auto pt-3 px-2 space-y-0.5"
              onScroll={(event) => {
                const target = event.currentTarget;
                const nearBottom = target.scrollHeight - (target.scrollTop + target.clientHeight) < 80;
                if (nearBottom && hasMoreVisibleDirectConversations) {
                  loadMoreVisibleDirectConversations();
                }
              }}
            >
              <form onSubmit={addDirectFriendById} className="rounded-[4px] bg-[#1E1F22] p-2.5 space-y-2 mx-0">
                <p className="text-xs text-[#949BA4]">Adicionar amigo por userId</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newDirectFriendUserId}
                    onChange={(event) => setNewDirectFriendUserId(event.target.value)}
                    placeholder="ID do usuário"
                    className="flex-1 rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                    disabled={busy}
                  />
                  <button
                    type="submit"
                    disabled={busy || !newDirectFriendUserId.trim()}
                    className="rounded bg-[#5865F2] hover:bg-[#5865F2] px-2 py-1 text-xs disabled:opacity-60"
                  >
                    Adicionar
                  </button>
                </div>
              </form>
              <button
                type="button"
                onClick={() => setShowDirectFriendsModal(true)}
                className="w-full rounded border border-[#3F4147] bg-[#383A40]/70 hover:bg-[#404249] px-2 py-1.5 text-xs"
              >
                Ver lista de amigos ({directFriends.length})
              </button>

              {visibleDirectConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setDirectConversationContextMenu({
                      conversationId: conversation.id,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onClick={() => selectDirectConversation(conversation.id)}
                  className={`w-full text-left rounded-[4px] px-2 py-1.5 ${
                    selectedDirectConversationId === conversation.id
                      ? "bg-[#404249] text-white"
                      : "text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {conversation.otherUserAvatarUrl ? (
                      <img
                        src={conversation.otherUserAvatarUrl}
                        alt={conversation.otherUserName}
                        className="h-7 w-7 rounded-full object-cover border border-[#3F4147]"
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-full border border-[#3F4147] bg-[#383A40] flex items-center justify-center text-[10px] text-[#B5BAC1]">
                        DM
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <StyledDisplayName
                        displayName={conversation.otherUserName}
                        style={conversation.otherUserDisplayNameStyle}
                        className="text-sm truncate"
                      />
                      <p className="text-[11px] text-[#949BA4] truncate">
                        {(() => {
                          const marker = parseDirectFriendRequestMarker(conversation.lastMessagePreview ?? "");
                          if (!marker) {
                            return conversation.lastMessagePreview || "Nenhuma mensagem ainda";
                          }

                          if (marker.status === "pending") {
                            return "Solicitação de amizade pendente";
                          }

                          return marker.status === "accepted"
                            ? "Solicitação de amizade aceita"
                            : "Solicitação de amizade rejeitada";
                        })()}
                      </p>
                    </div>
                    {(directUnreadByConversationId[conversation.id] ?? 0) > 0 && (
                      <span className="ml-auto min-w-5 rounded-full bg-[#F23F42] px-1 text-center text-[10px] leading-5 text-white">
                        {(directUnreadByConversationId[conversation.id] ?? 0) > 99
                          ? "99+"
                          : (directUnreadByConversationId[conversation.id] ?? 0)}
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {directConversations.length === 0 && (
                <p className="text-xs text-[#80848E]">Sem conversas diretas. Clique com botão direito em um membro para iniciar.</p>
              )}

              {hasMoreVisibleDirectConversations && (
                <p className="text-xs text-[#80848E] text-center py-1">Role para carregar mais conversas...</p>
              )}
            </div>
          )}

          <div className="pt-3 border-t border-[#1F2023] mt-3 space-y-2">
            <div className="flex items-center gap-2">
              {userAvatarUrl ? (
                <img
                  src={userAvatarUrl}
                  alt={userName}
                  className="h-8 w-8 rounded-full object-cover border border-[#3F4147]"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-[#5865F2] flex items-center justify-center text-[10px] text-white font-semibold">
                  {userName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="display-name-wrapper">
                  <StyledDisplayName
                    displayName={userName}
                    style={userDisplayNameStyle}
                    className="text-sm truncate block"
                  />
                </div>
                <p className="text-[11px] text-[#949BA4] truncate">{userId}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (showSettingsPanel && settingsPanelMode === "all") {
                    setShowSettingsPanel(false);
                    return;
                  }
                  setSettingsPanelMode("all");
                  setShowSettingsPanel(true);
                }}
                className="rounded-[3px] bg-transparent hover:bg-[#404249] px-2 py-1 text-xs text-[#B5BAC1] hover:text-[#DBDEE1]"
              >
                Configurações
              </button>
              <button
                type="button"
                onClick={logout}
                className="rounded-[3px] bg-transparent hover:bg-[#404249] px-2 py-1 text-xs text-[#B5BAC1] hover:text-[#DBDEE1]"
              >
                Sair
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-h-0">
        <main className="flex-1 min-w-0 bg-[#313338] flex flex-col min-h-0 relative">
          {showSettingsPanel && (
            <div className="flex-1 min-h-0 bg-[#313338] px-6 py-4 overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Configurações do servidor e perfil</h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsPanel(false);
                    setSettingsPanelMode("all");
                  }}
                  className="rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-xs"
                >
                  Fechar
                </button>
              </div>

              {settingsPanelMode === "server" && (
                <>
                  {hasSelectedServerDetails && (
                    <form onSubmit={saveServerNotificationSettings} className="space-y-2 rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3">
                      <p className="text-sm font-medium">Notificacoes do servidor</p>
                      <label className="flex items-center gap-2 text-xs text-[#B5BAC1]">
                        <input
                          type="checkbox"
                          checked={serverSettingsNotifySoundEnabled}
                          onChange={(event) => setServerSettingsNotifySoundEnabled(event.target.checked)}
                        />
                        Tocar som ao receber novas mensagens neste servidor
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="w-full rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                      >
                        Salvar notificacoes
                      </button>
                    </form>
                  )}
                  {hasSelectedServerDetails && canManageChannels && (
                    <form onSubmit={saveServerSettings} className="space-y-2 rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3">
                      <p className="text-sm font-medium">Configurações do servidor</p>
                      {isSelectedServerOwner && (
                        <>
                          <label className="text-xs text-[#949BA4]">Nome do servidor</label>
                          <input
                            className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                            value={serverSettingsName}
                            onChange={(event) => setServerSettingsName(event.target.value)}
                            placeholder="Nome do servidor"
                          />
                          <label className="text-xs text-[#949BA4]">Foto do servidor</label>
                          <input
                            key={serverSettingsAvatarInputKey}
                            type="file"
                            accept="image/*"
                            onChange={(event) => setServerSettingsAvatarFile(event.target.files?.[0] ?? null)}
                            className="block w-full text-xs text-[#B5BAC1] file:mr-2 file:rounded file:border-0 file:bg-[#4E5058] file:px-2 file:py-1 file:text-[#DBDEE1]"
                          />
                        </>
                      )}
                      <div className="space-y-1 rounded border border-[#1F2023] bg-[#2B2D31] px-2 py-2 text-xs">
                        {isSelectedServerOwner && (
                          <>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={serverSettingsVirusTotalEnabled}
                                onChange={(event) => setServerSettingsVirusTotalEnabled(event.target.checked)}
                              />
                              Ativar scan de arquivos com VirusTotal antes do download
                            </label>
                            <label className="text-[#949BA4]">Chave da API VirusTotal (do dono)</label>
                            <input
                              type="password"
                              className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                              value={serverSettingsVirusTotalApiKey}
                              onChange={(event) => setServerSettingsVirusTotalApiKey(event.target.value)}
                              placeholder={serverDetails?.server.virusTotalConfigured ? "Chave já configurada (preencha para trocar)" : "Cole sua chave VirusTotal"}
                            />
                            {serverDetails?.server.virusTotalConfigured && (
                              <p className="text-[11px] text-[#80848E]">Chave já cadastrada. Deixe em branco para manter a atual.</p>
                            )}
                          </>
                        )}

                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowModeratorInvites}
                            onChange={(event) => setServerSettingsAllowModeratorInvites(event.target.checked)}
                          />
                          Moderadores podem gerar/excluir links de convite
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowMemberInvites}
                            onChange={(event) => setServerSettingsAllowMemberInvites(event.target.checked)}
                          />
                          Membros podem gerar/excluir links de convite
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowModeratorSoundUpload}
                            onChange={(event) => setServerSettingsAllowModeratorSoundUpload(event.target.checked)}
                          />
                          Moderadores podem enviar áudios
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowMemberSoundUpload}
                            onChange={(event) => setServerSettingsAllowMemberSoundUpload(event.target.checked)}
                          />
                          Membros podem enviar áudios
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowCrossServerSoundShare}
                            onChange={(event) => setServerSettingsAllowCrossServerSoundShare(event.target.checked)}
                          />
                          Permitir que áudios deste servidor apareçam em outros servidores
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowModeratorDeleteSounds}
                            onChange={(event) => setServerSettingsAllowModeratorDeleteSounds(event.target.checked)}
                          />
                          Moderadores podem excluir áudios
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowMemberDeleteSounds}
                            onChange={(event) => setServerSettingsAllowMemberDeleteSounds(event.target.checked)}
                          />
                          Membros podem excluir áudios
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowMemberStickerCreate}
                            onChange={(event) => setServerSettingsAllowMemberStickerCreate(event.target.checked)}
                          />
                          Membros podem criar figurinhas
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowModeratorStickerCreate}
                            onChange={(event) => setServerSettingsAllowModeratorStickerCreate(event.target.checked)}
                          />
                          Moderadores podem criar figurinhas
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowMemberEmojiCreate}
                            onChange={(event) => setServerSettingsAllowMemberEmojiCreate(event.target.checked)}
                          />
                          Membros podem criar emojis
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={serverSettingsAllowModeratorEmojiCreate}
                            onChange={(event) => setServerSettingsAllowModeratorEmojiCreate(event.target.checked)}
                          />
                          Moderadores podem criar emojis
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="submit"
                          disabled={busy || (isSelectedServerOwner && !serverSettingsName.trim())}
                          className="rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                        >
                          Salvar servidor
                        </button>
                        {isSelectedServerOwner ? (
                          <button
                            type="button"
                            onClick={() => void removeServerAvatar()}
                            disabled={busy || !serverDetails?.server.avatarUrl}
                            className="rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                          >
                            Remover foto
                          </button>
                        ) : (
                          <div />
                        )}
                      </div>
                    </form>
                  )}

                  {hasSelectedServerDetails && canManageServerBanner && (
                    <form onSubmit={uploadServerBanner} className="space-y-2 rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3">
                      <p className="text-sm font-medium">Banner do servidor</p>
                      <p className="text-[11px] text-[#80848E]">
                        Tamanho exibido: altura fixa (ajuste automático por corte). Suporta imagem e GIF.
                      </p>
                      <input
                        key={serverSettingsBannerInputKey}
                        type="file"
                        accept="image/*"
                        onChange={(event) => setServerSettingsBannerFile(event.target.files?.[0] ?? null)}
                        className="block w-full text-xs text-[#B5BAC1] file:mr-2 file:rounded file:border-0 file:bg-[#4E5058] file:px-2 file:py-1 file:text-[#DBDEE1]"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="submit"
                          disabled={busy || !serverSettingsBannerFile}
                          className="rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                        >
                          Atualizar banner
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeServerBanner()}
                          disabled={busy || !serverDetails?.server.serverBannerUrl}
                          className="rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                        >
                          Remover banner
                        </button>
                      </div>
                    </form>
                  )}

                  {hasSelectedServerDetails && (
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3 space-y-2">
                        <p className="text-sm font-medium">Figurinhas do servidor</p>
                        {canCreateServerStickers ? (
                          <form onSubmit={createSticker} className="space-y-2">
                            <input
                              className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                              value={newStickerName}
                              onChange={(event) => setNewStickerName(event.target.value)}
                              placeholder="Nome da figurinha (ex: festa)"
                              maxLength={32}
                            />
                            <input
                              key={newStickerInputKey}
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              onChange={(event) => setNewStickerFile(event.target.files?.[0] ?? null)}
                              className="block w-full text-xs text-[#B5BAC1] file:mr-2 file:rounded file:border-0 file:bg-[#4E5058] file:px-2 file:py-1 file:text-[#DBDEE1]"
                            />
                            <button
                              type="submit"
                              disabled={busy || !newStickerFile}
                              className="rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-xs disabled:opacity-60"
                            >
                              Enviar figurinha
                            </button>
                          </form>
                        ) : (
                          <p className="text-xs text-[#80848E]">Seu cargo não pode criar figurinhas neste servidor.</p>
                        )}
                        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                          {(serverDetails?.server.stickers ?? []).map((sticker) => (
                            <div key={sticker.id} className="flex items-center justify-between gap-2 rounded border border-[#1F2023] bg-[#1E1F22] px-2 py-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <img src={sticker.url} alt={sticker.name} className="h-8 w-8 rounded border border-[#1F2023] object-cover" />
                                <div className="min-w-0">
                                  <div className="text-xs font-medium truncate">{sticker.name}</div>
                                  <div className="text-[11px] text-[#80848E] truncate">por {sticker.createdByName}</div>
                                </div>
                              </div>
                              {(sticker.createdById === userId || canModerateUserMessages) && (
                                <button
                                  type="button"
                                  onClick={() => void deleteSticker(sticker)}
                                  disabled={busy}
                                  className="text-xs text-[#FA777C] hover:text-[#FBB4B7] disabled:opacity-60"
                                >
                                  Excluir
                                </button>
                              )}
                            </div>
                          ))}
                          {(serverDetails?.server.stickers ?? []).length === 0 && (
                            <p className="text-xs text-[#80848E]">Nenhuma figurinha cadastrada.</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3 space-y-2">
                        <p className="text-sm font-medium">Emojis do servidor</p>
                        {canCreateServerEmojis ? (
                          <form onSubmit={createEmoji} className="space-y-2">
                            <input
                              className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                              value={newEmojiName}
                              onChange={(event) => setNewEmojiName(event.target.value)}
                              placeholder="Nome do emoji (ex: hype)"
                              maxLength={32}
                            />
                            <input
                              key={newEmojiInputKey}
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              onChange={(event) => setNewEmojiFile(event.target.files?.[0] ?? null)}
                              className="block w-full text-xs text-[#B5BAC1] file:mr-2 file:rounded file:border-0 file:bg-[#4E5058] file:px-2 file:py-1 file:text-[#DBDEE1]"
                            />
                            <button
                              type="submit"
                              disabled={busy || !newEmojiFile}
                              className="rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-xs disabled:opacity-60"
                            >
                              Enviar emoji
                            </button>
                          </form>
                        ) : (
                          <p className="text-xs text-[#80848E]">Seu cargo não pode criar emojis neste servidor.</p>
                        )}
                        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                          {(serverDetails?.server.emojis ?? []).map((emoji) => (
                            <div key={emoji.id} className="flex items-center justify-between gap-2 rounded border border-[#1F2023] bg-[#1E1F22] px-2 py-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <img src={emoji.url} alt={emoji.name} className="h-7 w-7 rounded-sm border border-[#1F2023] object-cover" />
                                <div className="min-w-0">
                                  <div className="text-xs font-medium truncate">{emoji.name}</div>
                                  <div className="text-[11px] text-[#80848E] truncate">por {emoji.createdByName}</div>
                                </div>
                              </div>
                              {(emoji.createdById === userId || canModerateUserMessages) && (
                                <button
                                  type="button"
                                  onClick={() => void deleteEmoji(emoji)}
                                  disabled={busy}
                                  className="text-xs text-[#FA777C] hover:text-[#FBB4B7] disabled:opacity-60"
                                >
                                  Excluir
                                </button>
                              )}
                            </div>
                          ))}
                          {(serverDetails?.server.emojis ?? []).length === 0 && (
                            <p className="text-xs text-[#80848E]">Nenhum emoji cadastrado.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {hasSelectedServerDetails ? (
                  <div className="rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3 space-y-2">
                    <p className="text-sm font-medium">Membros no servidor</p>
                    <input
                      type="text"
                      value={settingsMemberSearchTerm}
                      onChange={(event) => setSettingsMemberSearchTerm(event.target.value)}
                      placeholder="Buscar por nome ou userId"
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                    />
                    <ul
                      className="no-scrollbar max-h-64 overflow-y-auto space-y-1 pr-1 text-sm"
                      onScroll={(event) => {
                        const target = event.currentTarget;
                        const nearBottom = target.scrollHeight - (target.scrollTop + target.clientHeight) < 80;
                        if (nearBottom && hasMoreVisibleSettingsMembers) {
                          loadMoreVisibleSettingsMembers();
                        }
                      }}
                    >
                      {visibleSettingsMembers.map((member) => (
                        <li
                          key={member.userId}
                          title={`Membro desde: ${formatMemberSince(member.createdAt)}`}
                          onContextMenu={(event) => {
                            if (member.userId.trim().toLowerCase() === userId.trim().toLowerCase()) {
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            setMemberContextMenu({
                              targetUserId: member.userId,
                              targetUserName: member.userName || "Usuário",
                              targetRole: member.role,
                              targetPermissions: member.permissions ?? undefined,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          className="rounded-[4px] px-2 py-1.5 text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1] cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {member.avatarUrl ? (
                              <img
                                src={member.avatarUrl}
                                alt={member.userName || "Usuário"}
                                className="h-5 w-5 rounded-full object-cover border border-[#3F4147]"
                              />
                            ) : (
                              <div className="h-5 w-5 rounded-full border border-[#3F4147] bg-[#2B2D31] flex items-center justify-center text-[9px] text-[#B5BAC1]">
                                {(member.userName || "U").slice(0, 1).toUpperCase()}
                              </div>
                            )}
                            <span className="truncate">
                              {selectedServer && member.userId === selectedServer.ownerId && "👑 "}
                              {member.userName || "Usuário"} ({member.role})
                            </span>
                          </div>
                        </li>
                      ))}
                      {hasMoreVisibleSettingsMembers && (
                        <li className="text-center text-xs text-[#80848E]">Role para carregar mais membros...</li>
                      )}
                    </ul>
                  </div>
                  ) : (
                    <div className="rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3">
                      <p className="text-sm text-[#949BA4]">Você não tem acesso às configurações deste servidor.</p>
                    </div>
                  )}

                  {!isSelectedServerOwner && !!selectedServerId && (
                    <div className="rounded border border-red-900 bg-red-950/40 p-3 space-y-2">
                      <p className="text-sm font-medium text-[#FA777C]">Sair do servidor</p>
                      <p className="text-xs text-red-200">
                        Você deixará de ver canais, mensagens e chamadas deste servidor até entrar novamente por convite.
                      </p>
                      <button
                        type="button"
                        onClick={() => void leaveCurrentServer()}
                        disabled={busy}
                        className="rounded bg-red-700 hover:bg-[#F23F42] px-3 py-1.5 text-sm text-white disabled:opacity-60"
                      >
                        Sair do servidor
                      </button>
                    </div>
                  )}

                  {canManageBansForSelectedServer && (
                    <div className="rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3 space-y-2">
                      <p className="text-sm font-medium">Usuários banidos</p>
                      <ul className="space-y-1 text-sm">
                        {serverBans.map((ban) => (
                          <li
                            key={ban.id}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setBannedUserContextMenu({
                                banId: ban.id,
                                userName: ban.userName || ban.userId,
                                x: event.clientX,
                                y: event.clientY,
                              });
                            }}
                            className="rounded-[4px] px-2 py-1.5 text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1] cursor-pointer"
                          >
                            {ban.userName} ({ban.userId})
                          </li>
                        ))}
                        {serverBans.length === 0 && (
                          <li className="text-xs text-[#80848E]">Nenhum usuário banido.</li>
                        )}
                      </ul>
                      <p className="text-[11px] text-[#80848E]">Clique com botão direito em um banido para remover o ban.</p>
                    </div>
                  )}

                  {canManageInvites && (
                  <div className="rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">Links de convite</p>
                      <button
                        type="button"
                        onClick={() => void createInviteLink()}
                        disabled={busy || serverInvites.length >= 10}
                        className="rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-xs disabled:opacity-60"
                      >
                        Gerar link
                      </button>
                    </div>
                    <p className="text-xs text-[#949BA4]">
                      {serverInvites.length}/10 links ativos. Somente usuários com cadastro válido entram com convite.
                    </p>
                    {serverInvites.length === 0 && (
                      <p className="text-xs text-[#80848E]">Nenhum link criado.</p>
                    )}
                    <div className="space-y-2">
                      {serverInvites.map((invite) => {
                        const inviteUrl = typeof window !== "undefined"
                          ? `${window.location.origin}/?invite=${encodeURIComponent(invite.code)}`
                          : `/?invite=${encodeURIComponent(invite.code)}`;

                        return (
                          <div key={invite.id} className="rounded border border-[#1F2023] bg-[#2B2D31] px-2 py-2 text-xs space-y-1">
                            <div className="break-all text-[#B5BAC1]">{inviteUrl}</div>
                            <div className="flex items-center justify-between text-[#80848E]">
                              <span>{new Date(invite.createdAt).toLocaleString()}</span>
                              <button
                                type="button"
                                onClick={() => void deleteInviteLink(invite.id)}
                                disabled={busy}
                                className="text-[#FA777C] hover:text-[#FBB4B7] disabled:opacity-60"
                              >
                                Excluir link
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  )}

                  {canManageChannels && (
                    <div className="rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3 space-y-2">
                      <p className="text-sm font-medium">Logs de auditoria</p>
                      <p className="text-xs text-[#949BA4]">Histórico de ações de administração e moderação no servidor</p>
                      {auditLogsError && (
                        <p className="text-xs text-[#FA777C]">{auditLogsError}</p>
                      )}
                      
                      {serverAuditLogs.length > 0 && (
                        <div className="space-y-2">
                          <input
                            type="text"
                            placeholder="Buscar por nome de usuário ou ação..."
                            value={auditLogSearchQuery}
                            onChange={(event) => {
                              setAuditLogSearchQuery(event.target.value);
                              setAuditLogCurrentPage(1);
                            }}
                            className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                          />
                          <div className="grid grid-cols-3 gap-2">
                            <input
                              type="date"
                              value={auditLogFilterDate}
                              onChange={(event) => {
                                setAuditLogFilterDate(event.target.value);
                                setAuditLogCurrentPage(1);
                              }}
                              className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                            />
                            <input
                              type="time"
                              placeholder="De"
                              value={auditLogFilterTimeStart}
                              onChange={(event) => {
                                setAuditLogFilterTimeStart(event.target.value);
                                setAuditLogCurrentPage(1);
                              }}
                              className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                            />
                            <input
                              type="time"
                              placeholder="Até"
                              value={auditLogFilterTimeEnd}
                              onChange={(event) => {
                                setAuditLogFilterTimeEnd(event.target.value);
                                setAuditLogCurrentPage(1);
                              }}
                              className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                            />
                          </div>
                        </div>
                      )}

                      {serverAuditLogs.length > 0 ? (
                        (() => {
                          const ITEMS_PER_PAGE = 10;
                          
                          const filteredLogs = serverAuditLogs.filter((log) => {
                            // Filtro de texto
                            if (auditLogSearchQuery.trim()) {
                              const query = auditLogSearchQuery.toLowerCase();
                              const actorMatch = log.actorName.toLowerCase().includes(query);
                              const targetMatch = log.targetName?.toLowerCase().includes(query);
                              const actionMatch = log.action.toLowerCase().includes(query);
                              const detailsMatch = log.details?.toLowerCase().includes(query);
                              if (!actorMatch && !targetMatch && !actionMatch && !detailsMatch) {
                                return false;
                              }
                            }

                            // Filtro de data
                            if (auditLogFilterDate) {
                              const logDate = new Date(log.createdAt).toISOString().split('T')[0];
                              if (logDate !== auditLogFilterDate) {
                                return false;
                              }
                            }

                            // Filtro de range de hora (se data estiver selecionada)
                            if ((auditLogFilterTimeStart || auditLogFilterTimeEnd) && auditLogFilterDate) {
                              const logTime = new Date(log.createdAt).toTimeString().split(' ')[0];
                              if (auditLogFilterTimeStart && logTime < auditLogFilterTimeStart) {
                                return false;
                              }
                              if (auditLogFilterTimeEnd && logTime > auditLogFilterTimeEnd) {
                                return false;
                              }
                            }

                            return true;
                          });

                          const totalPages = Math.ceil(filteredLogs.length / ITEMS_PER_PAGE);
                          const currentPage = Math.min(auditLogCurrentPage, totalPages || 1);
                          const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
                          const endIndex = startIndex + ITEMS_PER_PAGE;
                          const paginatedLogs = filteredLogs.slice(startIndex, endIndex);

                          return (
                            <>
                              {paginatedLogs.length > 0 ? (
                                <>
                                  <div className="space-y-1">
                                    {paginatedLogs.map((log) => {
                                      const actionText = {
                                        member_kicked: "expulsou",
                                        member_banned: "baniu",
                                        member_unbanned: "desbaniu",
                                        member_role_updated: "atualizou cargo de",
                                        member_permissions_updated: "atualizou permissões de",
                                        member_voice_kicked: "expulsou do canal de voz",
                                        member_voice_moved: "moveu de canal de voz",
                                        member_voice_timeout: "silenciou no voz",
                                        channel_created: "criou canal",
                                        channel_updated: "editou canal",
                                        channel_deleted: "excluiu canal",
                                        category_created: "criou categoria",
                                        category_updated: "editou categoria",
                                        category_deleted: "excluiu categoria",
                                        message_deleted: "excluiu mensagem de",
                                        invite_created: "criou convite",
                                        invite_deleted: "excluiu convite",
                                        server_updated: "atualizou o servidor",
                                      }[log.action] || "realizou ação";

                                      return (
                                        <div key={log.id} className="text-xs rounded bg-[#383A40] px-2 py-1.5 text-[#B5BAC1]">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="flex-1 min-w-0">
                                              <strong className="text-[#DBDEE1]">{log.actorName}</strong> {actionText}
                                              {log.targetName && <strong className="text-[#DBDEE1]"> {log.targetName}</strong>}
                                            </span>
                                            <span className="text-[#80848E] whitespace-nowrap text-[10px]">
                                              {new Date(log.createdAt).toLocaleString('pt-BR', { 
                                                day: '2-digit', 
                                                month: '2-digit', 
                                                hour: '2-digit', 
                                                minute: '2-digit' 
                                              })}
                                            </span>
                                          </div>
                                          {log.details && (
                                            <div className="mt-1 text-[#949BA4]">{log.details}</div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  
                                  {totalPages > 1 && (
                                    <div className="flex items-center justify-between text-xs pt-1">
                                      <span className="text-[#949BA4]">
                                        Página {currentPage} de {totalPages} ({filteredLogs.length} {filteredLogs.length === 1 ? 'registro' : 'registros'})
                                      </span>
                                      <div className="flex gap-1">
                                        <button
                                          type="button"
                                          onClick={() => setAuditLogCurrentPage(Math.max(1, currentPage - 1))}
                                          disabled={currentPage === 1}
                                          className="rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                          ← Anterior
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setAuditLogCurrentPage(Math.min(totalPages, currentPage + 1))}
                                          disabled={currentPage === totalPages}
                                          className="rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                          Próxima →
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <p className="text-xs text-[#80848E]">Nenhum resultado encontrado para &quot;{auditLogSearchQuery}&quot;.</p>
                              )}
                            </>
                          );
                        })()
                      ) : (
                        <p className="text-xs text-[#80848E]">Nenhuma ação registrada ainda.</p>
                      )}
                    </div>
                  )}

                  {isSelectedServerOwner && selectedServerId && (
                    <div className="rounded border border-red-900 bg-red-950/40 p-3 space-y-2">
                      <p className="text-sm font-medium text-[#FA777C]">Zona de perigo</p>
                      <p className="text-xs text-red-200">
                        Excluir este servidor é uma ação permanente e você não poderá desfazer.
                        Todos os canais, mensagens, membros, anexos e configurações deste servidor serão apagados.
                      </p>
                      <button
                        type="button"
                        onClick={() => void deleteServerById(selectedServerId)}
                        disabled={busy}
                        className="rounded bg-red-700 hover:bg-[#F23F42] px-3 py-1.5 text-sm text-white disabled:opacity-60"
                      >
                        Excluir servidor permanentemente
                      </button>
                    </div>
                  )}
                </>
              )}

              {settingsPanelMode === "all" && (
                <>
                  <form onSubmit={saveOwnProfile} className="space-y-3 rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3">
                    <p className="text-sm font-medium">Perfil</p>
                    <div>
                      <label className="text-xs text-[#949BA4]">Nome de exibição</label>
                      <input
                        className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                        value={userName}
                        onChange={(event) => setUserName(event.target.value)}
                        placeholder="Seu nome"
                      />
                      <p className="text-[11px] text-[#80848E] mt-1">Pré-visualização (passa o mouse):</p>
                      <div className="display-name-wrapper mt-1 rounded bg-[#383A40] px-2 py-1 text-sm inline-block">
                        <StyledDisplayName
                          displayName={userName || "Seu nome"}
                          style={{
                            color: displayNameGradientEnabled ? undefined : displayNameColor,
                            fontFamily: displayNameFontFamily,
                            bold: displayNameBold,
                            animation: displayNameAnimation,
                            gradientEnabled: displayNameGradientEnabled,
                            backgroundColor: displayNameBackgroundColor,
                            backgroundOpacity: displayNameBackgroundOpacity,
                            showBackground: displayNameShowBackground,
                          }}
                        />
                      </div>
                    </div>

                    <div className="border-t border-[#3F4147] pt-3">
                      <p className="text-xs text-[#949BA4] mb-2">Personalização do nome</p>
                      
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-xs text-[#B5BAC1]">
                          <input
                            type="checkbox"
                            checked={displayNameGradientEnabled}
                            onChange={(event) => setDisplayNameGradientEnabled(event.target.checked)}
                          />
                          🌈 Gradiente Arco-Íris (anima ao passar o mouse)
                        </label>

                        {!displayNameGradientEnabled && (
                          <div>
                            <label className="text-xs text-[#949BA4]">Cor</label>
                            <div className="flex gap-2">
                              <input
                                type="color"
                                value={displayNameColor}
                                onChange={(event) => setDisplayNameColor(event.target.value)}
                                className="w-10 h-8 rounded border border-[#3F4147] cursor-pointer"
                              />
                              <input
                                type="text"
                                value={displayNameColor}
                                onChange={(event) => setDisplayNameColor(event.target.value)}
                                className="flex-1 rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                                placeholder="#ffffff"
                              />
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="text-xs text-[#949BA4]">Fonte</label>
                          <select
                            value={displayNameFontFamily}
                            onChange={(event) => setDisplayNameFontFamily(event.target.value)}
                            className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                          >
                            <option value="sans">Padrão (Sans)</option>
                            <option value="serif">Serifa</option>
                            <option value="mono">Monoespaciada</option>
                            <option value="cursive">Cursiva</option>
                          </select>
                        </div>

                        <label className="flex items-center gap-2 text-xs text-[#B5BAC1]">
                          <input
                            type="checkbox"
                            checked={displayNameBold}
                            onChange={(event) => setDisplayNameBold(event.target.checked)}
                          />
                          Negrito
                        </label>

                        <div>
                          <label className="text-xs text-[#949BA4]">Animação (ativa ao passar o mouse)</label>
                          <select
                            value={displayNameAnimation}
                            onChange={(event) => setDisplayNameAnimation(event.target.value)}
                            className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                          >
                            <option value="none">Nenhuma</option>
                            <option value="pulse">Pulso</option>
                            <option value="glow">Brilho</option>
                            <option value="rainbow">Arco-íris</option>
                          </select>
                        </div>

                        <label className="flex items-center gap-2 text-xs text-[#B5BAC1]">
                          <input
                            type="checkbox"
                            checked={displayNameShowBackground}
                            onChange={(event) => setDisplayNameShowBackground(event.target.checked)}
                          />
                          Fundo destacado
                        </label>

                        {displayNameShowBackground && (
                          <div className="space-y-2 pl-5 border-l border-[#3F4147]">
                            <div>
                              <label className="text-xs text-[#949BA4]">Cor do fundo</label>
                              <div className="flex gap-2">
                                <input
                                  type="color"
                                  value={displayNameBackgroundColor}
                                  onChange={(event) => setDisplayNameBackgroundColor(event.target.value)}
                                  className="w-10 h-8 rounded border border-[#3F4147] cursor-pointer"
                                />
                                <input
                                  type="text"
                                  value={displayNameBackgroundColor}
                                  onChange={(event) => setDisplayNameBackgroundColor(event.target.value)}
                                  className="flex-1 rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-xs"
                                  placeholder="#1a1a2e"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-[#949BA4]">Opacidade: {displayNameBackgroundOpacity}%</label>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={displayNameBackgroundOpacity}
                                onChange={(event) => setDisplayNameBackgroundOpacity(Number(event.target.value))}
                                className="w-full rounded"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={busy || !userName.trim()}
                      className="w-full rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                    >
                      Salvar personalização
                    </button>
                  </form>

                  <form onSubmit={uploadAvatar} className="space-y-2 rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3">
                    <p className="text-sm font-medium">Foto de perfil</p>
                    <label className="text-xs text-[#949BA4]">Imagem ou GIF</label>
                    <input
                      key={avatarInputKey}
                      type="file"
                      accept="image/*"
                      onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)}
                      className="block w-full text-xs text-[#B5BAC1] file:mr-2 file:rounded file:border-0 file:bg-[#4E5058] file:px-2 file:py-1 file:text-[#DBDEE1]"
                    />
                    <button
                      type="submit"
                      disabled={busy || !avatarFile}
                      className="w-full rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                    >
                      Atualizar foto
                    </button>
                  </form>

                  <form onSubmit={uploadProfileCardGif} className="space-y-2 rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3">
                    <p className="text-sm font-medium">GIF do card na DM</p>
                    <p className="text-[11px] text-[#80848E]">
                      O GIF fica atrás do card no painel lateral da DM e só toca ao passar o mouse.
                      Tamanho padrão: 320x96 (arquivos fora do padrão serão ajustados automaticamente).
                    </p>
                    <label className="text-xs text-[#949BA4]">Arquivo GIF (.gif)</label>
                    <input
                      key={profileCardGifInputKey}
                      type="file"
                      accept="image/gif"
                      onChange={(event) => setProfileCardGifFile(event.target.files?.[0] ?? null)}
                      className="block w-full text-xs text-[#B5BAC1] file:mr-2 file:rounded file:border-0 file:bg-[#4E5058] file:px-2 file:py-1 file:text-[#DBDEE1]"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={busy || !profileCardGifFile}
                        className="flex-1 rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                      >
                        Atualizar GIF do card
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeProfileCardGif()}
                        disabled={busy || !displayNameProfileCardGifUrl}
                        className="rounded border border-[#3F4147] bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                      >
                        Remover
                      </button>
                    </div>
                  </form>

                  <form onSubmit={updateOwnPassword} className="space-y-2 rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3">
                    <p className="text-sm font-medium">Segurança</p>
                    <label className="text-xs text-[#949BA4]">Nova senha</label>
                    <input
                      type="password"
                      value={newOwnPassword}
                      onChange={(event) => setNewOwnPassword(event.target.value)}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                      placeholder="Digite a nova senha"
                    />
                    <label className="text-xs text-[#949BA4]">Confirmar nova senha</label>
                    <input
                      type="password"
                      value={confirmOwnPassword}
                      onChange={(event) => setConfirmOwnPassword(event.target.value)}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                      placeholder="Repita a nova senha"
                    />
                    <button
                      type="submit"
                      disabled={busy || !newOwnPassword.trim() || !confirmOwnPassword.trim()}
                      className="w-full rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                    >
                      Alterar senha
                    </button>
                    <p className="text-[11px] text-[#80848E]">A alteração não exige senha atual.</p>
                  </form>

                  <form onSubmit={saveVoiceJoinPreferences} className="space-y-2 rounded border border-[#1F2023] bg-[#2B2D31]/60 p-3">
                    <p className="text-sm font-medium">Preferências</p>
                    <label className="flex items-center gap-2 text-xs text-[#B5BAC1]">
                      <input
                        type="checkbox"
                        checked={joinWithMicEnabled}
                        onChange={(event) => setJoinWithMicEnabled(event.target.checked)}
                      />
                      Entrar com microfone ligado
                    </label>
                    <label className="flex items-center gap-2 text-xs text-[#B5BAC1]">
                      <input
                        type="checkbox"
                        checked={joinWithCameraEnabled}
                        onChange={(event) => setJoinWithCameraEnabled(event.target.checked)}
                      />
                      Entrar com câmera ligada
                    </label>
                    <label className="flex items-center gap-2 text-xs text-[#B5BAC1]">
                      <input
                        type="checkbox"
                        checked={noiseSuppressionEnabled}
                        onChange={(event) => setNoiseSuppressionEnabled(event.target.checked)}
                      />
                      Ativar antirruído no microfone
                    </label>
                    {noiseSuppressionEnabled && (
                      <div className="rounded border border-[#1F2023] bg-[#1E1F22]/60 p-2">
                        <p className="text-[11px] text-[#949BA4] mb-1">Qualidade do antirruído:</p>
                        <div className="space-y-1">
                          <label className="flex items-center gap-2 text-xs text-[#B5BAC1]">
                            <input
                              type="radio"
                              name="noiseMode"
                              checked={noiseSuppressionMode === "rnnoise"}
                              onChange={() => setNoiseSuppressionMode("rnnoise")}
                            />
                            <span>RNNoise (rápido, leve)</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[#B5BAC1]">
                            <input
                              type="radio"
                              name="noiseMode"
                              checked={noiseSuppressionMode === "deepfilter"}
                              onChange={() => setNoiseSuppressionMode("deepfilter")}
                            />
                            <span>DeepFilterNet2 (máxima qualidade, pesado)</span>
                          </label>
                        </div>
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-xs text-[#B5BAC1]">
                      <input
                        type="checkbox"
                        checked={chatNotificationSoundEnabled}
                        onChange={(event) => setChatNotificationSoundEnabled(event.target.checked)}
                      />
                      Tocar som em novas mensagens diretas (DM)
                    </label>
                    <div className="rounded border border-[#1F2023] bg-[#1E1F22]/60 p-2 space-y-2">
                      <div>
                        <p className="text-[11px] text-[#949BA4] mb-1">
                          Ganho do microfone: <span className="text-[#F2F3F5] font-medium">{micGain}%</span>
                        </p>
                        <input
                          type="range"
                          min="0"
                          max="300"
                          value={micGain}
                          onChange={(event) => setMicGain(Number(event.target.value))}
                          className="w-full accent-emerald-500"
                        />
                        <p className="text-[10px] text-[#80848E]">100% = normal. Aumente se os outros ouvirem baixo.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMicLevelMeterActive((value) => !value)}
                        className="w-full rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-xs"
                      >
                        {micLevelMeterActive ? "Parar de medir" : "Medir nível do microfone"}
                      </button>
                      <MicLevelMeter active={micLevelMeterActive} />
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-sm disabled:opacity-60"
                    >
                      Salvar preferências
                    </button>
                  </form>

                  <div className="space-y-2 rounded border border-red-900 bg-red-950/40 p-3">
                    <p className="text-sm font-medium text-[#FA777C]">Conta do usuário</p>
                    <p className="text-xs text-red-200">
                      Excluir conta remove dados de perfil e acesso de login. Histórico em servidores e DMs é preservado.
                    </p>
                    <button
                      type="button"
                      onClick={() => void deleteOwnAccount()}
                      disabled={busy}
                      className="w-full rounded bg-red-700 hover:bg-[#F23F42] px-2 py-1 text-sm text-white disabled:opacity-60"
                    >
                      Excluir minha conta
                    </button>
                  </div>
                </>
              )}

              {settingsPanelMode === "all" && canManageChannels && (
                <form onSubmit={createChannel} className="space-y-2">
                  <label className="text-xs text-[#949BA4]">Novo canal</label>
                  <input
                    className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                    value={newChannelName}
                    onChange={(event) => setNewChannelName(event.target.value)}
                    placeholder="Nome do canal"
                  />
                  <select
                    value={newChannelType}
                    onChange={(event) => setNewChannelType(event.target.value as ChannelType)}
                    className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                  >
                    <option value="text">Texto</option>
                    <option value="voice">Voz</option>
                  </select>
                  <button type="submit" disabled={busy} className="w-full rounded bg-[#404249] px-2 py-1 text-sm">
                    Criar canal
                  </button>
                </form>
              )}

              {settingsPanelMode === "all" && isSelectedServerOwner && (
                <>
                  <form onSubmit={saveMember} className="space-y-2">
                    <label className="text-xs text-[#949BA4]">Membro / função</label>
                    <input
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                      value={newMemberId}
                      onChange={(event) => setNewMemberId(event.target.value)}
                      placeholder="ID do usuário"
                    />
                    <select
                      value={newMemberRole}
                      onChange={(event) => setNewMemberRole(event.target.value as Role)}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                    >
                      <option value="member">member</option>
                      <option value="moderator">moderator</option>
                      <option value="admin">admin</option>
                    </select>
                    {newMemberRole === "moderator" && (
                      <div className="space-y-1 rounded border border-[#1F2023] bg-[#2B2D31] px-2 py-2 text-xs">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={newModeratorPermissions.canRemoveMembers}
                            onChange={(event) =>
                              setNewModeratorPermissions((current) => ({
                                ...current,
                                canRemoveMembers: event.target.checked,
                              }))
                            }
                          />
                          Pode remover usuários
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={newModeratorPermissions.canBanUsers}
                            onChange={(event) =>
                              setNewModeratorPermissions((current) => ({
                                ...current,
                                canBanUsers: event.target.checked,
                              }))
                            }
                          />
                          Pode banir usuários
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={newModeratorPermissions.canTimeoutVoice}
                            onChange={(event) =>
                              setNewModeratorPermissions((current) => ({
                                ...current,
                                canTimeoutVoice: event.target.checked,
                              }))
                            }
                          />
                          Pode expulsar da chamada por tempo
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={newModeratorPermissions.canDeleteUserMessages}
                            onChange={(event) =>
                              setNewModeratorPermissions((current) => ({
                                ...current,
                                canDeleteUserMessages: event.target.checked,
                              }))
                            }
                          />
                          Pode apagar mensagens ao remover
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={newModeratorPermissions.canKickFromVoice}
                            onChange={(event) =>
                              setNewModeratorPermissions((current) => ({
                                ...current,
                                canKickFromVoice: event.target.checked,
                              }))
                            }
                          />
                          Pode expulsar da chamada
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={newModeratorPermissions.canMoveVoiceUsers}
                            onChange={(event) =>
                              setNewModeratorPermissions((current) => ({
                                ...current,
                                canMoveVoiceUsers: event.target.checked,
                              }))
                            }
                          />
                          Pode mover entre canais de voz
                        </label>
                      </div>
                    )}
                    <button type="submit" disabled={busy} className="w-full rounded bg-[#404249] px-2 py-1 text-sm">
                      Salvar membro
                    </button>
                  </form>

                  <form onSubmit={runModerationAction} className="space-y-2">
                    <label className="text-xs text-[#949BA4]">Moderação</label>
                    <input
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                      value={moderationTargetId}
                      onChange={(event) => setModerationTargetId(event.target.value)}
                      placeholder="ID do usuário alvo"
                    />
                    <select
                      value={moderationAction}
                      onChange={(event) => setModerationAction(event.target.value as "remove-user" | "ban-user" | "voice-timeout" | "voice-kick" | "voice-move")}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                    >
                      <option value="ban-user">Banir do servidor</option>
                      <option value="remove-user">Remover do servidor</option>
                      <option value="voice-timeout">Ban temporário de voz</option>
                      <option value="voice-kick">Expulsar da chamada de voz</option>
                      <option value="voice-move">Mover para outro canal de voz</option>
                    </select>
                    {moderationAction === "voice-timeout" && (
                      <input
                        type="number"
                        min={1}
                        max={4320}
                        value={moderationDurationMinutes}
                        onChange={(event) => setModerationDurationMinutes(Number(event.target.value || 1))}
                        className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                        placeholder="Minutos"
                      />
                    )}
                    {moderationAction === "voice-move" && (
                      <select
                        value={moderationTargetChannelId}
                        onChange={(event) => setModerationTargetChannelId(event.target.value)}
                        className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                      >
                        <option value="">Selecione o canal de voz destino</option>
                        {serverDetails?.server.channels
                          .filter((channel) => channel.type === "voice")
                          .map((channel) => (
                            <option key={channel.id} value={channel.id}>
                              {channel.name}
                            </option>
                          ))}
                      </select>
                    )}
                    {moderationAction === "remove-user" && (
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={moderationRemoveMessages}
                          onChange={(event) => setModerationRemoveMessages(event.target.checked)}
                        />
                        Remover mensagens do usuário também
                      </label>
                    )}
                    <textarea
                      value={moderationReason}
                      onChange={(event) => setModerationReason(event.target.value)}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                      rows={2}
                      placeholder="Motivo da ação"
                    />
                    <button type="submit" disabled={busy} className="w-full rounded bg-[#404249] px-2 py-1 text-sm">
                      Executar ação
                    </button>
                  </form>
                </>
              )}

              {settingsPanelMode === "all" && serverDetails?.currentRole === "admin" && !isSelectedServerOwner && (
                <form onSubmit={runModerationAction} className="space-y-2">
                  <label className="text-xs text-[#949BA4]">Moderação</label>
                  <input
                    className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                    value={moderationTargetId}
                    onChange={(event) => setModerationTargetId(event.target.value)}
                    placeholder="ID do usuário alvo"
                  />
                  <select
                    value={moderationAction}
                    onChange={(event) => setModerationAction(event.target.value as "remove-user" | "ban-user" | "voice-timeout" | "voice-kick" | "voice-move")}
                    className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                  >
                    <option value="ban-user">Banir do servidor</option>
                    <option value="remove-user">Remover do servidor</option>
                    <option value="voice-timeout">Ban temporário de voz</option>
                    <option value="voice-kick">Expulsar da chamada de voz</option>
                    <option value="voice-move">Mover para outro canal de voz</option>
                  </select>
                  {moderationAction === "voice-timeout" && (
                    <input
                      type="number"
                      min={1}
                      max={4320}
                      value={moderationDurationMinutes}
                      onChange={(event) => setModerationDurationMinutes(Number(event.target.value || 1))}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                      placeholder="Minutos"
                    />
                  )}
                  {moderationAction === "voice-move" && (
                    <select
                      value={moderationTargetChannelId}
                      onChange={(event) => setModerationTargetChannelId(event.target.value)}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                    >
                      <option value="">Selecione o canal de voz destino</option>
                      {serverDetails?.server.channels
                        .filter((channel) => channel.type === "voice")
                        .map((channel) => (
                          <option key={channel.id} value={channel.id}>
                            {channel.name}
                          </option>
                        ))}
                    </select>
                  )}
                  {moderationAction === "remove-user" && (
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={moderationRemoveMessages}
                        onChange={(event) => setModerationRemoveMessages(event.target.checked)}
                      />
                      Remover mensagens do usuário também
                    </label>
                  )}
                  <textarea
                    value={moderationReason}
                    onChange={(event) => setModerationReason(event.target.value)}
                    className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                    rows={2}
                    placeholder="Motivo da ação"
                  />
                  <button type="submit" disabled={busy} className="w-full rounded bg-[#404249] px-2 py-1 text-sm">
                    Executar ação
                  </button>
                </form>
              )}

              {settingsPanelMode === "all" && serverDetails?.currentRole === "moderator" && (
                <form onSubmit={runModerationAction} className="space-y-2">
                  <label className="text-xs text-[#949BA4]">Moderação</label>
                  <input
                    className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                    value={moderationTargetId}
                    onChange={(event) => setModerationTargetId(event.target.value)}
                    placeholder="ID do usuário alvo"
                  />
                  <select
                    value={moderationAction}
                    onChange={(event) => setModerationAction(event.target.value as "remove-user" | "ban-user" | "voice-timeout" | "voice-kick" | "voice-move")}
                    className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                  >
                    <option value="ban-user">Banir do servidor</option>
                    <option value="remove-user">Remover do servidor</option>
                    <option value="voice-timeout">Ban temporário de voz</option>
                    <option value="voice-kick">Expulsar da chamada de voz</option>
                    <option value="voice-move">Mover para outro canal de voz</option>
                  </select>
                  {moderationAction === "voice-timeout" && (
                    <input
                      type="number"
                      min={1}
                      max={4320}
                      value={moderationDurationMinutes}
                      onChange={(event) => setModerationDurationMinutes(Number(event.target.value || 1))}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                      placeholder="Minutos"
                    />
                  )}
                  {moderationAction === "voice-move" && (
                    <select
                      value={moderationTargetChannelId}
                      onChange={(event) => setModerationTargetChannelId(event.target.value)}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                    >
                      <option value="">Selecione o canal de voz destino</option>
                      {serverDetails?.server.channels
                        .filter((channel) => channel.type === "voice")
                        .map((channel) => (
                          <option key={channel.id} value={channel.id}>
                            {channel.name}
                          </option>
                        ))}
                    </select>
                  )}
                  {moderationAction === "remove-user" && (
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={moderationRemoveMessages}
                        onChange={(event) => setModerationRemoveMessages(event.target.checked)}
                      />
                      Remover mensagens do usuário também
                    </label>
                  )}
                  <textarea
                    value={moderationReason}
                    onChange={(event) => setModerationReason(event.target.value)}
                    className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm"
                    rows={2}
                    placeholder="Motivo da ação"
                  />
                  <button type="submit" disabled={busy} className="w-full rounded bg-[#404249] px-2 py-1 text-sm">
                    Executar ação
                  </button>
                </form>
              )}
            </div>
          )}
          {!isSecureContextValue && (
            <p className="mb-2 rounded bg-amber-900/60 border border-amber-700 px-2 py-1 text-sm">
              Conexão não segura detectada. Em HTTP por IP, navegador pode bloquear microfone/câmera.
            </p>
          )}
          {error && <p style={{ opacity: errorOpacity, transition: 'opacity 0.3s ease' }} className="mb-2 rounded-[4px] bg-[#F23F42]/10 border border-[#F23F42]/30 px-3 py-2 text-sm text-[#F23F42]">{error}</p>}

          {!showSettingsPanel && appMode === "server" && !selectedChannel && <p className="text-[#949BA4]">Selecione um canal.</p>}

          {!showSettingsPanel && appMode === "direct" && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-medium">
                  {selectedDirectConversation ? (
                    <span className="inline-flex items-center gap-1">
                      <span>Conversa com</span>
                      <StyledDisplayName
                        displayName={selectedDirectConversation.otherUserName}
                        style={selectedDirectConversation.otherUserDisplayNameStyle}
                      />
                    </span>
                  ) : "Mensagens diretas"}
                </h3>
                {selectedDirectConversation && (
                  <button
                    type="button"
                    onClick={() => void toggleDirectBlock()}
                    disabled={busy}
                    className="rounded bg-[#383A40] hover:bg-[#404249] border border-[#3F4147] px-2 py-1 text-xs disabled:opacity-60"
                  >
                    {blockedDirectUserIds.includes(selectedDirectConversation.otherUserId) ? "Desbloquear" : "Bloquear"}
                  </button>
                )}
              </div>

              <div
                ref={directMessagesContainerRef}
                onScroll={onDirectMessagesScroll}
                className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
              >
                {isLoadingOlderDirectMessages && (
                  <p className="text-[#949BA4] text-xs">Carregando mensagens antigas...</p>
                )}
                {!hasMoreDirectMessages && directMessages.length > 0 && (
                  <p className="text-[#949BA4] text-xs">Início do histórico</p>
                )}

                {directMessages.map((message) => (
                  <div key={message.id} className="text-sm min-w-0">
                    {(() => {
                      const friendRequestMarker = parseDirectFriendRequestMarker(message.content);

                      return (
                        <>
                    <div className="text-[#949BA4] text-xs flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <StyledDisplayName displayName={message.senderName} style={message.senderDisplayNameStyle} className="text-[#B5BAC1]" />
                        <span>·</span>
                        <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                      </div>
                      {message.senderId === userId && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => startEditingDirectMessage(message)}
                            className="text-xs text-[#949CF7] hover:text-[#C5C8F8] disabled:opacity-60"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeDirectMessage(message.id)}
                            className="text-xs text-[#FA777C] hover:text-[#FBB4B7] disabled:opacity-60"
                          >
                            Excluir
                          </button>
                        </div>
                      )}
                    </div>

                    {editingDirectMessageId === message.id ? (
                      <div className="mt-1 space-y-2">
                        <textarea
                          className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm min-h-[44px] max-h-56 resize-y whitespace-pre-wrap"
                          value={editingDirectMessageContent}
                          onChange={(event) => setEditingDirectMessageContent(event.target.value)}
                          disabled={busy}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void saveEditedDirectMessage(message.id)}
                            disabled={busy}
                            className="rounded bg-[#5865F2] hover:bg-[#5865F2] px-2 py-1 text-xs disabled:opacity-60"
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditingDirectMessage}
                            disabled={busy}
                            className="rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-xs disabled:opacity-60"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : friendRequestMarker ? (
                      renderDirectFriendRequestMessage(friendRequestMarker)
                    ) : (
                      (() => {
                        const textOnly = getDirectMessageTextOnly(message.content);
                        if (!textOnly) {
                          return <div className="text-[#949BA4] text-xs">(mensagem sem conteúdo)</div>;
                        }
                        return <div className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{renderDirectMessageText(textOnly)}</div>;
                      })()
                    )}

                    {!friendRequestMarker && renderDirectMediaFromText(message.content)}
                    {!friendRequestMarker && <LinkPreview text={message.content} />}
                    {!friendRequestMarker && renderDirectFileAttachmentsFromText(message.content)}

                    {!friendRequestMarker && (
                      <MessageReactions
                        reactions={message.reactions}
                        currentUserId={userId}
                        onToggle={(emoji) => void toggleDirectMessageReaction(message.id, emoji)}
                      />
                    )}

                    {!friendRequestMarker && message.senderId === userId && getDirectAttachmentEntries(message.content).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {getDirectAttachmentEntries(message.content).map((attachment) => (
                          <button
                            key={`${message.id}-${attachment.url}`}
                            type="button"
                            onClick={() => void removeDirectAttachment(message.id, attachment.url)}
                            className="block text-xs text-[#FA777C] hover:text-[#FBB4B7] disabled:opacity-60"
                            disabled={busy}
                          >
                            Excluir arquivo: {attachment.name}
                          </button>
                        ))}
                      </div>
                    )}
                        </>
                      );
                    })()}
                  </div>
                ))}

                {selectedDirectConversationId && directMessages.length === 0 && (
                  <p className="text-[#80848E] text-sm">Sem mensagens. Inicie a conversa.</p>
                )}
                {!selectedDirectConversationId && (
                  <p className="text-[#80848E] text-sm">Selecione uma conversa direta.</p>
                )}
              </div>

              {newDirectMessageCount > 0 && (
                <div className="relative z-10 -mt-9 flex justify-center pointer-events-none">
                  <button
                    type="button"
                    onClick={scrollDirectMessagesToBottom}
                    className="pointer-events-auto flex items-center gap-2 rounded-full border border-indigo-500 bg-[#5865F2]/90 px-4 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-[#5865F2] transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
                      <path d="M12 4l-1.5 1.5 4.5 4.5H6v2h9l-4.5 4.5L12 18l6-6z" transform="rotate(180 12 12)" />
                    </svg>
                    {newDirectMessageCount} {newDirectMessageCount === 1 ? "mensagem nova" : "mensagens novas"}
                  </button>
                </div>
              )}

              <form onSubmit={sendDirectMessage} className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveDirectCustomPreview((current) => {
                        const next = current === "sticker" ? null : "sticker";
                        if (next === "sticker") {
                          setDirectStickerPreviewPage(0);
                        }
                        return next;
                      });
                      setShowDirectEmojiMartPicker(false);
                    }}
                    className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-xs hover:bg-[#404249] disabled:opacity-60"
                    disabled={!selectedDirectConversationId}
                  >
                    {activeDirectCustomPreview === "sticker" ? "Fechar figurinhas" : "Figurinhas dos servidores"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveDirectCustomPreview((current) => {
                        const next = current === "emoji" ? null : "emoji";
                        if (next === "emoji") {
                          setDirectEmojiPreviewPage(0);
                        }
                        return next;
                      });
                      setShowDirectEmojiMartPicker(false);
                    }}
                    className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-xs hover:bg-[#404249] disabled:opacity-60"
                    disabled={!selectedDirectConversationId}
                  >
                    {activeDirectCustomPreview === "emoji" ? "Fechar emojis" : "Emojis dos servidores"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDirectEmojiMartPicker((current) => !current);
                      setActiveDirectCustomPreview(null);
                    }}
                    className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-xs hover:bg-[#404249] disabled:opacity-60"
                    disabled={!selectedDirectConversationId}
                  >
                    {showDirectEmojiMartPicker ? "Fechar emojis padrão" : "Emoji padrão"}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSpoilerWrap(newDirectMessage, setNewDirectMessage)}
                    className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-xs hover:bg-[#404249] disabled:opacity-60"
                    disabled={!selectedDirectConversationId}
                    title="Marcar como spoiler (esconde o texto até clicar)"
                  >
                    Spoiler
                  </button>
                </div>
                {activeDirectCustomPreview === "sticker" && (
                  <div className="rounded border border-[#1F2023] bg-[#2B2D31]/50 p-2">
                    <p className="mb-1 text-[11px] text-[#949BA4]">Figurinhas dos seus servidores</p>
                    {directStickers.length > 0 ? (
                      <>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
                          {pagedDirectStickers.map((sticker) => (
                            <button
                              key={`direct-preview-sticker-${sticker.id}`}
                              type="button"
                              onClick={() => appendTokenToDirectMessage(`[sticker:${sticker.name}]`)}
                              className="rounded border border-[#3F4147] bg-[#1E1F22] px-1 py-1 hover:bg-[#383A40]"
                              title={`Inserir figurinha: ${sticker.name}`}
                            >
                              <img
                                src={sticker.url}
                                alt={sticker.name}
                                className="mx-auto h-12 w-12 rounded object-cover border border-[#1F2023]"
                              />
                              <div className="mt-1 truncate text-[10px] text-[#B5BAC1]">{sticker.name}</div>
                              <div className="truncate text-[9px] text-[#80848E]">{sticker.serverName}</div>
                            </button>
                          ))}
                        </div>
                        {directStickerPageCount > 1 && (
                          <div className="mt-2 flex items-center justify-between text-[11px] text-[#949BA4]">
                            <button
                              type="button"
                              onClick={() => setDirectStickerPreviewPage((current) => Math.max(0, current - 1))}
                              disabled={directStickerPreviewPage === 0}
                              className="rounded bg-[#383A40] px-2 py-1 disabled:opacity-50"
                            >
                              Anterior
                            </button>
                            <span>Página {directStickerPreviewPage + 1} de {directStickerPageCount}</span>
                            <button
                              type="button"
                              onClick={() => setDirectStickerPreviewPage((current) => Math.min(directStickerPageCount - 1, current + 1))}
                              disabled={directStickerPreviewPage >= directStickerPageCount - 1}
                              className="rounded bg-[#383A40] px-2 py-1 disabled:opacity-50"
                            >
                              Próxima
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[11px] text-[#80848E]">Nenhuma figurinha encontrada nos seus servidores.</p>
                    )}
                  </div>
                )}
                {activeDirectCustomPreview === "emoji" && (
                  <div className="rounded border border-[#1F2023] bg-[#2B2D31]/50 p-2">
                    <p className="mb-1 text-[11px] text-[#949BA4]">Emojis dos seus servidores</p>
                    {directEmojis.length > 0 ? (
                      <>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
                          {pagedDirectEmojis.map((emoji) => (
                            <button
                              key={`direct-preview-emoji-${emoji.id}`}
                              type="button"
                              onClick={() => appendTokenToDirectMessage(`:${emoji.name}:`)}
                              className="rounded border border-[#3F4147] bg-[#1E1F22] px-1 py-1 hover:bg-[#383A40]"
                              title={`Inserir emoji: ${emoji.name}`}
                            >
                              <img
                                src={emoji.url}
                                alt={emoji.name}
                                className="mx-auto h-8 w-8 rounded-sm object-cover border border-[#1F2023]"
                              />
                              <div className="mt-1 truncate text-[10px] text-[#B5BAC1]">{emoji.name}</div>
                              <div className="truncate text-[9px] text-[#80848E]">{emoji.serverName}</div>
                            </button>
                          ))}
                        </div>
                        {directEmojiPageCount > 1 && (
                          <div className="mt-2 flex items-center justify-between text-[11px] text-[#949BA4]">
                            <button
                              type="button"
                              onClick={() => setDirectEmojiPreviewPage((current) => Math.max(0, current - 1))}
                              disabled={directEmojiPreviewPage === 0}
                              className="rounded bg-[#383A40] px-2 py-1 disabled:opacity-50"
                            >
                              Anterior
                            </button>
                            <span>Página {directEmojiPreviewPage + 1} de {directEmojiPageCount}</span>
                            <button
                              type="button"
                              onClick={() => setDirectEmojiPreviewPage((current) => Math.min(directEmojiPageCount - 1, current + 1))}
                              disabled={directEmojiPreviewPage >= directEmojiPageCount - 1}
                              className="rounded bg-[#383A40] px-2 py-1 disabled:opacity-50"
                            >
                              Próxima
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[11px] text-[#80848E]">Nenhum emoji encontrado nos seus servidores.</p>
                    )}
                  </div>
                )}
                {showDirectEmojiMartPicker && (
                  <div className="rounded border border-[#1F2023] bg-[#1E1F22] p-2">
                    <Picker
                      data={emojiData}
                      onEmojiSelect={(emoji: { native?: string }) => onDirectStandardEmojiSelect(emoji)}
                      locale="pt"
                      theme="dark"
                      previewPosition="none"
                      skinTonePosition="none"
                    />
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <textarea
                    className="flex-1 rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-sm min-h-[44px] max-h-56 resize-y whitespace-pre-wrap"
                    value={newDirectMessage}
                    onChange={(event) => setNewDirectMessage(event.target.value)}
                    onPaste={onDirectMessagePaste}
                    placeholder="Escreva uma mensagem direta"
                    disabled={!selectedDirectConversationId}
                  />
                  <button
                    type="submit"
                    disabled={busy || !selectedDirectConversationId}
                    className="rounded bg-[#5865F2] hover:bg-[#5865F2] px-3 py-2 text-sm disabled:opacity-60"
                  >
                    Enviar
                  </button>
                </div>
                <input
                  key={directFileInputKey}
                  type="file"
                  multiple
                  onChange={(event) => {
                    const nextFiles = Array.from(event.target.files ?? []);
                    applyDirectFileSelection(nextFiles, false);
                  }}
                  disabled={!selectedDirectConversationId}
                  className="block w-full text-xs text-[#B5BAC1] file:mr-2 file:rounded file:border-0 file:bg-[#4E5058] file:px-2 file:py-1 file:text-[#DBDEE1] disabled:opacity-60"
                />
                <p className="text-[11px] text-[#80848E]">
                  Limite por arquivo: {formatUploadLimitMbLabel(channelUploadMaxFileSizeMb)} MB
                </p>
                {directUploadProgress !== null && (
                  <div className="rounded border border-[#1F2023] bg-[#2B2D31]/70 p-2">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-[#B5BAC1]">
                      <span>Enviando arquivos...</span>
                      <span>{directUploadProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-[#383A40]">
                      <div
                        className="h-full bg-[#5865F2] transition-all"
                        style={{ width: `${directUploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
                {selectedDirectFiles.length > 0 && (
                  <div className="rounded border border-[#1F2023] bg-[#2B2D31] px-2 py-2 text-xs text-[#B5BAC1] space-y-1">
                    <div className="text-[#949BA4]">Arquivos selecionados:</div>
                    {selectedDirectFiles.map((file) => {
                      const fileKey = getPendingFileKey(file);
                      const previewUrl = selectedDirectFilePreviewByKey[fileKey];

                      return (
                        <div key={fileKey} className="rounded border border-[#1F2023] bg-[#1E1F22] p-2 space-y-1">
                          {previewUrl && (
                            <img
                              src={previewUrl}
                              alt={file.name}
                              className="max-h-28 rounded border border-[#1F2023]"
                            />
                          )}
                          <div className="break-all">{file.name}</div>
                          <button
                            type="button"
                            onClick={() => removeSelectedDirectFile(fileKey)}
                            className="text-xs text-[#FA777C] hover:text-[#FBB4B7]"
                            disabled={busy}
                          >
                            Remover
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </form>
            </div>
          )}

          {!showSettingsPanel && appMode === "server" && selectedChannel?.type === "text" && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="h-12 px-4 flex items-center border-b border-[#1F2023] shadow-sm shrink-0">
                <span className="text-[#80848E] text-xl mr-1.5">#</span>
                <h3 className="font-semibold text-white text-[15px]">{selectedChannel.name}</h3>
              </div>
              <div
                ref={messagesContainerRef}
                onScroll={onMessagesScroll}
                className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
              >
                {isLoadingOlderMessages && (
                  <p className="text-[#949BA4] text-xs">Carregando mensagens antigas...</p>
                )}
                {!hasMoreMessages && messages.length > 0 && (
                  <p className="text-[#949BA4] text-xs">Início do histórico</p>
                )}
                {messages.map((message) => {
                  const canManageMessage = message.userId === userId || canModerateUserMessages;
                  const normalizedMessageUserId = message.userId.trim().toLowerCase();
                  const messageMemberInfo = memberInfoByUserId[normalizedMessageUserId];
                  const messageAvatarUrl = messageMemberInfo?.avatarUrl ?? null;

                  return (
                  <div key={message.id} className="text-sm min-w-0 flex gap-4 py-0.5 px-1 hover:bg-[#2E3035] rounded group">
                    <div className="shrink-0 mt-0.5">
                      {messageAvatarUrl ? (
                        <img src={messageAvatarUrl} alt={message.userName} className="h-10 w-10 rounded-full object-cover cursor-pointer" />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-[#5865F2] flex items-center justify-center text-sm text-white font-semibold cursor-pointer">
                          {(message.userName || "U").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setChannelMessageUserCard({
                              targetUserId: message.userId,
                              targetUserName: message.userName,
                              targetAvatarUrl: messageAvatarUrl,
                              targetDisplayNameStyle: message.userDisplayNameStyle,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          className="display-name-wrapper rounded px-0.5 hover:underline cursor-pointer"
                        >
                          <StyledDisplayName displayName={message.userName} style={message.userDisplayNameStyle} className="text-[#F2F3F5] font-medium" />
                        </button>
                        <span className="text-[#949BA4] text-xs">{new Date(message.createdAt).toLocaleString()}</span>
                      </div>
                      {canManageMessage && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => startEditingMessage(message)}
                            className="text-xs text-[#949CF7] hover:text-[#C5C8F8] disabled:opacity-60"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeMessage(message.id)}
                            className="text-xs text-[#FA777C] hover:text-[#FBB4B7] disabled:opacity-60"
                          >
                            Excluir
                          </button>
                        </div>
                      )}
                    </div>
                    {editingMessageId === message.id ? (
                      <div className="mt-1 space-y-2">
                        <textarea
                          className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1 text-sm min-h-[44px] max-h-56 resize-y whitespace-pre-wrap"
                          value={editingMessageContent}
                          onChange={(event) => setEditingMessageContent(event.target.value)}
                          disabled={busy}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void saveEditedMessage(message.id)}
                            disabled={busy}
                            className="rounded bg-[#5865F2] hover:bg-[#5865F2] px-2 py-1 text-xs disabled:opacity-60"
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditingMessage}
                            disabled={busy}
                            className="rounded bg-[#404249] hover:bg-[#404249] px-2 py-1 text-xs disabled:opacity-60"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      message.content && <div className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{renderServerMessageText(message.content)}</div>
                    )}
                    {message.content && renderServerGifLinksFromText(message.content)}
                    {message.content && <LinkPreview text={message.content} />}
                    <MessageReactions
                      reactions={message.reactions}
                      currentUserId={userId}
                      onToggle={(emoji) => void toggleServerMessageReaction(message.id, emoji)}
                    />
                    {!message.content && (!message.attachments || message.attachments.length === 0) && (
                      <div className="text-[#949BA4] text-xs">(mensagem sem conteúdo)</div>
                    )}
                    {!!message.attachments?.length && (
                      <div className="mt-2 space-y-2">
                        {message.attachments.map((attachment) => {
                          const isImage = attachment.mimeType.startsWith("image/");
                          const isVideo = attachment.mimeType.startsWith("video/");
                          const isAudio = attachment.mimeType.startsWith("audio/");

                          if (isImage) {
                            return (
                              <div key={attachment.id} className="space-y-1">
                                <a
                                  href={attachment.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block"
                                >
                                  <img
                                    src={attachment.url}
                                    alt={attachment.name}
                                    className="max-h-72 rounded border border-[#1F2023]"
                                  />
                                </a>
                                {(message.userId === userId || canModerateUserMessages) && (
                                  <button
                                    type="button"
                                    onClick={() => void removeAttachment(message.id, attachment.id)}
                                    className="text-xs text-[#FA777C] hover:text-[#FBB4B7]"
                                    disabled={busy}
                                  >
                                    Excluir arquivo
                                  </button>
                                )}
                              </div>
                            );
                          }

                          if (isVideo) {
                            return (
                              <div key={attachment.id} className="space-y-1">
                                <video
                                  controls
                                  className="max-h-80 rounded border border-[#1F2023] w-full"
                                  src={attachment.url}
                                />
                                {(message.userId === userId || canModerateUserMessages) && (
                                  <button
                                    type="button"
                                    onClick={() => void removeAttachment(message.id, attachment.id)}
                                    className="text-xs text-[#FA777C] hover:text-[#FBB4B7]"
                                    disabled={busy}
                                  >
                                    Excluir arquivo
                                  </button>
                                )}
                              </div>
                            );
                          }

                          if (isAudio) {
                            return (
                              <div key={attachment.id} className="space-y-1">
                                <audio
                                  controls
                                  className="w-full"
                                  src={attachment.url}
                                />
                                {(message.userId === userId || canModerateUserMessages) && (
                                  <button
                                    type="button"
                                    onClick={() => void removeAttachment(message.id, attachment.id)}
                                    className="text-xs text-[#FA777C] hover:text-[#FBB4B7]"
                                    disabled={busy}
                                  >
                                    Excluir arquivo
                                  </button>
                                )}
                              </div>
                            );
                          }

                          return (
                            <div key={attachment.id} className="space-y-1">
                              <a
                                href={attachment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => onAttachmentDownloadClick(event, attachment)}
                                className="block rounded border border-[#1F2023] bg-[#2B2D31] px-2 py-2 hover:bg-[#383A40]"
                              >
                                <div className="font-medium break-all">{attachment.name}</div>
                                <div className="text-xs text-[#949BA4]">
                                  {attachment.mimeType} · {formatBytes(attachment.size)}
                                </div>
                              </a>
                              {(message.userId === userId || canModerateUserMessages) && (
                                <button
                                  type="button"
                                  onClick={() => void removeAttachment(message.id, attachment.id)}
                                  className="text-xs text-[#FA777C] hover:text-[#FBB4B7]"
                                  disabled={busy}
                                >
                                  Excluir arquivo
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  </div>
                );
                })}
                {messages.length === 0 && <p className="text-[#949BA4] text-sm">Sem mensagens.</p>}
              </div>
              {newServerMessageCount > 0 && (
                <div className="relative z-10 -mt-9 flex justify-center pointer-events-none">
                  <button
                    type="button"
                    onClick={scrollServerMessagesToBottom}
                    className="pointer-events-auto flex items-center gap-2 rounded-full border border-indigo-500 bg-[#5865F2]/90 px-4 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-[#5865F2] transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
                      <path d="M12 4l-1.5 1.5 4.5 4.5H6v2h9l-4.5 4.5L12 18l6-6z" transform="rotate(180 12 12)" />
                    </svg>
                    {newServerMessageCount} {newServerMessageCount === 1 ? "mensagem nova" : "mensagens novas"}
                  </button>
                </div>
              )}
              <form onSubmit={sendMessage} className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCustomPreview((current) => {
                        const next = current === "sticker" ? null : "sticker";
                        if (next === "sticker") {
                          setServerStickerPreviewPage(0);
                        }
                        return next;
                      });
                      setShowEmojiMartPicker(false);
                    }}
                    className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-xs hover:bg-[#404249]"
                  >
                    {activeCustomPreview === "sticker" ? "Fechar figurinhas" : "Figurinhas do servidor"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCustomPreview((current) => {
                        const next = current === "emoji" ? null : "emoji";
                        if (next === "emoji") {
                          setServerEmojiPreviewPage(0);
                        }
                        return next;
                      });
                      setShowEmojiMartPicker(false);
                    }}
                    className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-xs hover:bg-[#404249]"
                  >
                    {activeCustomPreview === "emoji" ? "Fechar emojis do servidor" : "Emojis do servidor"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmojiMartPicker((current) => !current);
                      setActiveCustomPreview(null);
                    }}
                    className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-xs hover:bg-[#404249]"
                  >
                    {showEmojiMartPicker ? "Fechar emojis" : "Emoji padrão"}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSpoilerWrap(newMessage, setNewMessage)}
                    className="rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-xs hover:bg-[#404249]"
                    title="Marcar como spoiler (esconde o texto até clicar)"
                  >
                    Spoiler
                  </button>
                </div>
                {activeCustomPreview === "sticker" && (
                  <div className="rounded border border-[#1F2023] bg-[#2B2D31]/50 p-2">
                    <p className="mb-1 text-[11px] text-[#949BA4]">Preview de figurinhas do servidor</p>
                    {(serverDetails?.server.stickers ?? []).length > 0 ? (
                      <>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
                          {pagedServerStickers.map((sticker) => (
                            <button
                              key={`preview-sticker-${sticker.id}`}
                              type="button"
                              onClick={() => appendTokenToNewMessage(`[sticker:${sticker.name}]`)}
                              className="rounded border border-[#3F4147] bg-[#1E1F22] px-1 py-1 hover:bg-[#383A40]"
                              title={`Inserir figurinha: ${sticker.name}`}
                            >
                              <img
                                src={sticker.url}
                                alt={sticker.name}
                                className="mx-auto h-12 w-12 rounded object-cover border border-[#1F2023]"
                              />
                              <div className="mt-1 truncate text-[10px] text-[#B5BAC1]">{sticker.name}</div>
                            </button>
                          ))}
                        </div>
                        {serverStickerPageCount > 1 && (
                          <div className="mt-2 flex items-center justify-between text-[11px] text-[#949BA4]">
                            <button
                              type="button"
                              onClick={() => setServerStickerPreviewPage((current) => Math.max(0, current - 1))}
                              disabled={serverStickerPreviewPage === 0}
                              className="rounded bg-[#383A40] px-2 py-1 disabled:opacity-50"
                            >
                              Anterior
                            </button>
                            <span>Página {serverStickerPreviewPage + 1} de {serverStickerPageCount}</span>
                            <button
                              type="button"
                              onClick={() => setServerStickerPreviewPage((current) => Math.min(serverStickerPageCount - 1, current + 1))}
                              disabled={serverStickerPreviewPage >= serverStickerPageCount - 1}
                              className="rounded bg-[#383A40] px-2 py-1 disabled:opacity-50"
                            >
                              Próxima
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[11px] text-[#80848E]">Sem figurinhas cadastradas.</p>
                    )}
                  </div>
                )}
                {activeCustomPreview === "emoji" && (
                  <div className="rounded border border-[#1F2023] bg-[#2B2D31]/50 p-2">
                    <p className="mb-1 text-[11px] text-[#949BA4]">Preview de emojis do servidor</p>
                    {(serverDetails?.server.emojis ?? []).length > 0 ? (
                      <>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
                          {pagedServerEmojis.map((emoji) => (
                            <button
                              key={`preview-emoji-${emoji.id}`}
                              type="button"
                              onClick={() => appendTokenToNewMessage(`:${emoji.name}:`)}
                              className="rounded border border-[#3F4147] bg-[#1E1F22] px-1 py-1 hover:bg-[#383A40]"
                              title={`Inserir emoji: ${emoji.name}`}
                            >
                              <img
                                src={emoji.url}
                                alt={emoji.name}
                                className="mx-auto h-8 w-8 rounded-sm object-cover border border-[#1F2023]"
                              />
                              <div className="mt-1 truncate text-[10px] text-[#B5BAC1]">{emoji.name}</div>
                            </button>
                          ))}
                        </div>
                        {serverEmojiPageCount > 1 && (
                          <div className="mt-2 flex items-center justify-between text-[11px] text-[#949BA4]">
                            <button
                              type="button"
                              onClick={() => setServerEmojiPreviewPage((current) => Math.max(0, current - 1))}
                              disabled={serverEmojiPreviewPage === 0}
                              className="rounded bg-[#383A40] px-2 py-1 disabled:opacity-50"
                            >
                              Anterior
                            </button>
                            <span>Página {serverEmojiPreviewPage + 1} de {serverEmojiPageCount}</span>
                            <button
                              type="button"
                              onClick={() => setServerEmojiPreviewPage((current) => Math.min(serverEmojiPageCount - 1, current + 1))}
                              disabled={serverEmojiPreviewPage >= serverEmojiPageCount - 1}
                              className="rounded bg-[#383A40] px-2 py-1 disabled:opacity-50"
                            >
                              Próxima
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[11px] text-[#80848E]">Sem emojis cadastrados.</p>
                    )}
                  </div>
                )}
                {showEmojiMartPicker && (
                  <div className="rounded border border-[#1F2023] bg-[#1E1F22] p-2">
                    <Picker
                      data={emojiData}
                      onEmojiSelect={(emoji: { native?: string }) => onStandardEmojiSelect(emoji)}
                      locale="pt"
                      theme="dark"
                      previewPosition="none"
                      skinTonePosition="none"
                    />
                  </div>
                )}
                {((serverDetails?.server.stickers ?? []).length === 0 || (serverDetails?.server.emojis ?? []).length === 0) && (
                  <p className="text-[11px] text-[#80848E]">
                    Sem itens suficientes no servidor. Crie em Configurações do servidor.
                  </p>
                )}
                <div className="flex gap-2 items-end">
                  <textarea
                    className="flex-1 rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-sm min-h-[44px] max-h-56 resize-y whitespace-pre-wrap"
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    onPaste={onServerMessagePaste}
                    placeholder="Escreva uma mensagem"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded bg-[#5865F2] hover:bg-[#5865F2] px-3 py-2 text-sm disabled:opacity-60"
                  >
                    Enviar
                  </button>
                </div>
                <input
                  key={fileInputKey}
                  type="file"
                  multiple
                  onChange={(event) => {
                    const nextFiles = Array.from(event.target.files ?? []);
                    applyServerFileSelection(nextFiles, false);
                  }}
                  className="block w-full text-xs text-[#B5BAC1] file:mr-2 file:rounded file:border-0 file:bg-[#4E5058] file:px-2 file:py-1 file:text-[#DBDEE1]"
                />
                <p className="text-[11px] text-[#80848E]">
                  Limite por arquivo: {formatUploadLimitMbLabel(channelUploadMaxFileSizeMb)} MB
                </p>
                {serverUploadProgress !== null && (
                  <div className="rounded border border-[#1F2023] bg-[#2B2D31]/70 p-2">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-[#B5BAC1]">
                      <span>Enviando arquivos...</span>
                      <span>{serverUploadProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-[#383A40]">
                      <div
                        className="h-full bg-[#5865F2] transition-all"
                        style={{ width: `${serverUploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
                {selectedFiles.length > 0 && (
                  <div className="rounded border border-[#1F2023] bg-[#2B2D31] px-2 py-2 text-xs text-[#B5BAC1] space-y-1">
                    <div className="text-[#949BA4]">Arquivos selecionados:</div>
                    {selectedFiles.map((file) => {
                      const fileKey = getPendingFileKey(file);
                      const previewUrl = selectedFilePreviewByKey[fileKey];

                      return (
                        <div key={fileKey} className="rounded border border-[#1F2023] bg-[#1E1F22] p-2 space-y-1">
                          {previewUrl && (
                            <img
                              src={previewUrl}
                              alt={file.name}
                              className="max-h-28 rounded border border-[#1F2023]"
                            />
                          )}
                          <div className="break-all">{file.name}</div>
                          <button
                            type="button"
                            onClick={() => removeSelectedServerFile(fileKey)}
                            className="text-xs text-[#FA777C] hover:text-[#FBB4B7]"
                            disabled={busy}
                          >
                            Remover
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </form>
            </div>
          )}

          {!showSettingsPanel && appMode === "server" && selectedChannel?.type === "voice" && !isVoiceConnected && (
            <div className="flex-1 flex flex-col gap-3">
              <h3 className="font-medium">🔊 {selectedChannel.name}</h3>
              <button
                onClick={enterVoice}
                disabled={busy}
                className="w-fit rounded bg-[#5865F2] hover:bg-[#5865F2] px-3 py-2 text-sm disabled:opacity-60"
              >
                Entrar na sala de voz (câmera/microfone/tela)
              </button>
            </div>
          )}

          {!showSettingsPanel && appMode === "server" && isVoiceConnected && (
            <div className="mt-3 border-t border-[#1F2023] pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#B5BAC1]">
                  Conectado no canal de voz: <span className="font-medium">{activeVoiceChannelName ?? "canal de voz"}</span>
                </p>
                {activeVoiceChannelId && selectedChannelId !== activeVoiceChannelId && (
                  <button
                    onClick={() => setSelectedChannelId(activeVoiceChannelId)}
                    className="rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-xs"
                  >
                    Abrir voz
                  </button>
                )}
              </div>
            </div>
          )}

          {/* VoiceRoom renderizado sempre quando conectado, apenas oculto visualmente quando não em canal de voz */}
          {isVoiceConnected && (
            <div
              className={`${
                !showSettingsPanel && appMode === "server" && selectedChannel?.type === "voice"
                  ? "rounded border border-[#1F2023] overflow-hidden h-full min-h-[420px] mt-3"
                  : "h-0 w-0 opacity-0 pointer-events-none"
              }`}
            >
              <VoiceRoom
                token={voiceToken!}
                serverUrl={voiceServerUrl!}
                serverId={activeVoiceServerId}
                joinWithMicEnabled={joinWithMicEnabled}
                joinWithCameraEnabled={joinWithCameraEnabled}
                noiseSuppressionEnabled={noiseSuppressionEnabled}
                noiseSuppressionMode={noiseSuppressionMode}
                micGain={micGain}
                currentUserId={userId}
                canUploadServerSounds={!!canUploadServerSounds}
                canDeleteServerSounds={!!canDeleteServerSounds}
                canKickFromVoice={!!canKickFromVoice}
                canMoveVoiceUsers={!!canMoveVoiceUsers}
                currentVoiceChannelId={activeVoiceChannelId}
                voiceChannels={
                  (serverDetails?.server.channels ?? [])
                    .filter((channel) => channel.type === "voice")
                    .map((channel) => ({ id: channel.id, name: channel.name }))
                }
                onModerationAction={runVoiceCardModerationAction}
                avatarByUserId={
                  (serverDetails?.server.members ?? []).reduce<Record<string, string>>((acc, member) => {
                    if (member.avatarUrl) {
                      acc[member.userId] = member.avatarUrl;
                    }
                    return acc;
                  }, userAvatarUrl ? { [userId]: userAvatarUrl } : {})
                }
                onLeave={handleVoiceRoomDisconnected}
                onPresenceStatusChanged={refreshVoicePresenceNow}
                onListeningStateChanged={onVoiceListeningStateChanged}
              />
            </div>
          )}
        </main>

        {(isMembersPanelOpen || appMode !== "server") && (
        <aside className="w-60 shrink-0 bg-[#2B2D31] flex flex-col min-h-0">
          {appMode === "server" ? (
            <>
              <div className="px-4 pt-6 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#949BA4]">Membros — {serverMembers.length}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMembersPanelOpen(false)}
                  title="Ocultar painel de membros"
                  className="h-7 w-7 rounded hover:bg-[#383A40] flex items-center justify-center text-[#949BA4] hover:text-white"
                >
                  »
                </button>
              </div>
              <div className="pt-3">
                <input
                  type="text"
                  value={sidebarMemberSearchTerm}
                  onChange={(event) => setSidebarMemberSearchTerm(event.target.value)}
                  placeholder="Buscar por nome ou userId"
                  className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1.5 text-xs"
                />
              </div>
              <div
                className="no-scrollbar flex-1 overflow-y-auto pt-3"
                onScroll={(event) => {
                  const target = event.currentTarget;
                  const nearBottom = target.scrollHeight - (target.scrollTop + target.clientHeight) < 80;
                  if (nearBottom && hasMoreVisibleSidebarMembers) {
                    loadMoreVisibleSidebarMembers();
                  }
                }}
              >
                <ul className="space-y-1 text-sm">
                  {visibleSidebarMembers.map((member) => (
                    <li
                      key={member.userId}
                      title={`Membro desde: ${formatMemberSince(member.createdAt)}`}
                      onContextMenu={(event) => {
                        if (member.userId.trim().toLowerCase() === userId.trim().toLowerCase()) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        setMemberContextMenu({
                          targetUserId: member.userId,
                          targetUserName: member.userName || "Usuário",
                          targetRole: member.role,
                          targetPermissions: member.permissions ?? undefined,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      className="rounded-[4px] px-2 py-1.5 text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1] cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {member.avatarUrl ? (
                          <img
                            src={member.avatarUrl}
                            alt={member.userName || "Usuário"}
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-[#5865F2] flex items-center justify-center text-[10px] text-white font-semibold">
                            {(member.userName || "U").slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <span className="truncate">
                          {selectedServer && member.userId === selectedServer.ownerId && "👑 "}
                          {member.userName || "Usuário"} ({member.role})
                        </span>
                      </div>
                    </li>
                  ))}
                  {!serverMembers.length && (
                    <li className="text-xs text-[#80848E]">Sem membros visíveis.</li>
                  )}
                  {hasMoreVisibleSidebarMembers && (
                    <li className="text-center text-xs text-[#80848E]">Role para carregar mais membros...</li>
                  )}
                </ul>
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="pb-3 border-b border-[#1F2023]">
                <h3 className="font-medium">Conversa privada</h3>
                <p className="text-xs text-[#949BA4]">{selectedDirectConversation ? "1 participante" : "Sem conversa selecionada"}</p>
              </div>
              {selectedDirectConversation && (
                <div className="pt-3">
                  <div
                    className="group relative h-24 overflow-hidden rounded border border-[#1F2023] bg-[#2B2D31]/70"
                    onMouseEnter={() => setIsDirectProfileCardHovered(true)}
                    onMouseLeave={() => setIsDirectProfileCardHovered(false)}
                  >
                    {isDirectProfileCardHovered && selectedDirectConversation.otherUserDisplayNameStyle?.profileCardGifUrl && (
                      <img
                        src={selectedDirectConversation.otherUserDisplayNameStyle.profileCardGifUrl}
                        alt="GIF do card de perfil"
                        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70"
                      />
                    )}
                    <div className="relative z-10 flex h-full items-center gap-2 px-2">
                      {selectedDirectConversation.otherUserAvatarUrl ? (
                        <img
                          src={selectedDirectConversation.otherUserAvatarUrl}
                          alt={selectedDirectConversation.otherUserName}
                          className="h-9 w-9 rounded-full object-cover border border-[#3F4147]"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full border border-[#3F4147] bg-[#383A40] flex items-center justify-center text-[10px] text-[#B5BAC1]">
                          DM
                        </div>
                      )}
                      <div className="min-w-0">
                        <StyledDisplayName
                          displayName={selectedDirectConversation.otherUserName}
                          style={selectedDirectConversation.otherUserDisplayNameStyle}
                          className="text-sm truncate"
                        />
                        <p className="text-xs text-[#B5BAC1] truncate">{selectedDirectConversation.otherUserId}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )} 
            </div>
          )}
        </aside>
        )}
        </div>

        {!isMembersPanelOpen && appMode === "server" && (
          <button
            type="button"
            onClick={() => setIsMembersPanelOpen(true)}
            title="Mostrar painel de membros"
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex h-10 w-6 items-center justify-center rounded-l bg-[#2B2D31] hover:bg-[#35373C] text-[#949BA4] hover:text-white"
          >
            «
          </button>
        )}

        {serverContextMenu && contextMenuServer && (
          <div
            className="fixed z-50 min-w-[188px] rounded-[4px] bg-[#111214] p-[6px] shadow-xl"
            style={{ left: serverContextMenu.x, top: serverContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setSelectedChannelId(null);
                setSelectedServerId(contextMenuServer.id);
                setSettingsPanelMode("server");
                setShowSettingsPanel(true);
                setServerContextMenu(null);
              }}
              className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
            >
              Ir para configurações do servidor
            </button>
          </div>
        )}

        {channelAreaContextMenu && canManageChannels && (
          <div
            className="fixed z-50 min-w-52 rounded border border-[#1F2023] bg-[#2B2D31] p-1 shadow-lg"
            style={{ left: channelAreaContextMenu.x, top: channelAreaContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => openCreateItemModal("text")}
              className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
            >
              Criar canal de texto
            </button>
            <button
              type="button"
              onClick={() => openCreateItemModal("voice")}
              className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
            >
              Criar canal de voz
            </button>
            <button
              type="button"
              onClick={() => openCreateItemModal("category")}
              className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
            >
              Criar categoria
            </button>
          </div>
        )}

        {channelContextMenu && contextMenuChannel && canManageChannels && (
          <div
            className="fixed z-50 min-w-52 rounded border border-[#1F2023] bg-[#2B2D31] p-1 shadow-lg"
            style={{ left: channelContextMenu.x, top: channelContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => openChannelActionModal("rename")}
              className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
            >
              Editar nome do canal
            </button>
            <button
              type="button"
              onClick={() => openChannelActionModal("move")}
              className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
            >
              Mover para outra categoria
            </button>
            <button
              type="button"
              onClick={() => openChannelActionModal("permissions")}
              className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
            >
              Permissões do canal
            </button>
            <button
              type="button"
              onClick={() => void deleteChannel()}
              className="w-full text-left rounded px-2 py-1 text-sm text-[#FA777C] hover:bg-[#383A40]"
            >
              Excluir canal
            </button>
          </div>
        )}

        {categoryContextMenu && contextMenuCategory && canManageChannels && (
          <div
            className="fixed z-50 min-w-52 rounded border border-[#1F2023] bg-[#2B2D31] p-1 shadow-lg"
            style={{ left: categoryContextMenu.x, top: categoryContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={openCategoryRenameModal}
              className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
            >
              Editar nome da categoria
            </button>
            <button
              type="button"
              onClick={() => void deleteCategory()}
              className="w-full text-left rounded px-2 py-1 text-sm text-[#FA777C] hover:bg-[#383A40]"
            >
              Excluir categoria
            </button>
          </div>
        )}

        {directConversationContextMenu && contextMenuDirectConversation && (
          <div
            className="fixed z-50 min-w-56 rounded border border-[#1F2023] bg-[#2B2D31] p-1 shadow-lg"
            style={{ left: directConversationContextMenu.x, top: directConversationContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                void clearDirectConversationMessages(contextMenuDirectConversation.id);
                setDirectConversationContextMenu(null);
              }}
              className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
            >
              Excluir apenas as conversas
            </button>
            {directFriendUserIdSet.has(contextMenuDirectConversation.otherUserId.trim().toLowerCase()) ? (
              <button
                type="button"
                onClick={() => {
                  void removeDirectFriend(contextMenuDirectConversation.otherUserId);
                  setDirectConversationContextMenu(null);
                }}
                className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
              >
                Remover amizade
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void sendDirectFriendRequest(contextMenuDirectConversation.otherUserId);
                  setDirectConversationContextMenu(null);
                }}
                className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
              >
                Adicionar como amigo
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void deleteDirectConversation(contextMenuDirectConversation.id);
                setDirectConversationContextMenu(null);
              }}
              className="w-full text-left rounded px-2 py-1 text-sm text-[#FA777C] hover:bg-[#383A40]"
            >
              Excluir DM
            </button>
          </div>
        )}

        {memberContextMenu && (
          <div
            className="fixed z-50 min-w-52 rounded border border-[#1F2023] bg-[#2B2D31] p-1 shadow-lg"
            style={{ left: memberContextMenu.x, top: memberContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                void openDirectConversation(memberContextMenu.targetUserId);
                setMemberContextMenu(null);
              }}
              className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
            >
              Mensagem direta
            </button>
            {canManageMemberRoles && selectedServerId && (isSelectedServerOwner || (selectedServer && memberContextMenu.targetUserId !== selectedServer.ownerId && memberContextMenu.targetRole !== "admin")) && (
              <button
                type="button"
                onClick={() => {
                  openMemberRoleModal();
                }}
                className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
              >
                Gerenciar cargo e permissões
              </button>
            )}
            {canBanUsers && (
              <button
                type="button"
                onClick={() => void runQuickMemberModerationAction({
                  action: "ban-user",
                  targetUserId: memberContextMenu.targetUserId,
                  targetUserName: memberContextMenu.targetUserName,
                })}
                className="w-full text-left rounded px-2 py-1 text-sm text-[#FA777C] hover:bg-[#383A40]"
              >
                Banir membro
              </button>
            )}
            {canPunishUsers && (
              <button
                type="button"
                onClick={() => void runQuickMemberModerationAction({
                  action: "voice-timeout",
                  targetUserId: memberContextMenu.targetUserId,
                  targetUserName: memberContextMenu.targetUserName,
                })}
                className="w-full text-left rounded px-2 py-1 text-sm hover:bg-[#383A40]"
              >
                Castigar (tempo de voz)
              </button>
            )}
          </div>
        )}

        {channelMessageUserCard && (
          <div
            data-channel-message-user-card="true"
            ref={channelMessageUserCardRef}
            className="fixed z-50 w-80 overflow-hidden rounded border border-[#1F2023] bg-[#2B2D31] shadow-lg"
            style={{ left: channelMessageUserCard.x, top: channelMessageUserCard.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative h-28">
              {channelMessageUserCard.targetDisplayNameStyle?.profileCardGifUrl ? (
                <img
                  src={channelMessageUserCard.targetDisplayNameStyle.profileCardGifUrl}
                  alt="GIF do perfil"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-[#383A40]" />
              )}
              <div className="absolute inset-0 bg-black/35" />
            </div>

            <div className="relative -mt-7 px-3 pb-3">
              <div className="flex items-center gap-2">
                {channelMessageUserCard.targetAvatarUrl ? (
                  <img
                    src={channelMessageUserCard.targetAvatarUrl}
                    alt={channelMessageUserCard.targetUserName}
                    className="h-12 w-12 rounded-full border-2 border-zinc-900 object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full border-2 border-zinc-900 bg-[#404249] flex items-center justify-center text-[10px] text-[#DBDEE1]">
                    USER
                  </div>
                )}
                <div className="min-w-0">
                  <StyledDisplayName
                    displayName={channelMessageUserCard.targetUserName}
                    style={channelMessageUserCard.targetDisplayNameStyle}
                    className="text-sm truncate"
                  />
                  <p className="text-xs text-[#949BA4] truncate">{channelMessageUserCard.targetUserId}</p>
                </div>
              </div>

              <div className="mt-3">
                {channelMessageUserCard.targetUserId.trim().toLowerCase() === userId.trim().toLowerCase() ? (
                  <button
                    type="button"
                    disabled
                    className="w-full rounded border border-[#3F4147] bg-[#383A40] px-2 py-1.5 text-xs text-[#80848E]"
                  >
                    Este é você
                  </button>
                ) : directFriendUserIdSet.has(channelMessageUserCard.targetUserId.trim().toLowerCase()) ? (
                  <button
                    type="button"
                    onClick={() => {
                      void openFriendConversation(channelMessageUserCard.targetUserId);
                      setChannelMessageUserCard(null);
                    }}
                    className="w-full rounded bg-[#5865F2] hover:bg-[#5865F2] px-2 py-1.5 text-xs"
                  >
                    Ir para DM
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void sendDirectFriendRequest(channelMessageUserCard.targetUserId);
                      setChannelMessageUserCard(null);
                    }}
                    className="w-full rounded bg-[#404249] hover:bg-[#404249] px-2 py-1.5 text-xs"
                  >
                    Enviar pedido de amizade
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {bannedUserContextMenu && canManageBansForSelectedServer && (
          <div
            className="fixed z-50 min-w-52 rounded border border-[#1F2023] bg-[#2B2D31] p-1 shadow-lg"
            style={{ left: bannedUserContextMenu.x, top: bannedUserContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => void unbanServerUser(bannedUserContextMenu.banId, bannedUserContextMenu.userName)}
              disabled={busy}
              className="w-full text-left rounded px-2 py-1 text-sm text-[#23A559] hover:bg-[#383A40] disabled:opacity-60"
            >
              Remover banimento
            </button>
          </div>
        )}

        {showDirectFriendsModal && (
          <div className="fixed inset-0 z-[73] bg-black/70 flex items-center justify-center p-4">
            <div className="w-full max-w-xl overflow-hidden rounded-xl border border-[#3F4147] bg-[#2B2D31] shadow-2xl">
              <div className="px-4 py-3 border-b border-[#3F4147] bg-[#1E1F22] flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold">Amigos</h3>
                  <p className="text-xs text-[#949BA4]">Lista de amigos com pesquisa e rolagem</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDirectFriendsModal(false)}
                  className="rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-xs"
                >
                  Fechar
                </button>
              </div>

              <div className="px-4 py-3 border-b border-[#1F2023]">
                <input
                  type="text"
                  value={directFriendSearchTerm}
                  onChange={(event) => setDirectFriendSearchTerm(event.target.value)}
                  placeholder="Pesquisar por nome ou userId"
                  className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-1.5 text-sm"
                />
              </div>

              <div
                className="max-h-[55vh] overflow-y-auto px-4 py-3 space-y-2"
                onScroll={(event) => {
                  const target = event.currentTarget;
                  const nearBottom = target.scrollHeight - (target.scrollTop + target.clientHeight) < 80;
                  if (nearBottom && hasMoreVisibleDirectFriends) {
                    loadMoreVisibleDirectFriends();
                  }
                }}
              >
                {visibleDirectFriends.length === 0 && (
                  <p className="text-sm text-[#80848E]">Nenhum amigo encontrado.</p>
                )}

                {visibleDirectFriends.map((friend) => (
                  <div key={friend.userId} className="rounded border border-[#1F2023] bg-[#1E1F22] px-2 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void openFriendConversation(friend.userId);
                          setShowDirectFriendsModal(false);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {friend.avatarUrl ? (
                          <img
                            src={friend.avatarUrl}
                            alt={friend.userName}
                            className="h-8 w-8 rounded-full object-cover border border-[#3F4147]"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full border border-[#3F4147] bg-[#383A40] flex items-center justify-center text-[10px] text-[#B5BAC1]">
                            AM
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm truncate">{friend.userName}</p>
                          <p className="text-[11px] text-[#949BA4] truncate">{friend.userId}</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeDirectFriend(friend.userId)}
                        disabled={busy}
                        className="rounded bg-[#383A40] hover:bg-[#404249] border border-[#3F4147] px-2 py-1 text-xs disabled:opacity-60"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}

                {hasMoreVisibleDirectFriends && (
                  <p className="text-xs text-[#80848E] text-center py-1">Role para carregar mais amigos...</p>
                )}
              </div>
            </div>
          </div>
        )}

        {virusTotalDownloadPrompt && (
          <div className="fixed inset-0 z-[72] bg-black/70 flex items-center justify-center p-4">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-[#3F4147] bg-[#2B2D31] shadow-2xl">
              <div className="px-4 py-3 border-b border-[#3F4147] bg-[#1E1F22]">
                <h3 className="text-base font-semibold">Análise de segurança (VirusTotal)</h3>
              </div>

              <div className="px-4 py-4 space-y-3">
                <div className="rounded border border-[#3F4147] bg-[#1E1F22] px-3 py-2">
                  <p className="text-xs text-[#949BA4]">Arquivo</p>
                  <p className="text-sm break-all text-[#F2F3F5]">{virusTotalDownloadPrompt.name}</p>
                </div>

                {virusTotalDownloadPrompt.status === "loading" && (
                  <p className="text-sm text-[#DBDEE1]">Consultando relatório do VirusTotal...</p>
                )}

                {virusTotalDownloadPrompt.status === "error" && (
                  <p className="text-sm text-amber-300">
                    {virusTotalDownloadPrompt.message ?? "Não foi possível verificar o arquivo agora."}
                  </p>
                )}

                {virusTotalDownloadPrompt.status === "result" && (
                  <>
                    <p className={`text-sm ${
                      virusTotalDownloadPrompt.verdict === "unsafe"
                        ? "text-[#FA777C]"
                        : virusTotalDownloadPrompt.verdict === "clean"
                          ? "text-[#23A559]"
                          : "text-amber-300"
                    }`}>
                      {virusTotalDownloadPrompt.verdict === "unsafe"
                        ? "Atenção: motores detectaram risco neste arquivo."
                        : virusTotalDownloadPrompt.verdict === "clean"
                          ? "Nenhuma detecção maliciosa encontrada na análise atual."
                          : (virusTotalDownloadPrompt.message ?? "Arquivo sem relatório disponível no VirusTotal.")}
                    </p>

                    {!!virusTotalDownloadPrompt.stats && (
                      <div className="rounded border border-[#3F4147] bg-[#1E1F22] px-3 py-2 text-xs text-[#B5BAC1] grid grid-cols-2 gap-2">
                        <span>Malicioso: {virusTotalDownloadPrompt.stats.malicious}</span>
                        <span>Suspeito: {virusTotalDownloadPrompt.stats.suspicious}</span>
                        <span>Inofensivo: {virusTotalDownloadPrompt.stats.harmless}</span>
                        <span>Não detectado: {virusTotalDownloadPrompt.stats.undetected}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#3F4147] bg-[#1E1F22] px-4 py-3">
                <button
                  type="button"
                  onClick={() => setVirusTotalDownloadPrompt(null)}
                  className="rounded bg-[#404249] hover:bg-[#404249] px-3 py-1.5 text-sm"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  disabled={virusTotalDownloadPrompt.status === "loading"}
                  onClick={() => {
                    if (isPotentiallyDangerousExtension(virusTotalDownloadPrompt.name)) {
                      setDangerousDownloadPrompt({
                        url: virusTotalDownloadPrompt.url,
                        name: virusTotalDownloadPrompt.name,
                      });
                      setVirusTotalDownloadPrompt(null);
                      return;
                    }

                    startFileDownload(virusTotalDownloadPrompt.url, virusTotalDownloadPrompt.name);
                    setVirusTotalDownloadPrompt(null);
                  }}
                  className="rounded bg-[#5865F2] hover:bg-[#5865F2] px-3 py-1.5 text-sm text-white disabled:opacity-60"
                >
                  {virusTotalDownloadPrompt.verdict === "unsafe" ? "Baixar mesmo assim" : "Continuar download"}
                </button>
              </div>
            </div>
          </div>
        )}

        {dangerousDownloadPrompt && (
          <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-[#3F4147] bg-[#2B2D31] shadow-2xl">
              <div className="bg-gradient-to-r from-amber-600/20 via-red-600/20 to-amber-600/20 px-4 py-3 border-b border-[#3F4147]">
                <h3 className="text-base font-semibold text-amber-200">Download potencialmente perigoso</h3>
              </div>

              <div className="px-4 py-4 space-y-3">
                <p className="text-sm text-[#DBDEE1]">
                  Este arquivo pode ser executável e potencialmente perigoso.
                </p>
                <div className="rounded border border-[#3F4147] bg-[#1E1F22] px-3 py-2">
                  <p className="text-xs text-[#949BA4]">Arquivo</p>
                  <p className="text-sm break-all text-[#F2F3F5]">{dangerousDownloadPrompt.name}</p>
                </div>
                <p className="text-xs text-[#949BA4]">
                  Baixe apenas se você confiar na origem.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#3F4147] bg-[#1E1F22] px-4 py-3">
                <button
                  type="button"
                  onClick={() => setDangerousDownloadPrompt(null)}
                  className="rounded bg-[#404249] hover:bg-[#404249] px-3 py-1.5 text-sm"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    startFileDownload(dangerousDownloadPrompt.url, dangerousDownloadPrompt.name);
                    setDangerousDownloadPrompt(null);
                  }}
                  className="rounded bg-[#5865F2] hover:bg-[#5865F2] px-3 py-1.5 text-sm text-white"
                >
                  Continuar download
                </button>
              </div>
            </div>
          </div>
        )}

        {showCategoryRenameModal && renameModalCategory && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-lg border border-[#1F2023] bg-[#2B2D31] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Editar nome da categoria</h3>
                <button
                  type="button"
                  onClick={() => {
                    if (busy) {
                      return;
                    }
                    setShowCategoryRenameModal(false);
                    setCategoryRenameId(null);
                  }}
                  className="rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-xs"
                >
                  Fechar
                </button>
              </div>

              <form onSubmit={submitCategoryRename} className="space-y-2">
                <label className="text-xs text-[#949BA4]">Novo nome</label>
                <input
                  className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-sm"
                  value={categoryRenameName}
                  onChange={(event) => setCategoryRenameName(event.target.value)}
                  placeholder="Nome da categoria"
                />
                <button
                  type="submit"
                  disabled={busy || !categoryRenameName.trim()}
                  className="w-full rounded bg-[#5865F2] hover:bg-[#5865F2] px-3 py-2 text-sm disabled:opacity-60"
                >
                  Salvar
                </button>
              </form>
            </div>
          </div>
        )}

        {showChannelActionModal && actionModalChannel && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-lg border border-[#1F2023] bg-[#2B2D31] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">
                  {channelActionMode === "rename"
                    ? "Editar nome do canal"
                    : channelActionMode === "move"
                      ? "Mover para outra categoria"
                      : "Permissões do canal"}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (busy) {
                      return;
                    }
                    setShowChannelActionModal(false);
                    setChannelActionChannelId(null);
                  }}
                  className="rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-xs"
                >
                  Fechar
                </button>
              </div>

              <form onSubmit={submitChannelAction} className="space-y-2">
                {channelActionMode === "rename" ? (
                  <>
                    <label className="text-xs text-[#949BA4]">Novo nome</label>
                    <input
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-sm"
                      value={channelActionName}
                      onChange={(event) => setChannelActionName(event.target.value)}
                      placeholder="Nome do canal"
                    />
                  </>
                ) : channelActionMode === "move" ? (
                  <>
                    <label className="text-xs text-[#949BA4]">Categoria de destino</label>
                    <select
                      value={channelActionCategoryId}
                      onChange={(event) => setChannelActionCategoryId(event.target.value)}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-sm"
                    >
                      <option value="">Sem categoria</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <div className="space-y-2 rounded border border-[#1F2023] bg-[#2B2D31] px-2 py-2 text-xs">
                    <p className="text-[#B5BAC1]">Defina permissões por cargo (admin sempre mantém acesso total).</p>
                    <label className="flex items-center justify-between gap-2">
                      <span>Membros podem ver canal no servidor</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowMemberView}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowMemberView: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Moderadores podem ver canal no servidor</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowModeratorView}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowModeratorView: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Membros podem acessar</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowMemberAccess}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowMemberAccess: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Moderadores podem acessar</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowModeratorAccess}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowModeratorAccess: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Membros podem enviar mensagens</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowMemberSendMessages}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowMemberSendMessages: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Moderadores podem enviar mensagens</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowModeratorSendMessages}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowModeratorSendMessages: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Membros podem enviar arquivos</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowMemberSendFiles}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowMemberSendFiles: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Moderadores podem enviar arquivos</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowModeratorSendFiles}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowModeratorSendFiles: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Membros podem enviar links</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowMemberSendLinks}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowMemberSendLinks: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Moderadores podem enviar links</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowModeratorSendLinks}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowModeratorSendLinks: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Membros podem excluir mensagens</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowMemberDeleteMessages}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowMemberDeleteMessages: event.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span>Moderadores podem excluir mensagens</span>
                      <input
                        type="checkbox"
                        checked={channelActionPermissions.allowModeratorDeleteMessages}
                        onChange={(event) => setChannelActionPermissions((current) => ({ ...current, allowModeratorDeleteMessages: event.target.checked }))}
                      />
                    </label>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy || (channelActionMode === "rename" && !channelActionName.trim())}
                  className="w-full rounded bg-[#5865F2] hover:bg-[#5865F2] px-3 py-2 text-sm disabled:opacity-60"
                >
                  Salvar
                </button>
              </form>
            </div>
          </div>
        )}

        {showCreateItemModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-lg border border-[#1F2023] bg-[#2B2D31] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">
                  {createItemKind === "category"
                    ? "Criar categoria"
                    : createItemKind === "voice"
                      ? "Criar canal de voz"
                      : "Criar canal de texto"}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (busy) {
                      return;
                    }
                    setShowCreateItemModal(false);
                  }}
                  className="rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-xs"
                >
                  Fechar
                </button>
              </div>

              <form onSubmit={createItemFromModal} className="space-y-2">
                <label className="text-xs text-[#949BA4]">Nome</label>
                <input
                  className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-sm"
                  value={createItemName}
                  onChange={(event) => setCreateItemName(event.target.value)}
                  placeholder={createItemKind === "category" ? "Nome da categoria" : "Nome do canal"}
                />

                {createItemKind !== "category" && (
                  <>
                    <label className="text-xs text-[#949BA4]">Categoria (opcional)</label>
                    <select
                      value={createItemCategoryId}
                      onChange={(event) => setCreateItemCategoryId(event.target.value)}
                      className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-sm"
                    >
                      <option value="">Sem categoria</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <button
                  type="submit"
                  disabled={busy || !createItemName.trim()}
                  className="w-full rounded bg-[#5865F2] hover:bg-[#5865F2] px-3 py-2 text-sm disabled:opacity-60"
                >
                  Criar
                </button>
              </form>
            </div>
          </div>
        )}

        {showCreateServerModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-lg border border-[#1F2023] bg-[#2B2D31] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Criar novo servidor</h3>
                <button
                  type="button"
                  onClick={() => {
                    if (busy) {
                      return;
                    }
                    setShowCreateServerModal(false);
                    setNewServerName("");
                    setNewServerAvatarFile(null);
                    setNewServerAvatarInputKey((value) => value + 1);
                  }}
                  className="rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-xs"
                >
                  Fechar
                </button>
              </div>

              <form onSubmit={createServer} className="space-y-2">
                <label className="text-xs text-[#949BA4]">Nome do servidor</label>
                <input
                  className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-sm"
                  value={newServerName}
                  onChange={(event) => setNewServerName(event.target.value)}
                  placeholder="Ex: Meu servidor"
                />

                <label className="text-xs text-[#949BA4]">Foto do servidor (opcional)</label>
                <input
                  key={newServerAvatarInputKey}
                  type="file"
                  accept="image/*"
                  onChange={(event) => setNewServerAvatarFile(event.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-[#B5BAC1] file:mr-2 file:rounded file:border-0 file:bg-[#4E5058] file:px-2 file:py-1 file:text-[#DBDEE1]"
                />

                <button
                  type="submit"
                  disabled={busy || !newServerName.trim()}
                  className="w-full rounded bg-[#5865F2] hover:bg-[#5865F2] px-3 py-2 text-sm disabled:opacity-60"
                >
                  Criar servidor
                </button>
              </form>
            </div>
          </div>
        )}

        {showMemberRoleModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-lg border border-[#1F2023] bg-[#2B2D31] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Gerenciar cargo - {editMemberUserName}</h3>
                <button
                  type="button"
                  onClick={() => {
                    if (busy) {
                      return;
                    }
                    setShowMemberRoleModal(false);
                  }}
                  className="rounded bg-[#383A40] hover:bg-[#404249] px-2 py-1 text-xs"
                >
                  Fechar
                </button>
              </div>

              <form onSubmit={saveEditedMemberRole} className="space-y-3">
                <div>
                  <label className="text-xs text-[#949BA4]">Cargo</label>
                  <select
                    value={editMemberRole}
                    onChange={(event) => setEditMemberRole(event.target.value as Role)}
                    className="w-full rounded bg-[#383A40] border border-[#3F4147] px-2 py-2 text-sm"
                  >
                    <option value="member">Membro</option>
                    <option value="moderator">Moderador</option>
                    {isSelectedServerOwner && <option value="admin">Admin</option>}
                  </select>
                </div>

                {editMemberRole === "moderator" && (
                  <div className="space-y-1 rounded border border-[#1F2023] bg-[#2B2D31] px-2 py-2 text-xs">
                    <p className="text-[#B5BAC1] mb-2">Permissões do moderador:</p>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editModeratorPermissions.canRemoveMembers}
                        onChange={(event) =>
                          setEditModeratorPermissions((current) => ({
                            ...current,
                            canRemoveMembers: event.target.checked,
                          }))
                        }
                      />
                      Pode remover usuários
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editModeratorPermissions.canBanUsers}
                        onChange={(event) =>
                          setEditModeratorPermissions((current) => ({
                            ...current,
                            canBanUsers: event.target.checked,
                          }))
                        }
                      />
                      Pode banir usuários
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editModeratorPermissions.canTimeoutVoice}
                        onChange={(event) =>
                          setEditModeratorPermissions((current) => ({
                            ...current,
                            canTimeoutVoice: event.target.checked,
                          }))
                        }
                      />
                      Pode expulsar da chamada por tempo
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editModeratorPermissions.canDeleteUserMessages}
                        onChange={(event) =>
                          setEditModeratorPermissions((current) => ({
                            ...current,
                            canDeleteUserMessages: event.target.checked,
                          }))
                        }
                      />
                      Pode apagar mensagens ao remover
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editModeratorPermissions.canKickFromVoice}
                        onChange={(event) =>
                          setEditModeratorPermissions((current) => ({
                            ...current,
                            canKickFromVoice: event.target.checked,
                          }))
                        }
                      />
                      Pode expulsar da chamada
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editModeratorPermissions.canMoveVoiceUsers}
                        onChange={(event) =>
                          setEditModeratorPermissions((current) => ({
                            ...current,
                            canMoveVoiceUsers: event.target.checked,
                          }))
                        }
                      />
                      Pode mover entre canais de voz
                    </label>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded bg-[#5865F2] hover:bg-[#5865F2] px-3 py-2 text-sm disabled:opacity-60"
                >
                  Salvar cargo
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
