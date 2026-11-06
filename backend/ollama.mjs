export function createOllama(base = "http://127.0.0.1:11434") {
  const url = new URL(base);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) || url.username || url.password || url.pathname !== "/") {
    throw new Error("Ollama 只允许连接本机 HTTP 地址。");
  }
  const origin = url.origin;
  const request = async (route, body, signal) => {
    const response = await fetch(origin + route, {
      ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      signal: signal || AbortSignal.timeout(5000), redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 404 ? "Ollama 找不到这个模型，请检查安装和模型名称。" : `Ollama 返回错误（HTTP ${response.status}）。请检查模型和可用内存。`);
    }
    return response;
  };
  const json = async (route, body, signal) => (await request(route, body, signal)).json();
  return {
    async inspect() {
      const [tags, ps] = await Promise.all([json("/api/tags"), json("/api/ps")]);
      const models = (tags.models || []).filter((model) => !/:cloud(?:$|[/-])/i.test(model.name) && !model.remote_host && !model.remote_model).map((model) => ({ name: model.name, size: model.size || 0, parameters: model.details?.parameter_size || "", quantization: model.details?.quantization_level || "" }));
      const running = (ps.models || []).map((model) => ({ name: model.name || model.model, vram: model.size_vram ?? null, memory: model.size ?? null, expiresAt: model.expires_at || null }));
      return { models, running };
    },
    async assertLocalModel(model) {
      if (/:cloud(?:$|[/-])/i.test(model)) throw new Error("本项目不允许云端模型。");
      const info = await json("/api/show", { model });
      if (info.remote_host || info.remote_model || info.capabilities?.includes("cloud")) throw new Error("该模型指向云端，本项目只允许本地推理。");
      return info;
    },
    async chat(body, signal) { return request("/api/chat", body, signal); },
    async release(model) { await json("/api/generate", { model, keep_alive: 0, stream: false }, AbortSignal.timeout(10000)); },
  };
}
