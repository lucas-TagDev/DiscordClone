const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, session, desktopCapturer, systemPreferences } = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");

const APP_URL = "https://partiuchat.lacgamesbr.com";
const ICON_PATH = path.join(__dirname, "assets", "icon.png");
const IS_WINDOWS = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

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

      if (sources.length === 0) {
        callback({});
        return;
      }

      // If only one source (single monitor, no windows), use it directly
      if (sources.length === 1) {
        callback({ video: sources[0], audio: "loopback" });
        return;
      }

      // Build picker data with thumbnail data URLs
      const pickerData = sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
      }));

      const selected = await showScreenPicker(pickerData);
      if (!selected) {
        callback({});
        return;
      }

      const chosen = sources.find((s) => s.id === selected);
      callback(chosen ? { video: chosen, audio: "loopback" } : {});
    } catch {
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
