import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function findInstalledOllama(environment = process.env) {
  const candidates = [];
  if (environment.LOCALAPPDATA) candidates.push(path.join(environment.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"));
  if (environment.ProgramFiles) candidates.push(path.join(environment.ProgramFiles, "Ollama", "ollama.exe"));
  for (const entry of (environment.PATH || environment.Path || "").split(path.delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, "$1");
    // Never search the working directory or execute a shell/PATH-expanded command.
    if (path.isAbsolute(directory)) candidates.push(path.join(directory, "ollama.exe"));
  }
  for (const candidate of [...new Set(candidates)]) {
    try { if (path.isAbsolute(candidate) && (await stat(candidate)).isFile()) return candidate; } catch { /* Continue to the next installation directory. */ }
  }
  return null;
}

export function createOllamaService({
  endpoint = "http://127.0.0.1:11434",
  environment = process.env,
  fetcher = fetch,
  findExecutable = () => findInstalledOllama(environment),
  launch = spawn,
  pollMilliseconds = 350,
  startupMilliseconds = 20000,
} = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/") throw new Error("Ollama 自动启动只允许本机服务。");
  const origin = url.origin;
  let snapshot = { state: "checking", managed: false, message: "正在检查本机 Ollama…" };
  let operation = null, child = null, disposed = false;
  const alive = () => child && child.exitCode === null && child.signalCode === null && !child.killed;
  const update = (state, message) => { snapshot = { state, managed: Boolean(alive()), message }; return { ...snapshot }; };
  async function probe() {
    try {
      const response = await fetcher(origin + "/api/version", { signal: AbortSignal.timeout(1200), redirect: "error" });
      if (!response.ok) return false;
      const body = await response.json(); return typeof body?.version === "string" && body.version.length > 0;
    } catch { return false; }
  }
  async function ensure() {
    update("checking", "正在检查本机 Ollama…");
    if (await probe()) return update("ready", alive() ? "Ollama 已由本应用在后台启动；未预加载模型。" : "已连接正在运行的 Ollama，没有重复启动。");
    if (disposed) return snapshot;
    if (!alive()) {
      const executable = await findExecutable();
      if (disposed) return snapshot;
      if (!executable) return update("missing", "未找到 Ollama。请先安装 Ollama，再点击「重试后台启动」。不会自动下载安装程序或模型。");
      let launchError = null;
      try {
        child = launch(executable, ["serve"], {
          cwd: path.dirname(executable), windowsHide: true, shell: false, detached: true, stdio: "ignore",
          env: { ...environment, OLLAMA_HOST: url.host, OLLAMA_NO_CLOUD: "1" },
        });
        // Leave a shared background service available after the window closes.
        // The app's 60-second keep-alive/game mode controls model residency.
        child.on("error", (error) => { launchError = error; });
        child.unref();
      } catch (error) { launchError = error; }
      update("starting", "正在后台启动 Ollama，只启动服务，不下载或加载模型…");
      const deadline = Date.now() + startupMilliseconds;
      while (!disposed && Date.now() < deadline) {
        if (await probe()) return update("ready", alive() ? "Ollama 已由本应用在后台启动；未预加载模型。" : "已连接正在运行的 Ollama，没有重复启动。");
        if (launchError) return update("failed", "无法后台启动 Ollama。请检查安装是否完整，或手动打开 Ollama 后重试。");
        if (!alive()) return update("failed", "Ollama 启动后已退出。请手动打开 Ollama 检查本地端口或安装状态，再点击重试。");
        await wait(pollMilliseconds);
      }
    } else {
      update("starting", "Ollama 进程已启动，正在等待服务就绪，不会重复启动…");
      const deadline = Date.now() + startupMilliseconds;
      while (!disposed && alive() && Date.now() < deadline) {
        if (await probe()) return update("ready", "Ollama 已由本应用在后台启动；未预加载模型。");
        await wait(pollMilliseconds);
      }
    }
    if (disposed) return snapshot;
    return update("failed", "Ollama 尚未就绪，可能仍在启动。可以稍后刷新或重试；不会重复启动已有进程。");
  }
  return {
    getStatus() { return { ...snapshot, managed: Boolean(alive()) }; },
    start() {
      if (disposed) return Promise.resolve(snapshot);
      if (operation) return operation;
      operation = ensure().catch(() => update("failed", "启动检查失败，请手动打开 Ollama 后重试。"));
      operation.finally(() => { operation = null; });
      return operation;
    },
    dispose() { disposed = true; },
  };
}
