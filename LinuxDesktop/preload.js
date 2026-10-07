const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Window controls
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),

  // Listen for maximize state changes
  onMaximizedChange: (callback) => {
    ipcRenderer.on("window-maximized", (event, isMaximized) => callback(isMaximized));
  },

  // Native notifications
  showNotification: (title, body) => {
    ipcRenderer.send("show-notification", { title, body });
  },

  // Update events
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (event, status) => callback(status));
  },
  installUpdate: () => ipcRenderer.send("install-update"),

  // Per-program audio capture for screen sharing (desktop build only)
  processAudio: {
    getStatus: () => ipcRenderer.invoke("process-audio:status"),
    start: () => ipcRenderer.invoke("process-audio:start"),
    stop: () => ipcRenderer.invoke("process-audio:stop"),
    onData: (callback) => {
      ipcRenderer.on("process-audio:data", (event, pcm) => callback(pcm));
    },
    removeDataListener: () => {
      ipcRenderer.removeAllListeners("process-audio:data");
    },
  },

  // Platform info
  platform: process.platform,
});
