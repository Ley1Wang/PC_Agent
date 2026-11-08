import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMock } from "./mock.mjs";

const { _electron } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const fromSource = process.argv.includes("--source");
const executable = fromSource ? path.join(root, "node_modules", "electron", "dist", "electron.exe") : path.join(root, "release", "win-unpacked", "PC-Agent.exe");
const args = fromSource ? [root, "--qa"] : ["--qa"];
await access(executable);
const qaParent = path.join(root, ".local", "desktop-qa"); await mkdir(qaParent, { recursive: true });
const qaDirectory = await mkdtemp(path.join(qaParent, "run-")); const exportsDir = path.join(qaDirectory, "exports"); await mkdir(exportsDir);
const mock = createMock(); await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
const environment = { ...process.env, PC_AGENT_QA: "1", PC_AGENT_QA_DATA_DIR: qaDirectory, PC_AGENT_QA_OLLAMA: `http://127.0.0.1:${mock.server.address().port}`, PC_AGENT_QA_EXPORT_DIR: exportsDir };
delete environment.ELECTRON_RUN_AS_NODE;
let electronApp;
async function openPopup(page, phase) {
  const opened = electronApp.waitForEvent("window", { timeout: 10000 });
  await page.locator("#open-companion").click();
  const popup = await opened;
  await popup.waitForURL("**/companion-popup.html");
  await popup.locator(`#companion[data-state="${phase}"] img:visible`).evaluate((image) => image.decode());
  return popup;
}
const isPinned = () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith("/companion-popup.html"))?.isAlwaysOnTop());
try {
  electronApp = await _electron.launch({ executablePath: executable, args, env: environment, timeout: 30000 });
  let page = await electronApp.firstWindow();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(() => document.getElementById("ollama-state").textContent === "在线");
  assert.equal(await page.locator("#model").inputValue(), "deepseek-r1:8b");
  assert.equal(await page.locator("#companion img").evaluateAll(async (images) => {
    await Promise.all(images.map((image) => image.decode()));
    return images.length;
  }), 3, "All whale-girl portraits decode from the packaged app");
  const settings = await electronApp.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, version: app.getVersion(), data: app.getPath("userData"), preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(), node: process.versions.node }));
  assert.equal(settings.version, version);
  await page.waitForFunction(() => document.getElementById("engine-message").textContent.includes("没有重复启动"));
  assert.equal(settings.packaged, !fromSource); assert.equal(path.resolve(settings.data), path.resolve(qaDirectory));
  assert.equal(settings.preferences.nodeIntegration, false); assert.equal(settings.preferences.contextIsolation, true); assert.equal(settings.preferences.sandbox, true);
  assert.equal(await page.evaluate(() => typeof require), "undefined"); assert.equal(await page.evaluate(() => typeof process), "undefined");
  const cookie = await page.evaluate(() => document.cookie); assert.ok(!cookie.includes("pc_agent_session"), "Desktop token must be HTTP-only");
  const localOrigin = new URL(page.url()).origin;
  assert.equal((await fetch(localOrigin + "/api/conversations")).status, 403, "Ordinary browser requests cannot access desktop history");
  const popup = await openPopup(page, "idle");
  popup.on("pageerror", (error) => errors.push(error.message));
  await popup.locator('#pin[aria-pressed="true"]').waitFor();
  assert.equal(await isPinned(), true);
  assert.equal(await popup.evaluate(() => typeof process === "undefined" && !window.pcAgentDesktop && Boolean(window.pcAgentCompanion)), true);
  assert.equal(await popup.evaluate(() => fetch("/api/status").then(() => true, () => false)), false, "The popup cannot call application APIs");
  assert.equal(await popup.evaluate(() => new Promise((resolve) => {
    const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = "/icon.svg";
  })), false, "The popup can only load its own static assets");
  assert.equal(await page.evaluate(() => window.pcAgentDesktop.openCompanion()), true);
  assert.equal(electronApp.windows().length, 2, "Opening again reuses the same popup");
  await popup.locator("#pin").click();
  await popup.locator('#pin[aria-pressed="false"]').waitFor();
  assert.equal(await isPinned(), false);
  await popup.locator("#pin").click();
  await popup.locator('#pin[aria-pressed="true"]').waitFor();
  await popup.screenshot({ path: path.join(qaDirectory, "companion-popup.png"), omitBackground: true });
  await page.locator("#prompt").fill("slow"); await page.locator("#send").click();
  await popup.locator('#companion[data-state="writing"]').waitFor();
  await page.locator("#stop").click(); await page.locator("#stop").waitFor({ state: "hidden" });
  await page.locator("#new-chat").click();
  await page.locator("#prompt").fill("桌面版测试"); await page.locator("#send").click(); await page.locator("#stop").waitFor({ state: "hidden" });
  assert.match(await page.locator(".message.assistant .message-body").textContent(), /模拟回答/);
  await page.locator("[data-copy-code]").click();
  assert.equal(await electronApp.evaluate(() => globalThis.__pcAgentQALastCopy?.includes("hello, local agent")), true, "Only the requested mock text reaches the clipboard bridge");
  await page.locator("#export").click();
  for (let attempt = 0; attempt < 30 && !(await readdir(exportsDir)).some((file) => file.endsWith(".md")); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  const exported = (await readdir(exportsDir)).find((file) => file.endsWith(".md")); assert.ok(exported, "Packaged app exports a real Markdown file");
  assert.match(await readFile(path.join(exportsDir, exported), "utf8"), /桌面版测试/);
  try { await page.screenshot({ path: path.join(qaDirectory, "packaged-chat.png") }); } catch { console.log("Offscreen screenshot unavailable; DOM and packaged workflows remain verified."); }
  await page.locator("#game-mode").click(); await page.locator("#confirm-submit").click();
  await page.waitForFunction(() => document.getElementById("mode-badge").textContent === "游戏模式");
  assert.equal(await page.locator("#vram").textContent(), "0.0 GiB");
  await popup.locator('#companion[data-state="game"] .portrait-sleepy').waitFor();
  assert.equal(await isPinned(), false);
  assert.equal(await popup.locator("#pin").isDisabled(), true);
  await page.locator("#game-mode").click();
  await popup.locator('#pin[aria-pressed="true"]').waitFor();
  assert.equal(await isPinned(), true);
  await page.locator("#game-mode").click(); await page.locator("#confirm-submit").click();
  await popup.locator('#companion[data-state="game"]').waitFor();
  const popupClosed = popup.waitForEvent("close");
  await popup.locator("#close").click();
  await popupClosed;
  const second = spawn(executable, args, { env: environment, windowsHide: true, stdio: "ignore" });
  assert.equal(await new Promise((resolve, reject) => { second.once("exit", resolve); second.once("error", reject); }), 0, "Second launch focuses existing instance and exits");
  assert.equal((await electronApp.windows()).length, 1);
  assert.deepEqual(errors, []);
  await electronApp.close(); electronApp = null;
  electronApp = await _electron.launch({ executablePath: executable, args, env: environment, timeout: 30000 });
  page = await electronApp.firstWindow();
  await page.waitForFunction(() => document.getElementById("mode-badge").textContent === "游戏模式");
  await page.locator(".history-open").first().click(); assert.match(await page.locator(".message.assistant .message-body").textContent(), /模拟回答/);
  assert.equal(mock.state.loaded.size, 0);
  mock.state.offline = true;
  await page.locator("#refresh").click(); await page.waitForFunction(() => document.getElementById("ollama-state").textContent === "未连接");
  await page.locator("#engine-start").click();
  await page.waitForFunction(() => document.getElementById("engine-message").textContent.includes("未找到 Ollama"));
  assert.equal(await page.locator("#engine-start").isEnabled(), true);
  assert.equal(await page.locator("#mode-badge").textContent(), "游戏模式");
  mock.state.offline = false;
  await page.locator("#refresh").click(); await page.waitForFunction(() => document.getElementById("ollama-state").textContent === "在线");
  const reopened = await openPopup(page, "game");
  const escaped = reopened.waitForEvent("close");
  await reopened.keyboard.down("Escape");
  await escaped;
  const lingering = await openPopup(page, "game");
  const closedWithMain = lingering.waitForEvent("close");
  const exited = electronApp.waitForEvent("close");
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().endsWith("/companion-popup.html")).close());
  await Promise.all([closedWithMain, exited]); electronApp = null;
  console.log(`Desktop passed: Node ${settings.node}, isolated popup state and pinning, game mode, window cleanup, SQLite, clipboard/export, restart and single instance. Screenshot: ${path.join(qaDirectory, "companion-popup.png")}`);

  if (!fromSource) {
    const portable = path.join(root, "PC-Agent.exe"); await access(portable);
    const portableData = path.join(qaDirectory, "portable-profile"); await mkdir(portableData);
    const portableProcess = spawn(portable, ["--qa"], { windowsHide: true, stdio: "ignore", env: { ...environment, PC_AGENT_QA_DATA_DIR: portableData, PC_AGENT_QA_SMOKE: "1" } });
    let report;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try { report = JSON.parse(await readFile(path.join(portableData, "smoke-report.json"), "utf8")); break; } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
    }
    if (!report) { portableProcess.kill(); throw new Error("Portable EXE did not report a successful startup within 60 seconds"); }
    assert.equal(report.packaged, true); assert.equal(report.loaded, true); assert.equal(report.isolated, true); assert.equal(report.sandboxed, true);
    assert.equal(report.version, version);
    assert.equal(path.resolve(report.dataDir), path.join(path.resolve(portableData), "data"));
    console.log("Portable single-file EXE self-extracted, started its local service, loaded the isolated app and exited cleanly.");
  }
} finally {
  if (electronApp) await electronApp.close();
  mock.server.closeAllConnections(); await new Promise((resolve) => mock.server.close(resolve));
}
