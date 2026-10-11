// Collects the finished videos into one folder + zip for the case page:
//
//   out/unitodi-case-videos/
//     index.html            all videos on one page, with sizes and embed code
//     ЧИТАТЬ.txt            the same as a plain list
//     slot-1200x600/        videos for the case slots (2400x1200, background + screen)
//     screen-1920x1080/     the bare screen, for another frame / background
//   out/unitodi-case-videos.zip
//
//   node pack.mjs [--name unitodi-case-videos]

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fmtBytes, parseArgs, ROOT } from "./lib/common.mjs";

const a = parseArgs(process.argv.slice(2));
const packName = a.name ?? "unitodi-case-videos";
const outRoot = path.join(ROOT, "out");
const dest = path.join(outRoot, packName);
fs.rmSync(dest, { recursive: true, force: true });
const slotDir = path.join(dest, "slot-1200x600");
const screenDir = path.join(dest, "screen-1920x1080");
fs.mkdirSync(slotDir, { recursive: true });
fs.mkdirSync(screenDir, { recursive: true });

// Where each video goes on the case page (from the call with Sabrina).
const INFO = {
  "01-home": ["Главная — скринкаст", "Загрузка и прелоадер, первый экран, наведение на меню и «Программное обеспечение» с подменю, скролл главной."],
  "02-3d-home-hero": ["3D и анимация · первый экран", "Вращающиеся терминалы на первом экране главной. Бесшовная петля."],
  "03-3d-p8bio-interface": ["3D и анимация · интерфейс P8 BIO", "Блок «Индивидуальный дизайн и анимация интерфейса». Бесшовная петля."],
  "04-3d-mf960": ["3D и анимация · терминал MF960", "Первый экран страницы MF960. Бесшовная петля."],
  "05-about-scheme": ["Схема «О компании»", "Наведение на узлы схемы и вкладки 1–3 (четвёртая на сайте не анимирована)."],
  "06-soft-card": ["Страница ПО · карточка", "Карточка uniTodi наклоняется за курсором. Петля."],
  "07-branding": ["Брендирование оборудования", "Карусель цветных терминалов под фирменный стиль клиента. Бесшовная петля."],
  "08-mf960-rotate": ["Поворот устройства", "Блок «Универсальное решение» на странице MF960: терминал плавно разворачивается."],
};

const names = fs.readdirSync(outRoot)
  .filter(n => /^\d\d-/.test(n) && !n.endsWith("-draft") && fs.existsSync(path.join(outRoot, n, n + ".webm")))
  .sort();
if (!names.length) {
  console.error("нет готовых роликов в out/ — сначала node make-all.mjs");
  process.exit(1);
}

const rows = [];
for (const n of names) {
  const src = path.join(outRoot, n);
  const meta = JSON.parse(fs.readFileSync(path.join(src, "meta.json"), "utf8"));
  const copy = (file, to) => {
    const p = path.join(src, file);
    if (!fs.existsSync(p)) return null;
    fs.copyFileSync(p, path.join(to, file));
    return fs.statSync(p).size;
  };
  const r = {
    name: n,
    title: INFO[n]?.[0] ?? n,
    text: INFO[n]?.[1] ?? "",
    duration: meta.duration,
    fps: meta.fps,
    webm: copy(n + ".webm", slotDir),
    mp4: copy(n + ".mp4", slotDir),
    poster: copy(n + "-poster.jpg", slotDir),
    swebm: copy(n + "-screen.webm", screenDir),
    smp4: copy(n + "-screen.mp4", screenDir),
    sposter: copy(n + "-screen-poster.jpg", screenDir),
  };
  rows.push(r);
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const embed = n => `<video autoplay muted loop playsinline preload="metadata" poster="${n}-poster.jpg">
  <source src="${n}.webm" type="video/webm">
  <source src="${n}.mp4" type="video/mp4">
</video>`;

const cards = rows.map(r => `
<article class="card">
  <video autoplay muted loop playsinline preload="metadata" poster="slot-1200x600/${r.name}-poster.jpg">
    <source src="slot-1200x600/${r.name}.webm" type="video/webm"><source src="slot-1200x600/${r.name}.mp4" type="video/mp4">
  </video>
  <div class="body">
    <div class="head"><h2>${esc(r.title)}</h2><span class="file">${r.name}</span></div>
    <p>${esc(r.text)}</p>
    <dl>
      <div><dt>Длина</dt><dd>${r.duration.toFixed(1)} с · ${r.fps} fps</dd></div>
      <div><dt>Слот 2400×1200</dt><dd>WebM ${fmtBytes(r.webm)} · MP4 ${fmtBytes(r.mp4)}</dd></div>
      ${r.swebm ? `<div><dt>Экран 1920×1080</dt><dd><a href="screen-1920x1080/${r.name}-screen.webm">WebM ${fmtBytes(r.swebm)}</a> · <a href="screen-1920x1080/${r.name}-screen.mp4">MP4 ${fmtBytes(r.smp4)}</a></dd></div>` : ""}
    </dl>
    <details><summary>Код вставки</summary><pre>${esc(embed(r.name))}</pre></details>
  </div>
</article>`).join("\n");

const total = rows.reduce((s, r) => s + (r.webm ?? 0), 0);
fs.writeFileSync(path.join(dest, "index.html"), `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Видео кейса unitodi</title>
<style>
  :root { --bg: #f4f3f7; --fg: #17151c; --muted: #6c6875; --card: #ffffff; --line: #e4e1ea; --accent: #7b5bdd; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f0d14; --fg: #eeecf2; --muted: #9a95a6; --card: #18151f; --line: #2a2533; --accent: #a58cf0; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header, main { max-width: 1240px; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 40px; padding-bottom: 24px; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; }
  header p { margin: 0; color: var(--muted); max-width: 760px; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 560px), 1fr)); gap: 20px; padding-bottom: 56px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .card video { display: block; width: 100%; aspect-ratio: 2 / 1; background: #000; }
  .body { padding: 16px 18px 18px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  h2 { font-size: 17px; margin: 0; }
  .file { color: var(--muted); font: 12px/1.4 ui-monospace, Consolas, monospace; }
  .body > p { margin: 6px 0 12px; color: var(--muted); }
  dl { margin: 0; display: grid; gap: 4px; }
  dl div { display: flex; gap: 10px; flex-wrap: wrap; }
  dt { color: var(--muted); min-width: 130px; }
  dd { margin: 0; }
  a { color: var(--accent); }
  details { margin-top: 12px; }
  summary { cursor: pointer; color: var(--accent); }
  pre { background: var(--bg); border-radius: 8px; padding: 10px 12px; overflow: auto; font-size: 12px; }
</style></head><body>
<header>
  <h1>Видео для кейса unitodi</h1>
  <p>${rows.length} роликов · 60 fps · слот 1200×600 в 2× (2400×1200) на фирменном фоне, экран сайта по центру, как в кейсах RhinOIL и Flat Interior. Рядом — чистый экран 1920×1080 для другой подложки. Всего WebM ${fmtBytes(total)}.</p>
</header>
<main>
${cards}
</main>
</body></html>
`);

const txt = [
  "Видео для кейса unitodi — 60 fps, без звука.",
  "",
  "slot-1200x600/     — для слотов кейса: 2400x1200 (1200x600 в 2x), фирменный фон #7b5bdd, экран сайта по центру со скруглением.",
  "screen-1920x1080/  — только экран сайта, если нужна своя подложка/рамка.",
  "Форматы: WebM (VP9) — основной, MP4 (H.264) — запасной для Safari; -poster.jpg — постер до загрузки.",
  "",
  ...rows.map(r => `${r.name}  ${r.title} — ${r.duration.toFixed(1)} с, WebM ${fmtBytes(r.webm)}, MP4 ${fmtBytes(r.mp4)}\n    ${r.text}`),
  "",
  "Код вставки (пример):",
  embed(rows[0].name),
  "",
].join("\n");
fs.writeFileSync(path.join(dest, "ЧИТАТЬ.txt"), txt.replace(/\n/g, "\r\n"));

// Zip: zip on macOS/Linux, PowerShell on Windows.
const zipPath = path.join(outRoot, packName + ".zip");
fs.rmSync(zipPath, { force: true });
let ok = false;
if (process.platform === "win32") {
  ok = spawnSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${dest}' -DestinationPath '${zipPath}'`], { stdio: "inherit" }).status === 0;
} else {
  ok = spawnSync("zip", ["-qr", zipPath, packName], { cwd: outRoot, stdio: "inherit" }).status === 0;
}
console.log(`папка: ${dest}`);
console.log(ok ? `архив: ${zipPath}  ${fmtBytes(fs.statSync(zipPath).size)}` : "архив не создан — заархивируйте папку вручную");
for (const r of rows) console.log(`  ${r.name.padEnd(24)} ${r.duration.toFixed(1).padStart(5)} с  WebM ${fmtBytes(r.webm)}`);
