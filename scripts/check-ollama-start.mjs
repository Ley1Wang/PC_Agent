// Optional integration check: an isolated port, version/ps only, no inference.
import http from "node:http";
import { spawn } from "node:child_process";
import { createOllamaService, findInstalledOllama } from "../desktop/ollama-service.mjs";

const executable = await findInstalledOllama();
if (!executable) { console.log("Ollama is not installed; real startup check skipped."); process.exitCode = 1; }
else {
  const reserve = http.createServer(); await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port; await new Promise((resolve) => reserve.close(resolve));
  const endpoint = `http://127.0.0.1:${port}`; let owned = null;
  const engine = createOllamaService({ endpoint, findExecutable: async () => executable, environment: { ...process.env, OLLAMA_NOPRUNE: "1" }, startupMilliseconds: 30000,
    launch(file, args, options) { owned = spawn(file, args, { ...options, detached: false }); return owned; }
  });
  try {
    const result = await engine.start();
    if (result.state !== "ready" || !result.managed) throw new Error(result.message);
    const response = await fetch(endpoint + "/api/ps", { signal: AbortSignal.timeout(3000) });
    const status = await response.json();
    if (!response.ok || !Array.isArray(status.models) || status.models.length !== 0) throw new Error("Expected a fresh service with no loaded models");
    console.log("Real Ollama startup passed on an isolated loopback port: hidden serve process ready, zero loaded models, no downloads or inference.");
  } finally {
    engine.dispose();
    // This is the exact child handle created above, never an existing user service.
    if (owned && owned.exitCode === null && !owned.killed) {
      const exit = new Promise((resolve) => owned.once("exit", resolve)); owned.kill();
      await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
  }
}
