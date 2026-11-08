import { app, BrowserWindow, Menu, dialog, session, shell, clipboard, ipcMain } from "electron";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../backend/app.mjs";
import { createOllamaService } from "./ollama-service.mjs";
import { createCompanionWindow } from "./companion-window.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const qa = process.env.PC_AGENT_QA === "1" && process.argv.includes("--qa");
app.setName("PC Agent");
// A simple 2D UI does not need to compete with games for hardware acceleration.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-networking");
if (qa && process.env.PC_AGENT_QA_DATA_DIR) {
  const directory = path.resolve(process.env.PC_AGENT_QA_DATA_DIR);
  await mkdir(directory, { recursive: true });
  app.setPath("userData", directory);
} else {
  app.setPath("userData", path.join(app.getPath("appData"), "PC-Agent"));
}
const locked = app.requestSingleInstanceLock();
let window = null;
let service = null;
let engine = null;
let closing = false;
const dataDir = path.join(app.getPath("userData"), "data");
const icon = path.join(app.isPackaged ? path.join(process.resourcesPath, "icons") : path.join(root, ".local", "build-icons"), "icon.png");

if (!locked) app.quit();
else {
  app.on("second-instance", () => {
    if (window) { if (window.isMinimized()) window.restore(); if (!qa) window.show(); window.focus(); }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (closing || !service) return;
    event.preventDefault(); closing = true;
    engine?.dispose();
    service.close().then(() => app.quit()).catch(() => app.exit(1));
  });
  app.whenReady().then(async () => {
  try {
    const token = randomBytes(32).toString("hex");
    engine = createOllamaService(qa ? { endpoint: process.env.PC_AGENT_QA_OLLAMA, findExecutable: async () => null, startupMilliseconds: 300 } : {});
    service = createApplication({ dataDir, desktopToken: token, engine, ...(qa ? { ollamaUrl: process.env.PC_AGENT_QA_OLLAMA, preview: true } : {}) });
    await new Promise((resolve, reject) => {
      service.server.once("error", reject);
      // Stable local origin preserves per-app drafts/model choice across launches.
      service.server.listen(qa ? 0 : 8792, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${service.server.address().port}`;
    const browserSession = session.fromPartition("persist:pc-agent");
    const companion = createCompanionWindow({ origin, browserSession, root, icon, qa, getMainWindow: () => closing ? null : window });
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(origin + "/") || details.url.startsWith(`blob:${origin}/`) || details.url.startsWith("devtools:");
      callback({ cancel: !allowed || companion.restrictRequest(details) });
    });
    await browserSession.cookies.set({ url: origin, name: "pc_agent_session", value: token, httpOnly: true, sameSite: "strict", path: "/" });
    window = new BrowserWindow({
      title: "PC Agent", width: 1380, height: 920, minWidth: 760, minHeight: 600,
      backgroundColor: "#f5f5f2", icon, show: false,
      webPreferences: { session: browserSession, preload: path.join(root, "desktop", "preload.cjs"), offscreen: qa, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: !app.isPackaged || qa }
    });
    ipcMain.handle("pc-agent:copy-text", (event, text) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith(origin + "/") || typeof text !== "string" || text.length > 200000) throw new Error("Invalid copy request");
      if (qa) globalThis.__pcAgentQALastCopy = text; // Tests must not touch the owner's real clipboard.
      else clipboard.writeText(text);
      return true;
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(origin + "/")) event.preventDefault(); });
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    window.once("closed", () => { window = null; companion.close(); });
    window.webContents.on("will-prevent-unload", (event) => {
      if (closing || qa) { event.preventDefault(); return; }
      const response = dialog.showMessageBoxSync(window, { type: "question", title: "退出 PC Agent", message: "正在生成回答，是否停止并退出？", detail: "已收到的部分回答会保留在本地。模型不会因为退出而被删除。", buttons: ["继续使用", "停止并退出"], defaultId: 0, cancelId: 0 });
      if (response === 1) event.preventDefault();
    });
    browserSession.on("will-download", (event, item, contents) => {
      const name = item.getFilename();
      if (contents !== window?.webContents || !item.getURL().startsWith(`blob:${origin}/`) || !/^pc-agent-[a-f0-9-]+\.md$/i.test(name)) { event.preventDefault(); return; }
      if (qa && process.env.PC_AGENT_QA_EXPORT_DIR) item.setSavePath(path.join(path.resolve(process.env.PC_AGENT_QA_EXPORT_DIR), name));
      else item.setSaveDialogOptions({ title: "导出本地对话", defaultPath: path.join(app.getPath("downloads"), name), filters: [{ name: "Markdown 文本", extensions: ["md"] }] });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "文件", submenu: [
        { label: "打开数据目录", click: async () => { await mkdir(dataDir, { recursive: true }); await shell.openPath(dataDir); } },
        { type: "separator" }, { label: "退出", accelerator: "Alt+F4", click: () => app.quit() }
      ] },
      { label: "编辑", submenu: [{ role: "undo", label: "撤销" }, { role: "redo", label: "重做" }, { type: "separator" }, { role: "cut", label: "剪切" }, { role: "copy", label: "复制" }, { role: "paste", label: "粘贴" }, { role: "selectAll", label: "全选" }] },
      { label: "视图", submenu: [
        { label: "打开人物弹窗", click: () => companion.open().catch(() => dialog.showErrorBox("人物弹窗", "弹窗没有打开，请重试。")) },
        { type: "separator" }, { role: "resetZoom", label: "实际大小" }, { role: "zoomIn", label: "放大" }, { role: "zoomOut", label: "缩小" }, { role: "togglefullscreen", label: "全屏" }
      ] },
      { label: "帮助", submenu: [{ label: "关于 PC Agent", click: () => dialog.showMessageBox(window, { type: "info", title: "PC Agent", message: `PC Agent ${app.getVersion()}`, detail: "自动检测并后台启动已安装的 Ollama，不下载或预加载模型。\n人物弹窗可以在「视图」菜单打开。尚未接入语音和任务工具。\n退出不强制关闭共享 Ollama 服务，模型按驻留策略或游戏模式释放。" }) }] }
    ]));
    window.once("ready-to-show", () => { if (!qa) window.show(); });
    void engine.start();
    await window.loadURL(origin + "/");
    if (qa && process.env.PC_AGENT_QA_SMOKE === "1") {
      // Also exercise the single-file portable EXE after it self-extracts.
      await window.webContents.executeJavaScript("fetch('/api/status').then(response => response.json())");
      await engine.start();
      await writeFile(path.join(app.getPath("userData"), "smoke-report.json"), JSON.stringify({ packaged: app.isPackaged, version: app.getVersion(), node: process.versions.node, electron: process.versions.electron, dataDir, loaded: window.webContents.getURL().startsWith(origin + "/"), isolated: window.webContents.getLastWebPreferences().contextIsolation, sandboxed: window.webContents.getLastWebPreferences().sandbox }, null, 2));
      app.quit();
    }
  } catch (error) {
    const message = error.code === "EADDRINUSE" ? "本地端口 8792 已被占用，请先关闭其他 PC Agent 实例后重试。" : String(error.message);
    if (qa) console.error(message); else dialog.showErrorBox("PC Agent 启动失败", message);
    if (service) await service.close();
    app.exit(1);
  }
  });
}
