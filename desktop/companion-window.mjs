import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { companionStates } from "../frontend/companion-view.js";

const width = 218, height = 252;

export function createCompanionWindow({ origin, browserSession, root, icon, qa, getMainWindow }) {
  const mainUrl = origin + "/";
  const popupUrl = origin + "/companion-popup.html";
  const popupResources = new Set([popupUrl, ...[
    "/companion-popup.css", "/companion-popup.js", "/companion-portrait.css", "/companion-view.js",
    ...["delighted", "determined", "sleepy"].map((pose) => `/assets/whale/${pose}-cutout.png`)
  ].map((route) => origin + route)]);
  let popup = null, popupContentsId = null, opening = null, position = null;
  let phase = "idle", pinRequested = true;
  const pinned = () => pinRequested && phase !== "game";

  function publish() {
    if (!popup || popup.isDestroyed()) return;
    const onTop = pinned();
    if (popup.isAlwaysOnTop() !== onTop) popup.setAlwaysOnTop(onTop);
    popup.webContents.send("pc-agent:companion-state", { phase, pinned: onTop });
  }

  async function open() {
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return false;
    if (popup && !popup.isDestroyed()) {
      if (opening) { await opening; return Boolean(popup && !popup.isDestroyed()); }
      if (!qa) { popup.showInactive(); popup.moveTop(); }
      return true;
    }
    const area = screen.getDisplayMatching(position ? { ...position, width, height } : main.getBounds()).workArea;
    const x = Math.max(area.x, Math.min(position?.x ?? area.x + area.width - width - 24, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(position?.y ?? area.y + area.height - height - 24, area.y + area.height - height));
    const target = new BrowserWindow({
      title: "鲸鱼娘 · PC Agent", x, y, width, height, icon, show: false,
      frame: false, transparent: true, backgroundColor: "#00000000",
      resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: pinned(), autoHideMenuBar: true,
      webPreferences: {
        session: browserSession, preload: path.join(root, "desktop", "companion-preload.cjs"),
        offscreen: qa, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: qa
      }
    });
    popup = target;
    popupContentsId = target.webContents.id;
    target.removeMenu();
    target.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    target.webContents.on("will-navigate", (event) => event.preventDefault());
    target.webContents.on("will-attach-webview", (event) => event.preventDefault());
    target.on("moved", () => { const { x, y } = target.getBounds(); position = { x, y }; });
    target.once("closed", () => { if (popup === target) { popup = null; popupContentsId = null; } });

    const loading = target.loadURL(popupUrl);
    opening = loading;
    try {
      await loading;
      if (target.isDestroyed()) return false;
      if (!qa) target.showInactive();
      return true;
    } catch (error) {
      if (target.isDestroyed()) return false;
      target.destroy();
      throw error;
    } finally { if (opening === loading) opening = null; }
  }

  function senderMatches(event, target, url) {
    return target && !target.isDestroyed() && event.sender === target.webContents &&
      event.senderFrame === target.webContents.mainFrame && event.senderFrame.url === url;
  }
  ipcMain.handle("pc-agent:companion-open", (event) => {
    if (!senderMatches(event, getMainWindow(), mainUrl)) throw new Error("Invalid companion request");
    return open();
  });
  ipcMain.on("pc-agent:companion-phase", (event, next) => {
    if (!senderMatches(event, getMainWindow(), mainUrl) || typeof next !== "string" || !Object.hasOwn(companionStates, next) || phase === next) return;
    phase = next;
    publish();
  });
  ipcMain.on("pc-agent:companion-ready", (event) => { if (senderMatches(event, popup, popupUrl)) publish(); });
  ipcMain.on("pc-agent:companion-toggle-pin", (event) => {
    if (!senderMatches(event, popup, popupUrl) || phase === "game") return;
    pinRequested = !pinRequested;
    publish();
  });
  ipcMain.on("pc-agent:companion-close", (event) => { if (senderMatches(event, popup, popupUrl)) popup.close(); });

  return {
    open,
    close: () => { if (popup && !popup.isDestroyed()) popup.destroy(); },
    restrictRequest: (details) => popupContentsId !== null && details.webContentsId === popupContentsId && !popupResources.has(details.url)
  };
}
