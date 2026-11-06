// Convert the established SVG icon directly; no browser, network or new artwork.
import { Resvg } from "@resvg/resvg-js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(path.join(root, "frontend", "icon.svg"), "utf8");
const png = new Resvg(svg, { fitTo: { mode: "width", value: 256 }, font: { loadSystemFonts: false } }).render().asPng();
if (png.length < 100) throw new Error("Icon conversion produced no image");
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
const directory = path.join(root, ".local", "build-icons"); await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, "icon.png"), png);
await writeFile(path.join(directory, "icon.ico"), Buffer.concat([header, png]));
console.log("Created desktop icons from frontend/icon.svg.");
