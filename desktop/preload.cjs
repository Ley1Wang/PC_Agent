const { contextBridge, ipcRenderer } = require("electron");

// Narrow clipboard and companion operations only; no file or general IPC access.
contextBridge.exposeInMainWorld("pcAgentDesktop", Object.freeze({
  copyText: (text) => ipcRenderer.invoke("pc-agent:copy-text", text),
  openCompanion: () => ipcRenderer.invoke("pc-agent:companion-open"),
  setCompanionPhase: (phase) => ipcRenderer.send("pc-agent:companion-phase", phase)
}));
