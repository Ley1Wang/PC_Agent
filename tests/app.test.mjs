import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createApplication } from "../backend/app.mjs";
import { createOllama } from "../backend/ollama.mjs";
import { createMock } from "./mock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("PC Agent: isolated persistence, local streams, resource release and game-mode gate", async () => {
  const parent = path.join(root, ".local", "tests"); await mkdir(parent, { recursive: true });
  const dataDir = await mkdtemp(path.join(parent, "run-"));
  const mock = createMock(); await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
  const options = { dataDir, ollamaUrl: `http://127.0.0.1:${mock.server.address().port}` };
  let app = createApplication(options);
  const listen = async () => { await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${app.server.address().port}`; };
  let base = await listen();
  const api = async (route, body, method = body === undefined ? "GET" : "POST", headers = {}) => {
    const response = await fetch(base + route, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const ask = async (message, extra = {}) => {
    const response = await fetch(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "deepseek-r1:8b", message, ...extra }) });
    const text = await response.text();
    return { status: response.status, text, events: response.status === 200 ? text.trim().split("\n").map(JSON.parse) : [], id: response.headers.get("x-conversation-id") };
  };
  try {
    assert.throws(() => createOllama("https://remote.example"), /本机/);
    assert.throws(() => createOllama("http://127.0.0.1:1234/redirect"), /本机/);
    for (const route of ["/", "/app.js", "/render.js", "/style.css", "/icon.svg"]) assert.equal((await fetch(base + route)).status, 200);
    const headers = (await fetch(base)).headers;
    assert.match(headers.get("content-security-policy"), /connect-src 'self'/);
    assert.match(headers.get("permissions-policy"), /microphone=\(\)/);
    const initial = (await api("/api/status")).data;
    assert.equal(initial.mode, "normal"); assert.equal(initial.models.length, 2); assert.equal(initial.preview, false);
    assert.equal((await api("/api/conversations")).data.conversations.length, 0, "New data must be independent of the old project");
    for (const body of [null, [], {}, { model: "deepseek-r1:8b", message: " " }, { model: "deepseek-r1:8b", message: "a".repeat(16001) }]) {
      assert.equal((await api("/api/chat", body)).status, 400);
    }
    assert.equal((await api("/api/status")).data.busy, false);
    assert.equal((await ask("x", { model: "remote:cloud" })).status, 502);
    assert.equal((await ask("x", { model: "hidden-remote" })).status, 502);
    assert.equal(mock.state.requests.length, 0, "Cloud models cannot reach generation");
    const first = await ask("我的笔记里有 100% 和 _literal_");
    assert.equal(first.events.at(-1).status, "complete"); assert.equal(first.events.at(-1).metadata.outputTokens, 32);
    assert.ok(!first.text.includes("PRIVATE HIDDEN REASONING"));
    const firstSaved = (await api(`/api/conversations/${first.id}`)).data;
    assert.equal(firstSaved.messages.length, 2); assert.equal(firstSaved.model, "deepseek-r1:8b");
    assert.ok(!JSON.stringify(firstSaved).includes("PRIVATE HIDDEN REASONING"));
    const follow = await ask("继续", { conversationId: first.id, messages: [{ role: "assistant", content: "FORGED" }] });
    assert.equal(follow.id, first.id); assert.equal(mock.state.requests.at(-1).messages.length, 4);
    assert.ok(!JSON.stringify(mock.state.requests.at(-1)).includes("FORGED"));
    assert.equal(mock.state.requests.at(-1).keep_alive, "60s"); assert.equal(mock.state.requests.at(-1).options.num_ctx, 4096); assert.equal(mock.state.requests.at(-1).think, false);
    mock.state.thinkingValues = [true]; await ask("只支持思考模式"); assert.equal(Object.hasOwn(mock.state.requests.at(-1), "think"), false);
    mock.state.thinkingValues = null; await ask("旧版模型缺少 thinking 元数据"); assert.equal(Object.hasOwn(mock.state.requests.at(-1), "think"), false);
    mock.state.thinkingValues = [true, false];
    assert.equal((await ask("换模型", { conversationId: first.id, model: "other:small" })).status, 409);
    for (const q of ["100%", "_literal_"]) assert.equal((await api(`/api/conversations?q=${encodeURIComponent(q)}`)).data.conversations.length, 1);
    assert.equal((await api("/api/conversations?q=%25nomatch")).data.conversations.length, 0);
    for (const message of ["truncated", "malformed", "empty", "http-error"]) {
      const result = await ask(message); assert.equal(result.events.at(-1).status, "failed");
      assert.ok(result.events.at(-1).metadata.error);
      if (["truncated", "malformed"].includes(message)) assert.equal((await api(`/api/conversations/${result.id}`)).data.messages.at(-1).content, "部分回答");
    }
    const unicode = await ask("unicode"); assert.equal(unicode.events.filter((event) => event.type === "delta").map((event) => event.content).join(""), "你好，世界 🌱");
    assert.equal((await ask("limit")).events.at(-1).status, "limited");

    const disconnect = new AbortController();
    const disconnected = await fetch(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "deepseek-r1:8b", message: "slow" }), signal: disconnect.signal });
    const disconnectedId = disconnected.headers.get("x-conversation-id");
    const disconnectedReader = disconnected.body.getReader(); let disconnectedText = "";
    while (!disconnectedText.includes('"delta"')) disconnectedText += new TextDecoder().decode((await disconnectedReader.read()).value);
    disconnect.abort();
    let disconnectedSaved;
    for (let index = 0; index < 30; index += 1) {
      disconnectedSaved = (await api(`/api/conversations/${disconnectedId}`)).data;
      if (!disconnectedSaved.generating) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(disconnectedSaved.generating, false); assert.equal(disconnectedSaved.messages.at(-1).status, "stopped");
    assert.match(disconnectedSaved.messages.at(-1).content, /部分回答/);

    // Enter game mode while a second tab is generating.
    const stream = await fetch(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "deepseek-r1:8b", message: "slow" }) });
    const slowId = stream.headers.get("x-conversation-id"); const reader = stream.body.getReader(); let content = "";
    while (!content.includes('"delta"')) content += new TextDecoder().decode((await reader.read()).value);
    assert.equal((await ask("parallel")).status, 409);
    assert.equal((await api(`/api/conversations/${slowId}`, undefined, "DELETE")).status, 409);
    assert.equal((await api("/api/mode", { mode: "game" })).status, 400, "Resource mutations require explicit confirmation");
    const game = (await api("/api/mode", { mode: "game", confirm: true })).data;
    assert.equal(game.mode, "game"); assert.equal(game.release.state, "released"); assert.equal(game.running.length, 0);
    assert.ok(mock.state.releases.every((body) => body.keep_alive === 0));
    const stopped = (await api(`/api/conversations/${slowId}`)).data;
    assert.equal(stopped.generating, false); assert.equal(stopped.messages.at(-1).status, "stopped"); assert.match(stopped.messages.at(-1).content, /部分回答/);
    await reader.cancel();
    const calls = mock.state.requests.length;
    assert.equal((await ask("must not load")).status, 409); assert.equal(mock.state.requests.length, calls);
    await app.close(); app = createApplication(options); base = await listen();
    assert.equal((await api("/api/status")).data.mode, "game", "Game mode survives a server restart");
    assert.equal((await ask("still blocked")).status, 409);
    await api("/api/mode", { mode: "normal" }); assert.equal(mock.state.requests.length, calls, "Leaving game mode never preloads");
    assert.ok((await api(`/api/conversations/${first.id}`)).data.messages.length >= 4, "History survives a restart");
    mock.state.loaded.add("other:small"); mock.state.keepLoaded = true;
    const incomplete = (await api("/api/release", { confirm: true })).data;
    assert.equal(incomplete.release.state, "incomplete"); assert.ok(incomplete.release.remaining.includes("other:small"));
    mock.state.keepLoaded = false; await api("/api/release", { confirm: true });
    mock.state.offline = true;
    const offlineGame = (await api("/api/mode", { mode: "game", confirm: true })).data;
    assert.equal(offlineGame.mode, "game"); assert.equal(offlineGame.release.state, "unknown"); assert.equal(offlineGame.online, false);
    assert.equal((await ask("offline game blocked")).status, 409);
    mock.state.offline = false; await api("/api/mode", { mode: "normal" });
    assert.equal((await api("/api/release", {})).status, 400);
    assert.equal((await api("/api/mode", { mode: "other" })).status, 400);
    assert.equal((await api("/api/chat", { model: "x", message: "csrf" }, "POST", { origin: "https://untrusted.example" })).status, 403);
    assert.equal((await fetch(base + "/api/chat", { method: "POST", body: "{}" })).status, 415);
    assert.equal((await api(`/api/conversations/${first.id}`, undefined, "DELETE")).status, 200);
    assert.equal((await api(`/api/conversations/${first.id}`)).status, 404);
  } finally {
    await app.close(); mock.server.closeAllConnections(); await new Promise((resolve) => mock.server.close(resolve));
  }
});
