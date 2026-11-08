const { contextBridge, ipcRenderer } = require("electron");

// The popup gets display state and window controls only, never a general IPC interface.
contextBridge.exposeInMainWorld("pcAgentCompanion", Object.freeze({
  onState: (callback) => { ipcRenderer.on("pc-agent:companion-state", (_event, state) => callback(state)); },
  ready: () => ipcRenderer.send("pc-agent:companion-ready"),
  togglePin: () => ipcRenderer.send("pc-agent:companion-toggle-pin"),
  close: () => ipcRenderer.send("pc-agent:companion-close")
}));
