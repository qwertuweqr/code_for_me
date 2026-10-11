// Self-test: serves the test page and makes a draft video from it.
//   npm test   ->  out/test-draft/preview.html
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { server } from "./server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = spawn(process.execPath, [path.join(root, "make.mjs"), path.join(root, "test", "test.json"), ...process.argv.slice(2)], { stdio: "inherit" });
p.on("close", code => { server.close(); process.exit(code ?? 1); });
