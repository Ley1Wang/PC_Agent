const { contextBridge, ipcRenderer } = require("electron");

// A single text-only operation. No file, command, clipboard-read or generic IPC API.
contextBridge.exposeInMainWorld("pcAgentDesktop", Object.freeze({
  copyText: (text) => ipcRenderer.invoke("pc-agent:copy-text", text)
}));
