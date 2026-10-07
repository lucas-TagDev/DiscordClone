"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ControlBar,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { LocalAudioTrack, RemoteAudioTrack, RemoteParticipant, RoomEvent, Track } from "livekit-client";
import { ServerSound } from "@/lib/types";

const ROOM_CONNECT_OPTIONS = { autoSubscribe: false };
const MAX_SOUND_DURATION_SECONDS = 10;
const SOUND_PLAY_GLOBAL_COOLDOWN_MS = 1000;
const SOUND_PLAY_PER_SOUND_COOLDOWN_MS = 2500;
const SOUND_PLAY_INCOMING_WINDOW_MS = 6000;
const SOUND_PLAY_INCOMING_MAX_PER_USER = 4;
const SOUND_PLAY_WARNING_COOLDOWN_MS = 2500;

const applyTrackVolume = (audioTrack: LocalAudioTrack | RemoteAudioTrack | undefined, volume: number) => {
  if (!audioTrack) {
    return;
  }

  if ("setVolume" in audioTrack && typeof audioTrack.setVolume === "function") {
    const normalizedVolume = Math.max(0, Math.min(100, volume));
    audioTrack.setVolume(normalizedVolume / 100);
  }
};

const writeWavString = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const createWavBlobFromAudioBuffer = (audioBuffer: AudioBuffer): Blob => {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frameCount = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const pcmDataSize = frameCount * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + pcmDataSize);
  const view = new DataView(wavBuffer);

  writeWavString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmDataSize, true);
  writeWavString(view, 8, "WAVE");
  writeWavString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeWavString(view, 36, "data");
  view.setUint32(40, pcmDataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[frame] ?? 0));
      const sampleInt = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, sampleInt, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
};

const trimAudioFileToWav = async (
  file: File,
  startSeconds: number,
  durationSeconds: number,
): Promise<File> => {
  if (typeof window === "undefined") {
    throw new Error("Recorte de áudio indisponível neste ambiente.");
  }

  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Seu navegador não suporta recorte de áudio.");
  }

  const audioContext = new AudioContextClass();
  try {
    const inputBuffer = await file.arrayBuffer();
    const decodedAudio = await audioContext.decodeAudioData(inputBuffer.slice(0));

    const sampleRate = decodedAudio.sampleRate;
    const maxStart = Math.max(0, decodedAudio.duration - durationSeconds);
    const clampedStart = Math.max(0, Math.min(startSeconds, maxStart));
    const startFrame = Math.floor(clampedStart * sampleRate);
    const requestedFrameCount = Math.floor(durationSeconds * sampleRate);
    const availableFrameCount = decodedAudio.length - startFrame;
    const frameCount = Math.max(1, Math.min(requestedFrameCount, availableFrameCount));

    const trimmedBuffer = audioContext.createBuffer(decodedAudio.numberOfChannels, frameCount, sampleRate);
    for (let channel = 0; channel < decodedAudio.numberOfChannels; channel += 1) {
      const sourceData = decodedAudio.getChannelData(channel).subarray(startFrame, startFrame + frameCount);
      trimmedBuffer.copyToChannel(sourceData, channel, 0);
    }

    const wavBlob = createWavBlobFromAudioBuffer(trimmedBuffer);
    const baseName = file.name.replace(/\.[^/.]+$/, "") || "som";
    return new File([wavBlob], `${baseName}-recorte.wav`, { type: "audio/wav" });
  } finally {
    void audioContext.close().catch(() => undefined);
  }
};

type WatchStateMessage = {
  type: "watch-state";
  viewerId: string;
  viewerName: string;
  watchingIds: string[];
};

type SoundPlayMessage = {
  type: "sound-play";
  soundId: string;
  soundName: string;
  soundUrl: string;
  senderUserId: string;
};

type SoundCatalogUpdatedMessage = {
  type: "sound-catalog-updated";
  serverId: string;
  actorUserId: string;
  occurredAt: number;
};

type ListeningStateMessage = {
  type: "listening-state";
  participantId: string;
  isListening: boolean;
};

type VoiceRoomProps = {
  token: string;
  serverUrl: string;
  serverId?: string | null;
  joinWithMicEnabled?: boolean;
  joinWithCameraEnabled?: boolean;
  noiseSuppressionEnabled?: boolean;
  avatarByUserId?: Record<string, string>;
  currentUserId: string;
  canUploadServerSounds?: boolean;
  canDeleteServerSounds?: boolean;
  canKickFromVoice?: boolean;
  canMoveVoiceUsers?: boolean;
  currentVoiceChannelId?: string | null;
  voiceChannels?: { id: string; name: string }[];
  onModerationAction?: (payload: {
    action: "voice-kick" | "voice-move";
    targetUserId: string;
    targetChannelId?: string;
  }) => Promise<void> | void;
  onPresenceStatusChanged?: () => void;
  onListeningStateChanged?: (stateByUserId: Record<string, boolean>) => void;
  onLeave: (disconnectedToken: string) => void;
};

export function VoiceRoom({
  token,
  serverUrl,
  serverId = null,
  joinWithMicEnabled = true,
  joinWithCameraEnabled = false,
  noiseSuppressionEnabled = true,
  avatarByUserId = {},
  currentUserId,
  canUploadServerSounds = true,
  canDeleteServerSounds = false,
  canKickFromVoice = false,
  canMoveVoiceUsers = false,
  currentVoiceChannelId = null,
  voiceChannels = [],
  onModerationAction,
  onPresenceStatusChanged,
  onListeningStateChanged,
  onLeave,
}: VoiceRoomProps) {
  const micCaptureOptions = useMemo(
    () => ({
      noiseSuppression: noiseSuppressionEnabled,
      echoCancellation: noiseSuppressionEnabled,
      autoGainControl: noiseSuppressionEnabled,
    }),
    [noiseSuppressionEnabled],
  );

  return (
    <div className="h-full min-h-[520px] rounded-md border border-zinc-700 overflow-hidden">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect
        video={joinWithCameraEnabled}
        audio={joinWithMicEnabled ? micCaptureOptions : false}
        connectOptions={ROOM_CONNECT_OPTIONS}
        onDisconnected={() => onLeave(token)}
        data-lk-theme="default"
        className="h-full bg-zinc-950"
      >
        <VoiceRoomContent
          serverId={serverId}
          avatarByUserId={avatarByUserId}
          currentUserId={currentUserId}
          canUploadServerSounds={canUploadServerSounds}
          canDeleteServerSounds={canDeleteServerSounds}
          canKickFromVoice={canKickFromVoice}
          canMoveVoiceUsers={canMoveVoiceUsers}
          micCaptureOptions={micCaptureOptions}
          currentVoiceChannelId={currentVoiceChannelId}
          voiceChannels={voiceChannels}
          onModerationAction={onModerationAction}
          onPresenceStatusChanged={onPresenceStatusChanged}
          onListeningStateChanged={onListeningStateChanged}
        />
      </LiveKitRoom>
    </div>
  );
}

function VoiceRoomContent({
  serverId,
  avatarByUserId,
  currentUserId,
  canUploadServerSounds,
  canDeleteServerSounds,
  canKickFromVoice,
  canMoveVoiceUsers,
  micCaptureOptions,
  currentVoiceChannelId,
  voiceChannels,
  onModerationAction,
  onPresenceStatusChanged,
  onListeningStateChanged,
}: {
  serverId: string | null;
  avatarByUserId: Record<string, string>;
  currentUserId: string;
  canUploadServerSounds: boolean;
  canDeleteServerSounds: boolean;
  canKickFromVoice: boolean;
  canMoveVoiceUsers: boolean;
  micCaptureOptions: {
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
  };
  currentVoiceChannelId: string | null;
  voiceChannels: { id: string; name: string }[];
  onModerationAction?: (payload: {
    action: "voice-kick" | "voice-move";
    targetUserId: string;
    targetChannelId?: string;
  }) => Promise<void> | void;
  onPresenceStatusChanged?: () => void;
  onListeningStateChanged?: (stateByUserId: Record<string, boolean>) => void;
}) {
  const room = useRoomContext();
  const participants = useParticipants();
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const [participantOrderById, setParticipantOrderById] = useState<Record<string, number>>({});
  const initializedAudioPublicationSidsRef = useRef(new Set<string>());
  const initializedPublicationSidsRef = useRef(new Set<string>());
  const initializedHiddenTrackKeysRef = useRef(new Set<string>());
  const [hiddenTrackKeys, setHiddenTrackKeys] = useState<string[]>([]);
  const [fullscreenParticipantId, setFullscreenParticipantId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    participantId: string;
    source: "camera" | "screen" | "placeholder";
    x: number;
    y: number;
  } | null>(null);
  const [serverSounds, setServerSounds] = useState<ServerSound[]>([]);
  const [collapsedSoundSections, setCollapsedSoundSections] = useState<Record<string, boolean>>({});
  const [showOnlyFavoriteSounds, setShowOnlyFavoriteSounds] = useState(false);
  const [isLoadingServerSounds, setIsLoadingServerSounds] = useState(false);
  const [isSoundboardBusy, setIsSoundboardBusy] = useState(false);
  const [soundboardError, setSoundboardError] = useState<string | null>(null);
  const [newSoundName, setNewSoundName] = useState("");
  const [newSoundFile, setNewSoundFile] = useState<File | null>(null);
  const [newSoundOriginalDuration, setNewSoundOriginalDuration] = useState<number | null>(null);
  const [newSoundTrimStartSeconds, setNewSoundTrimStartSeconds] = useState(0);
  const [newSoundTrimDurationSeconds, setNewSoundTrimDurationSeconds] = useState(MAX_SOUND_DURATION_SECONDS);
  const [isAnalyzingSoundFile, setIsAnalyzingSoundFile] = useState(false);
  const [isPlayingTrimPreview, setIsPlayingTrimPreview] = useState(false);
  const [newSoundInputKey, setNewSoundInputKey] = useState(0);
  const [playingSoundIds, setPlayingSoundIds] = useState<string[]>([]);
  const [soundEffectsVolume, setSoundEffectsVolume] = useState(100);
  const [mutedSoundEffectsByUserId, setMutedSoundEffectsByUserId] = useState<Record<string, boolean>>({});
  const [enableSelfScreenShareMonitor, setEnableSelfScreenShareMonitor] = useState(false);
  const [localScreenShareAudioTrack, setLocalScreenShareAudioTrack] = useState<LocalAudioTrack | null>(null);
  const [isAudioOnlySharing, setIsAudioOnlySharing] = useState(false);
  const [audioOnlyShareError, setAudioOnlyShareError] = useState<string | null>(null);
  const lastOutgoingSoundAtRef = useRef(0);
  const outgoingSoundCooldownByIdRef = useRef<Record<string, number>>({});
  const incomingSoundTimestampsByUserRef = useRef<Record<string, number[]>>({});
  const lastIncomingSoundWarningByUserRef = useRef<Record<string, number>>({});
  const audioPlayersRef = useRef<HTMLAudioElement[]>([]);
  const trimPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const trimPreviewTimeoutRef = useRef<number | null>(null);
  const trimPreviewObjectUrlRef = useRef<string | null>(null);
  const [audioPreferenceByParticipant, setAudioPreferenceByParticipant] = useState<Record<string, boolean>>({});
  const [audioVolumeByParticipant, setAudioVolumeByParticipant] = useState<Record<string, number>>({});
  const [sharedAudioPreferenceByParticipant, setSharedAudioPreferenceByParticipant] = useState<Record<string, boolean>>({});
  const [sharedAudioVolumeByParticipant, setSharedAudioVolumeByParticipant] = useState<Record<string, number>>({});
  const [isSelfSilenced, setIsSelfSilenced] = useState(false);
  const [watchedParticipantIds, setWatchedParticipantIds] = useState<string[]>([]);
  const [watchStateByViewer, setWatchStateByViewer] = useState<Record<string, WatchStateMessage>>({});
  const [listeningStateByParticipant, setListeningStateByParticipant] = useState<Record<string, boolean>>({});
  const selfScreenShareMonitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioOnlyShareTrackRef = useRef<LocalAudioTrack | null>(null);
  const audioOnlyShareStreamRef = useRef<MediaStream | null>(null);
  const previousMicEnabledRef = useRef<boolean | null>(null);
  const [loadedVolumeStorageKey, setLoadedVolumeStorageKey] = useState("");
  const [loadedSoundEffectsStorageKey, setLoadedSoundEffectsStorageKey] = useState("");
  const [loadedSoundFilterStorageKey, setLoadedSoundFilterStorageKey] = useState("");

  const remoteParticipants = useMemo<RemoteParticipant[]>(
    () =>
      participants
        .filter((participant) => !participant.isLocal)
        .map((participant) => room.remoteParticipants.get(participant.identity))
        .filter((participant): participant is RemoteParticipant => !!participant),
    [participants, room],
  );

  const trackRefs = useTracks(
    [Track.Source.ScreenShare, Track.Source.Camera],
    {
      onlySubscribed: true,
    },
  );

  const localIdentity = room.localParticipant.identity;
  const localName = room.localParticipant.name || localIdentity;
  const normalizedCurrentUserId = useMemo(() => currentUserId.trim().toLowerCase(), [currentUserId]);
  const stableStorageScope = useMemo(
    () => `${normalizedCurrentUserId}:${serverId || "global"}`,
    [normalizedCurrentUserId, serverId],
  );
  const roomStorageScope = useMemo(
    () => `${normalizedCurrentUserId}:${room.name || "default"}`,
    [normalizedCurrentUserId, room.name],
  );
  const volumeStorageKey = useMemo(
    () => `twinslkit:voice:volume:${stableStorageScope}`,
    [stableStorageScope],
  );
  const soundEffectsStorageKey = useMemo(
    () => `twinslkit:voice:sfx:${stableStorageScope}`,
    [stableStorageScope],
  );
  const presenceNotifyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notifyPresenceStatusChanged = useCallback(() => {
    if (!onPresenceStatusChanged) {
      return;
    }

    if (presenceNotifyTimeoutRef.current) {
      clearTimeout(presenceNotifyTimeoutRef.current);
    }

    presenceNotifyTimeoutRef.current = setTimeout(() => {
      onPresenceStatusChanged();
      presenceNotifyTimeoutRef.current = null;
    }, 150);
  }, [onPresenceStatusChanged]);

  useEffect(() => {
    const events: RoomEvent[] = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
    ];

    events.forEach((eventName) => {
      room.on(eventName, notifyPresenceStatusChanged);
    });

    notifyPresenceStatusChanged();

    return () => {
      events.forEach((eventName) => {
        room.off(eventName, notifyPresenceStatusChanged);
      });

      if (presenceNotifyTimeoutRef.current) {
        clearTimeout(presenceNotifyTimeoutRef.current);
        presenceNotifyTimeoutRef.current = null;
      }
    };
  }, [notifyPresenceStatusChanged, room]);

  useEffect(() => {
    const syncLocalScreenShareAudioTrack = () => {
      const publication = [...room.localParticipant.audioTrackPublications.values()].find(
        (item) => item.source === Track.Source.ScreenShareAudio && !!item.audioTrack && !item.isMuted,
      );

      setLocalScreenShareAudioTrack(publication?.audioTrack ?? null);
    };

    const events: RoomEvent[] = [
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
    ];

    events.forEach((eventName) => {
      room.on(eventName, syncLocalScreenShareAudioTrack);
    });

    syncLocalScreenShareAudioTrack();

    return () => {
      events.forEach((eventName) => {
        room.off(eventName, syncLocalScreenShareAudioTrack);
      });
    };
  }, [room]);

  useEffect(() => {
    const audioElement = selfScreenShareMonitorAudioRef.current;

    if (!enableSelfScreenShareMonitor || !localScreenShareAudioTrack) {
      if (audioElement) {
        audioElement.pause();
        audioElement.removeAttribute("src");
        audioElement.load();
      }
      return;
    }

    const monitorAudio = audioElement ?? new Audio();
    monitorAudio.preload = "auto";
    monitorAudio.volume = 1;
    selfScreenShareMonitorAudioRef.current = monitorAudio;

    localScreenShareAudioTrack.attach(monitorAudio);
    void monitorAudio.play().catch(() => undefined);

    return () => {
      localScreenShareAudioTrack.detach(monitorAudio);
      monitorAudio.pause();
      monitorAudio.removeAttribute("src");
      monitorAudio.load();
    };
  }, [enableSelfScreenShareMonitor, localScreenShareAudioTrack]);

  const soundFilterStorageKey = useMemo(
    () => `twinslkit:voice:sound-filter:${stableStorageScope}`,
    [stableStorageScope],
  );
  const getCardSourceFromTrackSource = (source: Track.Source) =>
    source === Track.Source.ScreenShare ? "screen" : "camera";
  const getTrackKey = (participantId: string, source: "camera" | "screen") =>
    `${participantId}:${source}`;

  const publishRoomData = useCallback(async (payload: WatchStateMessage | SoundPlayMessage | ListeningStateMessage | SoundCatalogUpdatedMessage) => {
    if (room.state !== "connected") {
      throw new Error("Conexão de voz indisponível no momento. Aguarde reconectar e tente novamente.");
    }

    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(payload)),
      {
        reliable: true,
      },
    );
  }, [room.localParticipant, room.state]);

  const publishListeningState = useCallback((isListening: boolean) => {
    const payload: ListeningStateMessage = {
      type: "listening-state",
      participantId: localIdentity,
      isListening,
    };

    void publishRoomData(payload).catch(() => undefined);
  }, [localIdentity, publishRoomData]);

  const stopAudioOnlyShare = useCallback(() => {
    const localTrack = audioOnlyShareTrackRef.current;
    if (localTrack) {
      try {
        room.localParticipant.unpublishTrack(localTrack, true);
      } catch {
        // ignore unpublish failures
      }
      localTrack.stop();
    }

    const stream = audioOnlyShareStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    audioOnlyShareTrackRef.current = null;
    audioOnlyShareStreamRef.current = null;
    setIsAudioOnlySharing(false);
  }, [room.localParticipant]);

  const startAudioOnlyShare = useCallback(async () => {
    if (room.state !== "connected") {
      setAudioOnlyShareError("Conecte-se ao canal de voz antes de compartilhar audio.");
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setAudioOnlyShareError("Seu navegador nao suporta compartilhamento de audio.");
      return;
    }

    if (audioOnlyShareTrackRef.current) {
      return;
    }

    setAudioOnlyShareError(null);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: true,
      });

      const [audioTrack] = stream.getAudioTracks();
      if (!audioTrack) {
        stream.getTracks().forEach((track) => track.stop());
        setAudioOnlyShareError("Nenhum audio foi selecionado para compartilhar.");
        return;
      }

      stream.getVideoTracks().forEach((track) => track.stop());

      audioOnlyShareStreamRef.current = stream;

      const localTrack = new LocalAudioTrack(audioTrack);
      audioOnlyShareTrackRef.current = localTrack;

      audioTrack.addEventListener("ended", () => {
        stopAudioOnlyShare();
      });

      await room.localParticipant.publishTrack(localTrack, {
        source: Track.Source.ScreenShareAudio,
      });

      setIsAudioOnlySharing(true);
    } catch (error) {
      stopAudioOnlyShare();
      const message = error instanceof Error ? error.message : "Falha ao compartilhar apenas o audio.";
      if (message.toLowerCase().includes("not supported") || message.toLowerCase().includes("notsupported")) {
        setAudioOnlyShareError("Seu navegador não suporta compartilhar apenas áudio nesta plataforma. Tente Chrome/Edge e selecione a aba com opção de compartilhar áudio.");
        return;
      }
      setAudioOnlyShareError(message);
    }
  }, [room, stopAudioOnlyShare]);
  const maxTrimStartSeconds = useMemo(() => {
    if (!newSoundOriginalDuration || newSoundOriginalDuration <= newSoundTrimDurationSeconds) {
      return 0;
    }

    return Math.max(0, newSoundOriginalDuration - newSoundTrimDurationSeconds);
  }, [newSoundOriginalDuration, newSoundTrimDurationSeconds]);

  const maxTrimDurationSeconds = useMemo(() => {
    if (!newSoundOriginalDuration) {
      return MAX_SOUND_DURATION_SECONDS;
    }

    return Math.min(MAX_SOUND_DURATION_SECONDS, newSoundOriginalDuration);
  }, [newSoundOriginalDuration]);

  const filteredServerSounds = useMemo(
    () => (showOnlyFavoriteSounds ? serverSounds.filter((sound) => sound.isFavorite) : serverSounds),
    [serverSounds, showOnlyFavoriteSounds],
  );

  const groupedServerSounds = useMemo(() => {
    const sections: Array<{ key: string; serverName: string; isCurrentServer: boolean; sounds: ServerSound[] }> = [];
    const byKey = new Map<string, number>();

    filteredServerSounds.forEach((sound) => {
      const key = `${sound.serverId}:${sound.sourceServerName}`;
      const existingIndex = byKey.get(key);
      if (existingIndex === undefined) {
        byKey.set(key, sections.length);
        sections.push({
          key,
          serverName: sound.sourceServerName,
          isCurrentServer: sound.serverId === serverId,
          sounds: [sound],
        });
        return;
      }

      sections[existingIndex].sounds.push(sound);
    });

    return sections.sort((left, right) => {
      if (left.isCurrentServer !== right.isCurrentServer) {
        return left.isCurrentServer ? -1 : 1;
      }

      return left.serverName.localeCompare(right.serverName, "pt-BR", { sensitivity: "base" });
    });
  }, [filteredServerSounds, serverId]);

  const loadServerSounds = useCallback(async () => {
    if (!serverId || !normalizedCurrentUserId) {
      setServerSounds([]);
      return;
    }

    setIsLoadingServerSounds(true);
    setSoundboardError(null);
    const response = await fetch(
      `/api/servers/${serverId}/sounds?userId=${encodeURIComponent(normalizedCurrentUserId)}`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    setIsLoadingServerSounds(false);

    if (!response.ok) {
      setSoundboardError(payload.error ?? "Falha ao carregar sons do servidor.");
      return;
    }

    setServerSounds(payload.sounds as ServerSound[]);
  }, [normalizedCurrentUserId, serverId]);

  const getSoundDurationSeconds = useCallback((file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const audio = document.createElement("audio");
      audio.preload = "metadata";

      const cleanup = () => {
        audio.removeAttribute("src");
        audio.load();
        URL.revokeObjectURL(objectUrl);
      };

      audio.onloadedmetadata = () => {
        const duration = audio.duration;
        cleanup();
        if (!Number.isFinite(duration) || duration <= 0) {
          reject(new Error("Não foi possível ler a duração do áudio."));
          return;
        }
        resolve(duration);
      };

      audio.onerror = () => {
        cleanup();
        reject(new Error("Arquivo de áudio inválido."));
      };

      audio.src = objectUrl;
    });
  }, []);

  const stopTrimPreview = useCallback(() => {
    if (trimPreviewTimeoutRef.current !== null) {
      window.clearTimeout(trimPreviewTimeoutRef.current);
      trimPreviewTimeoutRef.current = null;
    }

    if (trimPreviewAudioRef.current) {
      trimPreviewAudioRef.current.pause();
      trimPreviewAudioRef.current.removeAttribute("src");
      trimPreviewAudioRef.current.load();
      trimPreviewAudioRef.current = null;
    }

    if (trimPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(trimPreviewObjectUrlRef.current);
      trimPreviewObjectUrlRef.current = null;
    }

    setIsPlayingTrimPreview(false);
  }, []);

  const playTrimPreview = useCallback(async () => {
    if (!newSoundFile) {
      return;
    }

    stopTrimPreview();
    setSoundboardError(null);

    try {
      const objectUrl = URL.createObjectURL(newSoundFile);
      trimPreviewObjectUrlRef.current = objectUrl;

      const audio = new Audio(objectUrl);
      audio.preload = "metadata";
      trimPreviewAudioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onloadedmetadata = () => resolve();
        audio.onerror = () => reject(new Error("Não foi possível carregar a prévia do áudio."));
      });

      const fullAllowedDuration = Math.min(newSoundOriginalDuration ?? audio.duration, MAX_SOUND_DURATION_SECONDS);
      const selectedDuration = Math.max(0.1, Math.min(newSoundTrimDurationSeconds, fullAllowedDuration));
      const selectedStart = newSoundTrimStartSeconds;

      const safeStart = Math.max(0, Math.min(selectedStart, Math.max(0, audio.duration - 0.1)));
      const safeDuration = Math.max(0.1, Math.min(selectedDuration, Math.max(0.1, audio.duration - safeStart)));

      audio.currentTime = safeStart;
      setIsPlayingTrimPreview(true);
      await audio.play();

      trimPreviewTimeoutRef.current = window.setTimeout(() => {
        stopTrimPreview();
      }, Math.ceil(safeDuration * 1000));
    } catch (error) {
      stopTrimPreview();
      setSoundboardError(error instanceof Error ? error.message : "Falha ao reproduzir prévia do trecho.");
    }
  }, [
    newSoundFile,
    newSoundOriginalDuration,
    newSoundTrimDurationSeconds,
    newSoundTrimStartSeconds,
    stopTrimPreview,
  ]);

  useEffect(() => {
    if (!newSoundFile) {
      setNewSoundOriginalDuration(null);
      setNewSoundTrimStartSeconds(0);
      setNewSoundTrimDurationSeconds(MAX_SOUND_DURATION_SECONDS);
      setIsAnalyzingSoundFile(false);
      stopTrimPreview();
      return;
    }

    let isCancelled = false;
    setIsAnalyzingSoundFile(true);
    setSoundboardError(null);

    void getSoundDurationSeconds(newSoundFile)
      .then((duration) => {
        if (isCancelled) {
          return;
        }
        setNewSoundOriginalDuration(duration);
        setNewSoundTrimStartSeconds(0);
        setNewSoundTrimDurationSeconds(Math.min(MAX_SOUND_DURATION_SECONDS, duration));
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        setNewSoundOriginalDuration(null);
        setSoundboardError(error instanceof Error ? error.message : "Falha ao analisar o áudio.");
      })
      .finally(() => {
        if (isCancelled) {
          return;
        }
        setIsAnalyzingSoundFile(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [getSoundDurationSeconds, newSoundFile, stopTrimPreview]);

  useEffect(() => {
    setNewSoundTrimStartSeconds((currentValue) => {
      if (currentValue <= maxTrimStartSeconds) {
        return currentValue;
      }
      return maxTrimStartSeconds;
    });
  }, [maxTrimStartSeconds]);

  const playSoundLocally = useCallback((payload: SoundPlayMessage) => {
    if (!payload.soundUrl.startsWith("/uploads/")) {
      return;
    }
    if (isSelfSilenced) {
      return;
    }
    if (mutedSoundEffectsByUserId[payload.senderUserId]) {
      return;
    }

    const audio = new Audio(payload.soundUrl);
    audio.preload = "auto";
    audio.volume = Math.max(0, Math.min(1, soundEffectsVolume / 100));

    setPlayingSoundIds((currentValue) =>
      currentValue.includes(payload.soundId) ? currentValue : [...currentValue, payload.soundId],
    );

    const clear = () => {
      setPlayingSoundIds((currentValue) => currentValue.filter((value) => value !== payload.soundId));
      audioPlayersRef.current = audioPlayersRef.current.filter((item) => item !== audio);
    };

    audio.onended = clear;
    audio.onerror = clear;
    audioPlayersRef.current.push(audio);

    void audio.play().catch(() => {
      clear();
      setSoundboardError(`Não foi possível reproduzir o som: ${payload.soundName}`);
    });
  }, [isSelfSilenced, mutedSoundEffectsByUserId, soundEffectsVolume]);

  const isIncomingSoundRateLimited = useCallback((senderUserId: string) => {
    const normalizedSenderUserId = senderUserId.trim().toLowerCase();
    if (!normalizedSenderUserId) {
      return false;
    }

    const now = Date.now();
    const minAllowedTimestamp = now - SOUND_PLAY_INCOMING_WINDOW_MS;
    const currentEntries = incomingSoundTimestampsByUserRef.current[normalizedSenderUserId] ?? [];
    const recentEntries = currentEntries.filter((timestamp) => timestamp >= minAllowedTimestamp);

    if (recentEntries.length >= SOUND_PLAY_INCOMING_MAX_PER_USER) {
      incomingSoundTimestampsByUserRef.current[normalizedSenderUserId] = recentEntries;
      return true;
    }

    incomingSoundTimestampsByUserRef.current[normalizedSenderUserId] = [...recentEntries, now];
    return false;
  }, []);

  const playServerSound = useCallback(async (sound: ServerSound) => {
    if (room.state !== "connected") {
      setSoundboardError("Conexão de voz indisponível no momento. Aguarde reconectar e tente novamente.");
      return;
    }

    const now = Date.now();
    const globalCooldownRemainingMs = lastOutgoingSoundAtRef.current + SOUND_PLAY_GLOBAL_COOLDOWN_MS - now;
    const perSoundCooldownRemainingMs = (outgoingSoundCooldownByIdRef.current[sound.id] ?? 0) - now;
    const cooldownRemainingMs = Math.max(globalCooldownRemainingMs, perSoundCooldownRemainingMs);

    if (cooldownRemainingMs > 0) {
      const waitSeconds = Math.max(1, Math.ceil(cooldownRemainingMs / 1000));
      setSoundboardError(`Aguarde ${waitSeconds}s antes de tocar outro som.`);
      return;
    }

    lastOutgoingSoundAtRef.current = now;
    outgoingSoundCooldownByIdRef.current[sound.id] = now + SOUND_PLAY_PER_SOUND_COOLDOWN_MS;

    const payload: SoundPlayMessage = {
      type: "sound-play",
      soundId: sound.id,
      soundName: sound.name,
      soundUrl: sound.url,
      senderUserId: normalizedCurrentUserId,
    };

    setSoundboardError(null);
    playSoundLocally(payload);

    try {
      await publishRoomData(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao compartilhar som no canal de voz.";
      if (message.toLowerCase().includes("pc manager is closed")) {
        setSoundboardError("Conexão de voz foi encerrada. Reconecte ao canal e tente novamente.");
        return;
      }
      setSoundboardError(message);
    }
  }, [normalizedCurrentUserId, playSoundLocally, publishRoomData, room.state]);

  const uploadServerSound = useCallback(async () => {
    if (!serverId || !newSoundFile || !normalizedCurrentUserId) {
      return;
    }

    if (!canUploadServerSounds) {
      setSoundboardError("Seu cargo não pode enviar áudio neste servidor.");
      return;
    }

    setSoundboardError(null);
    setIsSoundboardBusy(true);

    try {
      let duration = newSoundOriginalDuration;
      if (!duration || !Number.isFinite(duration)) {
        duration = await getSoundDurationSeconds(newSoundFile);
      }

      let fileToUpload = newSoundFile;
      const fullAllowedDuration = Math.min(duration, MAX_SOUND_DURATION_SECONDS);
      const effectiveTrimDuration = Math.max(0.1, Math.min(fullAllowedDuration, newSoundTrimDurationSeconds));
      const hasCustomTrim =
        newSoundTrimStartSeconds > 0.01 ||
        effectiveTrimDuration < fullAllowedDuration - 0.01;

      if (duration > MAX_SOUND_DURATION_SECONDS || hasCustomTrim) {
        const effectiveTrimDuration = Math.max(0.1, Math.min(MAX_SOUND_DURATION_SECONDS, newSoundTrimDurationSeconds));
        fileToUpload = await trimAudioFileToWav(
          newSoundFile,
          newSoundTrimStartSeconds,
          effectiveTrimDuration,
        );
      }

      const formData = new FormData();
      formData.append("actorId", normalizedCurrentUserId);
      formData.append("sound", fileToUpload);
      if (newSoundName.trim()) {
        formData.append("name", newSoundName.trim());
      }

      const response = await fetch(`/api/servers/${serverId}/sounds`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSoundboardError(payload.error ?? "Falha ao enviar áudio.");
        return;
      }

      const created = payload.sound as ServerSound;
      setServerSounds((currentValue) => {
        const nextValue = [created, ...currentValue];
        return [...nextValue].sort((left, right) => {
          if (left.isFavorite !== right.isFavorite) {
            return left.isFavorite ? -1 : 1;
          }

          return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        });
      });

      void publishRoomData({
        type: "sound-catalog-updated",
        serverId,
        actorUserId: normalizedCurrentUserId,
        occurredAt: Date.now(),
      }).catch(() => undefined);

      setNewSoundName("");
      setNewSoundFile(null);
      setNewSoundOriginalDuration(null);
      setNewSoundTrimStartSeconds(0);
      setNewSoundTrimDurationSeconds(MAX_SOUND_DURATION_SECONDS);
      setNewSoundInputKey((value) => value + 1);
    } catch (error) {
      setSoundboardError(error instanceof Error ? error.message : "Falha ao preparar áudio para envio.");
    } finally {
      setIsSoundboardBusy(false);
    }
  }, [
    getSoundDurationSeconds,
    newSoundFile,
    newSoundName,
    newSoundOriginalDuration,
    newSoundTrimDurationSeconds,
    newSoundTrimStartSeconds,
    normalizedCurrentUserId,
    serverId,
    canUploadServerSounds,
    publishRoomData,
  ]);

  const toggleServerSoundFavorite = useCallback(async (sound: ServerSound) => {
    if (!serverId || !normalizedCurrentUserId) {
      return;
    }

    const nextIsFavorite = !sound.isFavorite;
    setSoundboardError(null);

    setServerSounds((currentValue) => {
      const updated = currentValue.map((item) =>
        item.id === sound.id
          ? { ...item, isFavorite: nextIsFavorite }
          : item,
      );

      return [...updated].sort((left, right) => {
        if (left.isFavorite !== right.isFavorite) {
          return left.isFavorite ? -1 : 1;
        }

        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      });
    });

    const response = await fetch(`/api/servers/${serverId}/sounds/${sound.id}/favorite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: normalizedCurrentUserId,
        isFavorite: nextIsFavorite,
      }),
    });

    if (response.ok) {
      return;
    }

    const payload = await response.json().catch(() => ({}));
    setSoundboardError(payload.error ?? "Falha ao atualizar favorito.");

    setServerSounds((currentValue) => {
      const reverted = currentValue.map((item) =>
        item.id === sound.id
          ? { ...item, isFavorite: sound.isFavorite }
          : item,
      );

      return [...reverted].sort((left, right) => {
        if (left.isFavorite !== right.isFavorite) {
          return left.isFavorite ? -1 : 1;
        }

        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      });
    });
  }, [normalizedCurrentUserId, serverId]);

  const removeServerSound = useCallback(async (sound: ServerSound) => {
    if (!serverId || !normalizedCurrentUserId) {
      return;
    }

    const confirmed = window.confirm(`Remover o som \"${sound.name}\"?`);
    if (!confirmed) {
      return;
    }

    setSoundboardError(null);
    setIsSoundboardBusy(true);

    const response = await fetch(
      `/api/servers/${serverId}/sounds/${sound.id}?actorId=${encodeURIComponent(normalizedCurrentUserId)}`,
      { method: "DELETE" },
    );
    const payload = await response.json().catch(() => ({}));
    setIsSoundboardBusy(false);

    if (!response.ok) {
      setSoundboardError(payload.error ?? "Falha ao remover som.");
      return;
    }

    setServerSounds((currentValue) => currentValue.filter((item) => item.id !== sound.id));

    void publishRoomData({
      type: "sound-catalog-updated",
      serverId,
      actorUserId: normalizedCurrentUserId,
      occurredAt: Date.now(),
    }).catch(() => undefined);
  }, [normalizedCurrentUserId, publishRoomData, serverId]);

  const publishWatchState = useCallback(
    (watchingIds: string[]) => {
      const payload: WatchStateMessage = {
        type: "watch-state",
        viewerId: localIdentity,
        viewerName: localName,
        watchingIds,
      };

      void publishRoomData(payload).catch(() => undefined);
    },
    [localIdentity, localName, publishRoomData],
  );

  const setWatchingState = (participantId: string, isWatching: boolean) => {
    setWatchedParticipantIds((currentValue) => {
      const nextSet = new Set(currentValue);
      if (isWatching) {
        nextSet.add(participantId);
      } else {
        nextSet.delete(participantId);
      }

      const nextValue = [...nextSet];
      publishWatchState(nextValue);
      return nextValue;
    });
  };

  const participantsById = useMemo(() => {
    const map = new Map<string, string>();
    participants.forEach((participant) => {
      map.set(participant.identity, participant.name || participant.identity);
    });
    return map;
  }, [participants]);

  useEffect(() => {
    setParticipantOrderById((currentValue) => {
      const currentIds = new Set(participants.map((participant) => participant.identity));
      const nextValue: Record<string, number> = {};

      Object.entries(currentValue).forEach(([participantId, order]) => {
        if (currentIds.has(participantId)) {
          nextValue[participantId] = order;
        }
      });

      let nextOrder = Object.values(nextValue).reduce((max, value) => Math.max(max, value), -1) + 1;
      participants.forEach((participant) => {
        if (!(participant.identity in nextValue)) {
          nextValue[participant.identity] = nextOrder;
          nextOrder += 1;
        }
      });

      return nextValue;
    });
  }, [participants]);

  const viewersByTarget = useMemo(() => {
    const byTarget: Record<string, { id: string; name: string }[]> = {};
    const mergedStates: Record<string, WatchStateMessage> = {
      ...watchStateByViewer,
      [localIdentity]: {
        type: "watch-state",
        viewerId: localIdentity,
        viewerName: localName,
        watchingIds: watchedParticipantIds,
      },
    };

    Object.values(mergedStates).forEach((state) => {
      state.watchingIds.forEach((targetId) => {
        if (!byTarget[targetId]) {
          byTarget[targetId] = [];
        }
        byTarget[targetId].push({ id: state.viewerId, name: state.viewerName || state.viewerId });
      });
    });

    return byTarget;
  }, [localIdentity, localName, watchStateByViewer, watchedParticipantIds]);

  const visibleTrackRefs = useMemo(
    () =>
      trackRefs.filter((trackRef) => {
        const source = getCardSourceFromTrackSource(trackRef.source);
        return !hiddenTrackKeys.includes(getTrackKey(trackRef.participant.identity, source));
      }),
    [hiddenTrackKeys, trackRefs],
  );

  const getPreferredTrack = (participantId: string) => {
    return (
      visibleTrackRefs.find(
        (trackRef) =>
          trackRef.participant.identity === participantId && trackRef.source === Track.Source.ScreenShare,
      ) ??
      visibleTrackRefs.find(
        (trackRef) => trackRef.participant.identity === participantId && trackRef.source === Track.Source.Camera,
      ) ??
      null
    );
  };

  const fullscreenTrack = fullscreenParticipantId ? getPreferredTrack(fullscreenParticipantId) : null;

  const getRemoteParticipant = (participantId: string) => room.remoteParticipants.get(participantId);

  const getAudioPublicationVolume = useCallback(
    (participantId: string, source: Track.Source | undefined) => {
      if (source === Track.Source.ScreenShareAudio) {
        return sharedAudioVolumeByParticipant[participantId] ?? 100;
      }

      return audioVolumeByParticipant[participantId] ?? 100;
    },
    [audioVolumeByParticipant, sharedAudioVolumeByParticipant],
  );

  const shouldSubscribeToAudioPublication = useCallback(
    (
      participantId: string,
      source: Track.Source | undefined,
      shouldListen: boolean,
    ) => {
      if (!shouldListen) {
        return false;
      }

      if (source === Track.Source.ScreenShareAudio) {
        const explicitPreference = sharedAudioPreferenceByParticipant[participantId];
        if (typeof explicitPreference === "boolean") {
          return explicitPreference;
        }

        return watchedParticipantIds.includes(participantId);
      }

      return true;
    },
    [sharedAudioPreferenceByParticipant, watchedParticipantIds],
  );

  useEffect(() => {
    remoteParticipants.forEach((participant) => {
      const audioPublications = [...participant.audioTrackPublications.values()];
      const videoPublications = [...participant.videoTrackPublications.values()].filter(
        (publication) =>
          publication.source === Track.Source.Camera || publication.source === Track.Source.ScreenShare,
      );

      audioPublications.forEach((publication) => {
        if (!publication.trackSid) {
          return;
        }
        if (initializedAudioPublicationSidsRef.current.has(publication.trackSid)) {
          return;
        }

        const shouldListen = (audioPreferenceByParticipant[participant.identity] ?? true) && !isSelfSilenced;
        const volume = getAudioPublicationVolume(participant.identity, publication.source);
        publication.setSubscribed(
          shouldSubscribeToAudioPublication(
            participant.identity,
            publication.source,
            shouldListen,
          ),
        );
        applyTrackVolume(publication.audioTrack, volume);
        initializedAudioPublicationSidsRef.current.add(publication.trackSid);
      });

      videoPublications.forEach((publication) => {
        if (!publication.trackSid) {
          return;
        }
        if (initializedPublicationSidsRef.current.has(publication.trackSid)) {
          return;
        }

        publication.setSubscribed(false);
        initializedPublicationSidsRef.current.add(publication.trackSid);

        const source = getCardSourceFromTrackSource(publication.source);
        const trackKey = getTrackKey(participant.identity, source);
        if (!initializedHiddenTrackKeysRef.current.has(trackKey)) {
          initializedHiddenTrackKeysRef.current.add(trackKey);
          setHiddenTrackKeys((currentValue) =>
            currentValue.includes(trackKey) ? currentValue : [...currentValue, trackKey],
          );
        }
      });
    });
  }, [
    audioPreferenceByParticipant,
    getAudioPublicationVolume,
    isSelfSilenced,
    remoteParticipants,
    shouldSubscribeToAudioPublication,
  ]);

  useEffect(() => {
    if (isSelfSilenced) {
      if (previousMicEnabledRef.current === null) {
        previousMicEnabledRef.current = room.localParticipant.isMicrophoneEnabled;
      }
      void room.localParticipant.setMicrophoneEnabled(false);
    } else {
      if (previousMicEnabledRef.current !== null) {
        void room.localParticipant.setMicrophoneEnabled(previousMicEnabledRef.current);
        previousMicEnabledRef.current = null;
      }
    }

    remoteParticipants.forEach((participant) => {
      const shouldListen = (audioPreferenceByParticipant[participant.identity] ?? true) && !isSelfSilenced;
      [...participant.audioTrackPublications.values()].forEach((publication) => {
        const volume = getAudioPublicationVolume(participant.identity, publication.source);
        publication.setSubscribed(
          shouldSubscribeToAudioPublication(
            participant.identity,
            publication.source,
            shouldListen,
          ),
        );
        applyTrackVolume(publication.audioTrack, volume);
      });
    });
  }, [
    audioPreferenceByParticipant,
    getAudioPublicationVolume,
    isSelfSilenced,
    remoteParticipants,
    room.localParticipant,
    sharedAudioPreferenceByParticipant,
    sharedAudioVolumeByParticipant,
    shouldSubscribeToAudioPublication,
    watchedParticipantIds,
  ]);

  useEffect(() => {
    if (!room.localParticipant.isMicrophoneEnabled) {
      return;
    }

    void room.localParticipant.setMicrophoneEnabled(true, {
      noiseSuppression: micCaptureOptions.noiseSuppression,
      echoCancellation: micCaptureOptions.echoCancellation,
      autoGainControl: micCaptureOptions.autoGainControl,
    });
  }, [micCaptureOptions, room.localParticipant]);

  useEffect(() => {
    try {
      const rawValue =
        window.sessionStorage.getItem(volumeStorageKey) ??
        window.sessionStorage.getItem(`twinslkit:voice:volume:${roomStorageScope}`) ??
        window.localStorage.getItem(volumeStorageKey);
      if (rawValue) {
        const parsed = JSON.parse(rawValue) as Record<string, number>;
        const sanitized: Record<string, number> = {};
        Object.entries(parsed).forEach(([participantId, value]) => {
          const normalizedValue = Math.max(0, Math.min(100, Math.round(Number(value))));
          if (Number.isFinite(normalizedValue)) {
            sanitized[participantId] = normalizedValue;
          }
        });

        setAudioVolumeByParticipant(sanitized);
      }
    } catch {
      // ignore invalid persisted values
    } finally {
      setLoadedVolumeStorageKey(volumeStorageKey);
    }
  }, [roomStorageScope, volumeStorageKey]);

  useEffect(() => {
    if (loadedVolumeStorageKey !== volumeStorageKey) {
      return;
    }

    try {
      window.sessionStorage.setItem(volumeStorageKey, JSON.stringify(audioVolumeByParticipant));
    } catch {
      // ignore storage quota / privacy mode failures
    }
  }, [audioVolumeByParticipant, loadedVolumeStorageKey, volumeStorageKey]);

  useEffect(() => {
    try {
      const rawValue =
        window.sessionStorage.getItem(soundEffectsStorageKey) ??
        window.sessionStorage.getItem(`twinslkit:voice:sfx:${roomStorageScope}`) ??
        window.localStorage.getItem(soundEffectsStorageKey);
      if (rawValue) {
        const parsed = JSON.parse(rawValue) as {
          volume?: number;
          mutedByUserId?: Record<string, boolean>;
        };

        if (typeof parsed.volume === "number" && Number.isFinite(parsed.volume)) {
          setSoundEffectsVolume(Math.max(0, Math.min(100, Math.round(parsed.volume))));
        }

        if (parsed.mutedByUserId && typeof parsed.mutedByUserId === "object") {
          const sanitized: Record<string, boolean> = {};
          Object.entries(parsed.mutedByUserId).forEach(([key, value]) => {
            if (typeof value === "boolean") {
              sanitized[key] = value;
            }
          });
          setMutedSoundEffectsByUserId(sanitized);
        }
      }
    } catch {
      // ignore invalid persisted values
    } finally {
      setLoadedSoundEffectsStorageKey(soundEffectsStorageKey);
    }
  }, [roomStorageScope, soundEffectsStorageKey]);

  useEffect(() => {
    if (loadedSoundEffectsStorageKey !== soundEffectsStorageKey) {
      return;
    }

    try {
      window.sessionStorage.setItem(
        soundEffectsStorageKey,
        JSON.stringify({
          volume: soundEffectsVolume,
          mutedByUserId: mutedSoundEffectsByUserId,
        }),
      );
    } catch {
      // ignore storage quota / privacy mode failures
    }
  }, [loadedSoundEffectsStorageKey, mutedSoundEffectsByUserId, soundEffectsStorageKey, soundEffectsVolume]);

  useEffect(() => {
    try {
      const rawValue =
        window.sessionStorage.getItem(soundFilterStorageKey) ??
        window.sessionStorage.getItem(`twinslkit:voice:sound-filter:${roomStorageScope}`);
      if (rawValue) {
        setShowOnlyFavoriteSounds(rawValue === "favorites");
      }
    } catch {
      // ignore storage quota / privacy mode failures
    } finally {
      setLoadedSoundFilterStorageKey(soundFilterStorageKey);
    }
  }, [roomStorageScope, soundFilterStorageKey]);

  useEffect(() => {
    if (loadedSoundFilterStorageKey !== soundFilterStorageKey) {
      return;
    }

    try {
      window.sessionStorage.setItem(
        soundFilterStorageKey,
        showOnlyFavoriteSounds ? "favorites" : "all",
      );
    } catch {
      // ignore storage quota / privacy mode failures
    }
  }, [loadedSoundFilterStorageKey, showOnlyFavoriteSounds, soundFilterStorageKey]);

  useEffect(() => {
    void loadServerSounds();
  }, [loadServerSounds]);

  useEffect(() => {
    return () => {
      stopTrimPreview();
      stopAudioOnlyShare();
      audioPlayersRef.current.forEach((audio) => {
        audio.pause();
        audio.removeAttribute("src");
      });
      audioPlayersRef.current = [];
    };
  }, [stopAudioOnlyShare, stopTrimPreview]);

  useEffect(() => {
    const onDataReceived = (payload: Uint8Array, participant?: RemoteParticipant) => {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload)) as WatchStateMessage | SoundPlayMessage | ListeningStateMessage | SoundCatalogUpdatedMessage;

        if (parsed.type === "watch-state" && parsed.viewerId) {
          setWatchStateByViewer((currentValue) => ({
            ...currentValue,
            [parsed.viewerId]: {
              type: "watch-state",
              viewerId: parsed.viewerId,
              viewerName: parsed.viewerName || participantsById.get(parsed.viewerId) || parsed.viewerId,
              watchingIds: parsed.watchingIds ?? [],
            },
          }));
          return;
        }

        if (
          parsed.type === "sound-play" &&
          parsed.soundId &&
          parsed.soundName &&
          parsed.soundUrl &&
          parsed.senderUserId &&
          participant?.identity !== localIdentity
        ) {
          if (isIncomingSoundRateLimited(parsed.senderUserId)) {
            const normalizedSenderUserId = parsed.senderUserId.trim().toLowerCase();
            const now = Date.now();
            const lastWarningAt = lastIncomingSoundWarningByUserRef.current[normalizedSenderUserId] ?? 0;
            if (now - lastWarningAt >= SOUND_PLAY_WARNING_COOLDOWN_MS) {
              lastIncomingSoundWarningByUserRef.current[normalizedSenderUserId] = now;
              const senderIdentity = participant?.identity ?? parsed.senderUserId;
              const senderName = participantsById.get(senderIdentity) ?? senderIdentity;
              setSoundboardError(`${senderName} excedeu o limite de sons e foi temporariamente bloqueado.`);
            }
            return;
          }
          playSoundLocally(parsed);
          return;
        }

        if (
          parsed.type === "sound-catalog-updated" &&
          parsed.serverId &&
          parsed.serverId === serverId &&
          participant?.identity !== localIdentity
        ) {
          void loadServerSounds();
          return;
        }

        if (
          parsed.type === "listening-state" &&
          parsed.participantId &&
          participant?.identity !== localIdentity
        ) {
          setListeningStateByParticipant((currentValue) => ({
            ...currentValue,
            [parsed.participantId]: !!parsed.isListening,
          }));
        }
      } catch {
        // ignore non-json payloads from other features
      }
    };

    room.on(RoomEvent.DataReceived, onDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, onDataReceived);
    };
  }, [isIncomingSoundRateLimited, loadServerSounds, localIdentity, participantsById, playSoundLocally, room, serverId]);

  useEffect(() => {
    publishWatchState(watchedParticipantIds);
    const intervalId = window.setInterval(() => publishWatchState(watchedParticipantIds), 5000);
    return () => window.clearInterval(intervalId);
  }, [publishWatchState, watchedParticipantIds]);

  useEffect(() => {
    publishListeningState(!isSelfSilenced);
    const intervalId = window.setInterval(() => publishListeningState(!isSelfSilenced), 5000);
    return () => window.clearInterval(intervalId);
  }, [isSelfSilenced, publishListeningState]);

  useEffect(() => {
    const validParticipantIds = new Set(participants.map((participant) => participant.identity));

    setWatchStateByViewer((currentValue) => {
      const nextValue: Record<string, WatchStateMessage> = {};
      Object.values(currentValue).forEach((state) => {
        if (!validParticipantIds.has(state.viewerId)) {
          return;
        }
        nextValue[state.viewerId] = {
          ...state,
          watchingIds: state.watchingIds.filter((id) => validParticipantIds.has(id)),
        };
      });
      return nextValue;
    });

    setWatchedParticipantIds((currentValue) => currentValue.filter((id) => validParticipantIds.has(id)));

    setListeningStateByParticipant((currentValue) => {
      const nextValue: Record<string, boolean> = {};
      Object.entries(currentValue).forEach(([participantId, isListening]) => {
        if (validParticipantIds.has(participantId)) {
          nextValue[participantId] = isListening;
        }
      });
      return nextValue;
    });
  }, [participants]);

  useEffect(() => {
    if (!onListeningStateChanged) {
      return;
    }

    const byUserId: Record<string, boolean> = {};
    participants.forEach((participant) => {
      const userId = participant.identity.split("::")[0].trim().toLowerCase();
      const isListening = participant.isLocal
        ? !isSelfSilenced
        : (listeningStateByParticipant[participant.identity] ?? true);
      if (userId) {
        byUserId[userId] = isListening;
      }
    });

    onListeningStateChanged(byUserId);
  }, [isSelfSilenced, listeningStateByParticipant, onListeningStateChanged, participants]);

  useEffect(() => {
    const syncFullscreenState = () => {
      if (!document.fullscreenElement) {
        setFullscreenParticipantId(null);
      }
    };

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    const closeOnResize = () => setContextMenu(null);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("keydown", onEsc);
    };
  }, []);

  const isAudioMutedLocally = (participantId: string) => {
    const participant = getRemoteParticipant(participantId);
    if (!participant) {
      return true;
    }

    const audioPublications = [...participant.audioTrackPublications.values()];
    if (audioPublications.length === 0) {
      return true;
    }

    const preference = audioPreferenceByParticipant[participantId];
    if (preference === false) {
      return true;
    }

    return audioPublications.every((publication) => !publication.isSubscribed);
  };

  const hasActiveTransmission = (
    participant: RemoteParticipant | typeof room.localParticipant,
  ) => {
    const videoPublications = [...participant.videoTrackPublications.values()].filter(
      (publication) =>
        publication.source === Track.Source.Camera || publication.source === Track.Source.ScreenShare,
    );

    return videoPublications.some(
      (publication) => !publication.isMuted && (!!publication.trackSid || !!publication.track),
    );
  };

  const setAudioListening = (participantId: string, shouldListen: boolean) => {
    setAudioPreferenceByParticipant((currentValue) => ({
      ...currentValue,
      [participantId]: shouldListen,
    }));

    const participant = getRemoteParticipant(participantId);
    if (!participant) {
      return;
    }

    const audioPublications = [...participant.audioTrackPublications.values()];
    audioPublications.forEach((publication) => {
      const volume = getAudioPublicationVolume(participantId, publication.source);
      publication.setSubscribed(
        shouldSubscribeToAudioPublication(
          participantId,
          publication.source,
          shouldListen && !isSelfSilenced,
        ),
      );
      applyTrackVolume(publication.audioTrack, volume);
    });
  };

  const setParticipantAudioVolume = (participantId: string, volume: number) => {
    const normalizedVolume = Math.max(0, Math.min(100, Math.round(volume)));

    setAudioVolumeByParticipant((currentValue) => ({
      ...currentValue,
      [participantId]: normalizedVolume,
    }));

    const participant = getRemoteParticipant(participantId);
    if (!participant) {
      return;
    }

    [...participant.audioTrackPublications.values()]
      .filter((publication) => publication.source !== Track.Source.ScreenShareAudio)
      .forEach((publication) => {
        applyTrackVolume(publication.audioTrack, normalizedVolume);
      });
  };

  const setSharedAudioListening = (participantId: string, shouldListen: boolean) => {
    setSharedAudioPreferenceByParticipant((currentValue) => ({
      ...currentValue,
      [participantId]: shouldListen,
    }));

    const participant = getRemoteParticipant(participantId);
    if (!participant) {
      return;
    }

    const shouldListenToParticipant = (audioPreferenceByParticipant[participantId] ?? true) && !isSelfSilenced;
    const sharedVolume = sharedAudioVolumeByParticipant[participantId] ?? 100;

    [...participant.audioTrackPublications.values()]
      .filter((publication) => publication.source === Track.Source.ScreenShareAudio)
      .forEach((publication) => {
        publication.setSubscribed(shouldListenToParticipant && shouldListen);
        applyTrackVolume(publication.audioTrack, sharedVolume);
      });
  };

  const setParticipantSharedAudioVolume = (participantId: string, volume: number) => {
    const normalizedVolume = Math.max(0, Math.min(100, Math.round(volume)));

    setSharedAudioVolumeByParticipant((currentValue) => ({
      ...currentValue,
      [participantId]: normalizedVolume,
    }));

    const participant = getRemoteParticipant(participantId);
    if (!participant) {
      return;
    }

    [...participant.audioTrackPublications.values()]
      .filter((publication) => publication.source === Track.Source.ScreenShareAudio)
      .forEach((publication) => {
      applyTrackVolume(publication.audioTrack, normalizedVolume);
    });
  };

  const getRemoteVideoPublications = (participantId: string) => {
    const participant = getRemoteParticipant(participantId);
    if (!participant) {
      return [];
    }

    return [...participant.videoTrackPublications.values()].filter(
      (publication) =>
        publication.source === Track.Source.Camera || publication.source === Track.Source.ScreenShare,
    );
  };

  const setParticipantVideoVisible = (participantId: string, shouldBeVisible: boolean) => {
    const publications = getRemoteVideoPublications(participantId);
    if (publications.length === 0) {
      return;
    }

    publications.forEach((publication) => publication.setSubscribed(shouldBeVisible));

    const keys = publications.map((publication) =>
      getTrackKey(participantId, getCardSourceFromTrackSource(publication.source)),
    );

    setHiddenTrackKeys((currentValue) => {
      if (shouldBeVisible) {
        return currentValue.filter((value) => !keys.includes(value));
      }

      const next = [...currentValue];
      keys.forEach((key) => {
        if (!next.includes(key)) {
          next.push(key);
        }
      });
      return next;
    });

    syncWatchingFromSubscriptions(participantId);
  };

  const isParticipantVideoVisible = (participantId: string) => {
    const publications = getRemoteVideoPublications(participantId);
    if (publications.length === 0) {
      return false;
    }

    return publications.some((publication) => {
      const source = getCardSourceFromTrackSource(publication.source);
      const hidden = hiddenTrackKeys.includes(getTrackKey(participantId, source));
      return publication.isSubscribed && !hidden;
    });
  };

  const syncWatchingFromSubscriptions = (participantId: string) => {
    const participant = getRemoteParticipant(participantId);
    if (!participant) {
      return;
    }

    const videoPublications = [...participant.videoTrackPublications.values()].filter(
      (publication) =>
        publication.source === Track.Source.Camera || publication.source === Track.Source.ScreenShare,
    );

    const isWatchingAny = videoPublications.some((publication) => publication.isSubscribed);
    setWatchingState(participantId, isWatchingAny);
  };

  const openFullscreen = async (participantId: string) => {
    setHiddenTrackKeys((currentValue) => currentValue.filter((key) => !key.startsWith(`${participantId}:`)));

    if (participantId !== localIdentity) {
      const participant = getRemoteParticipant(participantId);
      if (participant) {
        const videoPublications = [...participant.videoTrackPublications.values()].filter(
          (publication) =>
            publication.source === Track.Source.Camera || publication.source === Track.Source.ScreenShare,
        );
        videoPublications.forEach((publication) => publication.setSubscribed(true));
        syncWatchingFromSubscriptions(participantId);
      }
    }

    setFullscreenParticipantId(participantId);

    if (!document.fullscreenElement) {
      try {
        await fullscreenRootRef.current?.requestFullscreen();
      } catch {
        // no-op fallback: a fixed overlay still renders inside app viewport
      }
    }
  };

  const closeFullscreen = async () => {
    setFullscreenParticipantId(null);
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  };

  const localHasActiveTransmission = hasActiveTransmission(room.localParticipant);

  const remoteParticipantsById = useMemo(() => {
    const map = new Map<string, RemoteParticipant>();
    remoteParticipants.forEach((participant) => {
      map.set(participant.identity, participant);
    });
    return map;
  }, [remoteParticipants]);

  const getParticipantName = (participantId: string) => participantsById.get(participantId) ?? participantId;
  const getBaseUserId = (participantId: string) => participantId.split("::")[0].trim().toLowerCase();
  const getAvatarUrl = (participantId: string) => {
    const baseUserId = getBaseUserId(participantId);
    return avatarByUserId[participantId] ?? avatarByUserId[baseUserId] ?? null;
  };

  const isParticipantSpeaking = (participantId: string) => {
    if (participantId === localIdentity) {
      return room.localParticipant.isSpeaking;
    }
    return remoteParticipantsById.get(participantId)?.isSpeaking ?? false;
  };

  const hasParticipantTransmission = (participantId: string) => {
    if (participantId === localIdentity) {
      return localHasActiveTransmission;
    }
    const participant = remoteParticipantsById.get(participantId);
    return participant ? hasActiveTransmission(participant) : false;
  };

  const isParticipantMicEnabled = (participantId: string) => {
    const participant = participantId === localIdentity
      ? room.localParticipant
      : remoteParticipantsById.get(participantId);

    if (!participant) {
      return false;
    }

    const audioPublications = [...participant.audioTrackPublications.values()];
    if (audioPublications.length === 0) {
      return false;
    }

    return audioPublications.some((publication) => !publication.isMuted && (!!publication.trackSid || !!publication.track));
  };

  const isParticipantCameraEnabled = (participantId: string) => {
    const participant = participantId === localIdentity
      ? room.localParticipant
      : remoteParticipantsById.get(participantId);

    if (!participant) {
      return false;
    }

    const cameraPublications = [...participant.videoTrackPublications.values()].filter(
      (publication) => publication.source === Track.Source.Camera,
    );

    if (cameraPublications.length === 0) {
      return false;
    }

    return cameraPublications.some((publication) => !publication.isMuted && (!!publication.trackSid || !!publication.track));
  };

  const hasParticipantSharedAudio = (participantId: string) => {
    const participant = participantId === localIdentity
      ? room.localParticipant
      : remoteParticipantsById.get(participantId);

    if (!participant) {
      return false;
    }

    const sharedAudioPublications = [...participant.audioTrackPublications.values()].filter(
      (publication) => publication.source === Track.Source.ScreenShareAudio,
    );

    if (sharedAudioPublications.length === 0) {
      return false;
    }

    return sharedAudioPublications.some((publication) => !publication.isMuted && (!!publication.trackSid || !!publication.track));
  };

  const isParticipantListening = (participantId: string) => {
    if (participantId === localIdentity) {
      return !isSelfSilenced;
    }
    return listeningStateByParticipant[participantId] ?? true;
  };

  const allParticipantIds = participants
    .map((participant) => participant.identity)
    .sort((leftId, rightId) => {
      const leftOrder = participantOrderById[leftId] ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = participantOrderById[rightId] ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
  const prioritized = [localIdentity, ...allParticipantIds];

  const stageParticipantIds: string[] = [];
  prioritized.forEach((id) => {
    if (!id || stageParticipantIds.includes(id) || stageParticipantIds.length >= 4) {
      return;
    }
    stageParticipantIds.push(id);
  });

  type StageCard = {
    participantId: string;
    source: "camera" | "screen" | "placeholder";
    trackRef: (typeof visibleTrackRefs)[number] | null;
  };

  const stageCards: StageCard[] = [];
  stageParticipantIds.forEach((participantId) => {
    const cameraTrack = visibleTrackRefs.find(
      (trackRef) =>
        trackRef.participant.identity === participantId && trackRef.source === Track.Source.Camera,
    ) ?? null;

    const screenTrack = visibleTrackRefs.find(
      (trackRef) =>
        trackRef.participant.identity === participantId && trackRef.source === Track.Source.ScreenShare,
    ) ?? null;

    if (cameraTrack) {
      stageCards.push({ participantId, source: "camera", trackRef: cameraTrack });
    }

    if (screenTrack) {
      stageCards.push({ participantId, source: "screen", trackRef: screenTrack });
    }

    if (!cameraTrack && !screenTrack) {
      stageCards.push({ participantId, source: "placeholder", trackRef: null });
    }
  });

  const audienceParticipantIds = allParticipantIds.filter((id) => !stageParticipantIds.includes(id));

  const getInitials = (value: string) => {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return "U";
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  };

  const formatSoundDuration = (durationSeconds: number) => `${durationSeconds.toFixed(1)}s`;

  const cardColors = [
    "from-slate-500/40 to-slate-300/30",
    "from-indigo-500/40 to-blue-300/30",
    "from-pink-500/40 to-rose-300/30",
    "from-amber-500/40 to-yellow-300/30",
  ];

  return (
    <div ref={fullscreenRootRef} className="h-full flex flex-col bg-zinc-950">
      {!isSelfSilenced && <RoomAudioRenderer />}

      <main className="relative flex-1 min-h-0 p-3 overflow-y-auto">
        <div className="border border-zinc-800 rounded-xl bg-zinc-900/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-400">Canal de voz</div>
          <h4 className="text-xl font-semibold mt-1">Sessão ao vivo</h4>
          <p className="text-xs text-zinc-400 mt-1">
            {participants.length} participantes • {participants.filter((participant) => participant.isSpeaking).length} falando
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
            {stageCards.map((card, index) => {
              const participantId = card.participantId;
              const name = getParticipantName(participantId);
              const speaking = isParticipantSpeaking(participantId);
              const transmission = hasParticipantTransmission(participantId);
              const micEnabled = isParticipantMicEnabled(participantId);
              const cameraEnabled = isParticipantCameraEnabled(participantId);
              const listeningEnabled = isParticipantListening(participantId);
              const watchers = viewersByTarget[participantId] ?? [];
              const sourceLabel =
                card.source === "screen" ? "Tela" : card.source === "camera" ? "Câmera" : "Sem vídeo";

              return (
                <div
                  key={`${participantId}-${card.source}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({
                      participantId,
                      source: card.source,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  className={`rounded-xl border p-3 bg-gradient-to-br ${cardColors[index % cardColors.length]} ${
                    speaking ? "border-emerald-400 shadow-[0_0_0_1px_rgba(52,211,153,0.6)]" : "border-zinc-700"
                  }`}
                >
                  <div className="h-36 rounded-lg bg-zinc-900/70 border border-zinc-700 overflow-hidden flex items-center justify-center">
                    {card.trackRef ? (
                      <ParticipantTile trackRef={card.trackRef} />
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        {getAvatarUrl(participantId) ? (
                          <img
                            src={getAvatarUrl(participantId)!}
                            alt={name}
                            className="h-20 w-20 rounded-md object-cover border border-zinc-600"
                          />
                        ) : (
                          <div className="h-20 w-20 rounded-md bg-zinc-700 flex items-center justify-center text-lg font-semibold">
                            {getInitials(name)}
                          </div>
                        )}
                        <p className="text-xs text-zinc-300">Sem transmissão ativa</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-2">
                    <p className="text-sm font-medium truncate" title={name}>{name}</p>
                    <p className="text-[11px] text-zinc-300 truncate">{participantId} • {sourceLabel}</p>
                    <p className="text-[11px] mt-1">
                      <span className={speaking ? "text-emerald-300" : "text-zinc-300"}>
                        {speaking ? "● Falando" : "● Em silêncio"}
                      </span>
                      <span className={`ml-2 ${transmission ? "text-emerald-300" : "text-zinc-300"}`}>
                        {transmission ? "● Transmitindo" : "● Sem transmissão"}
                      </span>
                    </p>
                    <p className="text-[11px] mt-1 text-zinc-300">
                      <span title={micEnabled ? "Microfone ativo" : "Microfone silenciado"}>
                        {micEnabled ? "🎤" : "🔇"}
                      </span>
                      <span className="ml-2" title={cameraEnabled ? "Câmera ativa" : "Câmera inativa"}>
                        {cameraEnabled ? "📷" : "🚫"}
                      </span>
                      <span className="ml-2" title={listeningEnabled ? "Escutando" : "Sem áudio da sala"}>
                        {listeningEnabled ? "👂" : "🙉"}
                      </span>
                    </p>
                    <p className="text-[11px] text-zinc-300 mt-1 truncate">
                      Assistindo: {watchers.map((viewer) => viewer.name).join(", ") || "ninguém"}
                    </p>
                  </div>

                  <p className="text-[10px] text-zinc-400 mt-2">Clique com botão direito para opções</p>
                </div>
              );
            })}
            {stageCards.length === 0 && (
              <div className="rounded border border-zinc-700 bg-zinc-900/60 p-4 text-sm text-zinc-400 col-span-full">
                Nenhuma câmera ou compartilhamento ativo no momento.
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-zinc-800 pt-4">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Audiência — {audienceParticipantIds.length}</p>
            <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {audienceParticipantIds.map((participantId) => {
                const name = getParticipantName(participantId);
                const speaking = isParticipantSpeaking(participantId);
                const transmission = hasParticipantTransmission(participantId);
                const micEnabled = isParticipantMicEnabled(participantId);
                const cameraEnabled = isParticipantCameraEnabled(participantId);
                const listeningEnabled = isParticipantListening(participantId);

                return (
                  <div key={participantId} className="flex flex-col items-center text-center">
                    {getAvatarUrl(participantId) ? (
                      <img
                        src={getAvatarUrl(participantId)!}
                        alt={name}
                        className={`h-16 w-16 rounded-md object-cover border ${speaking ? "border-emerald-400" : "border-zinc-700"}`}
                      />
                    ) : (
                      <div className={`h-16 w-16 rounded-md border flex items-center justify-center text-sm font-semibold ${speaking ? "border-emerald-400" : "border-zinc-700"}`}>
                        {getInitials(name)}
                      </div>
                    )}
                    <p className="text-xs mt-1 truncate w-full" title={name}>{name}</p>
                    <p className={`text-[10px] ${transmission ? "text-emerald-300" : "text-zinc-400"}`}>
                      {transmission ? "Transmitindo" : ""}
                    </p>
                    <p className="text-[10px] text-zinc-400">
                      <span title={micEnabled ? "Microfone ativo" : "Microfone silenciado"}>{micEnabled ? "🎤" : "🔇"}</span>
                      <span className="ml-1" title={cameraEnabled ? "Câmera ativa" : "Câmera inativa"}>{cameraEnabled ? "📷" : "🚫"}</span>
                      <span className="ml-1" title={listeningEnabled ? "Escutando" : "Sem áudio da sala"}>{listeningEnabled ? "👂" : "🙉"}</span>
                    </p>
                  </div>
                );
              })}
              {audienceParticipantIds.length === 0 && (
                <p className="text-xs text-zinc-500 col-span-full">Todos os participantes estão no palco.</p>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-800 p-2">
          <ControlBar />

          <div className="mt-2 rounded border border-zinc-800 bg-zinc-900/60 p-2">
            <label className="flex items-center gap-2 text-xs text-zinc-200">
              <input
                type="checkbox"
                checked={enableSelfScreenShareMonitor}
                onChange={(event) => setEnableSelfScreenShareMonitor(event.target.checked)}
              />
              Modo transmissão especial (ouvir meu áudio da transmissão)
            </label>
            <p className="mt-1 text-[11px] text-zinc-400">
              O navegador não permite silenciar automaticamente a aba compartilhada. Para evitar som duplicado,
              silencie manualmente a aba original (ícone de áudio da aba).
            </p>
            {enableSelfScreenShareMonitor && !localScreenShareAudioTrack && (
              <p className="mt-1 text-[11px] text-amber-300">
                Inicie o compartilhamento de tela com áudio para monitorar o som aqui.
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => (isAudioOnlySharing ? stopAudioOnlyShare() : void startAudioOnlyShare())}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700"
              >
                {isAudioOnlySharing ? "Parar áudio compartilhado" : "Compartilhar somente áudio"}
              </button>
              <span className="text-[11px] text-zinc-500">
                Compartilha só o áudio da aba, sem vídeo.
              </span>
            </div>
            {audioOnlyShareError && (
              <p className="mt-1 text-[11px] text-red-300">{audioOnlyShareError}</p>
            )}
          </div>
        </div>

        <div className="border-t border-zinc-800 p-3 space-y-3 bg-zinc-950/70">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Sons do servidor</p>
              <p className="text-[11px] text-zinc-400">Compartilhe e toque sons de até 10 segundos para todos no canal de voz.</p>
            </div>
            <button
              type="button"
              onClick={() => void loadServerSounds()}
              disabled={isLoadingServerSounds || isSoundboardBusy}
              className="rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-2 py-1 text-xs disabled:opacity-60"
            >
              Atualizar
            </button>
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2 space-y-1">
            <p className="text-xs text-zinc-300">Volume dos efeitos sonoros: {soundEffectsVolume}%</p>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={soundEffectsVolume}
              onChange={(event) => setSoundEffectsVolume(Number(event.target.value))}
              className="w-full"
            />
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2 space-y-2">
            <p className="text-xs text-zinc-300">Enviar som</p>
            <input
              key={newSoundInputKey}
              type="file"
              accept="audio/*"
              onChange={(event) => {
                setSoundboardError(null);
                setNewSoundFile(event.target.files?.[0] ?? null);
              }}
              className="block w-full text-xs text-zinc-300 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-100"
            />
            {isAnalyzingSoundFile && (
              <p className="text-[11px] text-zinc-400">Analisando duração do áudio...</p>
            )}
            {!isAnalyzingSoundFile && newSoundOriginalDuration !== null && (
              <p className="text-[11px] text-zinc-400">
                Duração original: {formatSoundDuration(newSoundOriginalDuration)}
              </p>
            )}

            {!isAnalyzingSoundFile && (newSoundOriginalDuration ?? 0) > 1 && (
              <div className="rounded border border-zinc-800 bg-zinc-900 p-2 space-y-2">
                <p className="text-[11px] text-zinc-300">
                  Escolha início e duração do trecho que será salvo.
                </p>
                <div className="space-y-1">
                  <p className="text-[11px] text-zinc-400">Duração do trecho: {formatSoundDuration(newSoundTrimDurationSeconds)}</p>
                  <input
                    type="range"
                    min={0.1}
                    max={maxTrimDurationSeconds}
                    step={0.1}
                    value={newSoundTrimDurationSeconds}
                    onChange={(event) => setNewSoundTrimDurationSeconds(Number(event.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] text-zinc-400">Início do trecho</p>
                  <input
                    type="range"
                    min={0}
                    max={maxTrimStartSeconds}
                    step={0.1}
                    value={newSoundTrimStartSeconds}
                    onChange={(event) => setNewSoundTrimStartSeconds(Number(event.target.value))}
                    className="w-full"
                  />
                  <p className="text-[11px] text-zinc-400">
                    Trecho: {formatSoundDuration(newSoundTrimStartSeconds)} até {formatSoundDuration(newSoundTrimStartSeconds + newSoundTrimDurationSeconds)}
                  </p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void playTrimPreview()}
                disabled={!newSoundFile || isAnalyzingSoundFile || isSoundboardBusy || isPlayingTrimPreview}
                className="rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-2 py-1 text-xs disabled:opacity-60"
              >
                {isPlayingTrimPreview ? "Reproduzindo prévia..." : "Ouvir prévia do trecho"}
              </button>
              <button
                type="button"
                onClick={stopTrimPreview}
                disabled={!isPlayingTrimPreview}
                className="rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-2 py-1 text-xs disabled:opacity-60"
              >
                Parar prévia
              </button>
            </div>
            <input
              value={newSoundName}
              onChange={(event) => setNewSoundName(event.target.value)}
              placeholder="Nome do som (opcional)"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => void uploadServerSound()}
              disabled={isSoundboardBusy || isAnalyzingSoundFile || !newSoundFile || !serverId || !canUploadServerSounds}
              className="w-full rounded bg-indigo-600 hover:bg-indigo-500 px-2 py-1 text-sm disabled:opacity-60"
            >
              {(newSoundOriginalDuration ?? 0) > 1 ? "Enviar trecho" : "Enviar som"}
            </button>
            {!canUploadServerSounds && (
              <p className="text-[11px] text-zinc-500">Seu cargo não pode enviar áudio neste servidor.</p>
            )}
          </div>

          {soundboardError && (
            <p className="rounded bg-red-900/50 border border-red-700 px-2 py-1 text-xs text-red-100">{soundboardError}</p>
          )}

          <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
            <div className="flex items-center gap-2 pb-1">
              <button
                type="button"
                onClick={() => setShowOnlyFavoriteSounds(false)}
                className={`rounded border px-2 py-1 text-[11px] ${!showOnlyFavoriteSounds ? "border-indigo-500 bg-indigo-600 text-white" : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setShowOnlyFavoriteSounds(true)}
                className={`rounded border px-2 py-1 text-[11px] ${showOnlyFavoriteSounds ? "border-indigo-500 bg-indigo-600 text-white" : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
              >
                Favoritos
              </button>
            </div>

            {isLoadingServerSounds && <p className="text-xs text-zinc-500">Carregando sons...</p>}

            {!isLoadingServerSounds && filteredServerSounds.length === 0 && (
              <p className="text-xs text-zinc-500">
                {showOnlyFavoriteSounds ? "Nenhum favorito ainda." : "Nenhum som disponível neste servidor."}
              </p>
            )}

            {groupedServerSounds.map((section) => {
              const isCollapsed = collapsedSoundSections[section.key] ?? !section.isCurrentServer;

              return (
                <div key={section.key} className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
                  <div className="flex items-center justify-between gap-2 pb-1">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedSoundSections((currentValue) => ({
                          ...currentValue,
                          [section.key]: !isCollapsed,
                        }))
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium text-zinc-200"
                    >
                      <span className="text-zinc-400">{isCollapsed ? "▸" : "▾"}</span>
                      <span className="truncate" title={section.serverName}>{section.serverName}</span>
                    </button>
                    <span className="text-[10px] text-zinc-500">{section.sounds.length} sons</span>
                  </div>

                  {!isCollapsed && (
                    <div className="max-h-40 overflow-y-auto pr-1">
                      <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
                        {section.sounds.map((sound) => {
                          const canRemove = canDeleteServerSounds && sound.serverId === serverId;
                          const isPlaying = playingSoundIds.includes(sound.id);

                          return (
                            <div
                              key={sound.id}
                              className={`rounded border px-1.5 py-1 ${isPlaying ? "border-emerald-500/60 bg-emerald-900/20" : "border-zinc-800 bg-zinc-900"}`}
                            >
                              <div className="flex items-start gap-1">
                                <button
                                  type="button"
                                  onClick={() => void playServerSound(sound)}
                                  disabled={isPlaying}
                                  className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                                  title={`${sound.name} · ${formatSoundDuration(sound.durationSeconds)} · por ${sound.createdByName}`}
                                >
                                  <p className="truncate text-[11px] text-zinc-200">▶ {sound.name}</p>
                                  <p className="text-[10px] text-zinc-500">{formatSoundDuration(sound.durationSeconds)}</p>
                                </button>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void toggleServerSoundFavorite(sound)}
                                    className={`rounded border px-1 text-[10px] ${sound.isFavorite ? "border-amber-500 bg-amber-500/20 text-amber-300" : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
                                    title={sound.isFavorite ? "Remover dos favoritos" : "Marcar como favorito"}
                                  >
                                    {sound.isFavorite ? "★" : "☆"}
                                  </button>
                                  {canRemove && (
                                    <button
                                      type="button"
                                      onClick={() => void removeServerSound(sound)}
                                      disabled={isSoundboardBusy}
                                      className="rounded border border-zinc-700 bg-zinc-800 px-1 text-[10px] text-red-300 hover:bg-zinc-700 disabled:opacity-60"
                                      title="Remover"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {fullscreenTrack && (
          <div className="fixed inset-0 z-50 bg-black p-3">
            <div
              className={`h-full w-full rounded overflow-hidden relative transition-colors ${
                fullscreenTrack.participant.isSpeaking
                  ? "border-2 border-emerald-400"
                  : "border border-zinc-700"
              }`}
            >
              <ParticipantTile trackRef={fullscreenTrack} />
              <button
                onClick={() => void closeFullscreen()}
                className="absolute top-2 right-2 rounded bg-zinc-900/80 border border-zinc-600 px-2 py-1 text-xs"
              >
                Sair da tela cheia
              </button>
            </div>
          </div>
        )}

        {contextMenu && (() => {
          const participantId = contextMenu.participantId;
          const isRemote = participantId !== localIdentity;
          const audioMuted = isRemote ? isAudioMutedLocally(participantId) : false;
          const canShowVideo = isRemote ? isParticipantVideoVisible(participantId) : false;
          const volume = audioVolumeByParticipant[participantId] ?? 100;
          const hasSharedAudio = isRemote ? hasParticipantSharedAudio(participantId) : false;
          const sharedAudioListeningPreference = sharedAudioPreferenceByParticipant[participantId];
          const sharedAudioListening = typeof sharedAudioListeningPreference === "boolean"
            ? sharedAudioListeningPreference
            : watchedParticipantIds.includes(participantId);
          const sharedAudioVolume = sharedAudioVolumeByParticipant[participantId] ?? 100;
          const targetUserId = getBaseUserId(participantId);
          const isSoundEffectsMutedFromUser = !!mutedSoundEffectsByUserId[targetUserId];
          const canModerateTarget =
            isRemote &&
            targetUserId !== currentUserId.trim().toLowerCase() &&
            (canKickFromVoice || canMoveVoiceUsers);
          const availableMoveChannels = voiceChannels.filter(
            (channel) => channel.id !== currentVoiceChannelId,
          );

          return (
            <>
              <button
                type="button"
                aria-label="Fechar menu"
                className="fixed inset-0 z-[69] cursor-default"
                onClick={() => setContextMenu(null)}
              />
              <div
                className="fixed z-[70] min-w-[220px] rounded-lg border border-zinc-700 bg-zinc-900/95 p-2 shadow-xl"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <p className="text-xs text-zinc-300 mb-2">Opções do card</p>

                <label className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-zinc-800 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSelfSilenced}
                    onChange={(event) => setIsSelfSilenced(event.target.checked)}
                  />
                  Silenciar (mic + áudio)
                </label>

                {isRemote && (
                  <label className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-zinc-800 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!audioMuted}
                      onChange={(event) => setAudioListening(participantId, event.target.checked)}
                    />
                    Ouvir áudio
                  </label>
                )}

                {isRemote && (
                  <label className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-zinc-800 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!isSoundEffectsMutedFromUser}
                      onChange={(event) =>
                        setMutedSoundEffectsByUserId((currentValue) => ({
                          ...currentValue,
                          [targetUserId]: !event.target.checked,
                        }))
                      }
                    />
                    Ouvir efeitos sonoros deste usuário
                  </label>
                )}

                {isRemote && (
                  <div className="px-2 py-1 rounded">
                    <p className="text-xs text-zinc-400 mb-1">Volume: {volume}%</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 px-2 py-1 text-xs"
                        onClick={() => setParticipantAudioVolume(participantId, volume - 10)}
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={volume}
                        onChange={(event) => setParticipantAudioVolume(participantId, Number(event.target.value))}
                        className="w-full"
                      />
                      <button
                        type="button"
                        className="rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 px-2 py-1 text-xs"
                        onClick={() => setParticipantAudioVolume(participantId, volume + 10)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}

                {isRemote && hasSharedAudio && (
                  <label className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-zinc-800 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sharedAudioListening}
                      onChange={(event) => setSharedAudioListening(participantId, event.target.checked)}
                    />
                    Ouvir áudio compartilhado
                  </label>
                )}

                {isRemote && hasSharedAudio && (
                  <div className="px-2 py-1 rounded">
                    <p className="text-xs text-zinc-400 mb-1">Volume da transmissão: {sharedAudioVolume}%</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 px-2 py-1 text-xs"
                        onClick={() => setParticipantSharedAudioVolume(participantId, sharedAudioVolume - 10)}
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={sharedAudioVolume}
                        onChange={(event) => setParticipantSharedAudioVolume(participantId, Number(event.target.value))}
                        className="w-full"
                      />
                      <button
                        type="button"
                        className="rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 px-2 py-1 text-xs"
                        onClick={() => setParticipantSharedAudioVolume(participantId, sharedAudioVolume + 10)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}

                {isRemote && (
                  <label className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-zinc-800 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canShowVideo}
                      onChange={(event) => {
                        setParticipantVideoVisible(participantId, event.target.checked);
                        if (!event.target.checked) {
                          setFullscreenParticipantId((currentValue) =>
                            currentValue === participantId ? null : currentValue,
                          );
                        }
                      }}
                    />
                    Ver transmissão
                  </label>
                )}

                {canModerateTarget && (
                  <div className="mt-2 border-t border-zinc-700 pt-2 space-y-1">
                    <p className="text-[11px] text-zinc-400 px-2">Moderação de voz</p>
                    {canKickFromVoice && (
                      <button
                        type="button"
                        className="w-full rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 px-2 py-1 text-xs text-left"
                        onClick={() => {
                          void onModerationAction?.({
                            action: "voice-kick",
                            targetUserId,
                          });
                          setContextMenu(null);
                        }}
                      >
                        Expulsar da chamada
                      </button>
                    )}

                    {canMoveVoiceUsers && (
                      <div className="px-2 py-1">
                        <p className="text-[11px] text-zinc-400 mb-1">Mover para:</p>
                        <div className="space-y-1">
                          {availableMoveChannels.length > 0 ? (
                            availableMoveChannels.map((channel) => (
                              <button
                                key={channel.id}
                                type="button"
                                className="w-full rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 px-2 py-1 text-xs text-left"
                                onClick={() => {
                                  void onModerationAction?.({
                                    action: "voice-move",
                                    targetUserId,
                                    targetChannelId: channel.id,
                                  });
                                  setContextMenu(null);
                                }}
                              >
                                {channel.name}
                              </button>
                            ))
                          ) : (
                            <p className="text-[11px] text-zinc-500">Nenhum outro canal de voz disponível.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <button
                  className="mt-2 w-full rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 px-2 py-1 text-xs"
                  onClick={() => {
                    void openFullscreen(participantId);
                    setContextMenu(null);
                  }}
                >
                  Tela cheia
                </button>
              </div>
            </>
          );
        })()}
      </main>
    </div>
  );
}
