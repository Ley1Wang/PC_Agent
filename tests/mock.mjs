import http from "node:http";

export const sample = ["## 本地对话已连接", "这是**模拟回答**，只用于检查界面和功能，不代表 DeepSeek 的实际表现。", "", "1. 对话记录保存在测试数据库。", "2. 游戏模式可以停止生成并释放模拟模型。", "", "```python", "print('hello, local agent')", "```"].join("\n");

export function createMock() {
  const state = { loaded: new Set(["deepseek-r1:8b"]), requests: [], releases: [], offline: false, keepLoaded: false, thinkingValues: [true, false] };
  const server = http.createServer(async (req, res) => {
    const json = (data, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    if (state.offline) return json({ error: "offline" }, 503);
    if (req.url === "/api/version") return json({ version: "0.0.0-test" });
    if (req.url === "/api/tags") return json({ models: [
      { name: "deepseek-r1:8b", size: 5200000000, details: { parameter_size: "8B", quantization_level: "Q4_K_M" } },
      { name: "other:small", size: 1800000000, details: { parameter_size: "2B", quantization_level: "Q4_K_M" } },
      { name: "remote:cloud", size: 100 },
    ] });
    if (req.url === "/api/ps") return json({ models: [...state.loaded].map((name) => ({ name, size_vram: 3 * 1024 ** 3, size: 4 * 1024 ** 3 })) });
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (req.url === "/api/show") {
      if (body.model === "hidden-remote") return json({ remote_host: "https://untrusted.example", remote_model: "something" });
      return json({ capabilities: ["completion", "thinking"], ...(state.thinkingValues ? { thinking: { values: state.thinkingValues, default: true } } : {}) });
    }
    if (req.url === "/api/generate") {
      state.releases.push(body); if (!state.keepLoaded) state.loaded.delete(body.model); return json({ done: true, done_reason: "unload" });
    }
    if (req.url !== "/api/chat") return json({ error: "missing" }, 404);
    state.requests.push(body); state.loaded.add(body.model); const question = body.messages.at(-1).content;
    if (question === "http-error") return json({ error: "not available" }, 503);
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    const emit = (event) => res.write(JSON.stringify(event) + "\n");
    if (question === "slow") {
      emit({ message: { content: "这是一段已收到的部分回答。" } });
      const timer = setInterval(() => emit({ message: { content: "继续生成。" } }), 120);
      res.on("close", () => clearInterval(timer)); return;
    }
    if (question === "truncated") { emit({ message: { content: "部分回答" } }); return res.end(); }
    if (question === "malformed") { emit({ message: { content: "部分回答" } }); return res.end("invalid json\n"); }
    if (question === "empty") return res.end(JSON.stringify({ done: true }));
    emit({ message: { thinking: "PRIVATE HIDDEN REASONING" } });
    const answer = question === "unicode" ? "你好，世界 🌱" : question === "limit" ? "已达到本轮长度限制。" : question === "unsafe" ? "<img src='https://untrusted.example/test' onerror='window.injected=true'>\n<script>window.injected=true</script>" : sample;
    const data = Buffer.from(JSON.stringify({ message: { content: answer } }) + "\n" + JSON.stringify({ done: true, ...(question === "limit" ? { done_reason: "length" } : {}), eval_count: 32, eval_duration: 2e9 }));
    // Exercise JSON/UTF-8 split boundaries and a final line without newline.
    for (let offset = 0; offset < data.length; offset += 5) res.write(data.subarray(offset, offset + 5));
    res.end();
  });
  return { server, state };
}
