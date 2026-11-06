import { spawn } from "node:child_process";
import { createApplication } from "../backend/app.mjs";

const app = createApplication();
const port = 8790;
app.server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `端口 ${port} 已被占用。如果 PC Agent 已启动，请直接打开 http://127.0.0.1:${port}` : error.message);
  process.exitCode = 1;
  app.close();
});
app.server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`PC Agent 已启动：${url}`);
  console.log("只连接本机 Ollama。关闭此窗口可停止 PC Agent；模型是否仍加载请查看资源面板。");
  if (process.platform === "win32" && !process.argv.includes("--no-open")) {
    const browser = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${url}'`], { windowsHide: true, stdio: "ignore" });
    browser.on("error", () => console.log("无法自动打开浏览器，请手动打开上方地址。"));
  }
});
let closing = false;
async function stop() { if (closing) return; closing = true; await app.close(); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
