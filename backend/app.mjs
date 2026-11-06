import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { createStore } from "./store.mjs";
import { createOllama } from "./ollama.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const MAX_TEXT = 16000;
const fail = (status, message) => Object.assign(new Error(message), { status });
const friendly = (error) => error.name === "TimeoutError" ? "等待模型超时，请尝试较短的问题或检查内存。" : error.message === "fetch failed" ? "无法连接 Ollama。请先在电脑上打开 Ollama。" : String(error.message).slice(0, 250);

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 100000) throw fail(413, "请求太大。"); chunks.push(chunk); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw fail(400, "请求必须是有效 JSON。"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "请求格式不正确。");
  return body;
}

export function createApplication({ dataDir = path.join(ROOT, "data"), ollamaUrl, preview = false, desktopToken = null } = {}) {
  if (desktopToken !== null && (typeof desktopToken !== "string" || !/^[a-f0-9]{64}$/.test(desktopToken))) throw new Error("Invalid desktop session token");
  const store = createStore(dataDir); const ollama = createOllama(ollamaUrl);
  let mode = store.setting("mode", "normal");
  if (!["normal", "game"].includes(mode)) mode = "normal";
  let job = null; let resourceOperation = null;
  let releaseState = { state: "not-requested", released: [], remaining: [], message: "尚未检查释放状态。" };

  async function status() {
    const base = { mode, preview, busy: Boolean(job), releasing: Boolean(resourceOperation), release: releaseState, contextTokens: 4096, keepAliveSeconds: 60, preferredModel: "deepseek-r1:8b" };
    try { return { ...base, online: true, ...await ollama.inspect() }; }
    catch (error) { return { ...base, online: false, models: [], running: [], error: friendly(error) }; }
  }

  async function releaseModels() {
    if (resourceOperation) return resourceOperation;
    resourceOperation = (async () => {
      releaseState = { state: "releasing", released: [], remaining: [], message: "正在停止本应用的生成，并请求 Ollama 释放模型。" };
      if (job) { job.controller.abort("release"); await job.finished; }
      const released = []; const errors = [];
      try {
        const { running } = await ollama.inspect();
        for (const model of running) {
          try { await ollama.release(model.name); released.push(model.name); }
          catch (error) { errors.push(`${model.name}：${friendly(error)}`); }
        }
        const remaining = (await ollama.inspect()).running.map((model) => model.name);
        releaseState = { state: remaining.length || errors.length ? "incomplete" : "released", released, remaining, message: remaining.length || errors.length ? `尚未确认全部释放。${errors.join("；")} ${remaining.length ? `仍加载：${remaining.join("、")}` : "请刷新状态后重试。"}` : "Ollama 当前没有已加载模型。模型文件与聊天记录均保留。" };
      } catch (error) { releaseState = { state: "unknown", released, remaining: [], message: `无法确认释放状态：${friendly(error)}` }; }
      return releaseState;
    })();
    try { return await resourceOperation; } finally { resourceOperation = null; }
  }

  async function chat(req, res) {
    const body = await readJson(req);
    if (mode === "game") throw fail(409, "游戏模式已阻止本应用加载模型。请先退出游戏模式。");
    if (resourceOperation || job) throw fail(409, "正在生成或释放模型，请等待结束。");
    const { model, message, conversationId } = body;
    if (typeof model !== "string" || !model.trim() || model.length > 200 || typeof message !== "string" || !message.trim() || message.length > MAX_TEXT || (conversationId != null && typeof conversationId !== "string")) throw fail(400, "请选择模型，并输入 1–16,000 个字符的问题。");
    const saved = conversationId ? store.get(conversationId) : null;
    if (conversationId && !saved) throw fail(404, "对话不存在。");
    if (saved && saved.model !== model) throw fail(409, "请新建对话后再切换模型。");
    let finish; const controller = new AbortController();
    const current = { controller, finished: new Promise((resolve) => { finish = resolve; }) };
    job = current;
    res.on("close", () => { if (!res.writableEnded) controller.abort("client"); });
    let conversation = null; let answer = ""; let result = "complete"; let metadata = {};
    const emit = (event) => { if (!res.destroyed) res.write(JSON.stringify(event) + "\n"); };
    const started = performance.now();
    try {
      // Reserve the single request slot before asynchronous metadata checks.
      const info = await ollama.assertLocalModel(model);
      if (controller.signal.aborted || mode === "game") throw new Error("已停止加载。");
      conversation = saved || store.create(model, message);
      const history = conversation.messages.filter((entry) => entry.content && entry.status !== "failed").slice(-20).map(({ role, content }) => ({ role, content }));
      store.add(conversation.id, "user", message.trim());
      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-content-type-options": "nosniff", "x-conversation-id": conversation.id });
      emit({ type: "conversation", id: conversation.id, title: conversation.title, model });
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]);
      const upstream = await ollama.chat({ model, messages: [{ role: "system", content: `你是通过本机 Ollama 运行的 ${model}，在 PC Agent 的本地文字对话模式中工作。你没有网络、文件、数据库操作、麦克风、系统命令或自动训练工具，不能声称已访问、保存、修改或执行任何内容。用用户的语言简明回答，不确定时说明。可以使用简单 Markdown 和代码块；公式用可读文字或 Unicode，本界面不渲染 LaTeX。` }, ...history, { role: "user", content: message.trim() }], stream: true, keep_alive: "60s", options: { num_ctx: 4096, temperature: 0.5, num_predict: 2048 }, ...(info.thinking?.values?.includes(false) ? { think: false } : {}) }, signal);
      const decoder = new TextDecoder(); let buffer = ""; let complete = null; let phase = "";
      const collect = (line) => {
        if (!line.trim()) return;
        let event;
        try { event = JSON.parse(line); } catch { throw new Error("模型返回了无法解析的数据，已保留收到的部分回答。"); }
        if (!event || typeof event !== "object" || event.error) throw new Error("模型生成中断，请检查模型与可用内存。部分回答已保留。");
        if (event.message?.thinking && phase !== "thinking") { phase = "thinking"; emit({ type: "phase", phase }); }
        if (typeof event.message?.content === "string" && event.message.content) {
          if (answer.length + event.message.content.length > 150000) throw new Error("回答达到本地长度上限，部分内容已保留。");
          answer += event.message.content; emit({ type: "delta", content: event.message.content });
        }
        if (event.done) complete = event;
      };
      for await (const chunk of upstream.body) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 1000000) throw new Error("模型数据超过本地限制。");
        const lines = buffer.split("\n"); buffer = lines.pop() || ""; lines.forEach(collect);
      }
      collect(buffer + decoder.decode());
      if (!complete) throw new Error("连接在回答结束前断开，已保留收到的内容。");
      if (!answer.trim()) throw new Error("模型没有返回回答。此版尚未开放 Agent 工具，请尝试普通文字问题。");
      if (complete.done_reason === "length") result = "limited";
      if (Number.isFinite(complete.eval_count) && complete.eval_count >= 0) metadata.outputTokens = complete.eval_count;
      if (complete.eval_duration > 0 && metadata.outputTokens != null) metadata.tokensPerSecond = Math.round(metadata.outputTokens / (complete.eval_duration / 1e9) * 10) / 10;
    } catch (error) {
      result = controller.signal.aborted ? "stopped" : "failed";
      controller.abort("error");
      if (result === "failed") metadata.error = friendly(error);
      if (!res.headersSent && !res.destroyed) send(res, result === "stopped" ? 409 : 502, { error: metadata.error || "已停止模型请求。" });
    } finally {
      metadata.elapsedMs = Math.round(performance.now() - started);
      if (conversation) {
        store.add(conversation.id, "assistant", answer, result, metadata);
        emit({ type: "done", status: result, metadata });
      }
      if (!res.destroyed && !res.writableEnded) res.end();
      if (job === current) job = null;
      finish();
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const address = server.address(); const host = req.headers.host || "";
      const origin = new URL(`http://${host}`);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || Number(origin.port || 80) !== address.port || !req.url.startsWith("/") || req.url.startsWith("//")) throw fail(403, "仅允许本机访问。");
      if (req.headers["sec-fetch-site"] === "cross-site") throw fail(403, "不允许其他网站访问本地服务。");
      if (req.headers.origin && req.headers.origin !== origin.origin) throw fail(403, "不允许跨来源访问。");
      if (desktopToken) {
        const cookie = (req.headers.cookie || "").split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith("pc_agent_session="))?.slice("pc_agent_session=".length) || "";
        if (!/^[a-f0-9]{64}$/.test(cookie) || !timingSafeEqual(Buffer.from(cookie), Buffer.from(desktopToken))) throw fail(403, "请从 PC Agent 桌面窗口访问。");
      }
      const url = new URL(req.url, origin);
      if (["POST", "PATCH"].includes(req.method) && !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw fail(415, "请使用 application/json。");
      if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, await status());
      if (req.method === "GET" && url.pathname === "/api/conversations") return send(res, 200, { conversations: store.list((url.searchParams.get("q") || "").slice(0, 200)) });
      const match = url.pathname.match(/^\/api\/conversations\/([a-zA-Z0-9-]+)$/);
      if (match && req.method === "GET") {
        const conversation = store.get(match[1]);
        return send(res, conversation ? 200 : 404, conversation ? { ...conversation, generating: Boolean(job) } : { error: "对话不存在。" });
      }
      if (match && req.method === "DELETE") {
        if (job) throw fail(409, "请先停止生成。");
        const removed = store.remove(match[1]); return send(res, removed ? 200 : 404, { ok: removed });
      }
      if (req.method === "POST" && url.pathname === "/api/mode") {
        const body = await readJson(req);
        if (!["normal", "game"].includes(body.mode) || (body.mode === "game" && body.confirm !== true)) throw fail(400, "请选择模式并确认释放 Ollama 已加载模型。");
        if (body.mode === "normal" && resourceOperation) throw fail(409, "请等待释放操作完成。");
        mode = body.mode; store.setSetting("mode", mode);
        if (mode === "game") await releaseModels();
        return send(res, 200, await status());
      }
      if (req.method === "POST" && url.pathname === "/api/release") {
        const body = await readJson(req); if (body.confirm !== true) throw fail(400, "请先确认释放操作。");
        await releaseModels(); return send(res, 200, await status());
      }
      if (req.method === "POST" && url.pathname === "/api/stop") {
        await readJson(req); if (job) { job.controller.abort("client"); await job.finished; } return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/chat") return await chat(req, res);
      if (url.pathname.startsWith("/api/")) throw fail(404, "接口不存在。");
      if (req.method !== "GET") throw fail(405, "不支持此请求方法。");
      const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).slice(1);
      const target = path.resolve(WEB, relative);
      if (!target.startsWith(WEB + path.sep)) throw fail(403, "无权读取此路径。");
      let bytes; try { bytes = await readFile(target); } catch { throw fail(404, "页面不存在。"); }
      res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "permissions-policy": "microphone=(), camera=()", "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
      res.end(bytes);
    } catch (error) { if (!res.headersSent && !res.destroyed) send(res, error.status || 400, { error: friendly(error) }); else if (!res.destroyed) res.end(); }
  });
  let closing = null;
  return {
    server,
    close() {
      return closing ||= (async () => {
        if (job) { job.controller.abort("shutdown"); await job.finished; }
        if (resourceOperation) await resourceOperation;
        server.closeAllConnections();
        if (server.listening) await new Promise((resolve) => server.close(resolve));
        store.close();
      })();
    },
  };
}
