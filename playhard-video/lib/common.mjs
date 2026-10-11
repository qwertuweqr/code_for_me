// Shared helpers: tool paths, process piping, small parsers.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// chrome-headless-shell: CHROME env, ./browsers (npm run setup), Playwright copy on Linux.
export function findChrome(explicit) {
  if (explicit) return explicit;
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(ROOT, "browsers", "chrome-headless-shell");
  if (fs.existsSync(base)) {
    for (const ver of fs.readdirSync(base).sort().reverse()) {
      const dir = path.join(base, ver);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const sub of fs.readdirSync(dir)) {
        for (const exe of ["chrome-headless-shell.exe", "chrome-headless-shell"]) {
          const p = path.join(dir, sub, exe);
          if (fs.existsSync(p)) return p;
        }
      }
    }
  }
  const pw = "/opt/pw-browsers";
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter(d => d.startsWith("chromium_headless_shell")).sort().reverse()) {
      const p = path.join(pw, d, "chrome-linux", "headless_shell");
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error("chrome-headless-shell не найден: выполните `npm run setup` или задайте CHROME");
}

// ffmpeg: FFMPEG env, ffmpeg-static from npm, or ffmpeg on PATH.
export async function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    const p = (await import("ffmpeg-static")).default;
    if (p && fs.existsSync(p)) return p;
  } catch {}
  return "ffmpeg";
}

export function run(cmd, args, { input, quiet } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", "pipe", quiet ? "pipe" : "inherit"] });
    const out = [];
    p.stdout.on("data", d => out.push(d));
    p.on("error", reject);
    p.on("close", code => (code ? reject(new Error(`${path.basename(cmd)} exited with ${code}`)) : resolve(Buffer.concat(out))));
    if (input) p.stdin.end(input);
  });
}

// Writable process stdin with backpressure.
export function sink(cmd, args) {
  const p = spawn(cmd, args, { stdio: ["pipe", "ignore", "inherit"] });
  const done = new Promise((resolve, reject) => {
    p.on("error", reject);
    p.on("close", code => (code ? reject(new Error(`${path.basename(cmd)} exited with ${code}`)) : resolve()));
  });
  return {
    async write(buf) {
      if (!p.stdin.write(buf)) await new Promise(r => p.stdin.once("drain", r));
    },
    async close() {
      p.stdin.end();
      await done;
    },
  };
}

export const even = v => {
  const n = Math.round(v);
  return n - (n % 2);
};

export function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (!s.startsWith("--")) { a._.push(s); continue; }
    const key = s.slice(2);
    const nxt = argv[i + 1];
    if (nxt === undefined || nxt.startsWith("--")) a[key] = true;
    else { a[key] = nxt; i++; }
  }
  return a;
}

export const nums = s => (Array.isArray(s) ? s : String(s).split(/[,x]/)).map(Number);

export const fmtBytes = n => (n > 1048576 ? (n / 1048576).toFixed(2) + " МБ" : (n / 1024).toFixed(0) + " КБ");
