import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { NO_PASSWORD_HASH, getServerForUser } from "@/lib/store";
import { getMusicBotConfig, type MusicBotConfig } from "@/lib/music-bot/config";
import { isHttpUrl, resolveTrackMetadata } from "@/lib/music-bot/media";
import type { MusicPlayer, MusicPlayerSnapshot, MusicQueueItem } from "@/lib/music-bot/player";

export type MusicCommandContext = {
  serverId: string;
  channelId: string;
  userId: string;
  userName: string;
  content: string;
};

type VoiceChannelRef = {
  id: string;
  name: string;
};

const MUSIC_COMMAND_PATTERN = /^\/(play|pause|resume|skip|stop|leave|queue)(?:\s+([\s\S]*))?$/i;
const QUEUE_PREVIEW_LIMIT = 10;

const globalForMusicBot = globalThis as typeof globalThis & {
  __partiuMusicPlayers?: Map<string, MusicPlayer>;
  __partiuMusicConnecting?: Map<string, Promise<MusicPlayer>>;
};

const getPlayers = (): Map<string, MusicPlayer> => {
  globalForMusicBot.__partiuMusicPlayers ??= new Map<string, MusicPlayer>();
  return globalForMusicBot.__partiuMusicPlayers;
};

const getPendingConnections = (): Map<string, Promise<MusicPlayer>> => {
  globalForMusicBot.__partiuMusicConnecting ??= new Map<string, Promise<MusicPlayer>>();
  return globalForMusicBot.__partiuMusicConnecting;
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds) {
    return "";
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return ` (${minutes}:${String(remaining).padStart(2, "0")})`;
};

const toLivekitHttpUrl = (value: string): string => {
  const parsed = new URL(value);

  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }

  return parsed.toString();
};

/**
 * O comando chega pelo canal de texto, então descobrimos pelo LiveKit em qual
 * canal de voz o autor está.
 */
const findUserVoiceChannelId = async (
  serverId: string,
  voiceChannels: VoiceChannelRef[],
  userId: string,
): Promise<string | null> => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL ?? process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    throw new Error("Defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no .env.local.");
  }

  const { RoomServiceClient } = await import("livekit-server-sdk");
  const roomService = new RoomServiceClient(toLivekitHttpUrl(livekitUrl), apiKey, apiSecret);
  const normalizedUserId = userId.trim().toLowerCase();

  for (const channel of voiceChannels) {
    try {
      const participants = await roomService.listParticipants(`${serverId}:${channel.id}`);
      const isPresent = participants.some(
        (participant) =>
          (participant.identity ?? "").split("::")[0].trim().toLowerCase() === normalizedUserId,
      );

      if (isPresent) {
        return channel.id;
      }
    } catch {
      // Sala ainda não existe no LiveKit: o usuário não está nesse canal.
    }
  }

  return null;
};

const findServerPlayer = (
  serverId: string,
  voiceChannels: VoiceChannelRef[],
): { channelId: string; player: MusicPlayer } | null => {
  const players = getPlayers();

  for (const channel of voiceChannels) {
    const roomName = `${serverId}:${channel.id}`;
    const player = players.get(roomName);

    if (!player) {
      continue;
    }

    if (!player.isConnected()) {
      players.delete(roomName);
      continue;
    }

    return { channelId: channel.id, player };
  }

  return null;
};

const describeQueue = (snapshot: MusicPlayerSnapshot): string => {
  const upcoming = snapshot.queue.filter((item) => item.id !== snapshot.current?.id);

  if (!snapshot.current && upcoming.length === 0) {
    return "A fila está vazia.";
  }

  const lines: string[] = [];

  if (snapshot.current) {
    const state = snapshot.status === "paused" ? "Pausada" : "Tocando agora";
    lines.push(`${state}: ${snapshot.current.title}${formatDuration(snapshot.current.durationSeconds)}`);
  }

  if (upcoming.length > 0) {
    lines.push(`Na fila (${upcoming.length}):`);
    upcoming.slice(0, QUEUE_PREVIEW_LIMIT).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}${formatDuration(item.durationSeconds)}`);
    });

    if (upcoming.length > QUEUE_PREVIEW_LIMIT) {
      lines.push(`... e mais ${upcoming.length - QUEUE_PREVIEW_LIMIT}.`);
    }
  }

  return lines.join("\n");
};

const ensureBotUser = async (config: MusicBotConfig): Promise<void> => {
  const existing = await db.user.findUnique({ where: { id: config.userId } });

  if (!existing) {
    try {
      await db.user.create({
        data: {
          id: config.userId,
          username: config.username,
          displayName: config.displayName,
          avatarUrl: config.avatarUrl,
          passwordHash: NO_PASSWORD_HASH,
        },
      });
    } catch {
      // O username pode estar em uso por outro usuário: cria apenas com o id.
      await db.user.create({
        data: {
          id: config.userId,
          displayName: config.displayName,
          avatarUrl: config.avatarUrl,
          passwordHash: NO_PASSWORD_HASH,
        },
      });
    }

    return;
  }

  if (existing.displayName !== config.displayName || existing.avatarUrl !== config.avatarUrl) {
    await db.user.update({
      where: { id: config.userId },
      data: { displayName: config.displayName, avatarUrl: config.avatarUrl },
    });
  }
};

/**
 * O bot responde como um usuário do servidor. A mensagem é gravada direto na
 * tabela para não passar pelas regras de spam/cargo que valem para humanos.
 */
const postBotMessage = async (
  serverId: string,
  channelId: string,
  config: MusicBotConfig,
  content: string,
): Promise<void> => {
  await ensureBotUser(config);
  await db.serverMember.upsert({
    where: { serverId_userId: { serverId, userId: config.userId } },
    update: {},
    create: { serverId, userId: config.userId, role: "member" },
  });

  await db.message.create({
    data: {
      serverId,
      channelId,
      userId: config.userId,
      userName: config.displayName,
      content,
    },
  });
};

const getOrCreatePlayer = async (
  serverId: string,
  channelId: string,
  config: MusicBotConfig,
  notify: (content: string) => Promise<void>,
): Promise<MusicPlayer> => {
  const roomName = `${serverId}:${channelId}`;
  const players = getPlayers();
  const existing = players.get(roomName);

  if (existing?.isConnected()) {
    return existing;
  }

  if (existing) {
    players.delete(roomName);
  }

  const pending = getPendingConnections();
  const inFlight = pending.get(roomName);
  if (inFlight) {
    return inFlight;
  }

  const connection = (async () => {
    const { MusicPlayer: MusicPlayerClass } = await import("@/lib/music-bot/player");
    const player = new MusicPlayerClass({ roomName, config, notify });
    players.set(roomName, player);

    try {
      await player.connect();
    } catch (error) {
      players.delete(roomName);
      throw error;
    }

    return player;
  })();

  pending.set(roomName, connection);

  try {
    return await connection;
  } finally {
    pending.delete(roomName);
  }
};

const handlePlay = async (
  argument: string,
  voiceChannels: VoiceChannelRef[],
  context: MusicCommandContext,
  config: MusicBotConfig,
): Promise<void> => {
  const reply = (content: string) =>
    postBotMessage(context.serverId, context.channelId, config, content);

  if (!argument) {
    await reply("Use /play <link> para colocar uma música na fila.");
    return;
  }

  if (!isHttpUrl(argument)) {
    await reply("Envie um link completo, começando com http:// ou https://.");
    return;
  }

  const userChannelId = await findUserVoiceChannelId(context.serverId, voiceChannels, context.userId);
  if (!userChannelId) {
    await reply("Entre em um canal de voz antes de usar /play.");
    return;
  }

  // Resolve o link antes de entrar na call: um link inválido não deve arrastar o bot.
  const metadata = await resolveTrackMetadata(argument, config.binaries);

  const player = await getOrCreatePlayer(context.serverId, userChannelId, config, (content) =>
    postBotMessage(context.serverId, context.channelId, config, content),
  );

  if (player.queueSize() >= config.maxQueueSize) {
    await reply(`A fila está cheia (${config.maxQueueSize} músicas). Aguarde ou use /skip.`);
    return;
  }

  const item: MusicQueueItem = {
    id: randomUUID(),
    url: argument,
    title: metadata.title,
    durationSeconds: metadata.durationSeconds,
    requestedBy: context.userId,
    requestedByName: context.userName,
  };

  const wasIdle = !player.hasWork();
  player.enqueue(item);

  if (wasIdle) {
    await reply(`Tocando agora: ${item.title}${formatDuration(item.durationSeconds)}`);
    return;
  }

  await reply(
    `Adicionada à fila (#${player.pendingCount()}): ${item.title}${formatDuration(item.durationSeconds)}`,
  );
};

const handleControl = async (
  command: string,
  voiceChannels: VoiceChannelRef[],
  context: MusicCommandContext,
  config: MusicBotConfig,
): Promise<void> => {
  const reply = (content: string) =>
    postBotMessage(context.serverId, context.channelId, config, content);

  const active = findServerPlayer(context.serverId, voiceChannels);
  if (!active) {
    await reply("Não estou tocando nada neste servidor. Use /play <link> para começar.");
    return;
  }

  const channelName = voiceChannels.find((channel) => channel.id === active.channelId)?.name ?? "voz";
  const userChannelId = await findUserVoiceChannelId(context.serverId, voiceChannels, context.userId);

  // Só quem está na mesma call controla a reprodução, o que evita sabotagem.
  if (userChannelId !== active.channelId) {
    await reply(`Entre no canal de voz "${channelName}" para controlar a música.`);
    return;
  }

  const { player } = active;

  switch (command) {
    case "pause": {
      await reply(player.pause() ? "Música pausada. Use /resume para continuar." : "A música já está pausada.");
      return;
    }

    case "resume": {
      await reply(player.resume() ? "Música retomada." : "Não há música pausada para retomar.");
      return;
    }

    case "skip": {
      const skippedTitle = player.snapshot().current?.title;
      if (!player.skip()) {
        await reply("Não há música tocando para pular.");
        return;
      }

      await reply(skippedTitle ? `Pulando: ${skippedTitle}` : "Pulando para a próxima música...");
      return;
    }

    case "queue": {
      await reply(describeQueue(player.snapshot()));
      return;
    }

    case "stop":
    case "leave": {
      await reply("Parando a música e saindo do canal de voz.");
      await player.stop();
      getPlayers().delete(`${context.serverId}:${active.channelId}`);
      return;
    }

    default: {
      await reply("Comando desconhecido. Use /play, /pause, /resume, /skip, /stop, /leave ou /queue.");
    }
  }
};

/**
 * Intercepta comandos de música enviados no canal de texto. Qualquer mensagem
 * que não seja um comando conhecido é ignorada sem carregar o SDK de áudio.
 */
export const maybeHandleMusicCommand = async (context: MusicCommandContext): Promise<void> => {
  const config = getMusicBotConfig();
  if (!config.enabled) {
    return;
  }

  const parsed = MUSIC_COMMAND_PATTERN.exec(context.content.trim());
  if (!parsed) {
    return;
  }

  const command = parsed[1].toLowerCase();

  try {
    const server = await getServerForUser(context.serverId, context.userId);
    const voiceChannels: VoiceChannelRef[] = server.channels
      .filter((channel) => channel.type === "voice")
      .map((channel) => ({ id: channel.id, name: channel.name }));

    if (command === "play") {
      await handlePlay((parsed[2] ?? "").trim(), voiceChannels, context, config);
      return;
    }

    await handleControl(command, voiceChannels, context, config);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erro inesperado";
    await postBotMessage(
      context.serverId,
      context.channelId,
      config,
      `Não consegui executar o comando: ${detail}`,
    ).catch(() => undefined);
  }
};

export const isMusicCommand = (content: string): boolean => MUSIC_COMMAND_PATTERN.test(content.trim());
