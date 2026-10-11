// Test server: static files, /slow/* answered after 1.5 s (like a real CDN on a bad day).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
const types = { ".html": "text/html; charset=utf-8", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".webm": "video/webm" };
export const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const slow = url.startsWith("/slow/");
  const file = path.join(dir, (slow ? url.slice(5) : url) === "/" ? "index.html" : slow ? url.slice(5) : url);
  setTimeout(() => {
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const data = fs.readFileSync(file);
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (range) {
      const a = +range[1], b = range[2] ? +range[2] : data.length - 1;
      res.writeHead(206, { "Content-Type": types[path.extname(file)], "Content-Range": `bytes ${a}-${b}/${data.length}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1 });
      return res.end(data.subarray(a, b + 1));
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Accept-Ranges": "bytes" });
    res.end(data);
  }, slow ? 1500 : 0);
}).listen(+process.env.PORT || 8765, () => console.log("test site on http://localhost:" + (+process.env.PORT || 8765)));
