// One command per video: capture -> compose -> preview page.
//
//   node make.mjs scenarios/01-home.json            full run
//   node make.mjs scenarios/01-home.json --compose  re-encode only (after changing "compose")
//   node make.mjs scenarios/01-home.json --draft    quick low-res pass to check the timeline
//
// Result: out/<name>/<name>.webm, .mp4, -poster.jpg and preview.html.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fmtBytes, nums, parseArgs, ROOT } from "./lib/common.mjs";

const a = parseArgs(process.argv.slice(2));
const scPath = a._[0];
if (!scPath) {
  console.error("usage: node make.mjs scenarios/01-home.json [--compose] [--draft]");
  process.exit(2);
}
const sc = JSON.parse(fs.readFileSync(scPath, "utf8"));
const name = (sc.name ?? path.basename(scPath, ".json")) + (a.draft ? "-draft" : "");
const out = path.join(ROOT, "out", name);
fs.mkdirSync(out, { recursive: true });

// Slot settings shared by all videos (background, screen rect) live in
// scenarios/slot.json; a scenario's own "compose" overrides them.
const slotFile = path.join(path.dirname(scPath), "slot.json");
const slot = fs.existsSync(slotFile) ? JSON.parse(fs.readFileSync(slotFile, "utf8")) : {};
const c = { size: "1200x600", scale: 2, ...slot, ...(sc.compose ?? {}) };
// Second version: the bare screen at 1920x1080, for placing into another frame.
const screen = c.screen === false ? null : { size: `${sc.viewport?.width ?? 1440}x${sc.viewport?.height ?? 810}`, scale: 1920 / (sc.viewport?.width ?? 1440) };
const vw = sc.viewport?.width ?? 1440;
const [sw, sh] = nums(c.size);
const rect = c.rect ? nums(c.rect) : [0, 0, sw, sh];
const crop = c.crop ? nums(c.crop) : null;

if (a.draft) {
  c.scale = 1;
  sc.scale = 1;
}
// Capture density: enough device pixels for the screen at the output scale.
if (sc.scale === undefined || sc.scale === "auto") {
  const need = Math.max((rect[2] * c.scale) / (crop ? crop[2] : vw), screen && !crop ? screen.scale : 0);
  sc.scale = Math.min(3, Math.max(1, Math.ceil(need * 4) / 4));
}
// Files in "replace" are given from the scenario folder; the resolved copy lives in out/<name>/.
if (sc.replace) {
  sc.replace = Object.fromEntries(Object.entries(sc.replace).map(([part, f]) => [part, path.resolve(path.dirname(scPath), f)]));
}
const resolved = path.join(out, "scenario.json");
fs.writeFileSync(resolved, JSON.stringify(sc, null, 1));

const node = (script, args) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [path.join(ROOT, script), ...args], { stdio: "inherit" });
  p.on("close", code => (code ? reject(new Error(`${script} exited with ${code}`)) : resolve()));
});

const t0 = Date.now();
if (!a.compose) {
  console.log(`съёмка ${name}: ${sc.url}  (окно ${vw}x${sc.viewport?.height ?? 810}, плотность ${sc.scale}x)`);
  await node("capture.mjs", [resolved, out]);
}

function composeArgs(o, outName, slotMode) {
  const args = ["--capture", out, "--out", path.join(out, outName), "--size", o.size, "--scale", String(o.scale)];
  if (slotMode && o.bg) args.push("--bg", path.resolve(path.dirname(scPath), o.bg));
  if (slotMode && o.bgColor) args.push("--bg-color", o.bgColor);
  if (slotMode && o.rect) args.push("--rect", nums(o.rect).join(","));
  if (slotMode && o.radius) args.push("--radius", String(o.radius));
  if (c.crop) args.push("--crop", crop.join(","));
  if (c.cursor) args.push("--cursor");
  if (c.cursorSize) args.push("--cursor-size", String(c.cursorSize));
  if (c.crfWebm) args.push("--crf-webm", String(c.crfWebm));
  if (c.crfMp4) args.push("--crf-mp4", String(c.crfMp4));
  if (c.posterAt !== undefined) args.push("--poster-at", String(c.posterAt));
  if (a.draft) args.push("--vp9-speed", "5");
  return args;
}
console.log(`сборка ${name}: слот ${c.size} @${c.scale}x${c.bg ? " на подложке " + c.bg : c.bgColor ? " на фоне " + c.bgColor : ""}`);
await node("compose.mjs", composeArgs(c, name, true));
if (screen && !a.draft) {
  console.log(`сборка ${name}-screen: чистый экран 1920x1080`);
  await node("compose.mjs", composeArgs({ ...screen }, name + "-screen", false));
}

// Preview page: the video at slot size, as it will sit on the case page.
const meta = JSON.parse(fs.readFileSync(path.join(out, "meta.json"), "utf8"));
const size = f => (fs.existsSync(path.join(out, f)) ? fmtBytes(fs.statSync(path.join(out, f)).size) : "—");
const marks = meta.marks.filter(m => m.step !== "wait").map(m => `<li><b>${m.t.toFixed(2)} с</b> ${m.step} ${String(m.note).replace(/</g, "&lt;")}</li>`).join("");
fs.writeFileSync(path.join(out, "preview.html"), `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
 :root { color-scheme: light dark; --bg: #f3f3f1; --fg: #16171a; --muted: #6b6e76; --card: #fff; }
 @media (prefers-color-scheme: dark) { :root { --bg: #111214; --fg: #ececee; --muted: #8d9099; --card: #1a1b1f; } }
 body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
 main { max-width: ${sw}px; margin: 40px auto; padding: 0 16px; }
 video { display: block; width: 100%; aspect-ratio: ${sw} / ${sh}; border-radius: 4px; background: #000; }
 .row { display: flex; gap: 24px; flex-wrap: wrap; color: var(--muted); margin: 14px 0 28px; }
 .row b { color: var(--fg); font-weight: 600; }
 ol { color: var(--muted); columns: 2; padding-left: 18px; } ol b { color: var(--fg); font-weight: 600; }
</style></head><body><main>
<h1 style="font-size:20px;margin:0 0 16px">${name}</h1>
<video autoplay muted loop playsinline preload="metadata" poster="${name}-poster.jpg">
  <source src="${name}.webm" type="video/webm"><source src="${name}.mp4" type="video/mp4">
</video>
<div class="row"><span><b>${meta.duration.toFixed(1)} с</b> · ${meta.fps} fps · ${meta.frames.length} кадров</span>
<span>WebM <b>${size(name + ".webm")}</b></span><span>MP4 <b>${size(name + ".mp4")}</b></span><span>постер <b>${size(name + "-poster.jpg")}</b></span></div>
${fs.existsSync(path.join(out, name + "-screen.webm")) ? `<p style="color:var(--muted)">Чистый экран 1920×1080 (WebM ${size(name + "-screen.webm")}, MP4 ${size(name + "-screen.mp4")}):</p>
<video autoplay muted loop playsinline preload="metadata" poster="${name}-screen-poster.jpg" style="aspect-ratio:16/9;margin-bottom:28px">
  <source src="${name}-screen.webm" type="video/webm"><source src="${name}-screen.mp4" type="video/mp4">
</video>` : ""}
<p style="color:var(--muted)">Вставка на сайт:</p>
<pre style="background:var(--card);padding:14px;border-radius:8px;overflow:auto">&lt;video autoplay muted loop playsinline preload="metadata" poster="${name}-poster.jpg"&gt;
  &lt;source src="${name}.webm" type="video/webm"&gt;
  &lt;source src="${name}.mp4" type="video/mp4"&gt;
&lt;/video&gt;</pre>
<p style="color:var(--muted)">Таймлайн съёмки:</p><ol>${marks}</ol>
</main></body></html>
`);

console.log(`\nготово за ${((Date.now() - t0) / 60000).toFixed(1)} мин → ${out}`);
console.log(`  открыть превью: ${path.join(out, "preview.html")}`);
