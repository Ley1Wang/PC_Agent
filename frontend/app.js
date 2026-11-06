import { renderAnswer } from "./render.js";
const $ = (id) => document.getElementById(id);
const state = { status: null, id: null, model: null, title: "新的开始", controller: null, loading: false, resourceBusy: false, history: [], historyVersion: 0, refreshing: false };
const storage = { get(key) { try { return localStorage.getItem(key); } catch { return null; } }, set(key, value) { try { localStorage.setItem(key, value); } catch { /* Private browsing may block drafts. */ } } };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const busy = () => Boolean(state.controller || state.loading || state.resourceBusy);
const bytes = (value) => value == null ? "未知" : `${(value / 1024 ** 3).toFixed(1)} GiB`;

async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`); return data;
}
const post = (url, body) => request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
function notice(message = "", error = false) { $("notice").hidden = !message; $("notice").textContent = message; $("notice").classList.toggle("error", error); }

function companion(phase) {
  let name = "安静待命", note = "形象只做状态联动，不额外加载 AI 模型。";
  if (phase === "game") { name = "游戏模式 · 休息中"; note = "本应用不会加载模型。其他软件的 Ollama 请求不受此开关控制。"; }
  if (phase === "offline") { name = "等待 Ollama"; note = "可以先写草稿、查看旧记录。打开 Ollama 后再发送。"; }
  if (phase === "loading") { name = "正在加载本地模型"; note = "首次回答可能需要等待，可随时停止。"; }
  if (phase === "thinking") { name = "正在思考"; note = "只显示状态，不展示或保存模型的独立思考字段。"; }
  if (phase === "writing") { name = "正在回答"; note = "文字流式返回中，尚未接入语音朗读。"; }
  $("companion").dataset.state = phase; $("companion-state").textContent = name; $("companion-note").textContent = note;
}

function controls() {
  const status = state.status;
  const modelAvailable = status?.online && status.models.some((model) => model.name === $("model").value);
  const blocked = busy() || status?.busy || status?.releasing || status?.mode === "game";
  $("send").disabled = Boolean(blocked || !modelAvailable || !$("prompt").value.trim());
  $("prompt").disabled = Boolean(state.controller || state.loading);
  $("model").disabled = busy() || !status?.models.length;
  $("send").hidden = Boolean(state.controller); $("stop").hidden = !state.controller;
  $("new-chat").disabled = busy(); $("export").disabled = busy() || !state.id;
  // Release/game controls deliberately remain available during this tab's generation.
  $("release").disabled = state.resourceBusy || state.loading || Boolean(status?.releasing);
  $("game-mode").disabled = state.resourceBusy || state.loading || Boolean(status?.releasing);
  document.querySelectorAll(".history-open,.history-delete,.suggestions button").forEach((button) => { button.disabled = busy(); });
  $("input-hint").textContent = status?.mode === "game" ? "游戏模式：草稿可保留，退出后再发送" : !status?.online ? "Ollama 离线，草稿仍会保留" : "Enter 发送 · Shift + Enter 换行";
}

function applyStatus(status) {
  state.status = status;
  $("preview-banner").hidden = !status.preview; document.body.classList.toggle("preview", status.preview);
  $("ollama-state").textContent = status.online ? "在线" : "未连接";
  const knownVram = status.running.every((model) => model.vram != null);
  $("vram").textContent = status.online ? knownVram ? bytes(status.running.reduce((total, model) => total + model.vram, 0)) : "未知" : "—";
  $("running-list").innerHTML = status.online ? status.running.length ? status.running.map((model) => `<div class="running-model"><strong>${escapeHtml(model.name)}</strong><span>模型显存 ${escapeHtml(bytes(model.vram))}</span></div>`).join("") : '<p class="muted">Ollama 当前没有已加载模型。</p>' : `<p class="muted">${escapeHtml(status.error || "请打开 Ollama。")}</p>`;
  const selection = state.model || $("model").value || storage.get("pc-agent-model") || "deepseek-r1:8b";
  const select = $("model"); select.replaceChildren(new Option("请选择本地模型", ""));
  status.models.forEach((model) => select.add(new Option(`${model.name} · 文件 ${bytes(model.size)}`, model.name)));
  if (state.model && !status.models.some((model) => model.name === state.model)) select.add(new Option(`${state.model} · 当前不可用`, state.model));
  select.value = [...select.options].some((option) => option.value === selection) ? selection : "";
  $("setup-card").hidden = status.online && status.models.some((model) => model.name.startsWith("deepseek-r1:"));
  const gaming = status.mode === "game";
  $("mode-badge").textContent = gaming ? "游戏模式" : "日常模式"; $("mode-badge").classList.toggle("game", gaming);
  $("game-mode").textContent = gaming ? "退出游戏模式" : "进入游戏模式"; $("game-mode").classList.toggle("active", gaming);
  $("mode-description").textContent = gaming ? "本应用已禁止加载模型；退出只恢复发送权限，不会预加载。" : "停止本应用生成，释放 Ollama 已加载模型，并阻止本应用再次加载。";
  let resourceMessage = status.release.state === "not-requested" ? "" : status.release.message;
  if (gaming && status.online && status.running.length && !status.releasing) resourceMessage = "游戏模式已开启，但仍有模型加载。可能由其他软件加载，请检查后再次释放。";
  $("resource-message").textContent = resourceMessage; $("resource-message").classList.toggle("error", ["unknown", "incomplete"].includes(status.release.state) || gaming && status.running.length > 0);
  if (!state.controller) companion(gaming ? "game" : status.busy ? "thinking" : status.online ? "idle" : "offline");
  controls();
}

async function refreshStatus() {
  if (state.refreshing) return; state.refreshing = true;
  try { applyStatus(await request("/api/status")); }
  catch (error) {
    applyStatus({ online: false, models: [], running: [], error: "PC Agent 服务未连接，请启动或重启服务。", mode: state.status?.mode || "normal", preview: state.status?.preview || false, release: { state: "unknown", message: "服务不可用，无法确认模型是否释放。" } });
  } finally { state.refreshing = false; }
}

function history() {
  $("history-count").textContent = state.history.length;
  $("history").innerHTML = state.history.length ? state.history.map((item) => `<div class="history-item ${item.id === state.id ? "active" : ""}" data-id="${escapeHtml(item.id)}"><button class="history-open"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.model)}</small></button><button class="history-delete" aria-label="删除 ${escapeHtml(item.title)}" title="删除对话">×</button></div>`).join("") : `<p class="muted">${$("search").value ? "没有匹配的记录。" : "还没有对话，先聊一句吧。"}</p>`;
  document.querySelectorAll(".history-open").forEach((button) => button.addEventListener("click", () => openConversation(button.parentElement.dataset.id)));
  document.querySelectorAll(".history-delete").forEach((button) => button.addEventListener("click", () => deleteConversation(button.parentElement.dataset.id)));
  controls();
}
async function refreshHistory() {
  const version = ++state.historyVersion;
  try { const data = await request(`/api/conversations?q=${encodeURIComponent($("search").value)}`); if (version !== state.historyVersion) return; state.history = data.conversations; history(); }
  catch (error) { if (version === state.historyVersion) $("history").textContent = `记录暂时不可用：${error.message}`; }
}

function newConversation() {
  if (busy()) return;
  state.id = null; state.model = null; state.title = "新的开始"; $("conversation-title").textContent = state.title;
  $("messages").innerHTML = '<div class="empty-state"><span class="empty-mark">从一句话开始</span><h2>在自己的电脑上，<br>留一点思考的空间。</h2><p>选择已安装的本地模型，和它聊聊想法。<br>聊天记录独立保存，不会混入旧的 Local AI 项目。</p><div class="suggestions"><button>帮我安排今天的学习计划。</button><button>用一个简单例子解释电磁感应。</button><button>我想做一个个人助手，先从哪里开始？</button></div></div>';
  document.querySelectorAll(".suggestions button").forEach((button) => button.addEventListener("click", () => { $("prompt").value = button.textContent; saveDraft(); resizePrompt(); controls(); $("prompt").focus(); }));
  notice(); history(); if (state.status) applyStatus(state.status);
}

function drawMessage(message, article, phase = "") {
  const target = article.querySelector(".message-body");
  if (message.role === "assistant") renderAnswer(target, message.content); else target.textContent = message.content;
  const metadata = message.metadata || {}; const parts = [];
  if (phase) parts.push(phase);
  else {
    if (message.status === "stopped") parts.push("已停止 · 收到的部分回答已保存");
    if (message.status === "failed") parts.push(metadata.error || "生成失败，部分内容已保留");
    if (message.status === "limited") parts.push("达到本轮长度上限 · 可继续提问");
    if (metadata.outputTokens != null) parts.push(`${metadata.outputTokens} 输出 tokens`);
    if (metadata.tokensPerSecond != null) parts.push(`${metadata.tokensPerSecond} tokens/s`);
    if (metadata.elapsedMs != null) parts.push(`${(metadata.elapsedMs / 1000).toFixed(1)} 秒`);
  }
  article.querySelector(".message-meta").textContent = parts.join(" · ");
  article.querySelector(".copy-message").hidden = !message.content || Boolean(phase);
  article.classList.toggle("incomplete", ["stopped", "failed", "limited"].includes(message.status)); article.classList.toggle("pending", Boolean(phase));
}
function addMessage(message) {
  $("messages").querySelector(".empty-state")?.remove();
  const article = document.createElement("article"); article.className = `message ${message.role}`;
  article.innerHTML = `<div class="message-heading"><strong>${message.role === "user" ? "你" : escapeHtml(state.model || "本地模型")}</strong><button type="button" class="text-button copy-message">复制</button></div><div class="message-body"></div><div class="message-meta"></div>`;
  article.querySelector(".copy-message").addEventListener("click", (event) => copy(message.content, event.currentTarget));
  drawMessage(message, article); $("messages").append(article); return article;
}
function displayConversation(conversation) {
  state.id = conversation.id; state.model = conversation.model; state.title = conversation.title; $("conversation-title").textContent = conversation.title;
  $("messages").replaceChildren(); conversation.messages.forEach(addMessage); history(); if (state.status) applyStatus(state.status); scroll(true);
}
async function openConversation(id) {
  if (busy()) return; state.loading = true; controls(); notice();
  try { const conversation = await request(`/api/conversations/${id}`); displayConversation(conversation); drawer(false); if (conversation.generating) notice("本应用正在生成，请稍后重新打开记录查看最终结果。"); }
  catch (error) { notice(error.message, true); } finally { state.loading = false; controls(); }
}
async function deleteConversation(id) {
  if (busy() || !confirm("删除这条本地对话？此操作无法撤销。")) return;
  try { await request(`/api/conversations/${id}`, { method: "DELETE" }); if (id === state.id) newConversation(); await refreshHistory(); }
  catch (error) { notice(error.message, true); }
}
function scroll(force = false) { const element = $("messages"); if (force || element.scrollHeight - element.scrollTop - element.clientHeight < 160) element.scrollTop = element.scrollHeight; }

async function sendMessage(text) {
  if (busy() || $("send").disabled) return;
  const previousId = state.id;
  state.model ||= $("model").value; state.controller = new AbortController();
  const user = { role: "user", content: text, status: "complete" }; const assistant = { role: "assistant", content: "", status: "complete", metadata: {} };
  const userArticle = addMessage(user); const article = addMessage(assistant);
  drawMessage(assistant, article, "等待本地模型…"); companion("loading"); controls(); notice(); scroll(true);
  $("prompt").value = ""; saveDraft(); resizePrompt();
  let accepted = false; let doneEvent = false; let lastPaint = 0;
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: state.model, message: text, conversationId: state.id }), signal: state.controller.signal });
    if (!response.ok || !response.body) throw new Error((await response.json()).error || "发送失败。");
    accepted = true; state.id = response.headers.get("x-conversation-id") || state.id;
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    const collect = (line) => {
      if (!line.trim()) return; const event = JSON.parse(line);
      if (event.type === "conversation") { state.id = event.id; state.title = event.title; $("conversation-title").textContent = event.title; }
      if (event.type === "phase") { companion("thinking"); drawMessage(assistant, article, "模型思考中…"); }
      if (event.type === "delta") {
        assistant.content += event.content; companion("writing");
        if (performance.now() - lastPaint > 80) { drawMessage(assistant, article, "正在回答…"); scroll(); lastPaint = performance.now(); }
      }
      if (event.type === "done") { doneEvent = true; assistant.status = event.status; assistant.metadata = event.metadata || {}; }
    };
    while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() || ""; lines.forEach(collect); }
    collect(buffer + decoder.decode()); if (!doneEvent) throw new Error("连接提前中断，请重新打开记录检查已保存的内容。");
  } catch (error) {
    assistant.status = error.name === "AbortError" ? "stopped" : "failed"; assistant.metadata.error = error.message;
    if (!accepted) {
      $("prompt").value = text; saveDraft(); resizePrompt(); userArticle.remove(); article.remove();
      if (!previousId) state.model = null;
      notice(`未确认发送，问题已恢复为草稿。${error.name === "AbortError" ? "" : error.message}`, error.name !== "AbortError");
    } else if (assistant.status === "failed") notice(error.message, true);
  } finally {
    if (article.isConnected) drawMessage(assistant, article);
    if (accepted && state.controller.signal.aborted && state.id) {
      for (let count = 0; count < 15; count += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        try { const saved = await request(`/api/conversations/${state.id}`); if (!saved.generating) { displayConversation(saved); break; } } catch { break; }
      }
    }
    state.controller = null; await refreshStatus(); await refreshHistory(); controls(); scroll(); $("prompt").focus();
  }
}

let confirmationAction = null;
function confirmResources(action) {
  if (state.resourceBusy) return;
  confirmationAction = action;
  $("confirm-title").textContent = action === "game" ? "进入游戏模式" : "释放模型显存";
  const running = state.status?.running.map((model) => model.name) || [];
  $("confirm-description").textContent = `${action === "game" ? "先阻止本应用加载模型，再请求释放。" : "请求释放当前 Ollama 中已加载的模型。"}${running.length ? `当前检测到：${running.join("、")}。` : "执行时会重新检查已加载模型。"}`;
  $("confirm-dialog").showModal(); $("confirm-cancel").focus();
}
$("confirm-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const action = confirmationAction; $("confirm-dialog").close();
  state.resourceBusy = true; controls(); notice("正在停止生成并请求释放模型…");
  try {
    const data = await post(action === "game" ? "/api/mode" : "/api/release", action === "game" ? { mode: "game", confirm: true } : { confirm: true });
    applyStatus(data); notice(data.release.message, data.release.state !== "released");
  } catch (error) { notice(`操作未确认完成：${error.message}`, true); await refreshStatus(); }
  finally { state.resourceBusy = false; controls(); }
});
$("confirm-cancel").addEventListener("click", () => $("confirm-dialog").close());
$("release").addEventListener("click", () => confirmResources("release"));
$("game-mode").addEventListener("click", async () => {
  if (state.status?.mode !== "game") return confirmResources("game");
  state.resourceBusy = true; controls();
  try { applyStatus(await post("/api/mode", { mode: "normal" })); notice("已退出游戏模式。模型不会自动预加载，发送消息时才加载。"); }
  catch (error) { notice(error.message, true); } finally { state.resourceBusy = false; controls(); }
});
$("composer").addEventListener("submit", (event) => { event.preventDefault(); const text = $("prompt").value.trim(); if (text) sendMessage(text); });
$("prompt").addEventListener("input", () => { saveDraft(); resizePrompt(); controls(); });
$("prompt").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); $("composer").requestSubmit(); } });
$("stop").addEventListener("click", async () => { try { await post("/api/stop", {}); } catch { state.controller?.abort(); } });
$("new-chat").addEventListener("click", () => { newConversation(); drawer(false); });
$("model").addEventListener("change", () => { storage.set("pc-agent-model", $("model").value); if (state.id) { newConversation(); notice("已新建对话，原模型的记录仍然保留。"); } controls(); });
$("refresh").addEventListener("click", refreshStatus);
let searchTimer; $("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(refreshHistory, 180); });
function saveDraft() { storage.set("pc-agent-draft", $("prompt").value); }
function resizePrompt() { $("prompt").style.height = "auto"; $("prompt").style.height = `${Math.min($("prompt").scrollHeight, 170)}px`; }
async function copy(text, button) {
  try { if (window.pcAgentDesktop?.copyText) await window.pcAgentDesktop.copyText(text); else await navigator.clipboard.writeText(text); const label = button.textContent; button.textContent = "已复制"; setTimeout(() => { button.textContent = label; }, 1200); }
  catch { notice("浏览器不允许复制，请手动选中文字。", true); }
}
$("copy-command").addEventListener("click", (event) => copy("ollama pull deepseek-r1:8b", event.currentTarget));
$("messages").addEventListener("click", (event) => { const button = event.target.closest("[data-copy-code]"); if (button) copy(button.closest(".code-block").querySelector("code").textContent, button); });
$("export").addEventListener("click", async () => {
  try {
    const conversation = await request(`/api/conversations/${state.id}`);
    const text = [`# ${conversation.title}`, "", `模型：${conversation.model}`, "", ...conversation.messages.flatMap((message) => [`## ${message.role === "user" ? "你" : "本地模型"}`, "", message.content || "（没有回答正文）", "", ...(message.status !== "complete" ? [`> 状态：${message.status}。${message.metadata?.error || ""}`, ""] : [])])].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = `pc-agent-${conversation.id.slice(0, 8)}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); notice("已导出对话。文件中包含私人消息，请妥善保存。");
  } catch (error) { notice(error.message, true); }
});
function drawer(open) {
  const mobile = matchMedia("(max-width:640px)").matches;
  $("sidebar").classList.toggle("open", open); $("sidebar").inert = mobile && !open; $("drawer-shade").hidden = !open; $("drawer-toggle").setAttribute("aria-expanded", String(open));
  if (open) $("new-chat").focus();
}
$("drawer-toggle").addEventListener("click", () => drawer(!$("sidebar").classList.contains("open")));
$("drawer-shade").addEventListener("click", () => { drawer(false); $("drawer-toggle").focus(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("sidebar").classList.contains("open")) { drawer(false); $("drawer-toggle").focus(); }
  if (event.key === "Tab" && matchMedia("(max-width:640px)").matches && $("sidebar").classList.contains("open")) {
    const items = [...$("sidebar").querySelectorAll("a,button:not(:disabled),input")].filter((element) => element.getClientRects().length); const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
matchMedia("(max-width:640px)").addEventListener("change", () => drawer(false));
window.addEventListener("beforeunload", (event) => { if (state.controller) { event.preventDefault(); event.returnValue = ""; } });
$("prompt").value = storage.get("pc-agent-draft") || "";
newConversation(); drawer(false); resizePrompt(); refreshHistory(); refreshStatus();
setInterval(() => { if (!document.hidden) refreshStatus(); }, 4000);
