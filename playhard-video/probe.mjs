// Site reconnaissance before writing a scenario. Opens the page in real time
// and writes probe/<host>/:
//   report.json   menu items, sections, libraries (Lenis, GSAP, three.js...),
//                 videos, canvases, fixed layers (cookie banner, chat), cursor
//   load-NN.png   the first seconds of loading (preloader) every 250 ms
//   hover-NN.png  header while hovering each menu item
//   scroll-NN.png one screenshot per screen height down the page
//
//   node probe.mjs https://example.com [--width 1440 --height 810]

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { findChrome, parseArgs } from "./lib/common.mjs";

const a = parseArgs(process.argv.slice(2));
const url = a._[0];
if (!url) {
  console.error("usage: node probe.mjs https://site [--width 1440 --height 810]");
  process.exit(2);
}
const vw = Number(a.width ?? 1440), vh = Number(a.height ?? 810);
const host = new URL(url).hostname.replace(/^www\./, "");
const out = path.join(a.out ?? "probe", host);
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith(".png")) fs.unlinkSync(path.join(out, f));

const browser = await puppeteer.launch({
  executablePath: findChrome(a.chrome),
  headless: "shell",
  defaultViewport: { width: vw, height: vh, deviceScaleFactor: 1 },
  args: ["--hide-scrollbars", "--lang=ru-RU", "--autoplay-policy=no-user-gesture-required", "--mute-audio",
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e.message).split("\n")[0]));
page.on("console", m => m.type() === "error" && errors.push(m.text().slice(0, 200)));
const failed = [];
page.on("requestfailed", r => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 140)}`));

// Record which canvases get a WebGL context.
await page.evaluateOnNewDocument(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    this.dataset.probeCtx = type;
    return orig.call(this, type, ...rest);
  };
});

// Loading timeline: screenshots while the page starts.
const t0 = Date.now();
let loadedAt = null;
const nav = page.goto(url, { waitUntil: "load", timeout: 90000 }).then(r => { loadedAt = Date.now(); return r; }, e => ({ error: e.message }));
const loadShots = [];
for (let i = 0; i < 28; i++) {
  await new Promise(r => setTimeout(r, 250));
  try {
    const f = `load-${String(i).padStart(2, "0")}.png`;
    await page.screenshot({ path: path.join(out, f) });
    loadShots.push({ file: f, ms: Date.now() - t0 });
  } catch {}
}
const navRes = await nav;
const loadMs = (loadedAt ?? Date.now()) - t0;
await page.waitForNetworkIdle({ idleTime: 800, timeout: 20000 }).catch(() => {});
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: path.join(out, "first-screen.png") });

const report = await page.evaluate(() => {
  const rect = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height)]; };
  const sel = el => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
  const txt = el => (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const de = document.documentElement;

  const libs = {
    gsap: window.gsap?.version ?? null,
    ScrollTrigger: !!window.ScrollTrigger,
    lenis: !!(window.lenis || window.Lenis || de.classList.contains("lenis") || document.querySelector("[data-lenis-prevent], .lenis")),
    locomotive: !!(window.LocomotiveScroll || de.classList.contains("has-scroll-smooth") || document.querySelector("[data-scroll-container]")),
    smoothScrollbar: !!document.querySelector("[data-scrollbar], .scrollbar-track"),
    swiper: !!(window.Swiper || document.querySelector(".swiper, .swiper-container")),
    three: window.THREE?.REVISION ?? (window.__THREE__ || null),
    pixi: !!window.PIXI,
    spline: !!document.querySelector("spline-viewer, canvas#spline, [data-spline]"),
    lottie: !!(window.lottie || window.bodymovin || document.querySelector("lottie-player, dotlottie-player")),
    barba: !!window.barba,
    swup: !!window.swup,
    tilda: !!document.querySelector(".t-records, [data-tilda-page-id]"),
    webflow: !!window.Webflow,
    nuxt: !!(window.__NUXT__ || window.$nuxt),
    next: !!window.__NEXT_DATA__ || !!document.querySelector("#__next"),
    react: !!document.querySelector("[data-reactroot]") || !!window.React,
    vue: !!window.Vue || !!document.querySelector("[data-v-app]"),
    wordpress: !!document.querySelector("link[href*='wp-content']"),
    bitrix: !!window.BX,
  };

  const navItems = [];
  for (const el of document.querySelectorAll("header a, nav a, header button, [class*=menu] a, [class*=header] a")) {
    const b = el.getBoundingClientRect();
    if (b.width < 8 || b.height < 6 || b.top > innerHeight * 0.25 || b.bottom < 0) continue;
    const t = txt(el);
    if (!t || t.length > 40) continue;
    navItems.push({ text: t, href: el.getAttribute("href"), center: [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)], sel: sel(el) });
  }
  navItems.sort((p, q) => p.center[0] - q.center[0]);

  const sections = [];
  for (const el of document.querySelectorAll("section, main > *, [class*=section], [data-section], footer")) {
    const r = rect(el);
    if (r[3] < innerHeight * 0.25) continue;
    const h = el.querySelector("h1, h2, h3");
    sections.push({ sel: sel(el), top: r[1], height: r[3], heading: h ? txt(h) : txt(el).slice(0, 50) });
  }

  const fixed = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    const b = el.getBoundingClientRect();
    if (b.width < 20 || b.height < 20 || cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
    if (el.parentElement && getComputedStyle(el.parentElement).position === "fixed") continue;
    fixed.push({ sel: sel(el), position: cs.position, rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], z: cs.zIndex, text: txt(el).slice(0, 60) });
  }

  const videos = [...document.querySelectorAll("video")].map(v => ({
    src: (v.currentSrc || v.src || v.querySelector("source")?.src || "").slice(0, 140), autoplay: v.autoplay, loop: v.loop, muted: v.muted,
    paused: v.paused, readyState: v.readyState, rect: rect(v),
  }));
  const canvases = [...document.querySelectorAll("canvas")].map(c => ({ ctx: c.dataset.probeCtx ?? null, rect: rect(c), sel: sel(c) }));
  const iframes = [...document.querySelectorAll("iframe")].map(f => ({ src: (f.src || "").slice(0, 140), rect: rect(f) }));

  const cursorNone = getComputedStyle(document.body).cursor === "none" || getComputedStyle(de).cursor === "none";
  const cursorEls = [...document.querySelectorAll("[class*=cursor]")].filter(el => getComputedStyle(el).position === "fixed").map(sel).slice(0, 5);

  return {
    title: document.title, finalUrl: location.href, viewport: [innerWidth, innerHeight],
    scrollHeight: de.scrollHeight, bodyOverflow: getComputedStyle(document.body).overflow, htmlOverflow: getComputedStyle(de).overflow,
    libs, navItems, sections, fixed, videos, canvases, iframes,
    customCursor: cursorNone || cursorEls.length > 0, cursorEls,
    h264: document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"'),
    fonts: [...new Set([...document.fonts].map(f => f.family.replace(/"/g, "")))].slice(0, 12),
  };
});

// Wheel test: does a real wheel scroll move the page (and how)?
await page.mouse.move(vw / 2, vh * 0.6);
const before = await page.evaluate(() => ({ y: scrollY, first: document.querySelector("main, section, body > div")?.getBoundingClientRect().top ?? 0 }));
for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 100 }); await new Promise(r => setTimeout(r, 30)); }
await new Promise(r => setTimeout(r, 1800));
const after = await page.evaluate(() => ({ y: scrollY, first: document.querySelector("main, section, body > div")?.getBoundingClientRect().top ?? 0 }));
report.wheelTest = { wheelPx: 600, scrollYBefore: before.y, scrollYAfter: after.y, contentMovedPx: Math.round(before.first - after.first) };
report.scrollKind = after.y - before.y > 100 ? "native (scrollY меняется)" : Math.abs(after.first - before.first) > 100 ? "transform (свой скроллер, scrollY не меняется)" : "колесо не скроллит (fullpage / слайды / блокировка)";
await page.evaluate(() => window.scrollTo(0, 0));
for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: -200 }); await new Promise(r => setTimeout(r, 30)); }
await new Promise(r => setTimeout(r, 1500));

// Hover every menu item and capture the header area.
report.hoverShots = [];
for (const [i, item] of report.navItems.slice(0, 10).entries()) {
  await page.mouse.move(item.center[0], item.center[1], { steps: 8 });
  await new Promise(r => setTimeout(r, 700));
  const f = `hover-${String(i).padStart(2, "0")}.png`;
  await page.screenshot({ path: path.join(out, f), clip: { x: 0, y: 0, width: vw, height: Math.min(vh, 520) } });
  report.hoverShots.push({ file: f, text: item.text });
}
await page.mouse.move(vw / 2, vh * 0.7, { steps: 8 });

// Screens down the page with the wheel (works for native and custom scrollers).
report.scrollShots = [];
const maxScreens = Number(a.screens ?? 14);
for (let i = 0; i < maxScreens; i++) {
  const f = `scroll-${String(i).padStart(2, "0")}.png`;
  await page.screenshot({ path: path.join(out, f) });
  const y = await page.evaluate(() => scrollY);
  report.scrollShots.push({ file: f, scrollY: y });
  for (let k = 0; k < 8; k++) { await page.mouse.wheel({ deltaY: vh / 8 }); await new Promise(r => setTimeout(r, 25)); }
  await new Promise(r => setTimeout(r, 1300));
  const y2 = await page.evaluate(() => scrollY);
  if (report.scrollKind.startsWith("native") && Math.abs(y2 - y) < 5) break;
}

report.url = url;
report.loadMs = loadMs;
report.navError = navRes?.error ?? null;
report.loadShots = loadShots;
report.errors = errors.slice(0, 30);
report.failedRequests = failed.slice(0, 30);
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 1));
await browser.close();

console.log(`отчёт: ${path.join(out, "report.json")}`);
console.log(`  ${report.title} — загрузка ${(loadMs / 1000).toFixed(1)} с, высота ${report.scrollHeight}px, скролл: ${report.scrollKind}`);
console.log(`  меню: ${report.navItems.map(n => n.text).join(" | ") || "не найдено"}`);
console.log(`  библиотеки: ${Object.entries(report.libs).filter(([, v]) => v).map(([k, v]) => (v === true ? k : `${k} ${v}`)).join(", ") || "—"}`);
console.log(`  видео: ${report.videos.length}, canvas: ${report.canvases.length} (webgl: ${report.canvases.filter(c => /webgl/.test(c.ctx ?? "")).length}), свой курсор: ${report.customCursor ? "да" : "нет"}`);
if (report.fixed.length) console.log(`  фиксированные слои: ${report.fixed.map(f => f.sel).slice(0, 8).join(", ")}`);
if (report.errors.length) console.log(`  ошибки страницы: ${report.errors.length}`);
