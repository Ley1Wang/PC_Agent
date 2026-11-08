import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../backend/app.mjs";
import { createMock } from "./mock.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const qa = path.join(root, ".local", "qa"); await mkdir(qa, { recursive: true });
const dataDir = await mkdtemp(path.join(qa, "data-"));
const mock = createMock(); await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
const app = createApplication({ dataDir, ollamaUrl: `http://127.0.0.1:${mock.server.address().port}`, preview: true });
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
await context.addInitScript(() => {
  let text = "";
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { text = value; }, readText: async () => text } });
});
const page = await context.newPage(); const errors = [], remote = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => { if (!request.url().startsWith(origin) && !request.url().startsWith("blob:")) remote.push(request.url()); });
const send = async (message) => { await page.locator("#prompt").fill(message); await page.locator("#send").click(); await page.locator("#stop").waitFor({ state: "hidden" }); };
const ready = async () => { await page.waitForFunction(() => document.getElementById("ollama-state").textContent === "在线"); };
const portrait = async (phase, pose) => {
  const active = page.locator(`#companion[data-state="${phase}"] .portrait-${pose}`);
  await active.waitFor({ state: "visible" });
  await active.evaluate((image) => image.decode());
  assert.equal(await page.locator("#companion img:visible").count(), 1);
};
try {
  await page.goto(origin); await ready();
  assert.equal(await page.locator("#model").inputValue(), "deepseek-r1:8b");
  assert.equal(await page.locator("#preview-banner").isVisible(), true);
  assert.equal(await page.locator("#open-companion").isVisible(), false, "The native popup is desktop-only");
  await portrait("idle", "delighted");
  await page.locator(".companion-card").screenshot({ path: path.join(qa, "whale-companion.png") });
  await page.screenshot({ path: path.join(qa, "desktop-idle.png") });
  await send("unsafe");
  assert.equal(await page.locator(".message-body img,.message-body script").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await page.locator("#new-chat").click(); await send("帮我安排今天的学习计划。");
  assert.equal(await page.locator(".message.assistant h3").textContent(), "本地对话已连接");
  assert.match(await page.locator(".message-meta").last().textContent(), /32 输出 tokens.*16 tokens\/s/);
  await page.locator("[data-copy-code]").click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /hello, local agent/);
  const downloadPromise = page.waitForEvent("download"); await page.locator("#export").click();
  const download = await downloadPromise; const exported = path.join(qa, "conversation.md"); await download.saveAs(exported);
  assert.match(await readFile(exported, "utf8"), /deepseek-r1:8b/);
  await page.locator("#search").fill("安排今天"); await page.waitForTimeout(300);
  assert.equal(await page.locator(".history-item").count(), 1);
  await page.locator("#search").fill("this definitely does not match"); await page.waitForTimeout(300);
  assert.equal(await page.locator(".history-item").count(), 0);
  await page.locator("#search").fill(""); await page.waitForTimeout(300);
  await page.locator("#messages").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(qa, "desktop-chat.png") });

  const loadingGate = Promise.withResolvers();
  await page.route("**/api/chat", async (route) => { await loadingGate.promise; await route.continue(); }, { times: 1 });
  try {
    await page.locator("#new-chat").click(); await page.locator("#prompt").fill("slow"); await page.locator("#send").click();
    await portrait("loading", "determined");
  } finally { loadingGate.resolve(); }
  await page.waitForFunction(() => document.querySelector(".message.assistant .message-body")?.textContent.includes("部分回答"));
  await portrait("writing", "delighted");
  await page.locator("#game-mode").click();
  assert.equal(await page.locator("#confirm-dialog").isVisible(), true);
  assert.match(await page.locator("#confirm-description").textContent(), /deepseek-r1:8b/);
  await page.locator("#confirm-submit").click();
  await page.waitForFunction(() => document.getElementById("mode-badge").textContent === "游戏模式");
  await page.locator("#stop").waitFor({ state: "hidden" });
  assert.match(await page.locator(".message-meta").last().textContent(), /已停止/);
  assert.equal(await page.locator("#vram").textContent(), "0.0 GiB");
  await portrait("game", "sleepy");
  await page.locator("#prompt").fill("游戏期间保留的草稿"); assert.equal(await page.locator("#send").isDisabled(), true);
  await page.screenshot({ path: path.join(qa, "desktop-game.png") });
  const second = await context.newPage(); await second.goto(origin);
  await second.waitForFunction(() => document.getElementById("mode-badge").textContent === "游戏模式");
  await second.locator("#prompt").fill("另一个页面也不能加载"); assert.equal(await second.locator("#send").isDisabled(), true); await second.close();
  await page.reload(); await ready();
  assert.equal(await page.locator("#prompt").inputValue(), "另一个页面也不能加载", "Draft storage is app-wide");
  assert.equal(await page.locator("#mode-badge").textContent(), "游戏模式");
  await page.locator(".history-open").first().click(); assert.match(await page.locator(".message-meta").last().textContent(), /已停止/);
  await page.locator("#game-mode").click(); await page.waitForFunction(() => document.getElementById("mode-badge").textContent === "日常模式");
  assert.equal(mock.state.loaded.size, 0, "Exit must not preload");
  await page.locator("#new-chat").click(); await send("unicode"); assert.equal(await page.locator(".message.assistant .message-body").textContent(), "你好，世界 🌱");
  await page.locator("#new-chat").click(); await send("truncated"); assert.match(await page.locator(".message-meta").last().textContent(), /连接在回答结束前断开/);
  await page.locator("#new-chat").click(); await page.locator("#prompt").fill("slow"); await page.locator("#send").click();
  await page.waitForFunction(() => document.querySelector(".message.assistant .message-body")?.textContent.includes("部分回答"));
  await page.locator("#stop").click(); await page.locator("#stop").waitFor({ state: "hidden" }); assert.match(await page.locator(".message-meta").last().textContent(), /已停止/);
  await page.locator("#model").selectOption("other:small"); assert.equal(await page.locator(".message").count(), 0);
  await page.reload(); await ready(); assert.equal(await page.locator("#model").inputValue(), "other:small");
  await page.locator("#prompt").fill("输入法测试"); await page.locator("#prompt").dispatchEvent("keydown", { key: "Enter", isComposing: true }); assert.equal(await page.locator(".message").count(), 0);

  // Missing DeepSeek never automatically selects the larger installed model.
  await page.evaluate(() => localStorage.removeItem("pc-agent-model"));
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch(); const data = await response.json();
    data.models = [{ name: "huge-model:30b", size: 20000000000 }]; await route.fulfill({ json: data });
  });
  await page.reload(); await ready(); assert.equal(await page.locator("#model").inputValue(), ""); assert.equal(await page.locator("#setup-card").isVisible(), true);
  await page.unroute("**/api/status"); await page.locator("#refresh").click(); await page.waitForTimeout(100);
  await page.locator("#prompt").fill("手机尺寸草稿");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(250);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    if (!fits) console.log(await page.evaluate(() => [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).map((element) => ({ tag: element.tagName, id: element.id, class: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })).slice(0, 15)));
    assert.equal(fits, true, `Overflow at ${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250); await page.evaluate(() => scrollTo(0, 0));
  assert.equal(await page.locator("#sidebar").evaluate((element) => element.inert), true);
  await page.screenshot({ path: path.join(qa, "mobile.png") });
  await page.locator("#drawer-toggle").click(); assert.equal(await page.locator("#sidebar").evaluate((element) => element.inert), false);
  await page.keyboard.press("Escape"); assert.equal(await page.locator("#sidebar").evaluate((element) => element.inert), true);
  mock.state.offline = true; await page.locator("#refresh").click(); await page.waitForFunction(() => document.getElementById("ollama-state").textContent === "未连接");
  assert.equal(await page.locator("#prompt").isEnabled(), true); assert.equal(await page.locator("#send").isDisabled(), true);
  assert.match(await page.locator("#input-hint").textContent(), /草稿/);
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  console.log("UI passed: chat/Markdown safety, copy/export/search, partial saves, game mode across pages, no preload, model choice, IME, offline drafts and 320–1440px layouts. No remote browser requests.");
} catch (error) { await page.screenshot({ path: path.join(qa, "failure.png"), fullPage: true }); throw error; }
finally { await browser.close(); await app.close(); mock.server.closeAllConnections(); await new Promise((resolve) => mock.server.close(resolve)); }
