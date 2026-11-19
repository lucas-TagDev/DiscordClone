"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ControlBar,
  LiveKitRoom,
  ParticipantTile,
  AudioTrack,
  TrackToggle,
  useParticipants,
  useMediaDeviceSelect,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import {
  AudioPresets,
  LocalAudioTrack,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrackPublication,
  RoomEvent,
  Track,
  TrackPublication,
  type RoomOptions,
  type ScreenShareCaptureOptions,
  type VideoCaptureOptions,
  type TrackPublishOptions,
} from "livekit-client";
import { ServerSound } from "@/lib/types";
import { getProcessAudioBridge, ProcessAudioTrackPublisher } from "@/lib/native-process-audio";
import { applyRnnNoiseToLiveKitTrack, detachRnnNoise, RnnNoiseAttachment } from "@/lib/rnnoise-processor";
import { createDeepFilterProcessor } from "@/lib/deepfilter-processor";
import { SoundGifOverlay } from "@/components/sound-gif-overlay";
import { useIsMobile } from "@/lib/use-is-mobile";

type SoundPlayingState = {
  soundName: string;
  startTime: number;
};

const ROOM_CONNECT_OPTIONS = { autoSubscribe: false };
const VIDEO_FRAME_RATE = 60;
const CAMERA_CAPTURE_OPTIONS = {
  resolution: { width: 1280, height: 720, frameRate: VIDEO_FRAME_RATE },
  frameRate: { ideal: VIDEO_FRAME_RATE, max: VIDEO_FRAME_RATE },
} satisfies VideoCaptureOptions;
const SHARED_AUDIO_CAPTURE_OPTIONS = {
  // System/tab capture can contain the room playback; retain echo protection.
  echoCancellation: true,
  // Supported browsers can exclude audio produced by this calling page.
  restrictOwnAudio: true,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2,
  sampleRate: 48000,
};
const SHARED_AUDIO_PUBLISH_OPTIONS = {
  audioPreset: AudioPresets.musicHighQualityStereo,
  forceStereo: true,
  dtx: false,
  red: true,
} satisfies TrackPublishOptions;
const SCREEN_SHARE_CAPTURE_OPTIONS = {
  audio: SHARED_AUDIO_CAPTURE_OPTIONS,
  selfBrowserSurface: "exclude",
  systemAudio: "include",
  resolution: { width: 1920, height: 1080, frameRate: VIDEO_FRAME_RATE },
  contentHint: "motion",
} satisfies ScreenShareCaptureOptions;
const ROOM_OPTIONS = {
  videoCaptureDefaults: CAMERA_CAPTURE_OPTIONS,
  publishDefaults: {
    videoEncoding: { maxBitrate: 3_000_000, maxFramerate: VIDEO_FRAME_RATE },
    screenShareEncoding: { maxBitrate: 5_000_000, maxFramerate: VIDEO_FRAME_RATE },
    degradationPreference: "maintain-framerate",
  },
} satisfies RoomOptions;
// LiveKit adds a session suffix that changes when the user reconnects.
const getVolumeParticipantKey = (participantId: string) =>
  participantId.split("::")[0].trim().toLowerCase();

const MAX_SOUND_DURATION_SECONDS = 10;
const SOUND_PLAY_GLOBAL_COOLDOWN_MS = 1000;
const SOUND_PLAY_PER_SOUND_COOLDOWN_MS = 2500;
const SOUND_PLAY_INCOMING_WINDOW_MS = 6000;
const SOUND_PLAY_INCOMING_MAX_PER_USER = 4;
const SOUND_PLAY_WARNING_COOLDOWN_MS = 2500;

const normalizeParticipantVolume = (volume: number) =>
  Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume * 10) / 10)) : 100;

// A curved gain gives more control over loud participants at low slider values.
const participantVolumeToGain = (volume: number) => (normalizeParticipantVolume(volume) / 100) ** 2;

function VoiceAudioRenderer({ microphoneVolumes, sharedVolumes, ready }: {
  microphoneVolumes: Record<string, number>;
  sharedVolumes: Record<string, number>;
  ready: boolean;
}) {
  const audioTracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown], {
    onlySubscribed: true,
  }).filter((trackRef) => !trackRef.participant.isLocal && trackRef.publication.kind === Track.Kind.Audio);
  if (!ready) return null;
  return <div style={{ display: "none" }}>
    {audioTracks.map((trackRef) => {
      const volumes = trackRef.source === Track.Source.ScreenShareAudio ? sharedVolumes : microphoneVolumes;
      const volume = volumes[getVolumeParticipantKey(trackRef.participant.identity)] ?? 100;
      return <AudioTrack key={`${trackRef.participant.identity}:${trackRef.publication.trackSid}`}
        trackRef={trackRef} volume={participantVolumeToGain(volume)} />;
    })}
  </div>;
}

const cameraStorageKey = (userId: string) => `twinslkit:voice:camera:${userId.trim().toLowerCase()}`;

const readCameraPreference = (userId: string): string | undefined => {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(cameraStorageKey(userId)) || undefined : undefined;
  } catch { return undefined; }
};

function CameraDeviceControl({ currentUserId }: { currentUserId: string }) {
  const room = useRoomContext();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onDeviceError = useCallback(() => {
    setError("Não foi possível acessar as câmeras. Verifique a permissão de câmera do navegador.");
  }, []);
  const { devices, activeDeviceId } = useMediaDeviceSelect({
    kind: "videoinput", requestPermissions: open, onError: onDeviceError,
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const selectCamera = async (deviceId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const success = await room.switchActiveDevice("videoinput", deviceId, true);
      if (!success) throw new Error("Câmera indisponível.");
      try { window.localStorage.setItem(cameraStorageKey(currentUserId), deviceId); } catch { /* storage unavailable */ }
      setOpen(false);
    } catch {
      setError("Não foi possível selecionar esta câmera. Verifique se ela está conectada e disponível.");
    } finally { setBusy(false); }
  };

  return <div className="relative">
    <button type="button" aria-label="Escolher câmera" title="Escolher câmera" aria-expanded={open}
      onClick={() => { setError(null); setOpen((value) => !value); }}
      className="flex h-10 w-7 items-center justify-center rounded-r-md text-zinc-300 hover:bg-[var(--tk-bg-elev)] hover:text-white">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <>
      <button type="button" aria-label="Fechar seleção de câmera" className="fixed inset-0 z-[59] cursor-default" onClick={() => setOpen(false)} />
      <div className="absolute bottom-full left-1/2 z-[60] mb-3 w-72 -translate-x-1/2 rounded-lg border border-zinc-700 bg-[var(--tk-bg-panel)] p-2 shadow-xl">
        <p className="px-2 py-2 text-sm font-medium text-white">Escolher câmera</p>
        {error && <p role="alert" className="px-2 pb-2 text-xs text-red-300">{error}</p>}
        <div role="group" aria-label="Câmeras disponíveis" className="max-h-64 overflow-y-auto">
          {devices.map((device, index) => <button key={device.deviceId} type="button" disabled={busy}
            aria-pressed={device.deviceId === activeDeviceId} onClick={() => void selectCamera(device.deviceId)}
            className={`block w-full rounded px-2 py-2 text-left text-sm text-white disabled:opacity-50 ${device.deviceId === activeDeviceId ? "bg-[var(--tk-accent)]" : "hover:bg-[var(--tk-bg-elev)]"}`}>
            {device.label || `Câmera ${index + 1}`}{device.deviceId === activeDeviceId ? " ✓" : ""}
          </button>)}
          {devices.length === 0 && !error && <p className="p-2 text-xs text-zinc-400">Nenhuma câmera disponível. Permita o acesso à câmera no navegador.</p>}
        </div>
        <p className="px-2 pt-2 text-[11px] text-zinc-400">A escolha será salva neste navegador. Selecionar não liga a câmera.</p>
      </div>
    </>}
  </div>;
}

const applyTrackVolume = (audioTrack: LocalAudioTrack | RemoteAudioTrack | undefined, volume: number) => {
  if (!audioTrack) {
    return;
  }

  if ("setVolume" in audioTrack && typeof audioTrack.setVolume === "function") {
    audioTrack.setVolume(participantVolumeToGain(volume));
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
  gifUrl?: string | null;
  durationMs?: number;
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
  noiseSuppressionMode?: "rnnoise" | "deepfilter";
  micGain?: number;
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
  onMicrophoneStateChanged?: (enabled: boolean) => void;
  onLeave: (disconnectedToken: string) => void;
};

export function VoiceRoom({
  token,
  serverUrl,
  serverId = null,
  joinWithMicEnabled = true,
  joinWithCameraEnabled = false,
  noiseSuppressionEnabled = true,
  noiseSuppressionMode = "rnnoise",
  micGain = 100,
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
  onMicrophoneStateChanged,
  onLeave,
}: VoiceRoomProps) {
  const micCaptureOptions = useMemo(
    () => ({
      noiseSuppression: noiseSuppressionEnabled,
      // Echo prevention is independent from the optional noise filter.
      echoCancellation: true,
      autoGainControl: noiseSuppressionEnabled,
    }),
    [noiseSuppressionEnabled],
  );

  const roomOptions = useMemo<RoomOptions>(() => {
    const deviceId = readCameraPreference(currentUserId);
    return {
      ...ROOM_OPTIONS,
      videoCaptureDefaults: { ...CAMERA_CAPTURE_OPTIONS, ...(deviceId ? { deviceId: { ideal: deviceId } } : {}) },
    };
  }, [currentUserId]);

  return (
    <div className="h-full min-h-0 min-w-0 rounded-md border border-zinc-700 overflow-hidden">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect
        video={joinWithCameraEnabled}
        audio={joinWithMicEnabled ? micCaptureOptions : false}
        options={roomOptions}
        connectOptions={ROOM_CONNECT_OPTIONS}
        onDisconnected={() => onLeave(token)}
        data-lk-theme="default"
        className="h-full min-h-0 min-w-0 bg-zinc-950"
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
          noiseSuppressionEnabled={noiseSuppressionEnabled}
          noiseSuppressionMode={noiseSuppressionMode}
          micGain={micGain}
          currentVoiceChannelId={currentVoiceChannelId}
          voiceChannels={voiceChannels}
          onModerationAction={onModerationAction}
          onPresenceStatusChanged={onPresenceStatusChanged}
          onListeningStateChanged={onListeningStateChanged}
          onMicrophoneStateChanged={onMicrophoneStateChanged}
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
  noiseSuppressionEnabled,
  noiseSuppressionMode,
  micGain,
  currentVoiceChannelId,
  voiceChannels,
  onModerationAction,
  onPresenceStatusChanged,
  onListeningStateChanged,
  onMicrophoneStateChanged,
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
  noiseSuppressionEnabled: boolean;
  noiseSuppressionMode: "rnnoise" | "deepfilter";
  micGain: number;
  currentVoiceChannelId: string | null;
  voiceChannels: { id: string; name: string }[];
  onModerationAction?: (payload: {
    action: "voice-kick" | "voice-move";
    targetUserId: string;
    targetChannelId?: string;
  }) => Promise<void> | void;
  onPresenceStatusChanged?: () => void;
  onListeningStateChanged?: (stateByUserId: Record<string, boolean>) => void;
  onMicrophoneStateChanged?: (enabled: boolean) => void;
}) {
  const room = useRoomContext();
  const isMobile = useIsMobile();
  const participants = useParticipants();

  useEffect(() => {
    const reportMicrophone = () => {
      // Disconnecting unpublishes tracks; that must not overwrite the mute state.
      if (room.state !== "connected") return;
      const microphone = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (microphone) onMicrophoneStateChanged?.(!microphone.isMuted);
    };
    const events = [RoomEvent.Connected, RoomEvent.LocalTrackPublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted];
    events.forEach((event) => room.on(event, reportMicrophone));
    reportMicrophone();
    return () => { events.forEach((event) => room.off(event, reportMicrophone)); };
  }, [room, onMicrophoneStateChanged]);


  // Keybind event listeners for global shortcuts dispatched from app-shell
  useEffect(() => {
    const handleToggleMic = () => {
      const lp = room.localParticipant;
      void lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
    };
    const handleToggleCamera = () => {
      const lp = room.localParticipant;
      void lp.setCameraEnabled(!lp.isCameraEnabled);
    };
    const handleToggleDeafen = () => {
      // Uses isSelfSilenced which controls mic + all incoming audio AND updates card icons
      setIsSelfSilenced((prev) => !prev);
    };

    window.addEventListener("voice-toggle-mic", handleToggleMic);
    window.addEventListener("voice-toggle-camera", handleToggleCamera);
    window.addEventListener("voice-toggle-deafen", handleToggleDeafen);
    return () => {
      window.removeEventListener("voice-toggle-mic", handleToggleMic);
      window.removeEventListener("voice-toggle-camera", handleToggleCamera);
      window.removeEventListener("voice-toggle-deafen", handleToggleDeafen);
    };
  }, [room]);

  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const [participantOrderById, setParticipantOrderById] = useState<Record<string, number>>({});
  const initializedAudioPublicationSidsRef = useRef(new Set<string>());
  const initializedPublicationSidsRef = useRef(new Set<string>());
  const [hiddenTrackKeys, setHiddenTrackKeys] = useState<string[]>([]);
  const [focusedStreamKey, setFocusedStreamKey] = useState<string | null>(null);
  const [fullscreenSource, setFullscreenSource] = useState<Track.Source | null>(null);
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
  const [noiseSuppressionStatus, setNoiseSuppressionStatus] = useState<"idle" | "loading" | "active" | "error">("idle");
  const [newSoundName, setNewSoundName] = useState("");
  const [newSoundFile, setNewSoundFile] = useState<File | null>(null);
  const [newSoundGifFile, setNewSoundGifFile] = useState<File | null>(null);
  const [newSoundGifPreviewUrl, setNewSoundGifPreviewUrl] = useState<string | null>(null);
  const [gifEditingSoundId, setGifEditingSoundId] = useState<string | null>(null);
  const [gifEditingSoundName, setGifEditingSoundName] = useState("");
  const [gifEditingSoundGifFile, setGifEditingSoundGifFile] = useState<File | null>(null);
  const [gifEditingSoundGifPreviewUrl, setGifEditingSoundGifPreviewUrl] = useState<string | null>(null);
  const [newSoundOriginalDuration, setNewSoundOriginalDuration] = useState<number | null>(null);
  const [newSoundTrimStartSeconds, setNewSoundTrimStartSeconds] = useState(0);
  const [newSoundTrimDurationSeconds, setNewSoundTrimDurationSeconds] = useState(MAX_SOUND_DURATION_SECONDS);
  const [isAnalyzingSoundFile, setIsAnalyzingSoundFile] = useState(false);
  const [isPlayingTrimPreview, setIsPlayingTrimPreview] = useState(false);
  const [newSoundInputKey, setNewSoundInputKey] = useState(0);
  const [playingSoundIds, setPlayingSoundIds] = useState<string[]>([]);
  const [soundEffectsVolume, setSoundEffectsVolume] = useState(100);
  const [mutedSoundEffectsByUserId, setMutedSoundEffectsByUserId] = useState<Record<string, boolean>>({});
  const [soundPlayingByParticipantId, setSoundPlayingByParticipantId] = useState<Record<string, SoundPlayingState>>({});
  const [soundGifOverlay, setSoundGifOverlay] = useState<{
    gifUrl: string;
    soundName: string;
    senderName: string;
    id: number;
    visible: boolean;
  } | null>(null);
  const soundGifOverlayTimeoutRef = useRef<number | null>(null);
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
  const knownParticipantIdsRef = useRef<Set<string>>(new Set());
  const isInitialPresenceSyncDoneRef = useRef(false);
  const rnnoiseAttachmentRef = useRef<RnnNoiseAttachment | null>(null);
  const deepFilterProcessorRef = useRef<{ processor: unknown; track: LocalAudioTrack } | null>(null);
  const [loadedVolumeStorageKey, setLoadedVolumeStorageKey] = useState("");
  const [loadedSoundEffectsStorageKey, setLoadedSoundEffectsStorageKey] = useState("");
  const [loadedSoundFilterStorageKey, setLoadedSoundFilterStorageKey] = useState("");
  const [showSoundboardPopup, setShowSoundboardPopup] = useState(false);
  const [showSoundUploadModal, setShowSoundUploadModal] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);

  // The desktop build captures the audio of the shared program through a native
  // addon instead of the whole output device, which keeps the voice of the other
  // participants out of the transmission.
  const nativeShareAudioRef = useRef<ProcessAudioTrackPublisher | null>(null);
  const nativeShareAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const nativeShareAudioSessionRef = useRef(0);
  const [isNativeShareAudioAvailable, setIsNativeShareAudioAvailable] = useState(false);

  useEffect(() => {
    const bridge = getProcessAudioBridge();
    if (!bridge) {
      return;
    }

    let cancelled = false;
    void bridge
      .getStatus()
      .then((status) => {
        if (!cancelled) {
          setIsNativeShareAudioAvailable(Boolean(status?.supported));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const screenShareCaptureOptions = useMemo<ScreenShareCaptureOptions>(
    () => ({
      ...SCREEN_SHARE_CAPTURE_OPTIONS,
      // Chromium fails the whole share when the page asks for audio the handler
      // cannot grant, and the native capture provides the audio on its own.
      audio: isNativeShareAudioAvailable ? false : SCREEN_SHARE_CAPTURE_OPTIONS.audio,
    }),
    [isNativeShareAudioAvailable],
  );

  const stopNativeShareAudio = useCallback(async () => {
    // Invalidates any start that is still in flight.
    nativeShareAudioSessionRef.current += 1;

    const publisher = nativeShareAudioRef.current;
    nativeShareAudioRef.current = null;

    const track = nativeShareAudioTrackRef.current;
    nativeShareAudioTrackRef.current = null;
    if (track) {
      try {
        await room.localParticipant.unpublishTrack(track, true);
      } catch {
        // the track is already gone when the room disconnected
      }
    }

    publisher?.stop();

    try {
      await getProcessAudioBridge()?.stop();
    } catch {
      // the share is already over
    }
  }, [room]);

  const startNativeShareAudio = useCallback(async () => {
    const bridge = getProcessAudioBridge();
    if (!bridge || nativeShareAudioRef.current) {
      return;
    }

    const session = nativeShareAudioSessionRef.current + 1;
    nativeShareAudioSessionRef.current = session;
    const isCurrent = () => nativeShareAudioSessionRef.current === session;
    const publisher = new ProcessAudioTrackPublisher();
    nativeShareAudioRef.current = publisher;

    try {
      const status = await bridge.getStatus();
      if (!isCurrent() || !status.supported || !status.target) {
        return;
      }

      await bridge.start();
      if (!isCurrent()) {
        void bridge.stop().catch(() => undefined);
        return;
      }

      const track = await publisher.createTrack(bridge);
      if (!isCurrent()) {
        publisher.stop();
        void bridge.stop().catch(() => undefined);
        return;
      }

      nativeShareAudioRef.current = publisher;
      nativeShareAudioTrackRef.current = track;
      await room.localParticipant.publishTrack(track, { ...SHARED_AUDIO_PUBLISH_OPTIONS, source: Track.Source.ScreenShareAudio });
    } catch (error) {
      publisher.stop();
      if (isCurrent()) {
        nativeShareAudioTrackRef.current = null;
        void bridge.stop().catch(() => undefined);
      }
      console.error("Falha ao iniciar o áudio da transmissão:", error);
    } finally {
      if (nativeShareAudioRef.current === publisher && !nativeShareAudioTrackRef.current) {
        nativeShareAudioRef.current = null;
      }
    }
  }, [room]);

  useEffect(() => {
    const syncShareAudio = () => {
      if (room.localParticipant.isScreenShareEnabled) {
        void startNativeShareAudio();
      } else {
        void stopNativeShareAudio();
      }
    };

    const events = [
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
    ];
    events.forEach((eventName) => room.on(eventName, syncShareAudio));
    syncShareAudio();

    return () => {
      events.forEach((eventName) => room.off(eventName, syncShareAudio));
      void stopNativeShareAudio();
    };
  }, [room, startNativeShareAudio, stopNativeShareAudio]);

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
      const captureOptions = {
        audio: SHARED_AUDIO_CAPTURE_OPTIONS,
        video: true,
        selfBrowserSurface: "exclude",
        systemAudio: "include",
      };
      const stream = await navigator.mediaDevices.getDisplayMedia(captureOptions);

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
        ...SHARED_AUDIO_PUBLISH_OPTIONS,
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

  const participantIdByUserId = useMemo(() => {
    const map = new Map<string, string>();
    participants.forEach((participant) => {
      const baseUserId = participant.identity.split("::")[0].trim().toLowerCase();
      map.set(baseUserId, participant.identity);
    });
    return map;
  }, [participants]);

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

    // Rastrear que o usuário tocou o áudio
    const senderParticipantId = participantIdByUserId.get(payload.senderUserId);
    if (senderParticipantId) {
      setSoundPlayingByParticipantId((currentValue) => ({
        ...currentValue,
        [senderParticipantId]: {
          soundName: payload.soundName,
          startTime: Date.now(),
        },
      }));
    }

    // Exibir o GIF animado no centro da tela (estilo alerta de donate na Twitch)
    let soundOverlayId: number | null = null;
    if (payload.gifUrl) {
      const senderParticipantIdForGif = participantIdByUserId.get(payload.senderUserId);
      const senderDisplayName = senderParticipantIdForGif
        ? (participants.find((participant) => participant.identity === senderParticipantIdForGif)?.name ??
          senderParticipantIdForGif)
        : payload.senderUserId;

      // Encerra o overlay anterior (fade out) antes de exibir o novo
      setSoundGifOverlay((currentValue) =>
        currentValue ? { ...currentValue, visible: false } : currentValue,
      );

      window.setTimeout(() => {
        const overlayId = Date.now() + Math.random();
        soundOverlayId = overlayId;
        setSoundGifOverlay({
          gifUrl: payload.gifUrl!,
          soundName: payload.soundName,
          senderName: senderDisplayName,
          id: overlayId,
          visible: true,
        });

        // Dura o mesmo tempo do áudio (ou fallback de 10s se não souber)
        const durationMs = Math.max(500, payload.durationMs ?? MAX_SOUND_DURATION_SECONDS * 1000);
        if (soundGifOverlayTimeoutRef.current) {
          window.clearTimeout(soundGifOverlayTimeoutRef.current);
        }
        soundGifOverlayTimeoutRef.current = window.setTimeout(() => {
          setSoundGifOverlay((currentValue) =>
            currentValue && currentValue.id === overlayId ? { ...currentValue, visible: false } : currentValue,
          );
        }, durationMs);
      }, 80);
    }

    const fadeOutOverlayIfActive = (overlayId: number | null) => {
      if (overlayId !== null) {
        setSoundGifOverlay((currentValue) =>
          currentValue && currentValue.id === overlayId ? { ...currentValue, visible: false } : currentValue,
        );
      }
    };

    const clear = () => {
      setPlayingSoundIds((currentValue) => currentValue.filter((value) => value !== payload.soundId));
      audioPlayersRef.current = audioPlayersRef.current.filter((item) => item !== audio);
      fadeOutOverlayIfActive(soundOverlayId);

      // Remover o indicador de som tocado
      if (senderParticipantId) {
        setSoundPlayingByParticipantId((currentValue) => {
          const newValue = { ...currentValue };
          delete newValue[senderParticipantId];
          return newValue;
        });
      }
    };

    audio.onended = clear;
    audio.onerror = clear;
    audioPlayersRef.current.push(audio);

    void audio.play().catch(() => {
      clear();
      setSoundboardError(`Não foi possível reproduzir o som: ${payload.soundName}`);
    });
  }, [isSelfSilenced, mutedSoundEffectsByUserId, participants, soundEffectsVolume, participantIdByUserId]);

  // Beeps gerados via Web Audio API (usados se não houver arquivo personalizado)
  const playSynthesizedEventSound = useCallback((type: "join" | "leave" | "stream", volume: number) => {
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
    const destination = audioContext.destination;

    const playBeep = (
      startAt: number,
      frequency: number,
      durationSeconds: number,
      peakVolume: number,
    ) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(peakVolume, startAt + 0.015);
      gainNode.gain.setValueAtTime(peakVolume, startAt + Math.max(0.015, durationSeconds - 0.05));
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);
      oscillator.connect(gainNode);
      gainNode.connect(destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + durationSeconds + 0.02);
    };

    const playGlide = (
      startAt: number,
      fromFrequency: number,
      toFrequency: number,
      durationSeconds: number,
      peakVolume: number,
    ) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(fromFrequency, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(toFrequency, startAt + durationSeconds);
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(peakVolume, startAt + 0.02);
      gainNode.gain.setValueAtTime(peakVolume, startAt + durationSeconds - 0.04);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);
      oscillator.connect(gainNode);
      gainNode.connect(destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + durationSeconds + 0.02);
    };

    if (type === "join") {
      // Beep ascendente suave (400 -> 650 Hz)
      playGlide(now, 400, 650, 0.18, volume);
    } else if (type === "leave") {
      // Beep descendente suave (650 -> 400 Hz)
      playGlide(now, 650, 400, 0.22, volume);
    } else {
      // Transmissão: dois beeps rápidos
      playBeep(now, 620, 0.07, volume);
      playBeep(now + 0.1, 820, 0.09, volume);
    }

    window.setTimeout(() => {
      void audioContext.close().catch(() => undefined);
    }, 600);
  }, []);

  // Toca um som personalizado se existir em /sounds/, senão usa beep sintetizado
  const playEventSound = useCallback((type: "join" | "leave" | "stream") => {
    if (typeof window === "undefined" || room.state !== "connected") {
      return;
    }

    const volume = Math.max(0, Math.min(1, soundEffectsVolume / 100));
    if (volume <= 0.01) {
      return;
    }

    const soundFiles: Record<"join" | "leave" | "stream", string> = {
      join: "/sounds/join.mp3",
      leave: "/sounds/leave.mp3",
      stream: "/sounds/stream.mp3",
    };

    const audio = new Audio(soundFiles[type]);
    audio.volume = volume;
    audioPlayersRef.current.push(audio);
    const release = () => {
      audioPlayersRef.current = audioPlayersRef.current.filter((player) => player !== audio);
    };
    audio.addEventListener("ended", release, { once: true });
    audio.play().catch(() => {
      const stillActive = audioPlayersRef.current.includes(audio);
      release();
      if (stillActive && room.state === "connected") playSynthesizedEventSound(type, volume);
    });
  }, [room, soundEffectsVolume, playSynthesizedEventSound]);

  // Sons de entrada/saída de participantes
  useEffect(() => {
    // Aguarda a conexão estabilizar antes de sincronizar a lista inicial,
    // evitando "join/leave" falsos ao entrar no canal (localIdentity muda durante a conexão)
    if (!isInitialPresenceSyncDoneRef.current) {
      const syncTimer = window.setTimeout(() => {
        isInitialPresenceSyncDoneRef.current = true;
        knownParticipantIdsRef.current = new Set(
          participants.filter((participant) => !participant.isLocal).map((participant) => participant.identity),
        );
      }, 800);
      return () => window.clearTimeout(syncTimer);
    }

    // Considera apenas participantes REMOTOS para não ser afetado pelo identity local
    const currentIds = new Set(
      participants.filter((participant) => !participant.isLocal).map((participant) => participant.identity),
    );
    const previousIds = knownParticipantIdsRef.current;

    currentIds.forEach((id) => {
      if (!previousIds.has(id)) {
        playEventSound("join");
      }
    });

    previousIds.forEach((id) => {
      if (!currentIds.has(id)) {
        playEventSound("leave");
      }
    });

    knownParticipantIdsRef.current = currentIds;
  }, [participants, playEventSound]);

  // Som quando alguém inicia transmissão (câmera ou tela)
  useEffect(() => {
    const handleTrackPublished = (publication: RemoteTrackPublication, participant?: RemoteParticipant) => {
      const isStreamSource =
        publication.source === Track.Source.Camera || publication.source === Track.Source.ScreenShare;
      const isRemoteParticipant = participant ? !participant.isLocal : false;

      if (isStreamSource && isRemoteParticipant) {
        playEventSound("stream");
      }

      // Auto-assina a transmissão: quando alguém liga a câmera, o vídeo
      // aparece no card automaticamente, sem precisar clicar em "Ver transmissão".
      if (isStreamSource && isRemoteParticipant && publication.trackSid) {
        publication.setSubscribed(true);

        // Se o usuário tinha escondido a transmissão deste participante,
        // desesconde ao ligar a câmera novamente (nova transmissão).
        if (participant) {
          const source = getCardSourceFromTrackSource(publication.source);
          const trackKey = getTrackKey(participant.identity, source);
          setHiddenTrackKeys((currentValue) => currentValue.filter((key) => key !== trackKey));
        }
      }
    };

    room.on(RoomEvent.TrackPublished, handleTrackPublished);

    return () => {
      room.off(RoomEvent.TrackPublished, handleTrackPublished);
    };
  }, [playEventSound, room]);

  // Supressão de ruído (RNNoise ou DeepFilterNet2) no microfone local
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const micPublication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const micTrack = micPublication?.track;

    if (!micTrack || !(micTrack instanceof LocalAudioTrack)) {
      // Microfone ainda não publicado ou já removido
      if (rnnoiseAttachmentRef.current) {
        detachRnnNoise(rnnoiseAttachmentRef.current);
        rnnoiseAttachmentRef.current = null;
      }
      if (deepFilterProcessorRef.current) {
        if (micTrack instanceof LocalAudioTrack) {
          void micTrack.stopProcessor().catch(() => undefined);
        }
        deepFilterProcessorRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const apply = async () => {
      try {
        if (!noiseSuppressionEnabled) {
          // Desliga qualquer processamento
          setNoiseSuppressionStatus("idle");
          if (rnnoiseAttachmentRef.current) {
            await applyRnnNoiseToLiveKitTrack(
              {
                mediaStreamTrack: rnnoiseAttachmentRef.current.originalTrack,
                replaceTrack: (track) => micTrack.replaceTrack(track).then(() => undefined),
              },
              false,
              rnnoiseAttachmentRef,
              micGain,
            );
          }
          if (deepFilterProcessorRef.current) {
            await micTrack.stopProcessor().catch(() => undefined);
            deepFilterProcessorRef.current = null;
          }
          return;
        }

        setNoiseSuppressionStatus("loading");

        if (noiseSuppressionMode === "rnnoise") {
          // Desativa DeepFilter se estava ativo
          if (deepFilterProcessorRef.current) {
            await micTrack.stopProcessor().catch(() => undefined);
            deepFilterProcessorRef.current = null;
          }
          await applyRnnNoiseToLiveKitTrack(
            {
              mediaStreamTrack: micTrack.mediaStreamTrack,
              replaceTrack: (track) => micTrack.replaceTrack(track).then(() => undefined),
            },
            true,
            rnnoiseAttachmentRef,
            micGain,
          );
        } else {
          // DeepFilterNet2 - usa a API setProcessor do LiveKit
          if (rnnoiseAttachmentRef.current) {
            await applyRnnNoiseToLiveKitTrack(
              {
                mediaStreamTrack: rnnoiseAttachmentRef.current.originalTrack,
                replaceTrack: (track) => micTrack.replaceTrack(track).then(() => undefined),
              },
              false,
              rnnoiseAttachmentRef,
              micGain,
            );
          }
          try {
            const processor = await createDeepFilterProcessor();
            await micTrack.setProcessor(processor);
            deepFilterProcessorRef.current = { processor, track: micTrack };
          } catch (deepFilterError) {
            // DeepFilterNet não disponível (binários ausentes) -> fallback automático para RNNoise
            console.warn("DeepFilterNet2 indisponível, usando RNNoise.", deepFilterError);
            await applyRnnNoiseToLiveKitTrack(
              {
                mediaStreamTrack: micTrack.mediaStreamTrack,
                replaceTrack: (track) => micTrack.replaceTrack(track).then(() => undefined),
              },
              true,
              rnnoiseAttachmentRef,
              micGain,
            );
          }
        }

        if (!cancelled) {
          setNoiseSuppressionStatus("active");
        }
      } catch (error) {
        if (!cancelled) {
          setNoiseSuppressionStatus("error");
          console.error("Supressão de ruído: falha ao aplicar.", error);
        }
      }
    };

    void apply();

    // Se o microfone for publicado depois (entrar com mic), aplica automaticamente
    const handleTrackPublished = (publication: TrackPublication) => {
      if (publication.source === Track.Source.Microphone) {
        void apply();
      }
    };
    room.localParticipant.on(RoomEvent.LocalTrackPublished, handleTrackPublished);

    return () => {
      cancelled = true;
      room.localParticipant.off(RoomEvent.LocalTrackPublished, handleTrackPublished);
    };
  }, [micGain, noiseSuppressionEnabled, noiseSuppressionMode, room]);

  // Limpa o pipeline RNNoise ao desmontar o componente
  useEffect(() => {
    return () => {
      if (rnnoiseAttachmentRef.current) {
        detachRnnNoise(rnnoiseAttachmentRef.current);
        rnnoiseAttachmentRef.current = null;
      }
    };
  }, []);

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
      gifUrl: sound.gifUrl ?? null,
      durationMs: Math.round(sound.durationSeconds * 1000),
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
      if (newSoundGifFile) {
        formData.append("gif", newSoundGifFile);
      }
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
      setNewSoundGifFile(null);
      setNewSoundGifPreviewUrl((currentValue) => {
        if (currentValue) {
          URL.revokeObjectURL(currentValue);
        }
        return null;
      });
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
    newSoundGifFile,
    newSoundName,
    newSoundOriginalDuration,
    newSoundTrimDurationSeconds,
    newSoundTrimStartSeconds,
    normalizedCurrentUserId,
    serverId,
    canUploadServerSounds,
    publishRoomData,
  ]);

  const updateSoundGif = useCallback(async (action: "set" | "remove") => {
    if (!serverId || !gifEditingSoundId || !normalizedCurrentUserId) {
      return;
    }

    setSoundboardError(null);
    setIsSoundboardBusy(true);

    try {
      const formData = new FormData();
      formData.append("actorId", normalizedCurrentUserId);
      formData.append("action", action);
      if (action === "set" && gifEditingSoundGifFile) {
        formData.append("gif", gifEditingSoundGifFile);
      }

      const response = await fetch(`/api/servers/${serverId}/sounds/${gifEditingSoundId}`, {
        method: "PATCH",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSoundboardError(payload.error ?? "Falha ao atualizar o GIF do som.");
        return;
      }

      const updated = payload.sound as ServerSound;
      setServerSounds((currentValue) =>
        currentValue.map((item) => (item.id === updated.id ? updated : item)),
      );

      setGifEditingSoundId(null);
      setGifEditingSoundName("");
      setGifEditingSoundGifFile(null);
      setGifEditingSoundGifPreviewUrl((currentValue) => {
        if (currentValue && !currentValue.startsWith("/uploads/")) {
          URL.revokeObjectURL(currentValue);
        }
        return null;
      });
    } catch (error) {
      setSoundboardError(error instanceof Error ? error.message : "Falha ao atualizar o GIF do som.");
    } finally {
      setIsSoundboardBusy(false);
    }
  }, [gifEditingSoundGifFile, gifEditingSoundId, normalizedCurrentUserId, serverId]);

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

  const fullscreenTrack = fullscreenParticipantId
    ? fullscreenSource
      ? visibleTrackRefs.find((trackRef) =>
          trackRef.participant.identity === fullscreenParticipantId && trackRef.source === fullscreenSource,
        ) ?? null
      : getPreferredTrack(fullscreenParticipantId)
    : null;

  const getRemoteParticipant = (participantId: string) => room.remoteParticipants.get(participantId);

  const getAudioPublicationVolume = useCallback(
    (participantId: string, source: Track.Source | undefined) => {
      if (source === Track.Source.ScreenShareAudio) {
        return sharedAudioVolumeByParticipant[getVolumeParticipantKey(participantId)] ?? 100;
      }

      return audioVolumeByParticipant[getVolumeParticipantKey(participantId)] ?? 100;
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

        // Auto-assina o vídeo: quando o usuário liga a câmera, o card
        // já mostra a transmissão automaticamente, sem precisar clicar.
        publication.setSubscribed(true);
        initializedPublicationSidsRef.current.add(publication.trackSid);

        syncWatchingFromSubscriptions(participant.identity);
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
    const readVolumes = (key: string, legacyKey?: string): Record<string, number> => {
      try {
        const rawValue =
          window.localStorage.getItem(key) ??
          window.sessionStorage.getItem(key) ??
          (legacyKey ? window.sessionStorage.getItem(legacyKey) : null);
        const parsed: unknown = rawValue ? JSON.parse(rawValue) : {};
        const sanitized: Record<string, number> = {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.entries(parsed).forEach(([participantId, value]) => {
            if (typeof value === "number" && Number.isFinite(value)) {
              sanitized[getVolumeParticipantKey(participantId)] = normalizeParticipantVolume(value);
            }
          });
        }
        return sanitized;
      } catch {
        return {};
      }
    };

    setAudioVolumeByParticipant(readVolumes(volumeStorageKey, `twinslkit:voice:volume:${roomStorageScope}`));
    setSharedAudioVolumeByParticipant(readVolumes(`${volumeStorageKey}:shared`));
    setLoadedVolumeStorageKey(volumeStorageKey);
  }, [roomStorageScope, volumeStorageKey]);

  useEffect(() => {
    if (loadedVolumeStorageKey !== volumeStorageKey) {
      return;
    }

    try {
      window.localStorage.setItem(volumeStorageKey, JSON.stringify(audioVolumeByParticipant));
      window.localStorage.setItem(`${volumeStorageKey}:shared`, JSON.stringify(sharedAudioVolumeByParticipant));
    } catch {
      // ignore storage quota / privacy mode failures
    }
  }, [audioVolumeByParticipant, sharedAudioVolumeByParticipant, loadedVolumeStorageKey, volumeStorageKey]);

  useEffect(() => {
    try {
      const rawValue =
        window.localStorage.getItem(soundEffectsStorageKey) ??
        window.sessionStorage.getItem(soundEffectsStorageKey) ??
        window.sessionStorage.getItem(`twinslkit:voice:sfx:${roomStorageScope}`);
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
      window.localStorage.setItem(
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
      if (soundGifOverlayTimeoutRef.current) {
        window.clearTimeout(soundGifOverlayTimeoutRef.current);
        soundGifOverlayTimeoutRef.current = null;
      }
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

  // Limpar indicadores de som tocado após tempo máximo
  useEffect(() => {
    const timeoutIds: Record<string, ReturnType<typeof setTimeout>> = {};

    Object.entries(soundPlayingByParticipantId).forEach(([participantId, soundData]) => {
      const maxDurationMs = (MAX_SOUND_DURATION_SECONDS + 5) * 1000; // 15 segundos de margem
      const elapsedMs = Date.now() - soundData.startTime;
      const remainingMs = Math.max(0, maxDurationMs - elapsedMs);

      timeoutIds[participantId] = setTimeout(() => {
        setSoundPlayingByParticipantId((currentValue) => {
          const newValue = { ...currentValue };
          delete newValue[participantId];
          return newValue;
        });
      }, remainingMs);
    });

    return () => {
      Object.values(timeoutIds).forEach((timeoutId) => clearTimeout(timeoutId));
    };
  }, [soundPlayingByParticipantId]);

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
    const normalizedVolume = normalizeParticipantVolume(volume);

    setAudioVolumeByParticipant((currentValue) => ({
      ...currentValue,
      [getVolumeParticipantKey(participantId)]: normalizedVolume,
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
    const sharedVolume = sharedAudioVolumeByParticipant[getVolumeParticipantKey(participantId)] ?? 100;

    [...participant.audioTrackPublications.values()]
      .filter((publication) => publication.source === Track.Source.ScreenShareAudio)
      .forEach((publication) => {
        publication.setSubscribed(shouldListenToParticipant && shouldListen);
        applyTrackVolume(publication.audioTrack, sharedVolume);
      });
  };

  const setParticipantSharedAudioVolume = (participantId: string, volume: number) => {
    const normalizedVolume = normalizeParticipantVolume(volume);

    setSharedAudioVolumeByParticipant((currentValue) => ({
      ...currentValue,
      [getVolumeParticipantKey(participantId)]: normalizedVolume,
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

  const openFullscreen = async (participantId: string, source?: "camera" | "screen" | "placeholder") => {
    setFullscreenSource(source === "camera" ? Track.Source.Camera : source === "screen" ? Track.Source.ScreenShare : null);
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

  // Verifica se um trackRef de vídeo está realmente transmitindo (não muted).
  const isTrackRefActive = (trackRef: (typeof visibleTrackRefs)[number] | null): boolean => {
    if (!trackRef) {
      return false;
    }
    return !trackRef.publication.isMuted && !!trackRef.publication.track;
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
    if (!id || stageParticipantIds.includes(id)) {
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

  return (
    <div ref={fullscreenRootRef} className="h-full min-h-0 min-w-0 overflow-hidden flex flex-col bg-transparent">
      {!isSelfSilenced && <VoiceAudioRenderer microphoneVolumes={audioVolumeByParticipant}
        sharedVolumes={sharedAudioVolumeByParticipant} ready={loadedVolumeStorageKey === volumeStorageKey} />}

      {/* ── Participant video/avatar grid ── */}
      {/* Hide LiveKit's built-in participant info bar to avoid duplicate names */}
      <style>{`
        .lk-participant-tile .lk-participant-metadata,
        .lk-participant-tile .lk-participant-name,
        .lk-participant-tile .lk-participant-placeholder {
          display: none !important;
        }
        .lk-participant-tile {
          background: transparent !important;
        }
        .voice-stream-card .lk-participant-tile {
          position: absolute !important;
          inset: 0;
          width: 100%;
          height: 100%;
          min-width: 0;
          min-height: 0;
          aspect-ratio: auto;
        }
        .voice-stream-card .lk-participant-tile video,
        .voice-fullscreen .lk-participant-tile video {
          position: absolute;
          inset: 0;
          min-width: 0;
          min-height: 0;
          max-width: 100%;
          max-height: 100%;
          object-position: center;
        }
        .voice-fullscreen .lk-participant-tile {
          width: 100%;
          height: 100%;
          min-height: 0;
          max-height: 100%;
        }
        .lk-participant-tile video {
          object-fit: contain !important;
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>

      <main className={`neon-frame relative isolate flex-1 min-h-0 min-w-0 overflow-hidden mb-1 p-1.5 ${isMobile ? "mx-1.5 mt-1.5" : "mx-2 mt-1.5"}`}>
        {/* Video / screen share streams + audio-only avatars */}
        {(() => {
          const allActiveStreamCards = stageCards.filter((c) => c.trackRef && isTrackRefActive(c.trackRef));
          const focusedCard = allActiveStreamCards.find((card) => `${card.participantId}:${card.source}` === focusedStreamKey);
          const activeStreamCards = focusedCard ? [focusedCard] : allActiveStreamCards;
          const audioOnlyCards = stageCards.filter((c) => !c.trackRef || !isTrackRefActive(c.trackRef));
          const hasActiveStreams = activeStreamCards.length > 0;
          // Com uma única transmissão, a sobra fica nas laterais (vídeo 16:9 em área larga):
          // os participantes só de áudio vão para uma coluna à direita em vez de roubar altura.
          const audioAsSideColumn = !isMobile && hasActiveStreams && activeStreamCards.length === 1;

          return (
            <div className={`flex gap-1.5 h-full min-h-0 min-w-0 ${audioAsSideColumn ? "flex-row" : "flex-col"}`}>
              {focusedCard && (
                <button type="button" onClick={() => setFocusedStreamKey(null)}
                  className="absolute right-3 top-3 z-20 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white hover:bg-black/80 backdrop-blur">
                  Voltar à grade
                </button>
              )}
              {/* Video grid */}
              {hasActiveStreams && (
                <div
                  className={`grid min-h-0 min-w-0 flex-1 gap-1 ${activeStreamCards.length === 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"}`}
                  style={{ gridAutoRows: "minmax(0, 1fr)" }}
                >
                  {activeStreamCards.map((card) => {
                    const participantId = card.participantId;
                    const name = getParticipantName(participantId);
                    const speaking = isParticipantSpeaking(participantId);
                    return (
                      <div
                        key={`${participantId}-${card.source}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Ampliar ${card.source === "screen" ? "compartilhamento" : "câmera"} de ${name}`}
                        onClick={() => setFocusedStreamKey(`${participantId}:${card.source}`)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setFocusedStreamKey(`${participantId}:${card.source}`);
                          }
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setContextMenu({ participantId, source: card.source, x: event.clientX, y: event.clientY });
                        }}
                        className={`voice-stream-card cursor-pointer relative min-h-0 min-w-0 rounded-xl overflow-hidden bg-[var(--tk-bg-deepest)] ${
                          speaking ? "ring-2 ring-[var(--tk-green)] shadow-[0_0_18px_rgba(62,224,122,0.35)]" : ""
                        }`}
                      >
                        <div className="absolute inset-0">
                          <ParticipantTile trackRef={card.trackRef!} />
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#07051a]/95 via-[#130e2e]/60 to-transparent px-4 pt-6 pb-2.5 z-10">
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-bold text-white truncate">{name}</span>
                            {card.source === "screen" && (
                              <span className="rounded-md neon-active px-2 py-0.5 text-[10px] font-bold">AO VIVO · Tela</span>
                            )}
                            {!isParticipantMicEnabled(participantId) && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-red-400 shrink-0">
                                <path d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M17 16.95A7 7 0 015 12m14 0a7 7 0 01-.11 1.23M12 19v4m-4 0h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                            {!isParticipantListening(participantId) && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-red-400 shrink-0">
                                <path d="M3 14h3a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a9 9 0 0118 0v7a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              </svg>
                            )}
                            {soundPlayingByParticipantId[participantId] && (
                              <span className="text-[11px] text-blue-300 truncate">🔊 {soundPlayingByParticipantId[participantId].soundName}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Audio-only participants as circles */}
              {!focusedCard && audioOnlyCards.length > 0 && (
                <div className={`${
                  audioAsSideColumn
                    ? "shrink-0 w-32 min-h-0 overflow-y-auto no-scrollbar py-1"
                    : hasActiveStreams
                      ? "shrink-0 min-w-0 py-1 overflow-x-auto no-scrollbar"
                      : "flex-1 min-h-0 overflow-y-auto flex items-center justify-center"
                }`}>
                  <div className={`flex ${
                    audioAsSideColumn
                      ? "flex-col items-center gap-2"
                      : hasActiveStreams
                        ? "gap-3 px-2 w-max min-w-full justify-center"
                        : "gap-4 px-4 flex-wrap justify-center"
                  }`}>
                    {audioOnlyCards.map((card) => {
                      const participantId = card.participantId;
                      const name = getParticipantName(participantId);
                      const speaking = isParticipantSpeaking(participantId);
                      const micEnabled = isParticipantMicEnabled(participantId);
                      const avatarSize = hasActiveStreams ? "h-12 w-12" : "h-20 w-20";
                      const textSize = hasActiveStreams ? "text-sm" : "text-xl";
                      return (
                        <div
                          key={`${participantId}-${card.source}`}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setContextMenu({ participantId, source: card.source, x: event.clientX, y: event.clientY });
                          }}
                          data-speaking={speaking ? "true" : "false"}
                          className={`neon-card flex flex-col items-center gap-1.5 cursor-default ${hasActiveStreams ? "w-28 px-2 pt-2.5 pb-2" : "w-36 px-3 pt-4 pb-3"}`}
                        >
                          <div className={`relative ${
                            speaking ? "ring-[3px] ring-[var(--tk-green)] rounded-full shadow-[0_0_14px_rgba(62,224,122,0.5)]" : ""
                          }`}>
                            {getAvatarUrl(participantId) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={getAvatarUrl(participantId)!}
                                alt={name}
                                className={`${avatarSize} rounded-full object-cover`}
                              />
                            ) : (
                              <div className={`${avatarSize} rounded-full neon-active flex items-center justify-center ${textSize} font-bold`}>
                                {getInitials(name)}
                              </div>
                            )}
                            {!micEnabled && (
                              <div className="absolute -bottom-1 -right-1 rounded-full bg-[var(--tk-bg-deep)] p-[3px]">
                                <div className="rounded-full bg-[#ED4245] p-[3px] flex items-center justify-center">
                                  <svg width={hasActiveStreams ? "12" : "14"} height={hasActiveStreams ? "12" : "14"} viewBox="0 0 24 24" fill="none" className="text-white">
                                    <path d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M17 16.95A7 7 0 015 12m14 0a7 7 0 01-.11 1.23M12 19v4m-4 0h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                              </div>
                            )}
                            {!isParticipantListening(participantId) && (
                              <div className="absolute -bottom-1 -left-1 rounded-full bg-[var(--tk-bg-deep)] p-[3px]">
                                <div className="rounded-full bg-[#ED4245] p-[3px] flex items-center justify-center">
                                  <svg width={hasActiveStreams ? "12" : "14"} height={hasActiveStreams ? "12" : "14"} viewBox="0 0 24 24" fill="none" className="text-white">
                                    <path d="M3 14h3a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a9 9 0 0118 0v7a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                                  </svg>
                                </div>
                              </div>
                            )}
                          </div>
                          <span className={`${hasActiveStreams ? "text-[10px]" : "text-xs"} font-semibold text-white max-w-full truncate`} title={name}>{name}</span>
                          {soundPlayingByParticipantId[participantId] && (
                            <span className="text-[10px] text-blue-300 truncate max-w-[80px]">🔊 {soundPlayingByParticipantId[participantId].soundName}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </main>

      {/* ── Bottom control bar (Discord-style) ── */}
      <div className={`neon-controlbar relative z-30 shrink-0 py-2 ${isMobile ? "px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" : "px-4"}`}>
        <div className={`flex items-center justify-center ${isMobile ? "flex-wrap gap-2" : "gap-3"}`}>
          {/* Mic toggle - handled by ControlBar but we overlay custom icons */}
          <ControlBar
            variation="minimal"
            controls={{
              microphone: true,
              camera: false,
              screenShare: false,
              leave: false,
              chat: false,
              settings: false,
            }}
          />
          <div className="flex items-center">
            <TrackToggle
              source={Track.Source.Camera}
              captureOptions={CAMERA_CAPTURE_OPTIONS}
              title="Ativar/desativar câmera (60 FPS)"
            />
            <CameraDeviceControl currentUserId={currentUserId} />
          </div>
          {/* Celulares não suportam compartilhar tela pelo navegador */}
          {!isMobile && (
          <TrackToggle
            source={Track.Source.ScreenShare}
            captureOptions={screenShareCaptureOptions}
            publishOptions={SHARED_AUDIO_PUBLISH_OPTIONS}
            title="Ativar/desativar transmissão (60 FPS)"
          />
          )}

          {/* Soundboard button */}
          {serverId && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSoundboardPopup((v) => !v)}
                data-active={showSoundboardPopup ? "true" : "false"}
                className="neon-btn flex items-center justify-center"
                title="Soundboard"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </button>
            </div>
          )}

          {/* Audio-only share */}
          {(!isMobile || isAudioOnlySharing) && (
          <button
            type="button"
            onClick={() => (isAudioOnlySharing ? stopAudioOnlyShare() : void startAudioOnlyShare())}
            data-active={isAudioOnlySharing ? "true" : "false"}
            className="neon-btn flex items-center justify-center"
            title={isAudioOnlySharing ? "Parar áudio compartilhado" : "Compartilhar somente áudio"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
          </button>
          )}

          {/* Advanced options */}
          <button
            type="button"
            onClick={() => setShowAdvancedOptions((v) => !v)}
            data-active={showAdvancedOptions ? "true" : "false"}
            className="neon-btn flex items-center justify-center"
            title="Opções avançadas"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>

          {/* Disconnect */}
          <button
            type="button"
            onClick={() => room.disconnect()}
            className="neon-btn-danger flex items-center justify-center ml-3"
            title="Desconectar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 010-1.36C3.69 8.68 7.65 7 12 7s8.31 1.68 11.71 4.72c.18.18.29.44.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C14.15 9.25 12.6 9 12 9z"/>
            </svg>
          </button>
        </div>

        {/* Noise suppression badge */}
        {noiseSuppressionEnabled && noiseSuppressionStatus !== "idle" && (
          <div className="flex justify-center mt-2">
            {noiseSuppressionStatus === "active" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] text-emerald-300">
                Antirruído ativo
              </span>
            ) : noiseSuppressionStatus === "loading" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] text-amber-300">
                Carregando antirruído...
              </span>
            ) : noiseSuppressionStatus === "error" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-[11px] text-red-300" title="Falha ao carregar o antirruído (F12)">
                Antirruído falhou
              </span>
            ) : null}
          </div>
        )}

        {audioOnlyShareError && (
          <p className="text-center mt-1 text-[11px] text-red-300">{audioOnlyShareError}</p>
        )}
      </div>

      {/* ── Advanced options panel (slide-up) ── */}
      {showAdvancedOptions && (
        <>
          <button type="button" aria-label="Fechar" className="fixed inset-0 z-[59]" onClick={() => setShowAdvancedOptions(false)} />
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-80 rounded-xl border border-zinc-700 bg-[var(--tk-bg-panel)] shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-100">Opções avançadas</p>
              <button type="button" onClick={() => setShowAdvancedOptions(false)} className="text-zinc-400 hover:text-zinc-200">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer hover:text-white">
              <input
                type="checkbox"
                checked={isSelfSilenced}
                onChange={(event) => setIsSelfSilenced(event.target.checked)}
                className="rounded"
              />
              Silenciar tudo (mic + áudio)
            </label>

            <label className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer hover:text-white">
              <input
                type="checkbox"
                checked={enableSelfScreenShareMonitor}
                onChange={(event) => setEnableSelfScreenShareMonitor(event.target.checked)}
                className="rounded"
              />
              Monitorar áudio da transmissão
            </label>
            {enableSelfScreenShareMonitor && !localScreenShareAudioTrack && (
              <p className="text-[11px] text-amber-300 ml-6">Compartilhe a tela com áudio primeiro.</p>
            )}

            <div className="space-y-1">
              <p className="text-xs text-zinc-400">Volume dos efeitos sonoros: {soundEffectsVolume}%</p>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={soundEffectsVolume}
                onChange={(event) => setSoundEffectsVolume(Number(event.target.value))}
                className="w-full accent-[var(--tk-accent)]"
              />
            </div>
          </div>
        </>
      )}

      {/* ── Soundboard popup (Discord-style floating panel) ── */}
      {showSoundboardPopup && (
        <>
          <button type="button" aria-label="Fechar soundboard" className="fixed inset-0 z-[59]" onClick={() => setShowSoundboardPopup(false)} />
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-700 bg-[var(--tk-bg-panel)] shadow-2xl overflow-hidden">
            {/* Soundboard header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold text-zinc-100">Soundboard</p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setShowOnlyFavoriteSounds(false)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                      !showOnlyFavoriteSounds ? "bg-[var(--tk-accent)] text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                    }`}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOnlyFavoriteSounds(true)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                      showOnlyFavoriteSounds ? "bg-[var(--tk-accent)] text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                    }`}
                  >
                    ★ Favoritos
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canUploadServerSounds && (
                  <button
                    type="button"
                    onClick={() => { setShowSoundUploadModal(true); setShowSoundboardPopup(false); }}
                    className="rounded-md bg-[var(--tk-accent)] hover:bg-indigo-500 px-2.5 py-1 text-[11px] font-medium text-white transition-colors"
                  >
                    + Enviar som
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void loadServerSounds()}
                  disabled={isLoadingServerSounds}
                  className="text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
                  title="Atualizar"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                  </svg>
                </button>
                <button type="button" onClick={() => setShowSoundboardPopup(false)} className="text-zinc-400 hover:text-zinc-200">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>

            {/* Soundboard error */}
            {soundboardError && (
              <div className="px-4 py-2 bg-red-900/30 border-b border-red-700/50 text-xs text-red-200">{soundboardError}</div>
            )}

            {/* Sound grid */}
            <div className="max-h-[320px] overflow-y-auto p-3 space-y-2">
              {isLoadingServerSounds && <p className="text-xs text-zinc-500 text-center py-4">Carregando sons...</p>}

              {!isLoadingServerSounds && filteredServerSounds.length === 0 && (
                <p className="text-xs text-zinc-500 text-center py-4">
                  {showOnlyFavoriteSounds ? "Nenhum favorito ainda." : "Nenhum som disponível."}
                </p>
              )}

              {groupedServerSounds.map((section) => {
                const isCollapsed = collapsedSoundSections[section.key] ?? !section.isCurrentServer;

                return (
                  <div key={section.key}>
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedSoundSections((currentValue) => ({
                          ...currentValue,
                          [section.key]: !isCollapsed,
                        }))
                      }
                      className="flex w-full items-center gap-2 text-left text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1 hover:text-zinc-200"
                    >
                      <span>{isCollapsed ? "▸" : "▾"}</span>
                      <span className="truncate">{section.serverName}</span>
                      <span className="text-zinc-600 font-normal ml-auto">{section.sounds.length}</span>
                    </button>

                    {!isCollapsed && (
                      <div className="grid grid-cols-3 gap-1">
                        {section.sounds.map((sound) => {
                          const canRemove = canDeleteServerSounds && sound.serverId === serverId;
                          const isPlaying = playingSoundIds.includes(sound.id);

                          return (
                            <button
                              key={sound.id}
                              type="button"
                              onClick={() => void playServerSound(sound)}
                              disabled={isPlaying}
                              className={`group relative rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-60 ${
                                isPlaying
                                  ? "bg-emerald-600/20 border border-emerald-500/40"
                                  : "bg-[var(--tk-bg-elev)] hover:bg-[var(--tk-bg-active)] border border-transparent"
                              }`}
                              title={`${sound.name} · ${formatSoundDuration(sound.durationSeconds)} · por ${sound.createdByName}`}
                            >
                              <p className="truncate text-[12px] text-zinc-200 font-medium">{sound.name}</p>
                              <p className="text-[10px] text-zinc-500">{formatSoundDuration(sound.durationSeconds)}</p>

                              {/* Action buttons on hover */}
                              <div className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center gap-0.5">
                                {sound.gifUrl && (
                                  <span className="rounded bg-pink-500/20 px-1 text-[9px] text-pink-300">GIF</span>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); void toggleServerSoundFavorite(sound); }}
                                  className={`rounded px-1 text-[11px] ${sound.isFavorite ? "text-amber-300" : "text-zinc-500 hover:text-amber-300"}`}
                                  title={sound.isFavorite ? "Remover favorito" : "Favoritar"}
                                >
                                  {sound.isFavorite ? "★" : "☆"}
                                </button>
                                {canUploadServerSounds && sound.serverId === serverId && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setGifEditingSoundId(sound.id);
                                      setGifEditingSoundName(sound.name);
                                      setGifEditingSoundGifFile(null);
                                      setGifEditingSoundGifPreviewUrl(sound.gifUrl ?? null);
                                      setShowSoundboardPopup(false);
                                    }}
                                    className="rounded px-1 text-[11px] text-zinc-500 hover:text-indigo-300"
                                    title="Editar GIF"
                                  >
                                    🖼️
                                  </button>
                                )}
                                {canRemove && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); void removeServerSound(sound); }}
                                    disabled={isSoundboardBusy}
                                    className="rounded px-1 text-[11px] text-zinc-500 hover:text-red-300 disabled:opacity-60"
                                    title="Remover"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Sound upload modal ── */}
      {showSoundUploadModal && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-[var(--tk-bg-panel)] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold text-zinc-100">Enviar novo som</p>
              <button
                type="button"
                onClick={() => setShowSoundUploadModal(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-zinc-400 mb-1">Arquivo de áudio</p>
                <input
                  key={newSoundInputKey}
                  type="file"
                  accept="audio/*"
                  onChange={(event) => {
                    setSoundboardError(null);
                    setNewSoundFile(event.target.files?.[0] ?? null);
                  }}
                  className="block w-full text-xs text-zinc-300 file:mr-2 file:rounded-md file:border-0 file:bg-[var(--tk-accent)] file:px-3 file:py-1.5 file:text-white file:font-medium file:cursor-pointer"
                />
                {isAnalyzingSoundFile && (
                  <p className="text-[11px] text-zinc-500 mt-1">Analisando...</p>
                )}
                {!isAnalyzingSoundFile && newSoundOriginalDuration !== null && (
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Duração: {formatSoundDuration(newSoundOriginalDuration)}
                  </p>
                )}
              </div>

              {!isAnalyzingSoundFile && (newSoundOriginalDuration ?? 0) > 1 && (
                <div className="rounded-lg bg-[var(--tk-bg-deep)] p-3 space-y-2">
                  <p className="text-[11px] text-zinc-300 font-medium">Recortar trecho</p>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-zinc-400">Duração</p>
                      <p className="text-[11px] text-zinc-300">{formatSoundDuration(newSoundTrimDurationSeconds)}</p>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={maxTrimDurationSeconds}
                      step={0.1}
                      value={newSoundTrimDurationSeconds}
                      onChange={(event) => setNewSoundTrimDurationSeconds(Number(event.target.value))}
                      className="w-full accent-[var(--tk-accent)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-zinc-400">Início</p>
                      <p className="text-[11px] text-zinc-300">{formatSoundDuration(newSoundTrimStartSeconds)} — {formatSoundDuration(newSoundTrimStartSeconds + newSoundTrimDurationSeconds)}</p>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={maxTrimStartSeconds}
                      step={0.1}
                      value={newSoundTrimStartSeconds}
                      onChange={(event) => setNewSoundTrimStartSeconds(Number(event.target.value))}
                      className="w-full accent-[var(--tk-accent)]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void playTrimPreview()}
                      disabled={!newSoundFile || isAnalyzingSoundFile || isSoundboardBusy || isPlayingTrimPreview}
                      className="flex-1 rounded-md bg-[var(--tk-bg-elev)] hover:bg-[var(--tk-bg-active)] px-2 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
                    >
                      {isPlayingTrimPreview ? "Reproduzindo..." : "▶ Ouvir trecho"}
                    </button>
                    <button
                      type="button"
                      onClick={stopTrimPreview}
                      disabled={!isPlayingTrimPreview}
                      className="rounded-md bg-[var(--tk-bg-elev)] hover:bg-[var(--tk-bg-active)] px-2 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
                    >
                      ■ Parar
                    </button>
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs text-zinc-400 mb-1">Imagem/GIF (opcional)</p>
                <input
                  type="file"
                  accept="image/gif,image/*"
                  onChange={(event) => {
                    setSoundboardError(null);
                    const file = event.target.files?.[0] ?? null;
                    setNewSoundGifFile(file);
                    setNewSoundGifPreviewUrl((currentValue) => {
                      if (currentValue) URL.revokeObjectURL(currentValue);
                      return file ? URL.createObjectURL(file) : null;
                    });
                  }}
                  className="block w-full text-xs text-zinc-300 file:mr-2 file:rounded-md file:border-0 file:bg-[var(--tk-bg-elev)] file:px-3 file:py-1.5 file:text-zinc-200 file:cursor-pointer"
                />
                {newSoundGifPreviewUrl && (
                  <div className="flex items-center gap-2 mt-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={newSoundGifPreviewUrl} alt="GIF" className="h-14 w-14 rounded-md border border-zinc-700 object-cover" />
                    <button
                      type="button"
                      onClick={() => {
                        setNewSoundGifFile(null);
                        setNewSoundGifPreviewUrl((v) => { if (v) URL.revokeObjectURL(v); return null; });
                      }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remover
                    </button>
                  </div>
                )}
              </div>

              <input
                value={newSoundName}
                onChange={(event) => setNewSoundName(event.target.value)}
                placeholder="Nome do som (opcional)"
                className="w-full rounded-md bg-[var(--tk-bg-deep)] border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-[var(--tk-accent)] focus:outline-none"
              />

              {soundboardError && (
                <p className="text-xs text-red-300 bg-red-900/30 rounded-md px-3 py-1.5">{soundboardError}</p>
              )}

              <button
                type="button"
                onClick={() => { void uploadServerSound(); }}
                disabled={isSoundboardBusy || isAnalyzingSoundFile || !newSoundFile || !serverId || !canUploadServerSounds}
                className="w-full rounded-md bg-[var(--tk-accent)] hover:bg-indigo-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors"
              >
                {(newSoundOriginalDuration ?? 0) > 1 ? "Enviar trecho" : "Enviar som"}
              </button>
              {!canUploadServerSounds && (
                <p className="text-[11px] text-zinc-500">Seu cargo não permite enviar áudio neste servidor.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Fullscreen overlay ── */}
      {fullscreenTrack && (() => {
        const fsParticipantId = fullscreenTrack.participant.identity;
        const fsName = getParticipantName(fsParticipantId);
        return (
          <div className="voice-fullscreen fixed inset-0 z-50 bg-black p-2">
            <div className={`h-full w-full rounded-lg overflow-hidden relative ${
              fullscreenTrack.participant.isSpeaking ? "ring-2 ring-emerald-400" : ""
            }`}>
              {isTrackRefActive(fullscreenTrack) ? (
                <ParticipantTile trackRef={fullscreenTrack} />
              ) : (
                <div className="h-full w-full bg-[var(--tk-bg-panel)] flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    {getAvatarUrl(fsParticipantId) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={getAvatarUrl(fsParticipantId)!} alt={fsName} className="h-32 w-32 rounded-full object-cover" />
                    ) : (
                      <div className="h-32 w-32 rounded-full bg-[var(--tk-accent)] flex items-center justify-center text-5xl font-semibold text-white">
                        {getInitials(fsName)}
                      </div>
                    )}
                    <p className="text-sm text-zinc-400">{fsName}</p>
                  </div>
                </div>
              )}
              <button
                onClick={() => void closeFullscreen()}
                className="absolute top-3 right-3 rounded-md bg-black/60 hover:bg-black/80 px-3 py-1.5 text-xs text-white transition-colors"
              >
                Sair da tela cheia
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Context menu ── */}
      {contextMenu && (() => {
        const participantId = contextMenu.participantId;
        const ctxName = getParticipantName(participantId);
        const isRemote = participantId !== localIdentity;
        const audioMuted = isRemote ? isAudioMutedLocally(participantId) : false;
        const canShowVideo = isRemote ? isParticipantVideoVisible(participantId) : false;
        const volume = audioVolumeByParticipant[getVolumeParticipantKey(participantId)] ?? 100;
        const hasSharedAudio = isRemote ? hasParticipantSharedAudio(participantId) : false;
        const sharedAudioListeningPreference = sharedAudioPreferenceByParticipant[participantId];
        const sharedAudioListening = typeof sharedAudioListeningPreference === "boolean"
          ? sharedAudioListeningPreference
          : watchedParticipantIds.includes(participantId);
        const sharedAudioVolume = sharedAudioVolumeByParticipant[getVolumeParticipantKey(participantId)] ?? 100;
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
            <button type="button" aria-label="Fechar menu" className="fixed inset-0 z-[69] cursor-default" onClick={() => setContextMenu(null)} />
            <div
              className="fixed z-[70] min-w-[240px] rounded-lg border border-zinc-700 bg-[var(--tk-bg-deepest)] p-1.5 shadow-2xl"
              style={{
                left: Math.min(contextMenu.x, typeof window !== "undefined" ? window.innerWidth - 260 : contextMenu.x),
                ...(contextMenu.y > (typeof window !== "undefined" ? window.innerHeight * 0.5 : 400)
                  ? { bottom: typeof window !== "undefined" ? window.innerHeight - contextMenu.y : 0 }
                  : { top: contextMenu.y }),
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {/* User header */}
              <div className="flex items-center gap-2 px-2 py-2 mb-1">
                {getAvatarUrl(participantId) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={getAvatarUrl(participantId)!} alt={ctxName} className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-[var(--tk-accent)] flex items-center justify-center text-xs font-semibold text-white">
                    {getInitials(ctxName)}
                  </div>
                )}
                <span className="text-sm font-medium text-zinc-100 truncate">{ctxName}</span>
              </div>

              <div className="h-px bg-zinc-800 mx-1 mb-1" />

              {isRemote && (
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-300 hover:bg-[var(--tk-accent)] hover:text-white rounded transition-colors"
                  onClick={() => setAudioListening(participantId, audioMuted)}
                >
                  {audioMuted ? "Ativar áudio" : "Silenciar áudio"}
                </button>
              )}

              {isRemote && (
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-300 hover:bg-[var(--tk-accent)] hover:text-white rounded transition-colors"
                  onClick={() =>
                    setMutedSoundEffectsByUserId((currentValue) => ({
                      ...currentValue,
                      [targetUserId]: !isSoundEffectsMutedFromUser,
                    }))
                  }
                >
                  {isSoundEffectsMutedFromUser ? "Ativar efeitos sonoros" : "Silenciar efeitos sonoros"}
                </button>
              )}

              {isRemote && (
                <div className="px-2 py-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[11px] text-zinc-500">Volume</p>
                    <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                      <input type="number" aria-label="Volume do usuário em porcentagem" min={0} max={100} step={0.1}
                        value={volume} onChange={(event) => setParticipantAudioVolume(participantId, Number(event.target.value))}
                        className="w-16 rounded bg-zinc-800 px-1 py-0.5 text-right text-white" />%
                    </label>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.1}
                    value={volume}
                    onChange={(event) => setParticipantAudioVolume(participantId, Number(event.target.value))}
                    className="w-full accent-[var(--tk-accent)]"
                  />
                </div>
              )}

              {isRemote && hasSharedAudio && (
                <>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-300 hover:bg-[var(--tk-accent)] hover:text-white rounded transition-colors"
                    onClick={() => setSharedAudioListening(participantId, !sharedAudioListening)}
                  >
                    {sharedAudioListening ? "Parar áudio compartilhado" : "Ouvir áudio compartilhado"}
                  </button>
                  <div className="px-2 py-1.5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] text-zinc-500">Volume transmissão</p>
                      <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                        <input type="number" aria-label="Volume da transmissão em porcentagem" min={0} max={100} step={0.1}
                          value={sharedAudioVolume} onChange={(event) => setParticipantSharedAudioVolume(participantId, Number(event.target.value))}
                          className="w-16 rounded bg-zinc-800 px-1 py-0.5 text-right text-white" />%
                      </label>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={0.1}
                      value={sharedAudioVolume}
                      onChange={(event) => setParticipantSharedAudioVolume(participantId, Number(event.target.value))}
                      className="w-full accent-[var(--tk-accent)]"
                    />
                  </div>
                </>
              )}

              {isRemote && (
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-300 hover:bg-[var(--tk-accent)] hover:text-white rounded transition-colors"
                  onClick={() => {
                    setParticipantVideoVisible(participantId, !canShowVideo);
                    if (canShowVideo) {
                      setFullscreenParticipantId((currentValue) =>
                        currentValue === participantId ? null : currentValue,
                      );
                    }
                  }}
                >
                  {canShowVideo ? "Ocultar transmissão" : "Ver transmissão"}
                </button>
              )}

              <button
                type="button"
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-300 hover:bg-[var(--tk-accent)] hover:text-white rounded transition-colors"
                onClick={() => {
                  void openFullscreen(participantId, contextMenu.source);
                  setContextMenu(null);
                }}
              >
                Tela cheia
              </button>

              {canModerateTarget && (
                <>
                  <div className="h-px bg-zinc-800 mx-1 my-1" />
                  {canKickFromVoice && (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-[#ED4245] hover:bg-[#ED4245] hover:text-white rounded transition-colors"
                      onClick={() => {
                        void onModerationAction?.({ action: "voice-kick", targetUserId });
                        setContextMenu(null);
                      }}
                    >
                      Expulsar da chamada
                    </button>
                  )}

                  {canMoveVoiceUsers && availableMoveChannels.length > 0 && (
                    <div className="px-2 py-1.5">
                      <p className="text-[11px] text-zinc-500 mb-1">Mover para</p>
                      {availableMoveChannels.map((channel) => (
                        <button
                          key={channel.id}
                          type="button"
                          className="w-full flex items-center gap-2 px-2 py-1 text-sm text-zinc-300 hover:bg-[var(--tk-accent)] hover:text-white rounded transition-colors"
                          onClick={() => {
                            void onModerationAction?.({ action: "voice-move", targetUserId, targetChannelId: channel.id });
                            setContextMenu(null);
                          }}
                        >
                          {channel.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        );
      })()}

      {/* ── Sound GIF overlay ── */}
      {soundGifOverlay && (
        <SoundGifOverlay
          gifUrl={soundGifOverlay.gifUrl}
          soundName={soundGifOverlay.soundName}
          senderName={soundGifOverlay.senderName}
          visible={soundGifOverlay.visible}
          id={soundGifOverlay.id}
        />
      )}

      {/* ── GIF editing modal ── */}
      {gifEditingSoundId && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-[var(--tk-bg-panel)] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-zinc-100">Imagem/GIF do som</p>
              <button
                type="button"
                onClick={() => {
                  setGifEditingSoundId(null);
                  setGifEditingSoundGifFile(null);
                  setGifEditingSoundGifPreviewUrl((currentValue) => {
                    if (currentValue && !currentValue.startsWith("/uploads/")) URL.revokeObjectURL(currentValue);
                    return null;
                  });
                }}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <p className="truncate text-xs text-zinc-400">Som: {gifEditingSoundName}</p>

            {gifEditingSoundGifPreviewUrl && (
              <div className="rounded-lg bg-[var(--tk-bg-deep)] p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={gifEditingSoundGifPreviewUrl} alt="GIF" className="mx-auto max-h-40 rounded object-contain" />
              </div>
            )}

            <input
              type="file"
              accept="image/gif,image/*"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setGifEditingSoundGifFile(file);
                setGifEditingSoundGifPreviewUrl((currentValue) => {
                  if (currentValue && !currentValue.startsWith("/uploads/")) URL.revokeObjectURL(currentValue);
                  return file ? URL.createObjectURL(file) : currentValue;
                });
              }}
              className="block w-full text-xs text-zinc-300 file:mr-2 file:rounded-md file:border-0 file:bg-[var(--tk-accent)] file:px-3 file:py-1.5 file:text-white file:cursor-pointer"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void updateSoundGif("set")}
                disabled={isSoundboardBusy || !gifEditingSoundGifFile}
                className="flex-1 rounded-md bg-[var(--tk-accent)] hover:bg-indigo-500 px-2 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Salvar GIF
              </button>
              {gifEditingSoundGifPreviewUrl && (
                <button
                  type="button"
                  onClick={() => void updateSoundGif("remove")}
                  disabled={isSoundboardBusy}
                  className="rounded-md bg-[#ED4245] hover:bg-red-600 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Remover
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
