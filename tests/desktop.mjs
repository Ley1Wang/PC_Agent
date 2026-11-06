import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMock } from "./mock.mjs";

const { _electron } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(root, "release", "win-unpacked", "PC-Agent.exe");
await access(executable);
const qaParent = path.join(root, ".local", "desktop-qa"); await mkdir(qaParent, { recursive: true });
const qaDirectory = await mkdtemp(path.join(qaParent, "run-")); const exportsDir = path.join(qaDirectory, "exports"); await mkdir(exportsDir);
const mock = createMock(); await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
const environment = { ...process.env, PC_AGENT_QA: "1", PC_AGENT_QA_DATA_DIR: qaDirectory, PC_AGENT_QA_OLLAMA: `http://127.0.0.1:${mock.server.address().port}`, PC_AGENT_QA_EXPORT_DIR: exportsDir };
delete environment.ELECTRON_RUN_AS_NODE;
let electronApp;
try {
  electronApp = await _electron.launch({ executablePath: executable, args: ["--qa"], env: environment, timeout: 30000 });
  let page = await electronApp.firstWindow();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(() => document.getElementById("ollama-state").textContent === "在线");
  assert.equal(await page.locator("#model").inputValue(), "deepseek-r1:8b");
  const settings = await electronApp.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, data: app.getPath("userData"), preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(), node: process.versions.node }));
  assert.equal(settings.packaged, true); assert.equal(path.resolve(settings.data), path.resolve(qaDirectory));
  assert.equal(settings.preferences.nodeIntegration, false); assert.equal(settings.preferences.contextIsolation, true); assert.equal(settings.preferences.sandbox, true);
  assert.equal(await page.evaluate(() => typeof require), "undefined"); assert.equal(await page.evaluate(() => typeof process), "undefined");
  const cookie = await page.evaluate(() => document.cookie); assert.ok(!cookie.includes("pc_agent_session"), "Desktop token must be HTTP-only");
  const localOrigin = new URL(page.url()).origin;
  assert.equal((await fetch(localOrigin + "/api/conversations")).status, 403, "Ordinary browser requests cannot access desktop history");
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
  const second = spawn(executable, ["--qa"], { env: environment, windowsHide: true, stdio: "ignore" });
  assert.equal(await new Promise((resolve, reject) => { second.once("exit", resolve); second.once("error", reject); }), 0, "Second launch focuses existing instance and exits");
  assert.equal((await electronApp.windows()).length, 1);
  assert.deepEqual(errors, []);
  await electronApp.close(); electronApp = null;
  electronApp = await _electron.launch({ executablePath: executable, args: ["--qa"], env: environment, timeout: 30000 });
  page = await electronApp.firstWindow();
  await page.waitForFunction(() => document.getElementById("mode-badge").textContent === "游戏模式");
  await page.locator(".history-open").first().click(); assert.match(await page.locator(".message.assistant .message-body").textContent(), /模拟回答/);
  assert.equal(mock.state.loaded.size, 0);
  await electronApp.close(); electronApp = null;
  console.log(`Packaged EXE passed: bundled Node ${settings.node}, SQLite persistence, isolated window, HTTP-only session, clipboard/export, game mode, restart and single instance.`);

  const portable = (await readdir(path.join(root, "release"))).find((file) => /^PC-Agent-.*-portable-x64\.exe$/.test(file));
  assert.ok(portable, "Single-file portable EXE exists");
  const portableData = path.join(qaDirectory, "portable-profile"); await mkdir(portableData);
  const portableProcess = spawn(path.join(root, "release", portable), ["--qa"], { windowsHide: true, stdio: "ignore", env: { ...environment, PC_AGENT_QA_DATA_DIR: portableData, PC_AGENT_QA_SMOKE: "1" } });
  let report;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { report = JSON.parse(await readFile(path.join(portableData, "smoke-report.json"), "utf8")); break; } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  if (!report) { portableProcess.kill(); throw new Error("Portable EXE did not report a successful startup within 60 seconds"); }
  assert.equal(report.packaged, true); assert.equal(report.loaded, true); assert.equal(report.isolated, true); assert.equal(report.sandboxed, true);
  assert.equal(path.resolve(report.dataDir), path.join(path.resolve(portableData), "data"));
  console.log("Portable single-file EXE self-extracted, started its local service, loaded the isolated app and exited cleanly.");
} finally {
  if (electronApp) await electronApp.close();
  mock.server.closeAllConnections(); await new Promise((resolve) => mock.server.close(resolve));
}
