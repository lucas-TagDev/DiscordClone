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

  // Platform info
  platform: process.platform,
});
