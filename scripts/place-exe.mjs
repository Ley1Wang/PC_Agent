import { copyFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const source = path.join(root, "release", `PC-Agent-${version}-portable-x64.exe`);
if (!(await stat(source)).isFile()) throw new Error("Portable EXE is missing");
const staging = path.join(root, ".local", "build-output"); await mkdir(staging, { recursive: true });
const next = path.join(staging, "PC-Agent.exe");
await copyFile(source, next);
try { await rename(next, path.join(root, "PC-Agent.exe")); }
catch (error) { throw new Error("EXE 已在 release 生成，但无法替换根目录的 PC-Agent.exe。请关闭正在运行的旧版本后重新执行 node scripts/place-exe.mjs。", { cause: error }); }
console.log(`Ready: ${path.join(root, "PC-Agent.exe")}`);
