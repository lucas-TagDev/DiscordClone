const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, session, desktopCapturer, systemPreferences } = require("electron");
const fs = require("fs");
const path = require("path");
const { autoUpdater } = require("electron-updater");

const APP_URL = "https://partiuchat.lacgamesbr.com";
const ICON_PATH = path.join(__dirname, "assets", "icon.png");
const IS_WINDOWS = process.platform === "win32";
const IS_LINUX = process.platform === "linux";
// Chromium only delivers the shared audio as a system loopback stream on Windows/macOS.
const SUPPORTS_LOOPBACK_AUDIO = IS_WINDOWS || process.platform === "darwin";

// ── Native capture of a single program's audio ──────────────────────────────
// Whole-device loopback also captures the voice of the other participants, which
// then echoes back to them. The bundled addon uses WASAPI process loopback
// instead: it captures only the shared program, or everything but this app when a
// whole screen is shared.
const NATIVE_AUDIO_ADDON = (() => {
  const candidates = [
    process.resourcesPath
      ? path.join(process.resourcesPath, "native", "process_audio_capture.node")
      : null,
    path.join(__dirname, "native", "build", "Release", "process_audio_capture.node"),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) {
        return require(candidate);
      }
    } catch (error) {
      console.error("[process-audio] falha ao carregar o addon nativo:", error);
    }
  }
  return null;
})();

// Screen share being negotiated, and the one currently streaming to the room.
let pendingShareTarget = null;
let activeShareTarget = null;

const isNativeAudioAvailable = () => {
  try {
    return Boolean(NATIVE_AUDIO_ADDON?.isSupported?.());
  } catch {
    return false;
  }
};

const buildShareTarget = (source, useNativeAudio) => {
  if (!NATIVE_AUDIO_ADDON || !useNativeAudio) {
    return null;
  }

  const windowMatch = /^window:(\d+):/.exec(source?.id || "");
  if (windowMatch) {
    try {
      const processId = NATIVE_AUDIO_ADDON.getWindowProcessId(Number(windowMatch[1]));
      if (processId) {
        return {
          processId,
          includeTree: true,
          label: NATIVE_AUDIO_ADDON.getProcessImageName(processId) || source.name || "",
        };
      }
    } catch (error) {
      console.error("[process-audio] falha ao resolver o processo da janela:", error);
    }
  }

  // Whole screen or unknown window: capture everything except this app, which is
  // what keeps the call audio out of the share.
  return { processId: process.pid, includeTree: false, label: source?.name || "tela inteira" };
};

const stopNativeAudioCapture = () => {
  if (NATIVE_AUDIO_ADDON && activeShareTarget) {
    try {
      NATIVE_AUDIO_ADDON.stopCapture();
    } catch (error) {
      console.error("[process-audio] falha ao parar a captura nativa:", error);
    }
  }
  activeShareTarget = null;
};

let mainWindow = null;
let splashWindow = null;
let tray = null;
let isQuitting = false;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Auto-start with OS
const setAutoLaunch = (enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath("exe"),
    args: ["--hidden"],
  });
};

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile("splash.html");
}

function createMainWindow() {
  const windowOptions = {
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: "#1E1F22",
    show: false,
    icon: ICON_PATH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      partition: "persist:partiuchat",
    },
  };

  if (IS_WINDOWS) {
    // Windows: native titlebar overlay (minimize/maximize/close built-in)
    windowOptions.frame = false;
    windowOptions.titleBarStyle = "hidden";
    windowOptions.titleBarOverlay = {
      color: "#1E1F22",
      symbolColor: "#B5BAC1",
      height: 32,
    };
  } else if (IS_LINUX) {
    // Linux: normal frame with system window decorations
    windowOptions.frame = true;
    windowOptions.autoHideMenuBar = true;
  } else {
    // macOS: hidden titlebar with traffic lights
    windowOptions.frame = false;
    windowOptions.titleBarStyle = "hiddenInset";
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Ensure cookies and storage persist between sessions
  const ses = session.fromPartition("persist:partiuchat");
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ["media", "mediaKeySystem", "notifications", "clipboard-read"];
    callback(allowedPermissions.includes(permission));
  });

  // Make session cookies persistent so login survives app restarts
  // Session cookies (no expirationDate) are normally discarded on quit
  ses.cookies.on("changed", (event, cookie, cause, removed) => {
    if (removed || cookie.expirationDate) return; // skip removed or already persistent
    if (cause === "overwrite") return; // avoid infinite loop
    const thirtyDays = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    ses.cookies.set({
      url: `https://${cookie.domain.replace(/^\./, "")}${cookie.path}`,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite || "unspecified",
      expirationDate: thirtyDays,
    }).catch(() => {});
  });

  // Enable screen sharing — show picker so user can choose which screen/window
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 320, height: 180 },
      });

      const nativeAudioAvailable = isNativeAudioAvailable();
      if (!nativeAudioAvailable) {
        stopNativeAudioCapture();
      }

      // Electron rejects the entire request when the page asks for audio and the
      // handler grants none, so any page that asks still gets the whole-device
      // loopback. The desktop bundle stops asking once the native capture is
      // available, and then publishes its own per-program audio track.
      const audioGrant = request.audioRequested && SUPPORTS_LOOPBACK_AUDIO ? "loopback" : null;
      const grantFor = (source) =>
        audioGrant ? { video: source, audio: audioGrant } : { video: source };

      if (sources.length === 0) {
        pendingShareTarget = null;
        callback({});
        return;
      }

      // If only one source (single monitor, no windows), use it directly
      if (sources.length === 1) {
        pendingShareTarget = buildShareTarget(sources[0], nativeAudioAvailable);
        callback(grantFor(sources[0]));
        return;
      }

      // Build picker data with thumbnail data URLs
      const pickerData = sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
      }));

      const selected = await showScreenPicker(pickerData);
      const chosen = selected ? sources.find((s) => s.id === selected) : null;
      if (!chosen) {
        pendingShareTarget = null;
        callback({});
        return;
      }

      pendingShareTarget = buildShareTarget(chosen, nativeAudioAvailable);
      callback(grantFor(chosen));
    } catch {
      pendingShareTarget = null;
      callback({});
    }
  });

  mainWindow.loadURL(APP_URL);

  // Show window when page finishes loading
  mainWindow.webContents.on("did-finish-load", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    // Don't show if started with --hidden
    if (!process.argv.includes("--hidden")) {
      mainWindow.show();
    }

    // Inject draggable titlebar region for frameless windows (Windows/macOS)
    if (!IS_LINUX) {
      mainWindow.webContents.insertCSS(`
        /* Reserve space at top so page content doesn't go behind the titlebar overlay */
        html {
          padding-top: 32px !important;
        }
        /* Draggable titlebar region */
        body::before {
          content: '';
          display: block;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 32px;
          -webkit-app-region: drag;
          z-index: 99999;
          pointer-events: auto;
          background: #1E1F22;
        }
        /* Make interactive elements inside the drag zone clickable */
        button, a, input, select, textarea, [role="button"], [onclick] {
          -webkit-app-region: no-drag;
        }
      `);
    }
  });

  // Handle navigation - open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Minimize to tray instead of closing
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Abrir PartiuChat",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Iniciar com o sistema",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        setAutoLaunch(menuItem.checked);
      },
    },
    { type: "separator" },
    {
      label: "Verificar atualizações",
      click: () => {
        autoUpdater.checkForUpdatesAndNotify();
      },
    },
    { type: "separator" },
    {
      label: "Sair",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip("PartiuChat");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// IPC handlers for window controls (called from preload/renderer)
ipcMain.on("window-minimize", () => mainWindow?.minimize());
ipcMain.on("window-maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on("window-close", () => mainWindow?.close());
ipcMain.handle("window-is-maximized", () => mainWindow?.isMaximized() ?? false);

// Native notification from renderer
ipcMain.on("show-notification", (event, { title, body }) => {
  if (mainWindow && !mainWindow.isFocused()) {
    const notification = new Notification({
      title: title || "PartiuChat",
      body: body || "",
      icon: ICON_PATH,
    });
    notification.on("click", () => {
      mainWindow.show();
      mainWindow.focus();
    });
    notification.show();
  }
});

// Track maximize/unmaximize to update titlebar buttons
function setupMaximizeListeners() {
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window-maximized", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window-maximized", false);
  });
}

// Auto-updater events
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on("update-available", () => {
  if (mainWindow) {
    mainWindow.webContents.send("update-status", "downloading");
  }
});

autoUpdater.on("update-downloaded", () => {
  if (mainWindow) {
    mainWindow.webContents.send("update-status", "ready");
  }
  const notification = new Notification({
    title: "PartiuChat",
    body: "Atualização disponível! Reinicie para atualizar.",
    icon: ICON_PATH,
  });
  notification.on("click", () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });
  notification.show();
});

ipcMain.on("install-update", () => {
  isQuitting = true;
  autoUpdater.quitAndInstall();
});

// Native screen share audio, captured per program instead of for the whole device
ipcMain.handle("process-audio:status", () => ({
  supported: isNativeAudioAvailable(),
  target: activeShareTarget || pendingShareTarget,
}));

ipcMain.handle("process-audio:start", () => {
  if (!NATIVE_AUDIO_ADDON || !isNativeAudioAvailable()) {
    throw new Error("Captura de áudio por programa indisponível nesta plataforma.");
  }

  const target = pendingShareTarget;
  if (!target) {
    throw new Error("Nenhuma transmissão com áudio foi iniciada.");
  }

  if (!activeShareTarget) {
    NATIVE_AUDIO_ADDON.startCapture(
      { processId: target.processId, includeTree: target.includeTree },
      (pcm) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("process-audio:data", pcm);
        }
      },
    );
    activeShareTarget = target;
  }

  return activeShareTarget;
});

ipcMain.handle("process-audio:stop", () => {
  stopNativeAudioCapture();
  return true;
});

// Screen picker window for screen sharing
function showScreenPicker(sources) {
  return new Promise((resolve) => {
    const pickerWin = new BrowserWindow({
      width: 680,
      height: 520,
      resizable: false,
      minimizable: false,
      maximizable: false,
      frame: false,
      modal: true,
      parent: mainWindow,
      backgroundColor: "#1E1F22",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    let resolved = false;

    ipcMain.once("screen-picker-select", (event, sourceId) => {
      resolved = true;
      pickerWin.close();
      resolve(sourceId);
    });

    ipcMain.once("screen-picker-cancel", () => {
      resolved = true;
      pickerWin.close();
      resolve(null);
    });

    pickerWin.on("closed", () => {
      if (!resolved) resolve(null);
      ipcMain.removeAllListeners("screen-picker-select");
      ipcMain.removeAllListeners("screen-picker-cancel");
    });

    const screensHtml = sources.map((s) => {
      const isScreen = s.id.startsWith("screen:");
      const label = s.name.length > 30 ? s.name.slice(0, 30) + "…" : s.name;
      const icon = isScreen ? "🖥️" : "🪟";
      return `
        <button class="source" onclick="selectSource('${s.id}')" title="${s.name.replace(/'/g, "\\'")}">
          <img src="${s.thumbnail}" alt="${label}" />
          <div class="label">${icon} ${label}</div>
        </button>
      `;
    }).join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1E1F22;
    color: #DBDEE1;
    overflow: hidden;
    user-select: none;
    -webkit-app-region: drag;
  }
  .header {
    padding: 16px 20px 8px;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .close-btn {
    -webkit-app-region: no-drag;
    background: none;
    border: none;
    color: #B5BAC1;
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .close-btn:hover { background: #383A40; color: #fff; }
  .subtitle {
    padding: 0 20px 12px;
    font-size: 12px;
    color: #949BA4;
  }
  .grid {
    -webkit-app-region: no-drag;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    padding: 0 20px 20px;
    max-height: 400px;
    overflow-y: auto;
  }
  .grid::-webkit-scrollbar { width: 6px; }
  .grid::-webkit-scrollbar-track { background: transparent; }
  .grid::-webkit-scrollbar-thumb { background: #4E5058; border-radius: 3px; }
  .source {
    background: #2B2D31;
    border: 2px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    padding: 6px;
    transition: all 0.15s;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .source:hover {
    border-color: #5865F2;
    background: #383A40;
  }
  .source img {
    width: 100%;
    border-radius: 4px;
    aspect-ratio: 16/9;
    object-fit: cover;
    background: #111214;
  }
  .label {
    font-size: 11px;
    color: #B5BAC1;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
    padding: 0 2px;
  }
</style>
</head>
<body>
  <div class="header">
    <span>Compartilhar tela</span>
    <button class="close-btn" onclick="cancelPicker()">✕</button>
  </div>
  <div class="subtitle">Escolha uma tela ou janela para compartilhar</div>
  <div class="grid">${screensHtml}</div>
  <script>
    const { ipcRenderer } = require('electron');
    function selectSource(id) {
      ipcRenderer.send('screen-picker-select', id);
    }
    function cancelPicker() {
      ipcRenderer.send('screen-picker-cancel');
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancelPicker();
    });
  </script>
</body>
</html>`;

    pickerWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

// App ready
app.whenReady().then(() => {
  createSplashWindow();
  createMainWindow();
  createTray();
  setupMaximizeListeners();

  // Check for updates after 5 seconds
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 5000);
});

app.on("before-quit", async () => {
  isQuitting = true;
  stopNativeAudioCapture();
  // Flush cookies/session to disk before quitting so login persists
  try {
    const ses = session.fromPartition("persist:partiuchat");
    await ses.cookies.flushStore();
  } catch {}
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});
