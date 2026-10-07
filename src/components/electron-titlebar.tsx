"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProcessAudioBridge } from "@/lib/native-process-audio";

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChange: (callback: (isMaximized: boolean) => void) => void;
      showNotification: (title: string, body: string) => void;
      onUpdateStatus: (callback: (status: string) => void) => void;
      installUpdate: () => void;
      processAudio?: ProcessAudioBridge;
      platform: string;
    };
  }
}

export function ElectronTitlebar() {
  const [isElectron, setIsElectron] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      setIsElectron(true);
      window.electronAPI.isMaximized().then(setIsMaximized);
      window.electronAPI.onMaximizedChange(setIsMaximized);
      window.electronAPI.onUpdateStatus(setUpdateStatus);
    }
  }, []);

  const handleMinimize = useCallback(() => window.electronAPI?.minimize(), []);
  const handleMaximize = useCallback(() => window.electronAPI?.maximize(), []);
  const handleClose = useCallback(() => window.electronAPI?.close(), []);
  const handleInstallUpdate = useCallback(() => window.electronAPI?.installUpdate(), []);

  if (!isElectron) return null;

  return (
    <div
      className="flex items-center h-8 bg-[#1E1F22] select-none shrink-0"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* App icon + name */}
      <div className="flex items-center gap-2 px-3">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#5865F2">
          <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09-.01-.02-.04-.03-.07-.03-1.5.26-2.93.71-4.27 1.33-.01 0-.02.01-.03.02-2.72 4.07-3.47 8.03-3.1 11.95 0 .02.01.04.03.05 1.8 1.32 3.53 2.12 5.24 2.65.03.01.06 0 .07-.02.4-.55.76-1.13 1.07-1.74.02-.04 0-.08-.04-.09-.57-.22-1.11-.48-1.64-.78-.04-.02-.04-.08-.01-.11.11-.08.22-.17.33-.25.02-.02.05-.02.07-.01 3.44 1.57 7.15 1.57 10.55 0 .02-.01.05-.01.07.01.11.09.22.17.33.26.04.03.04.09-.01.11-.52.31-1.07.56-1.64.78-.04.01-.05.06-.04.09.32.61.68 1.19 1.07 1.74.03.01.05.02.07.02 1.72-.53 3.45-1.33 5.24-2.65.02-.01.03-.03.03-.05.44-4.53-.73-8.46-3.1-11.95-.01-.01-.02-.02-.04-.02ZM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.84 2.12-1.89 2.12Zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.83 2.12-1.89 2.12Z" />
        </svg>
        <span className="text-xs text-[#949BA4] font-medium">PartiuChat</span>
      </div>

      {/* Update banner */}
      {updateStatus === "ready" && (
        <button
          type="button"
          onClick={handleInstallUpdate}
          className="ml-auto mr-2 px-2 py-0.5 text-[10px] rounded bg-[#248046] hover:bg-[#1A6334] text-white transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          Atualização pronta — clique para reiniciar
        </button>
      )}
      {updateStatus === "downloading" && (
        <span className="ml-auto mr-2 text-[10px] text-[#949BA4]">Baixando atualização...</span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Window controls */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Minimize */}
        <button
          type="button"
          onClick={handleMinimize}
          className="w-[46px] h-full flex items-center justify-center text-[#B5BAC1] hover:bg-[#383A40] transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>

        {/* Maximize/Restore */}
        <button
          type="button"
          onClick={handleMaximize}
          className="w-[46px] h-full flex items-center justify-center text-[#B5BAC1] hover:bg-[#383A40] transition-colors"
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="2.5" y="0" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="0.5" y="2.5" width="9" height="9" rx="1" fill="#1E1F22" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="0.5" y="0.5" width="11" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          className="w-[46px] h-full flex items-center justify-center text-[#B5BAC1] hover:bg-[#ED4245] hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Hook to send native notifications from anywhere in the app
export function useElectronNotification() {
  const notify = useCallback((title: string, body: string) => {
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.showNotification(title, body);
    }
  }, []);

  return notify;
}
