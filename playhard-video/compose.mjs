// Composites the captured screen into the case slot and encodes WebM + MP4.
//
// The screencast is scaled into a rectangle of the prepared background (the
// "подложка" exported from Figma), with rounded corners and an optional cursor
// drawn along the recorded mouse path. One pass produces both formats.
//
//   node compose.mjs --capture out/01-home --bg bg@2x.png --size 1200x600 --scale 2 \
//       --rect 120,60,960,540 --radius 14 --cursor --out out/01-home/01-home
//
// --size / --rect / --radius are in the slot's design pixels (the 1200x600
// Figma frame); --scale 2 renders 2400x1200 for sharp retina playback.
// --crop x,y,w,h takes one block of the page (viewport CSS px), e.g. a 3D block.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { even, findFfmpeg, fmtBytes, nums, parseArgs, run, sink } from "./lib/common.mjs";

const a = parseArgs(process.argv.slice(2));
const dir = a.capture ?? a._[0];
if (!dir || !a.out) {
  console.error("usage: node compose.mjs --capture out/name --out out/name/name [--bg bg.png --size 1200x600 --scale 2 --rect x,y,w,h --radius r --cursor --crop x,y,w,h]");
  process.exit(2);
}
const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
const ff = await findFfmpeg();
const fps = Number(a.fps ?? meta.fps);
const vw = meta.viewport.width, vh = meta.viewport.height;

const [sw, sh] = nums(a.size ?? `${vw}x${vh}`);
const k = Number(a.scale ?? 2);
const W = even(sw * k), H = even(sh * k);
const [rx, ry, rw, rh] = a.rect ? nums(a.rect) : [0, 0, sw, sh];
const box = { x: Math.round(rx * k), y: Math.round(ry * k), w: even(rw * k), h: even(rh * k) };
box.w = Math.min(box.w, W - box.x); box.h = Math.min(box.h, H - box.y);
const R = Math.min(Math.round(Number(a.radius ?? 0) * k), box.w >> 1, box.h >> 1);

// Source region in CSS px of the viewport.
const crop = a.crop ? nums(a.crop) : null;
const [srcX, srcY, srcW, srcH] = crop ?? [0, 0, vw, vh];
if (Math.abs(srcW / srcH - box.w / box.h) > 0.01) {
  console.warn(`внимание: пропорции съёмки ${(srcW / srcH).toFixed(3)} не совпадают с экраном в слоте ${(box.w / box.h).toFixed(3)} — картинка растянется; поправьте viewport/crop`);
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

let bg;
if (a.bg) {
  bg = await run(ff, ["-loglevel", "error", "-i", a.bg, "-vf", `scale=${W}:${H}:flags=lanczos,format=rgb24`, "-frames:v", "1", "-f", "rawvideo", "-"], { quiet: true });
} else {
  const hex = String(a["bg-color"] ?? "#0b0d12").replace("#", "");
  const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  bg = Buffer.allocUnsafe(W * H * 3);
  for (let i = 0; i < W * H; i++) { bg[i * 3] = c[0]; bg[i * 3 + 1] = c[1]; bg[i * 3 + 2] = c[2]; }
}
if (bg.length !== W * H * 3) throw new Error("не удалось прочитать подложку " + a.bg);

// ---------------------------------------------------------------------------
// Rounded-corner coverage (analytic anti-aliasing) for the top-left quadrant.
// ---------------------------------------------------------------------------

const cov = new Float32Array(R * R);
for (let y = 0; y < R; y++) {
  for (let x = 0; x < R; x++) {
    const d = Math.hypot(R - (x + 0.5), R - (y + 0.5));
    cov[y * R + x] = Math.min(1, Math.max(0, R - d + 0.5));
  }
}

function blendPx(out, o, src, s, c) {
  if (c >= 1) { out[o] = src[s]; out[o + 1] = src[s + 1]; out[o + 2] = src[s + 2]; return; }
  if (c <= 0) return;
  out[o] += (src[s] - out[o]) * c;
  out[o + 1] += (src[s + 1] - out[o + 1]) * c;
  out[o + 2] += (src[s + 2] - out[o + 2]) * c;
}

function composite(screen, out) {
  bg.copy(out);
  const row = box.w * 3;
  for (let y = 0; y < box.h; y++) {
    const dst = ((box.y + y) * W + box.x) * 3, src = y * row;
    const cy = y < R ? y : y >= box.h - R ? box.h - 1 - y : -1;
    if (cy < 0) { screen.copy(out, dst, src, src + row); continue; }
    screen.copy(out, dst + R * 3, src + R * 3, src + row - R * 3);
    for (let x = 0; x < R; x++) {
      const c = cov[cy * R + x];
      blendPx(out, dst + x * 3, screen, src + x * 3, c);
      const xr = box.w - 1 - x;
      blendPx(out, dst + xr * 3, screen, src + xr * 3, c);
    }
  }
}

// ---------------------------------------------------------------------------
// Cursor: classic arrow, white with a dark outline and a soft shadow, drawn
// here at the output resolution (no OS assets).
// ---------------------------------------------------------------------------

function offsetPolygon(pts, d) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  const sgn = area > 0 ? 1 : -1;
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
    const nx = (sgn * dy) / len, ny = (-sgn * dx) / len;
    return { px: p[0] + nx * d, py: p[1] + ny * d, ux: dx, uy: dy, nx, ny };
  });
  return pts.map((p, i) => {
    const l1 = lines[(i - 1 + pts.length) % pts.length], l2 = lines[i];
    const cr = l1.ux * l2.uy - l1.uy * l2.ux;
    if (Math.abs(cr) < 1e-9) return [p[0] + l2.nx * d, p[1] + l2.ny * d];
    const t = ((l2.px - l1.px) * l2.uy - (l2.py - l1.py) * l2.ux) / cr;
    return [l1.px + l1.ux * t, l1.py + l1.uy * t];
  });
}

function polyCoverage(pts, w, h, ss = 4) {
  const out = new Float32Array(w * h);
  const n = pts.length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) {
        const py = y + (sy + 0.5) / ss;
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          let inside = false;
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j];
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) hit++;
        }
      }
      out[y * w + x] = hit / (ss * ss);
    }
  }
  return out;
}

function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    const from = pass ? tmp : src, to = pass ? out : tmp;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, c = 0;
        for (let d = -r; d <= r; d++) {
          const xx = pass ? x : x + d, yy = pass ? y + d : y;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += from[yy * w + xx]; c++;
        }
        to[y * w + x] = s / c;
      }
    }
  }
  return out;
}

function makeCursor(unit) {
  const body = [[0, 0], [0, 17], [4.2, 13.2], [7, 19.6], [9.8, 18.4], [7.1, 12.2], [12.4, 12.2]];
  const outline = offsetPolygon(body, 1.15);
  const pad = 4;
  const minX = Math.min(...outline.map(p => p[0])), minY = Math.min(...outline.map(p => p[1]));
  const tx = p => [(p[0] - minX + pad) * unit, (p[1] - minY + pad) * unit];
  const w = Math.ceil((14.8 + pad * 2) * unit), h = Math.ceil((22.5 + pad * 2) * unit);
  const shadowPts = outline.map(p => tx([p[0] + 0.5, p[1] + 1.1]));
  const cOut = polyCoverage(outline.map(tx), w, h);
  const cIn = polyCoverage(body.map(tx), w, h);
  const cSh = boxBlur(polyCoverage(shadowPts, w, h, 2), w, h, Math.max(1, Math.round(1.1 * unit)));
  const col = new Float32Array(w * h), alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let A = cSh[i] * 0.32, C = 0;
    A = cOut[i] + A * (1 - cOut[i]);
    const nA = cIn[i] + A * (1 - cIn[i]);
    C = nA > 0 ? (255 * cIn[i] + C * A * (1 - cIn[i])) / nA : 0;
    col[i] = C; alpha[i] = nA;
  }
  const [hx, hy] = tx([0, 0]);
  return { w, h, col, alpha, hx: Math.round(hx), hy: Math.round(hy) };
}

const pxPerCss = box.w / srcW;
const cursor = a.cursor ? makeCursor(pxPerCss * Number(a["cursor-size"] ?? 1.1)) : null;

function drawCursor(out, mx, my) {
  const cx = Math.round(box.x + (mx - srcX) * pxPerCss) - cursor.hx;
  const cy = Math.round(box.y + (my - srcY) * (box.h / srcH)) - cursor.hy;
  for (let y = 0; y < cursor.h; y++) {
    const oy = cy + y;
    if (oy < box.y || oy >= box.y + box.h) continue;
    for (let x = 0; x < cursor.w; x++) {
      const ox = cx + x;
      if (ox < box.x || ox >= box.x + box.w) continue;
      const i = y * cursor.w + x, al = cursor.alpha[i];
      if (al <= 0.002) continue;
      const o = (oy * W + ox) * 3, c = cursor.col[i];
      out[o] += (c - out[o]) * al;
      out[o + 1] += (c - out[o + 1]) * al;
      out[o + 2] += (c - out[o + 2]) * al;
    }
  }
}

// ---------------------------------------------------------------------------
// Decode -> composite -> encode
// ---------------------------------------------------------------------------

const framesDir = path.join(dir, "frames");
const input = fs.existsSync(path.join(dir, "screen.mp4"))
  ? ["-i", path.join(dir, "screen.mp4")]
  : ["-framerate", String(meta.fps), "-i", path.join(framesDir, "%06d.png")];
const ds = meta.pixels ? meta.pixels.width / vw : meta.scale ?? 1;
const vf = [
  crop ? `crop=${Math.round(srcW * ds)}:${Math.round(srcH * ds)}:${Math.round(srcX * ds)}:${Math.round(srcY * ds)}` : null,
  `scale=${box.w}:${box.h}:flags=lanczos`,
  "format=rgb24",
].filter(Boolean).join(",");
const dec = spawn(ff, ["-loglevel", "error", ...input, "-vf", vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdio: ["ignore", "pipe", "inherit"] });

async function* readFrames(stream, size) {
  let buf = Buffer.allocUnsafe(size), off = 0;
  for await (const chunk of stream) {
    let p = 0;
    while (p < chunk.length) {
      const n = Math.min(size - off, chunk.length - p);
      chunk.copy(buf, off, p, p + n);
      off += n; p += n;
      if (off === size) { yield buf; buf = Buffer.allocUnsafe(size); off = 0; }
    }
  }
}

const crfMp4 = String(a["crf-mp4"] ?? 21), crfWebm = String(a["crf-webm"] ?? 34);
const tags = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];
function encoderArgs(out, w, h) {
  const g = String(fps * 2);
  const args = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${w}x${h}`, "-r", String(fps), "-i", "-",
    "-filter_complex", `[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,split=${a.av1 ? 3 : 2}[v0][v1]${a.av1 ? "[v2]" : ""}`,
    // H.264: universal fallback (Safari, old devices). faststart for the web.
    "-map", "[v0]", "-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", crfMp4, "-profile:v", "high",
    "-g", g, ...tags, "-movflags", "+faststart", "-an", out + ".mp4",
    // VP9 WebM: main format, noticeably lighter at the same look.
    "-map", "[v1]", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", crfWebm, "-deadline", "good", "-cpu-used", String(a["vp9-speed"] ?? 2),
    "-row-mt", "1", "-tile-columns", "2", "-g", g, ...tags, "-an", out + ".webm"];
  if (a.av1) args.push("-map", "[v2]", "-c:v", "libaom-av1", "-crf", "38", "-cpu-used", "6", "-row-mt", "1", "-g", g, "-an", out + ".av1.mp4");
  return args;
}

fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
const enc = sink(ff, encoderArgs(a.out, W, H));
const clean = a.clean ? sink(ff, encoderArgs(a.out + "-screen", box.w, box.h)) : null;

// Poster: first frame after the preloader is gone (+0.8 s), or --poster-at seconds.
const startAt = meta.startAt ?? 0;
const wf = meta.marks.find(m => m.step === "hover" || m.step === "move" || m.step === "tour");
const posterAt = a["poster-at"] !== undefined ? Number(a["poster-at"]) : wf ? Math.max(0, wf.t - startAt) : 1;
const posterIdx = Math.min(meta.frames.length - 1, Math.round(posterAt * fps));
let poster = null;

const out = Buffer.allocUnsafe(W * H * 3);
let i = 0;
const t0 = Date.now();
for await (const screen of readFrames(dec.stdout, box.w * box.h * 3)) {
  composite(screen, out);
  if (cursor && meta.frames[i]) drawCursor(out, ...meta.frames[i].mouse);
  if (i === posterIdx) poster = Buffer.from(out);
  await enc.write(out);
  if (clean) await clean.write(screen);
  i++;
  if (i % (fps * 5) === 0) console.log(`сборка: ${(i / fps).toFixed(0)} с  (${(i / ((Date.now() - t0) / 1000)).toFixed(1)} кадр/с)`);
}
await enc.close();
if (clean) await clean.close();

if (poster) {
  await run(ff, ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", "-",
    "-frames:v", "1", "-q:v", "3", a.out + "-poster.jpg"], { input: poster, quiet: true });
}

const files = [".webm", ".mp4", "-poster.jpg", ...(a.av1 ? [".av1.mp4"] : []), ...(clean ? ["-screen.webm", "-screen.mp4"] : [])];
console.log(`собрано: ${i} кадров, ${W}x${H}, ${fps} fps, ${(i / fps).toFixed(2)} с`);
for (const f of files) if (fs.existsSync(a.out + f)) console.log(`  ${path.basename(a.out + f)}  ${fmtBytes(fs.statSync(a.out + f).size)}`);
