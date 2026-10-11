// Deterministic 60 fps website capture.
//
// The page never runs on the wall clock: every frame we advance a virtual
// clock by exactly 1/fps, fire due timers, move the mouse / scroll along eased
// curves, and ask Chromium for exactly one rendered frame
// (HeadlessExperimental.beginFrame). CSS animations, transitions,
// requestAnimationFrame, performance.now(), Date, setTimeout and <video>
// playback all follow that clock, so the result is perfectly smooth no matter
// how slow rendering is. While requests are in flight the clock waits, so
// images, fonts and the preloader behave as on a fast connection.
//
//   node capture.mjs scenario.json out/01-home
//
// Output: out/01-home/screen.mp4 (near-lossless master of the browser
// viewport), meta.json (mouse path, fps, sizes, step marks) and, with
// "keepFrames": true, frames/000001.png ...

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { findChrome, findFfmpeg, sink } from "./lib/common.mjs";

const [, , scenarioPath, outDir] = process.argv;
if (!scenarioPath || !outDir) {
  console.error("usage: node capture.mjs scenario.json out/name");
  process.exit(2);
}

const sc = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
const fps = sc.fps ?? 60;
const vw = sc.viewport?.width ?? 1440;
const vh = sc.viewport?.height ?? 810;
const scale = typeof sc.scale === "number" ? sc.scale : 1;
const pxW = Math.round(vw * scale);
const pxH = Math.round(vh * scale);

fs.mkdirSync(outDir, { recursive: true });
const framesDir = path.join(outDir, "frames");
if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
if (sc.keepFrames) fs.mkdirSync(framesDir);

// Analytics and chat widgets: slow the page down and must not be in the shot.
const BLOCK_DEFAULT = [
  "*mc.yandex.ru*", "*mc.yandex.com*", "*yandex.ru/metrika*", "*google-analytics.com*", "*googletagmanager.com*",
  "*top-fwz1.mail.ru*", "*vk.com/rtrg*", "*connect.facebook.net*", "*code.jivosite.com*", "*code.jivo.ru*",
  "*widget.replain.cc*", "*carrotquest*", "*cdn.envybox.io*", "*callibri.ru*", "*calltouch.ru*", "*roistat*",
  "*/bitrix/js/crm/site_button*", "*b24-*.bitrix24.*", "*cdn-ru.bitrix24.ru*",
];
const block = [...(sc.blockDefault === false ? [] : BLOCK_DEFAULT), ...(sc.block ?? [])];

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

const EASE = {
  linear: t => t,
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutQuint: t => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
};
const ease = (name, t) => (EASE[name] ?? EASE.inOutCubic)(Math.min(1, Math.max(0, t)));

// ---------------------------------------------------------------------------
// Virtual time keeper, injected before any page script.
// ---------------------------------------------------------------------------

const TIME_SHIM = `(() => {
  if (window.__vt_installed) return; window.__vt_installed = true;
  let vt = 0;
  const RealDate = Date, epoch = RealDate.now();
  const realTimeout = window.setTimeout.bind(window);
  performance.now = () => vt;
  function FakeDate(...a) {
    if (!new.target) return new RealDate(epoch + vt).toString();
    return a.length ? new RealDate(...a) : new RealDate(epoch + vt);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => epoch + vt; FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  window.Date = FakeDate;

  const timers = new Map(); let nextId = 1;
  window.setTimeout = (fn, ms, ...args) => { const id = nextId++; timers.set(id, { fn, at: vt + Math.max(0, +ms || 0), args, every: 0 }); return id; };
  window.setInterval = (fn, ms, ...args) => { const id = nextId++; const every = Math.max(1, +ms || 0); timers.set(id, { fn, at: vt + every, args, every }); return id; };
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
  window.requestIdleCallback = (fn, o) => window.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 8 }), 1);
  window.cancelIdleCallback = id => window.clearTimeout(id);

  // rAF callbacks get the same clock as performance.now().
  const realRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => realRAF(() => cb(vt));

  // <video>: kept paused and seeked to the virtual time every frame.
  const SYNC = ${sc.syncVideo === false ? "false" : "true"};
  const MP = HTMLMediaElement.prototype, realPlay = MP.play, realPause = MP.pause;
  const st = v => v.__vt || (v.__vt = { on: false, t0: null, base: 0 });
  if (SYNC) {
    MP.play = function () {
      if (!(this instanceof HTMLVideoElement)) return realPlay.call(this);
      const s = st(this);
      if (!s.on) { s.on = true; s.t0 = null; s.base = this.currentTime || 0; }
      this.dispatchEvent(new Event("play")); this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    MP.pause = function () { if (this.__vt) this.__vt.on = false; return realPause.call(this); };
  }
  function syncVideos() {
    const waits = [];
    for (const v of document.querySelectorAll("video")) {
      const s = st(v);
      if (v.autoplay && !s.on && !s.started) { s.on = true; s.base = 0; }
      if (!s.on) continue;
      s.started = true;
      if (!v.paused) realPause.call(v);
      if (v.readyState < 1 || !isFinite(v.duration) || !v.duration) continue;
      if (s.t0 === null) s.t0 = vt;
      let t = s.base + (vt - s.t0) / 1000 * (v.playbackRate || 1);
      if (v.loop) t %= v.duration; else if (t >= v.duration) { t = v.duration; s.on = false; v.dispatchEvent(new Event("ended")); }
      if (Math.abs(v.currentTime - t) < 0.0005) continue;
      waits.push(new Promise(res => {
        const done = () => { v.removeEventListener("seeked", done); res(); };
        v.addEventListener("seeked", done);
        realTimeout(done, 3000);
        v.currentTime = t;
      }));
    }
    return waits.length ? Promise.all(waits) : undefined;
  }

  window.__vtAdvance = t => {
    vt = t;
    for (let guard = 0; guard < 5000; guard++) {
      let best = null, bestId = 0;
      for (const [id, tm] of timers) if (tm.at <= vt && (!best || tm.at < best.at)) { best = tm; bestId = id; }
      if (!best) break;
      if (best.every) best.at += best.every; else timers.delete(bestId);
      try { typeof best.fn === "function" ? best.fn(...best.args) : (0, eval)(String(best.fn)); } catch (e) { console.error(e); }
    }
    return SYNC ? syncVideos() : undefined;
  };

  // Extra CSS from the scenario (hide a cookie banner, a chat button, ...).
  const CSS = ${JSON.stringify([sc.css ?? "", ...(sc.hide ?? []).map(s => `${s}{display:none!important}`)].join("\n"))};
  if (CSS.trim()) {
    const add = () => { if (document.getElementById("__vt_css")) return; const el = document.createElement("style"); el.id = "__vt_css"; el.textContent = CSS; (document.head || document.documentElement).appendChild(el); };
    if (document.documentElement) add();
    document.addEventListener("DOMContentLoaded", add);
  }
})();`;

// ---------------------------------------------------------------------------
// Browser with begin-frame control
// ---------------------------------------------------------------------------

const browser = await puppeteer.launch({
  executablePath: findChrome(sc.chrome),
  headless: "shell",
  defaultViewport: null,
  args: [
    "--deterministic-mode",
    "--enable-begin-frame-control",
    "--run-all-compositor-stages-before-draw",
    "--disable-new-content-rendering-timeout",
    "--disable-threaded-animation",
    "--disable-threaded-scrolling",
    "--disable-checker-imaging",
    "--disable-image-animation-resync",
    "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--font-render-hinting=none",
    ...(sc.gpu ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
    `--window-size=${vw},${vh}`,
    ...(sc.lang ? [`--lang=${sc.lang}`] : ["--lang=ru-RU"]),
    // Chromium refuses to start as root with its sandbox (containers, CI).
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
  ],
});

const root = await browser.target().createCDPSession();
const { targetId } = await root.send("Target.createTarget", { url: "about:blank", enableBeginFrameControl: true });
const target = await browser.waitForTarget(t => t._targetId === targetId);
const page = await target.page();
const cdp = await page.createCDPSession();

await cdp.send("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: scale, mobile: false });
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
if (block.length) await cdp.send("Network.setBlockedURLs", { urls: block });
if (sc.headers) await cdp.send("Network.setExtraHTTPHeaders", { headers: sc.headers });
if (sc.cookies) await cdp.send("Network.setCookies", { cookies: sc.cookies });
await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: TIME_SHIM });
cdp.on("Runtime.exceptionThrown", e => console.warn("page error:", e.exceptionDetails?.exception?.description?.split("\n")[0]));

// Requests in flight: the virtual clock does not move while they load.
const SKIP_TYPES = new Set(["Media", "WebSocket", "EventSource", "Ping", "Prefetch", "CSPViolationReport"]);
const inflight = new Map();
cdp.on("Network.requestWillBeSent", e => {
  if (!SKIP_TYPES.has(e.type) && !e.request.url.startsWith("data:")) inflight.set(e.requestId, Date.now());
});
for (const ev of ["Network.loadingFinished", "Network.loadingFailed"]) cdp.on(ev, e => inflight.delete(e.requestId));
cdp.on("Network.webSocketCreated", e => inflight.delete(e.requestId));

const netWait = sc.netWait ?? 4000; // max real ms to hold one frame for loading
const netStale = sc.netStale ?? 12000; // a request older than this is treated as a stream / long poll
let netHeld = 0;
async function waitNetwork() {
  if (!netWait) return;
  const t0 = Date.now();
  for (;;) {
    const now = Date.now();
    for (const [id, ts] of inflight) if (now - ts > netStale) inflight.delete(id);
    if (!inflight.size || now - t0 > netWait) break;
    await new Promise(r => setTimeout(r, 10));
  }
  netHeld += Date.now() - t0;
}

// Monotonic TimeTicks base (Chromium and Node both count from the same OS clock).
const ticks0 = Number(process.hrtime.bigint() / 1000000n) + 50;
const interval = 1000 / fps;
let frameNo = 0;
let lastPng = null;

const prof = { net: 0, advance: 0, frame: 0, retries: 0, missed: 0 };
const beginFrame = (ticks, save) => cdp.send("HeadlessExperimental.beginFrame", {
  frameTimeTicks: ticks,
  interval,
  noDisplayUpdates: false,
  screenshot: save ? { format: "png", optimizeForSpeed: true } : undefined,
});

// `motion`: the page is expected to change this frame (a scroll is running).
async function renderFrame(save, motion) {
  const vt = frameNo * interval;
  let t = Date.now();
  await waitNetwork();
  prof.net += Date.now() - t; t = Date.now();
  await cdp.send("Runtime.evaluate", {
    expression: `window.__vtAdvance && window.__vtAdvance(${vt})`,
    awaitPromise: true,
  }).catch(() => {});
  prof.advance += Date.now() - t; t = Date.now();
  let res = await beginFrame(ticks0 + vt, save);
  // No new frame while the page is moving means the renderer was late with
  // its commit; ask again a hair later in compositor time (page time stays).
  for (let r = 1; save && motion && !res.screenshotData && r <= 3; r++) {
    prof.retries++;
    res = await beginFrame(ticks0 + vt + r * 0.01, save);
  }
  prof.frame += Date.now() - t;
  frameNo++;
  if (!save) return { png: null, fresh: false };
  if (res.screenshotData) lastPng = Buffer.from(res.screenshotData, "base64");
  else if (motion) prof.missed++;
  return { png: lastPng, fresh: !!res.screenshotData };
}

// ---------------------------------------------------------------------------
// Scenario: steps run one after another (or together with `"with": true`).
// ---------------------------------------------------------------------------

const mouse = { x: sc.mouseStart?.[0] ?? vw * 0.5, y: sc.mouseStart?.[1] ?? vh * 0.6 };
const meta = {
  fps, viewport: { width: vw, height: vh }, scale, pixels: { width: pxW, height: pxH },
  url: sc.url, startAt: sc.startAt ?? 0, frames: [], marks: [],
};

// Input events are acknowledged only after the renderer handled them, which in
// begin-frame mode needs a later frame; so they are sent without waiting.
let pending = [];
const input = params => pending.push(cdp.send("Input.dispatchMouseEvent", params).catch(e => console.warn("input:", e.message)));
const evalJS = async (fn, ...args) => page.evaluate(fn, ...args).catch(e => { console.warn("eval:", e.message); return null; });

// Finds a point on the page: [x, y], "selector:css", "text:visible text".
async function resolveTarget(to) {
  if (Array.isArray(to)) return { x: to[0], y: to[1] };
  if (typeof to !== "string") return { x: to.x, y: to.y };
  const r = await evalJS(spec => {
    const vis = el => {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return b.width > 2 && b.height > 2 && cs.visibility !== "hidden" && cs.display !== "none" ? b : null;
    };
    let el = null;
    if (spec.startsWith("text:")) {
      const want = spec.slice(5).trim().toLowerCase().replace(/\s+/g, " ");
      let best = null, bestScore = Infinity;
      for (const node of document.querySelectorAll("a, button, [role=button], li, span, p, div, h1, h2, h3, h4")) {
        const t = (node.innerText || "").trim().toLowerCase().replace(/\s+/g, " ");
        if (!t || !t.includes(want)) continue;
        const b = vis(node);
        if (!b) continue;
        const onScreen = b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth;
        // Prefer on-screen, exact text, links/buttons, then the smallest box.
        const score = (onScreen ? 0 : 1e9) + (t === want ? 0 : 1e7) + (/^(A|BUTTON)$/.test(node.tagName) ? 0 : 1e6) + b.width * b.height;
        if (score < bestScore) { best = node; bestScore = score; }
      }
      el = best;
    } else {
      // First visible match (pages often keep hidden copies of menus and modals).
      const all = [...document.querySelectorAll(spec.replace(/^selector:/, ""))];
      el = all.find(e => { const b = vis(e); return b && +getComputedStyle(e).opacity > 0; }) ?? all[0] ?? null;
    }
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top + scrollY, h: b.height };
  }, to);
  if (!r) console.warn("target not found:", to);
  return r;
}

// Header navigation links, left to right.
const navLinks = sel => evalJS(sel => {
  const out = [];
  for (const a of document.querySelectorAll(sel)) {
    const b = a.getBoundingClientRect();
    if (b.width < 8 || b.height < 6 || b.top > innerHeight * 0.22 || b.bottom < 0) continue;
    const text = (a.innerText || "").trim();
    if (!text || text.length > 40) continue;
    out.push({ x: b.left + b.width / 2, y: b.top + b.height / 2, text });
  }
  return out.sort((p, q) => p.x - q.x).filter((p, i, arr) => !i || Math.abs(p.x - arr[i - 1].x) > 4);
}, sel ?? "header a, nav a, header button, [class*=menu] a, [class*=header] a");

// True when the page is loaded and no fixed full-screen layer covers it.
const PRELOADER_GONE = `(() => {
  if (document.readyState !== "complete") return false;
  const W = innerWidth, H = innerHeight;
  for (const [x, y] of [[W / 2, H / 2], [W * 0.2, H * 0.25], [W * 0.8, H * 0.75]]) {
    let el = document.elementFromPoint(x, y);
    while (el && el !== document.body && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed") {
        const b = el.getBoundingClientRect();
        if (b.width >= W * 0.9 && b.height >= H * 0.9 && parseFloat(cs.opacity) > 0.05) return false;
      }
      el = el.parentElement;
    }
  }
  return true;
})()`;

const queue = (sc.steps ?? []).map(s => ({ ...s }));
let next = 0;
let running = [];

const easeKey = s => s.ease ?? (s.do === "scroll" ? "inOutSine" : "inOutCubic");
const moveDur = (a, b) => Math.min(1.4, Math.max(0.45, Math.hypot(b.x - a.x, b.y - a.y) / 900));
const scrollDur = (s, dist) => s.dur ?? Math.min(s.maxDur ?? 6, Math.max(0.6, Math.abs(dist) / (s.speed ?? 900)));

async function begin(s, t) {
  s.t0 = t;
  s.finished = false;
  meta.marks.push({ t: Math.round(t * 1000) / 1000, step: s.do, note: s.note ?? (typeof s.to === "string" ? s.to : "") });
  switch (s.do) {
    case "goto":
      await cdp.send("Page.navigate", { url: s.url ?? sc.url });
      s.finished = true;
      break;
    case "wait":
      s.end = t + (s.sec ?? 1);
      break;
    case "waitFor":
      s.end = t + (s.timeout ?? 15);
      s.cond = s.preloader ? PRELOADER_GONE : s.selector ? `!!document.querySelector(${JSON.stringify(s.selector)})` : s.js;
      break;
    case "move": {
      s.from = { ...mouse };
      s.dest = (await resolveTarget(s.to)) ?? { ...mouse };
      if (s.offset) { s.dest.x += s.offset[0]; s.dest.y += s.offset[1]; }
      s.dur = s.dur ?? moveDur(s.from, s.dest);
      s.end = t + s.dur;
      break;
    }
    case "hover": {
      // Expands into moves over each target with a dwell on every one.
      const pts = !s.targets || s.targets === "nav" ? await navLinks(s.selector) : await Promise.all(s.targets.map(resolveTarget));
      let list = (pts ?? []).filter(Boolean);
      if (s.skip) list = list.filter(p => !s.skip.some(w => (p.text ?? "").toLowerCase().includes(w.toLowerCase())));
      list = list.slice(0, s.max ?? 8);
      if (!list.length) console.warn("hover: no targets found");
      const gen = [];
      for (const p of list) {
        gen.push({ do: "move", to: [p.x, p.y], dur: s.dur, ease: s.ease, note: p.text });
        gen.push({ do: "wait", sec: s.dwell ?? 0.5 });
      }
      queue.splice(next, 0, ...gen);
      s.finished = true;
      break;
    }
    case "scroll": {
      const info = await evalJS(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }));
      s.y0 = info?.y ?? 0;
      let dist = s.by ?? 0;
      if (s.toY !== undefined) dist = s.toY - s.y0;
      else if (s.to === "end") dist = (info?.max ?? 0) - s.y0;
      else if (s.to === "top") dist = -s.y0;
      else if (typeof s.to === "string") {
        const r = await resolveTarget(s.to);
        if (r) dist = r.top - (s.margin ?? 0) - s.y0;
      }
      s.dist = dist;
      s.dur = scrollDur(s, dist);
      s.end = t + s.dur;
      s.sent = 0;
      break;
    }
    case "tour": {
      // Scrolls the whole page section by section, pausing on each.
      const stops = await evalJS((sel, minH, limit) => {
        const max = document.documentElement.scrollHeight - innerHeight;
        const ys = [];
        for (const el of document.querySelectorAll(sel)) {
          const b = el.getBoundingClientRect();
          if (b.height < innerHeight * minH) continue;
          const y = Math.min(max, Math.round(b.top + scrollY));
          if (y > scrollY + 40 && (!ys.length || y - ys[ys.length - 1] > innerHeight * 0.35)) ys.push(y);
        }
        ys.sort((a, b) => a - b);
        if (!ys.length || max - ys[ys.length - 1] > 40) ys.push(max);
        return ys.filter(y => y <= limit);
      }, s.sections ?? "section, [data-section], main > *, footer", s.minHeight ?? 0.3, s.until ?? Infinity);
      const gen = [];
      for (const y of stops ?? []) {
        gen.push({ do: "scroll", toY: y, speed: s.speed ?? 900, maxDur: s.maxDur ?? 3.2, mode: s.mode, ease: s.ease });
        gen.push({ do: "wait", sec: s.dwell ?? 0.7 });
      }
      queue.splice(next, 0, ...gen);
      s.finished = true;
      break;
    }
    case "click":
      if (s.to) { const r = await resolveTarget(s.to); if (r) { mouse.x = r.x; mouse.y = r.y; input({ type: "mouseMoved", x: mouse.x, y: mouse.y }); } }
      input({ type: "mousePressed", x: mouse.x, y: mouse.y, button: "left", clickCount: 1 });
      input({ type: "mouseReleased", x: mouse.x, y: mouse.y, button: "left", clickCount: 1 });
      s.end = t + 0.05;
      break;
    case "key": {
      // Keyboard: {"do": "key", "key": "Escape"} (also Enter, Tab, ArrowDown, ...).
      const KEYS = { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, " ": 32 };
      const code = KEYS[s.key] ?? s.key.toUpperCase().charCodeAt(0);
      const base = { key: s.key, code: s.key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
      pending.push(cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base }).catch(() => {}));
      pending.push(cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }).catch(() => {}));
      s.end = t + 0.05;
      break;
    }
    case "record":
      // Start saving frames here (e.g. once the page has settled on a block).
      recording = true;
      meta.startAt = t;
      s.finished = true;
      break;
    case "eval":
      await evalJS(s.js);
      s.finished = true;
      break;
    default:
      console.warn("unknown step:", s.do);
      s.finished = true;
  }
}

async function update(s, t) {
  if (s.finished) return;
  const k = s.dur ? Math.min(1, (t - s.t0) / s.dur) : 1;
  if (s.do === "move") {
    const e = ease(easeKey(s), k);
    mouse.x = s.from.x + (s.dest.x - s.from.x) * e;
    mouse.y = s.from.y + (s.dest.y - s.from.y) * e;
    input({ type: "mouseMoved", x: mouse.x, y: mouse.y });
    if (k >= 1) s.finished = true;
  } else if (s.do === "scroll") {
    const want = s.dist * ease(easeKey(s), k);
    if ((s.mode ?? sc.scrollMode ?? "wheel") === "wheel") {
      // Real wheel events: sites with Lenis / custom smooth scroll handle them.
      const delta = want - s.sent;
      if (Math.abs(delta) >= 0.5 || k >= 1) {
        input({ type: "mouseWheel", x: mouse.x, y: mouse.y, deltaX: 0, deltaY: delta });
        s.sent += delta;
      }
    } else {
      await evalJS(y => window.scrollTo(0, y), s.y0 + want);
    }
    if (k >= 1) s.finished = true;
  } else if (s.do === "waitFor") {
    const ok = await cdp.send("Runtime.evaluate", { expression: s.cond, returnByValue: true }).catch(() => null);
    if (ok?.result?.value === true || t >= s.end) {
      if (t >= s.end) console.warn("waitFor timed out");
      s.finished = true;
    }
  } else if (t >= (s.end ?? t)) {
    s.finished = true;
  }
}

async function tick(t) {
  for (let guard = 0; guard < 50; guard++) {
    running = running.filter(s => !s.finished);
    if (next >= queue.length) break;
    const s = queue[next];
    if (!s.with && running.length) break;
    if (s._ready === undefined) s._ready = t + (s.pause ?? 0);
    if (t < s._ready) break;
    next++;
    await begin(s, t);
    if (!s.finished) running.push(s);
  }
  for (const s of running) {
    await update(s, t);
    if (s.finished && s.do === "scroll") lastScrollEnd = t;
  }
  running = running.filter(s => !s.finished);
}
let lastScrollEnd = -1e9;

// ---------------------------------------------------------------------------
// Recording loop. Step times are seconds from navigation start; frames that
// are not saved are still rendered, so the page keeps running.
// ---------------------------------------------------------------------------

const ffmpeg = await findFfmpeg();
const master = sink(ffmpeg, [
  "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
  "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0",
  // RGB-domain H.264: no colour-matrix round trip, near lossless, small on disk.
  "-c:v", "libx264rgb", "-preset", "faster", "-crf", String(sc.masterCrf ?? 8), "-pix_fmt", "rgb24",
  "-g", String(fps * 2), path.join(outDir, "screen.mp4"),
]);

// Frames are saved from `startAt` seconds, or from a "record" step if the
// scenario has one. Recording stops after `duration` saved seconds, `tail`
// seconds after the last step, or at `maxDuration` seconds of page time.
const startAt = sc.startAt ?? 0;
const tail = sc.tail ?? 0.6;
let recording = !queue.some(st => st.do === "record");
const wantSaved = sc.duration ? Math.round(sc.duration * fps) : Infinity;
const first = Math.round(startAt * fps);
const maxTotal = first + Math.round((sc.maxDuration ?? 60) * fps);
const tStart = Date.now();
let doneAt = null;
let saved = 0;

for (let i = 0; i < maxTotal && saved < wantSaved; i++) {
  const t = i / fps;
  await tick(t);
  const allDone = next >= queue.length && running.length === 0;
  if (allDone && doneAt === null) doneAt = t;
  if (doneAt !== null && wantSaved === Infinity && t >= doneAt + tail) break;
  const visible = recording && i >= first;
  const motion = running.some(st => st.do === "scroll") || t - lastScrollEnd < 0.8;
  const { png, fresh } = await renderFrame(visible, motion);
  if (pending.length > 64) pending = pending.slice(-64);
  if (visible && png) {
    saved++;
    await master.write(png);
    if (sc.keepFrames) fs.writeFileSync(path.join(framesDir, String(saved).padStart(6, "0") + ".png"), png);
    meta.frames.push({ mouse: [Math.round(mouse.x * 10) / 10, Math.round(mouse.y * 10) / 10], ...(fresh ? {} : { same: 1 }) });
    if (saved % fps === 0) {
      const el = (Date.now() - tStart) / 1000;
      console.log(`${(saved / fps).toFixed(0)} s записано  (${(i / el).toFixed(1)} кадр/с рендер)`);
    }
  }
}

meta.duration = saved / fps;
meta.netHeldMs = netHeld;
await Promise.race([Promise.allSettled(pending), new Promise(r => setTimeout(r, 1000))]);
await master.close();
fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 1));
await browser.close();
const per = k => (prof[k] / Math.max(1, frameNo)).toFixed(0);
console.log(`время на кадр: сеть ${per("net")} мс, страница/видео ${per("advance")} мс, отрисовка ${per("frame")} мс; повторов ${prof.retries}, пропущено ${prof.missed}`);
console.log(`готово: ${saved} кадров (${(saved / fps).toFixed(2)} с) за ${((Date.now() - tStart) / 1000).toFixed(1)} с, ожидание сети ${(netHeld / 1000).toFixed(1)} с`);
for (const m of meta.marks) if (m.step !== "wait") console.log(`  ${m.t.toFixed(2)}s  ${m.step} ${m.note}`);
