import path from "node:path";
import { mkdir, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createMock } from "../tests/mock.mjs";
import { createApplication } from "../backend/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parent = path.join(root, ".local", "preview"); await mkdir(parent, { recursive: true });
const dataDir = await mkdtemp(path.join(parent, "session-"));
const mock = createMock(); await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
const app = createApplication({ dataDir, ollamaUrl: `http://127.0.0.1:${mock.server.address().port}`, preview: true });
app.server.listen(8791, "127.0.0.1", () => console.log("测试预览（模拟回答）：http://127.0.0.1:8791"));
let closed = false;
async function stop() {
  if (closed) return; closed = true; await app.close(); mock.server.closeAllConnections(); await new Promise((resolve) => mock.server.close(resolve));
}
process.on("SIGINT", stop); process.on("SIGTERM", stop);
