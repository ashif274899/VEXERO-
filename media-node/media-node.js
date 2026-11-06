// VEXERO+ PC Media Node — your movies stay on THIS PC. Zero dependencies (Node 18+).
// Serves files only to requests carrying a signed, expiring token made by your VEXERO server (needs the same API key).
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto"), { spawn } = require("child_process");
const cfgFile = path.join(__dirname, "node-config.json");
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8")); } catch {}
const C = {
  RENDER_URL: (process.env.RENDER_URL || cfg.RENDER_URL || "").replace(/\/+$/, ""),
  API_KEY: process.env.VEXERO_API_KEY || cfg.API_KEY || "",
  MOVIES_DIR: path.resolve(process.env.MOVIES_DIR || cfg.MOVIES_DIR || path.join(__dirname, "..", "movies")),
  PORT: Number(process.env.NODE_PORT || cfg.PORT || 4040),
  PUBLIC_URL: (process.env.PUBLIC_URL || cfg.PUBLIC_URL || "").replace(/\/+$/, "")   // set this only if you use your own fixed tunnel/domain
};
if (!C.RENDER_URL || C.API_KEY.length < 24) { console.error("\n  node-config.json banao (node-config.example.json copy karo): RENDER_URL aur API_KEY (min 24 chars) zaroori hain.\n"); process.exit(1); }
fs.mkdirSync(C.MOVIES_DIR, { recursive: true });

const VIDEO = new Set([".mp4", ".m4v", ".mkv", ".webm", ".mov", ".avi", ".ogv", ".3gp"]);
const MIME = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".ogv": "video/ogg", ".3gp": "video/3gpp" };
const sig = (f, e) => crypto.createHmac("sha256", C.API_KEY).update(f + "|" + e).digest("hex");
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "range,x-api-key", "Access-Control-Expose-Headers": "content-range,content-length,accept-ranges" };
const out = (res, code, body = "") => { res.writeHead(code, { "Content-Type": "application/json", ...cors }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };

function walk(dir, rel = [], depth = 0) {
  let r = []; let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return r; }
  for (const e of ents) {
    if (e.name.startsWith(".")) continue; const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 4) r = r.concat(walk(full, [...rel, e.name], depth + 1));
    else if (e.isFile() && VIDEO.has(path.extname(e.name).toLowerCase())) r.push({ rel: [...rel, e.name].join("/"), size: fs.statSync(full).size });
  }
  return r;
}
function resolveFile(rel) {
  if (!rel || rel.includes("\0")) return null;
  const f = path.resolve(C.MOVIES_DIR, ...rel.split("/")), r = path.relative(C.MOVIES_DIR, f);
  return r && !r.startsWith("..") && !path.isAbsolute(r) && VIDEO.has(path.extname(f).toLowerCase()) ? f : null;
}

http.createServer((req, res) => {
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/list") return eq(req.headers["x-api-key"] || "", C.API_KEY) ? out(res, 200, walk(C.MOVIES_DIR)) : out(res, 401, { error: "unauthorized" });
    if (url.pathname === "/backup") {
      if (!eq(req.headers["x-api-key"] || "", C.API_KEY)) return out(res, 401, { error: "unauthorized" });
      const f = path.join(__dirname, "backup", "latest.json"); fs.mkdirSync(path.dirname(f), { recursive: true });
      if (req.method === "GET") { try { const d = fs.readFileSync(f); res.writeHead(200, { "Content-Type": "application/json", ...cors }); return res.end(d); } catch { return out(res, 404, { error: "no backup yet" }); } }
      if (req.method === "PUT") {
        const parts = []; let n = 0;
        req.on("data", c => { n += c.length; if (n > 300e6) { req.destroy(); } else parts.push(c); });
        req.on("end", () => { try { const buf = Buffer.concat(parts); JSON.parse(buf); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(path.dirname(f), "previous.json")); fs.writeFileSync(f + ".tmp", buf); fs.renameSync(f + ".tmp", f); out(res, 200, { ok: 1 }); } catch { out(res, 400, { error: "bad backup" }); } });
        return;
      }
    }
    if (url.pathname !== "/stream") return out(res, 404, { error: "not found" });
    const rel = url.searchParams.get("f") || "", exp = url.searchParams.get("e") || "", s = url.searchParams.get("s") || "";
    if (!(Number(exp) > Date.now()) || !eq(s, sig(rel, exp))) return out(res, 403, { error: "invalid or expired link" });
    const file = resolveFile(rel); let st; try { st = file && fs.statSync(file); } catch {}
    if (!st || !st.isFile()) return out(res, 404, { error: "file missing on PC" });
    let start = 0, end = st.size - 1, code = 200;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    const h = { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", ...cors };
    if (m) {
      if (m[1] === "" && m[2] !== "") start = Math.max(0, st.size - Number(m[2])); else { start = Number(m[1] || 0); if (m[2] !== "") end = Math.min(Number(m[2]), st.size - 1); }
      if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}`, ...cors }); return res.end(); }
      code = 206; h["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
    }
    h["Content-Length"] = end - start + 1; res.writeHead(code, h);
    if (req.method === "HEAD") return res.end();
    const rs = fs.createReadStream(file, { start, end }); rs.on("error", () => res.destroy()); res.on("close", () => rs.destroy()); rs.pipe(res);
  } catch (e) { if (!res.headersSent) out(res, 500, { error: "server error" }); else res.destroy(); }
}).listen(C.PORT, "127.0.0.1", () => {
  console.log(`\n  VEXERO+ PC Media Node\n  Movies folder : ${C.MOVIES_DIR}\n  Local port    : ${C.PORT}\n  Render server : ${C.RENDER_URL}\n`);
  if (C.PUBLIC_URL) return announce(C.PUBLIC_URL);
  startTunnel();
});

let current = null;
async function announce(url) {
  current = url || current; if (!current) return;
  try {
    const r = await fetch(C.RENDER_URL + "/node-api/register", { method: "POST", headers: { "content-type": "application/json", "x-api-key": C.API_KEY }, body: JSON.stringify({ url: current }) });
    if (r.ok) { if (!announce.ok) console.log("  [OK] Render server se connect ho gaya. Movies ab online hain:", current); announce.ok = true; }
    else { announce.ok = false; console.log("  [ERR] Register fail:", r.status, r.status === 401 ? "(API key Render ke VEXERO_API_KEY se match nahi karti)" : ""); }
  } catch (e) { announce.ok = false; console.log("  [ERR] Render tak nahi pahunch paya:", e.message); }
}
setInterval(() => announce(), 60e3);

function startTunnel() {
  console.log("  Cloudflare Tunnel start ho raha hai (cloudflared install hona chahiye)...");
  const p = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${C.PORT}`], { stdio: ["ignore", "pipe", "pipe"] });
  const onData = d => { const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d)); if (m && m[0] !== current) announce(m[0]); };
  p.stdout.on("data", onData); p.stderr.on("data", onData);
  p.on("error", () => { console.log("\n  cloudflared nahi mila. Install karo: winget install Cloudflare.cloudflared\n  (ya apna tunnel chalao aur node-config.json me PUBLIC_URL daalo)\n"); });
  p.on("exit", () => { console.log("  Tunnel band ho gaya, 5s me restart..."); current = null; setTimeout(startTunnel, 5000); });
  process.on("exit", () => p.kill());
}
