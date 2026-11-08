import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOllamaService, findInstalledOllama } from "../desktop/ollama-service.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const online = async () => ({ ok: true, json: async () => ({ version: "test-version" }) });
const offline = async () => { throw new Error("offline"); };
function child() { return Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, killed: false, unref() { this.unreferenced = true; } }); }

test("Existing Ollama is reused without spawning or scanning executables", async () => {
  const engine = createOllamaService({ fetcher: online, findExecutable: () => { throw new Error("Should not look for files"); }, launch: () => { throw new Error("Should not launch"); } });
  const state = await engine.start(); assert.equal(state.state, "ready"); assert.equal(state.managed, false); engine.dispose();
});
test("Missing installation fails clearly without automatic downloads", async () => {
  const engine = createOllamaService({ fetcher: offline, findExecutable: async () => null });
  assert.equal((await engine.start()).state, "missing"); engine.dispose();
});
test("Concurrent startup uses one hidden local-only serve process and preserves model path", async () => {
  let probes = 0, launches = 0; let options; const process = child();
  const engine = createOllamaService({
    endpoint: "http://127.0.0.1:19191", environment: { OLLAMA_MODELS: "D:\\ExistingModels", OLLAMA_HOST: "0.0.0.0:1", OLLAMA_NO_CLOUD: "0" },
    fetcher: async (url) => { assert.ok(url.endsWith("/api/version")); probes += 1; if (probes < 3) throw new Error("not yet"); return online(); },
    findExecutable: async () => path.join(root, ".local", "fake", "ollama.exe"),
    launch(file, args, configuration) { launches += 1; assert.ok(file.endsWith("ollama.exe")); assert.deepEqual(args, ["serve"]); options = configuration; return process; }, pollMilliseconds: 1, startupMilliseconds: 100,
  });
  const first = engine.start(); assert.equal(engine.start(), first);
  const state = await first; assert.equal(state.state, "ready"); assert.equal(state.managed, true); assert.equal(launches, 1);
  assert.equal(options.windowsHide, true); assert.equal(options.shell, false); assert.equal(options.detached, true); assert.equal(options.stdio, "ignore");
  assert.equal(options.env.OLLAMA_HOST, "127.0.0.1:19191"); assert.equal(options.env.OLLAMA_NO_CLOUD, "1"); assert.equal(options.env.OLLAMA_MODELS, "D:\\ExistingModels");
  assert.equal(process.unreferenced, true); await engine.start(); assert.equal(launches, 1);
  engine.dispose(); assert.equal(process.killed, false, "Closing PC Agent must not kill a shared background service");
});
test("Launch failure and early exit are reported, never mistaken for online", async () => {
  const failure = createOllamaService({ fetcher: offline, findExecutable: async () => "C:\\Ollama\\ollama.exe", launch() { throw new Error("Access denied"); } });
  assert.equal((await failure.start()).state, "failed"); failure.dispose();
  const exited = child(); exited.exitCode = 1;
  const early = createOllamaService({ fetcher: offline, findExecutable: async () => "C:\\Ollama\\ollama.exe", launch: () => exited });
  assert.equal((await early.start()).state, "failed"); early.dispose();
});
test("Slow startup does not spawn another live process on retry", async () => {
  let launches = 0; const process = child();
  const engine = createOllamaService({ fetcher: offline, findExecutable: async () => "C:\\Ollama\\ollama.exe", launch() { launches += 1; return process; }, pollMilliseconds: 1, startupMilliseconds: 8 });
  assert.equal((await engine.start()).state, "failed"); assert.equal((await engine.start()).state, "failed"); assert.equal(launches, 1); engine.dispose();
});
test("Only loopback endpoints and actual installation files are considered", async () => {
  assert.throws(() => createOllamaService({ endpoint: "http://example.com:11434" }), /本机/);
  const parent = path.join(root, ".local", "tests"); await mkdir(parent, { recursive: true });
  const fixture = await mkdtemp(path.join(parent, "finder-")); const directory = path.join(fixture, "Programs", "Ollama"); await mkdir(directory, { recursive: true });
  const executable = path.join(directory, "ollama.exe"); await writeFile(executable, "test fixture, never executed");
  assert.equal(await findInstalledOllama({ LOCALAPPDATA: fixture, PATH: "." }), executable);
  assert.equal(await findInstalledOllama({ PATH: "." }), null);
});
