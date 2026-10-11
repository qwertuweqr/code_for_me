// Makes every case video: scenarios/NN-*.json, a few at a time.
//
//   node make-all.mjs               capture + compose all
//   node make-all.mjs --compose     re-compose all (after changing scenarios/slot.json)
//   node make-all.mjs --jobs 2      two videos in parallel (4+ CPU cores)
//   node make-all.mjs 02 05         only these numbers

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs, ROOT } from "./lib/common.mjs";

const a = parseArgs(process.argv.slice(2));
const only = a._.map(String);
const dir = path.join(ROOT, "scenarios");
const files = fs.readdirSync(dir)
  .filter(f => /^\d\d-.*\.json$/.test(f) && (!only.length || only.some(n => f.startsWith(n.padStart(2, "0")))))
  .sort();
const jobs = Number(a.jobs ?? (os.cpus().length >= 4 ? 2 : 1));
const extra = a.compose ? ["--compose"] : [];

fs.mkdirSync(path.join(ROOT, "out", "logs"), { recursive: true });
const t0 = Date.now();
const results = [];
let next = 0;

async function worker() {
  while (next < files.length) {
    const f = files[next++];
    const name = path.basename(f, ".json");
    const log = fs.openSync(path.join(ROOT, "out", "logs", name + ".log"), "w");
    const t = Date.now();
    console.log(`→ ${name}`);
    const code = await new Promise(resolve => {
      const p = spawn(process.execPath, [path.join(ROOT, "make.mjs"), path.join(dir, f), ...extra], { stdio: ["ignore", log, log] });
      p.on("close", resolve);
    });
    fs.closeSync(log);
    results.push({ name, code, min: (Date.now() - t) / 60000 });
    console.log(`${code ? "✗" : "✓"} ${name}  ${((Date.now() - t) / 60000).toFixed(1)} мин${code ? "  — см. out/logs/" + name + ".log" : ""}`);
  }
}

await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
const bad = results.filter(r => r.code);
console.log(`\nготово: ${results.length - bad.length}/${results.length} за ${((Date.now() - t0) / 60000).toFixed(1)} мин. Архив: node pack.mjs`);
process.exit(bad.length ? 1 : 0);
