import { NextRequest, NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { ensureSameAuthenticatedUser, getApiErrorStatus, requireAuthenticatedUserId } from "@/lib/api-auth";
import { getServerForUser } from "@/lib/store";

type Params = {
  params: Promise<{ serverId: string }>;
};

type PresenceTrack = {
  source?: string | number | null;
  type?: string | number | null;
  muted?: boolean | null;
};

const normalizeTrackSource = (source: string | number | null | undefined): string => {
  if (source === null || source === undefined) {
    return "";
  }
  return String(source).trim().toUpperCase();
};

const isUnmutedTrack = (track: PresenceTrack): boolean => track.muted !== true;

const isAudioTrack = (track: PresenceTrack): boolean => {
  const type = normalizeTrackSource(track.type);
  return type.includes("AUDIO") || type === "0";
};

const isVideoTrack = (track: PresenceTrack): boolean => {
  const type = normalizeTrackSource(track.type);
  return type.includes("VIDEO") || type === "1";
};

const isMicSource = (track: PresenceTrack): boolean => {
  const source = normalizeTrackSource(track.source);
  return source.includes("MIC") || source.includes("AUDIO") || source === "2";
};

const isCameraSource = (track: PresenceTrack): boolean => {
  const source = normalizeTrackSource(track.source);
  return source.includes("CAMERA") || source === "1";
};

const hasMicEnabled = (tracks: PresenceTrack[]): boolean =>
  tracks.some((track) => (isMicSource(track) || isAudioTrack(track)) && isUnmutedTrack(track));

const hasCameraEnabled = (tracks: PresenceTrack[]): boolean =>
  tracks.some((track) => isCameraSource(track) && isVideoTrack(track) && isUnmutedTrack(track));

const normalizeUserId = (value: string) => value.trim().toLowerCase();

const toLivekitHttpUrl = (value: string): string => {
  const parsed = new URL(value);
  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }
  return parsed.toString();
};

export async function GET(request: NextRequest, { params }: Params) {
  const { serverId } = await params;

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL ?? process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    return NextResponse.json(
      { error: "Defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no .env.local." },
      { status: 500 },
    );
  }

  try {
    const authenticatedUserId = requireAuthenticatedUserId(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      ensureSameAuthenticatedUser(authenticatedUserId, userId);
    }

    const server = await getServerForUser(serverId, authenticatedUserId);
    const roomService = new RoomServiceClient(toLivekitHttpUrl(livekitUrl), apiKey, apiSecret);
    const voiceChannels = server.channels.filter((channel) => channel.type === "voice");

    const entries = await Promise.all(
      voiceChannels.map(async (channel) => {
        const roomName = `${serverId}:${channel.id}`;

        try {
          const participants = await roomService.listParticipants(roomName);
          const uniqueByUserId = new Map<
            string,
            { identity: string; userId: string; userName: string; micEnabled: boolean; cameraEnabled: boolean }
          >();

          participants.forEach((participant) => {
            const identity = participant.identity || "";
            const [rawUserId] = identity.split("::");
            const normalizedUserId = normalizeUserId(rawUserId || identity);
            if (!normalizedUserId || uniqueByUserId.has(normalizedUserId)) {
              return;
            }

            uniqueByUserId.set(normalizedUserId, {
              identity,
              userId: normalizedUserId,
              userName: participant.name || normalizedUserId,
              micEnabled: hasMicEnabled((participant.tracks ?? []) as PresenceTrack[]),
              cameraEnabled: hasCameraEnabled((participant.tracks ?? []) as PresenceTrack[]),
            });
          });

          return [channel.id, [...uniqueByUserId.values()]] as const;
        } catch {
          return [channel.id, []] as const;
        }
      }),
    );

    return NextResponse.json({
      channels: Object.fromEntries(entries),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar presença de voz." },
      { status: getApiErrorStatus(error) },
    );
  }
}
