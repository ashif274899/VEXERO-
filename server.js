// VEXERO+ server v3 — zero dependencies (Node 18+). Public site + hidden admin panel at /admin
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");

const PORT = Number(process.env.PORT || 3030), HOST = "0.0.0.0", ROOT = __dirname;
const DATA_ROOT = process.env.DATA_DIR || path.join(ROOT, "data");
const LOCAL_ADMIN = process.env.ADMIN_LOCAL === "1";        // runs on YOUR PC only: admin panel + direct access to movies folder
let LCFG = {}; if (LOCAL_ADMIN) { try { LCFG = JSON.parse(fs.readFileSync(path.join(ROOT, "media-node", "node-config.json"), "utf8")); } catch {} }
const RENDER_URL = (process.env.RENDER_URL || LCFG.RENDER_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.VEXERO_API_KEY || LCFG.API_KEY || "";          // shared secret between this server and your PC media node
const PROD = !!process.env.RENDER || process.env.NODE_ENV === "production";
const ADMIN_ENABLED = !PROD;                                  // admin is never exposed on the online (Render) server
const STREAM_MODE = process.env.STREAM_MODE || "redirect";  // redirect (PC -> viewer direct) | proxy (PC -> Render -> viewer)
if (PROD && API_KEY.length < 24) { console.error("FATAL: set VEXERO_API_KEY (min 24 chars) in environment."); process.exit(1); }
const DIR = {
  movies: LOCAL_ADMIN && LCFG.MOVIES_DIR ? path.resolve(LCFG.MOVIES_DIR) : path.join(ROOT, "movies"), data: DATA_ROOT, images: path.join(DATA_ROOT, "images"),
  subs: path.join(DATA_ROOT, "subs"), pub: path.join(ROOT, "public"), admin: path.join(ROOT, "admin")
};
Object.values(DIR).filter(d => d !== DIR.movies).forEach(d => fs.mkdirSync(d, { recursive: true }));
if (LOCAL_ADMIN) { try { fs.mkdirSync(DIR.movies, { recursive: true }); } catch (e) { console.error("MOVIES_DIR problem:", e.message); process.exit(1); } }

const VIDEO = new Set([".mp4", ".m4v", ".mkv", ".webm", ".mov", ".avi", ".ogv", ".3gp"]);
const IMGX = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".vtt": "text/vtt; charset=utf-8",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".ogv": "video/ogg", ".3gp": "video/3gpp"
};

/* ---------------- tiny JSON stores (atomic, debounced) ---------------- */
function store(file, fallback) {
  let data = fallback, timer;
  try { data = { ...fallback, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch {}
  const save = () => {
    st.hook && st.hook();
    clearTimeout(timer);
    timer = setTimeout(() => { try { fs.writeFileSync(file + ".tmp", JSON.stringify(data)); fs.renameSync(file + ".tmp", file); } catch (e) { console.error("save failed:", e.message); } }, 200);
  };
  const st = { get data() { return data; }, save, hook: null, replace(o) { data = { ...fallback, ...o }; save(); } };
  return st;
}
const dbS = store(path.join(DIR.data, "db.json"), { profiles: [{ id: "p1", name: "Player 1", avatar: 0 }, { id: "p2", name: "Player 2", avatar: 1 }], state: {}, views: {} });
const catS = store(path.join(DIR.data, "catalog.json"), { items: [], settings: { specialId: null, newDays: 7 } });
const admS = store(path.join(DIR.data, "admin.json"), { salt: null, hash: null });
const db = () => dbS.data, cat = () => catS.data;
if (!LOCAL_ADMIN) { dbS.hook = catS.hook = admS.hook = () => scheduleBackup(); }
const stateOf = pid => (db().state[pid] ||= { progress: {}, list: [], likes: {} });

/* ---------------- PC media node link ---------------- */
const nodeS = store(path.join(DIR.data, "node.json"), { url: null, seen: 0 });
const nodeUp = () => nodeS.data.url && Date.now() - nodeS.data.seen < 150e3;
const keyEq = v => { try { const a = Buffer.from(String(v || "")), b = Buffer.from(API_KEY); return a.length === b.length && API_KEY && crypto.timingSafeEqual(a, b); } catch { return false; } };
const sign = (file, exp) => crypto.createHmac("sha256", API_KEY).update(file + "|" + exp).digest("hex");
const streamUrl = (file, ttl = 6 * 3600e3) => { const e = Date.now() + ttl; return `${nodeS.data.url}/stream?f=${encodeURIComponent(file)}&e=${e}&s=${sign(file, e)}`; };
async function viaNode(req, res, file, forceProxy = false) {
  if (!nodeUp()) return send(res, 503, { error: "Movie server (owner's PC) is offline right now. Try again later." });
  const u = streamUrl(file);
  if (STREAM_MODE !== "proxy" && !forceProxy) return send(res, 302, "", "text/plain", { Location: u });
  try {
    const h = {}; if (req.headers.range) h.range = req.headers.range;
    const r = await fetch(u, { headers: h, method: req.method === "HEAD" ? "HEAD" : "GET" });
    const out = {}; for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) if (r.headers.get(k)) out[k] = r.headers.get(k);
    res.writeHead(r.status, { ...out, "Cache-Control": "no-store" });
    if (!r.body || req.method === "HEAD") return res.end();
    const rd = r.body.getReader(); res.on("close", () => rd.cancel().catch(() => {}));
    for (;;) { const { done, value } = await rd.read(); if (done) break; if (!res.write(value)) await new Promise(ok => res.once("drain", ok)); }
    res.end();
  } catch { if (!res.headersSent) send(res, 502, { error: "PC unreachable" }); else res.destroy(); }
}
const viaNodeProxy = (req, res, f) => viaNode(req, res, f, true);
async function nodeList() {
  if (!nodeUp()) throw new Error("Your PC media node is offline. Start START-MEDIA-NODE.bat on your PC.");
  const r = await fetch(nodeS.data.url + "/list", { headers: { "x-api-key": API_KEY } });
  if (!r.ok) throw new Error("Media node rejected the request (API key mismatch?)"); return r.json();
}

/* ---------------- free-tier persistence: snapshot kept on your PC ---------------- */
let synced = false, bTimer = null;
const pristine = () => !admS.data.hash && !cat().items.length;
const readDir = d => { const o = {}; try { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isFile() && fs.statSync(p).size < 15e6) o[f] = fs.readFileSync(p).toString("base64"); } } catch {} return o; };
const writeDir = (d, o) => { fs.mkdirSync(d, { recursive: true }); for (const [f, b] of Object.entries(o || {})) fs.writeFileSync(path.join(d, path.basename(f)), Buffer.from(b, "base64")); };
function scheduleBackup() { if (!synced || !API_KEY) return; clearTimeout(bTimer); bTimer = setTimeout(pushBackup, 20e3); }
async function pushBackup() {
  if (!synced || !nodeUp() || pristine()) return;
  try {
    const body = JSON.stringify({ at: Date.now(), catalog: cat(), db: db(), admin: admS.data, images: readDir(DIR.images), subs: readDir(DIR.subs) });
    const r = await fetch(nodeS.data.url + "/backup", { method: "PUT", headers: { "x-api-key": API_KEY, "content-type": "application/json" }, body });
    if (!r.ok) console.log("backup push failed:", r.status);
  } catch (e) { console.log("backup push error:", e.message); }
}
async function syncFromNode() {
  if (synced || !API_KEY) return;
  try {
    const r = await fetch(nodeS.data.url + "/backup", { headers: { "x-api-key": API_KEY } });
    if (r.status === 404 || !pristine()) { synced = true; return; }
    if (!r.ok) return;
    const b = await r.json();
    writeDir(DIR.images, b.images); writeDir(DIR.subs, b.subs);
    catS.replace(b.catalog || {}); dbS.replace(b.db || {}); admS.replace(b.admin || {});
    if (admS.data.hash) setupCode = null;
    synced = true; console.log("Data restored from your PC backup.");
  } catch (e) { console.log("restore error:", e.message); }
}
setInterval(() => { if (nodeUp() && !synced) syncFromNode(); }, 15e3);
let pTimer;
function schedulePush() { if (!LOCAL_ADMIN || !RENDER_URL || !API_KEY) return; clearTimeout(pTimer); pTimer = setTimeout(pushCatalog, 2500); }
async function pushCatalog() {
  try {
    const body = JSON.stringify({ catalog: { items: cat().items, settings: cat().settings }, images: readDir(DIR.images), subs: readDir(DIR.subs) });
    const r = await fetch(RENDER_URL + "/node-api/catalog", { method: "POST", headers: { "x-api-key": API_KEY, "content-type": "application/json" }, body });
    console.log(r.ok ? "  [SYNC] Catalog website par bhej diya." : "  [SYNC ERR] " + r.status + (r.status === 401 ? " (API key galat)" : ""));
  } catch (e) { console.log("  [SYNC ERR] Website tak nahi pahunch paya:", e.message); }
}
if (LOCAL_ADMIN) { catS.hook = schedulePush; setTimeout(pushCatalog, 3000); setInterval(pushCatalog, 10 * 60e3); }

/* ---------------- helpers ---------------- */
const uid = () => crypto.randomBytes(6).toString("hex");
const inside = (base, target) => { const r = path.relative(base, target); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };
const send = (res, code, body, type = "application/json; charset=utf-8", extra = {}) => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req, limit = 2e6) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on("data", c => { size += c.length; if (size > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); req.on("error", reject);
});
const json = async req => { try { return JSON.parse(await readBody(req)); } catch { return {}; } };
const getItem = id => cat().items.find(x => x.id === id);
const safeRel = f => typeof f === "string" && f && !f.split("/").some(x => x === ".." || x === "") && !path.isAbsolute(f);
const videoPath = it => (it?.file && safeRel(it.file) ? it.file : null);
const pretty = file => path.basename(file, path.extname(file)).replace(/[._]+/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim() || file;

function streamFile(req, res, file, extra = {}) {
  let st; try { st = fs.statSync(file); } catch { return send(res, 404, { error: "not found" }); }
  if (!st.isFile()) return send(res, 404, { error: "not found" });
  const head = { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-store", ...extra };
  let start = 0, end = st.size - 1, code = 200;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (m) {
    if (m[1] === "" && m[2] !== "") start = Math.max(0, st.size - Number(m[2]));
    else { start = Number(m[1] || 0); if (m[2] !== "") end = Math.min(Number(m[2]), st.size - 1); }
    if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); return res.end(); }
    code = 206; head["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
  }
  head["Content-Length"] = end - start + 1; res.writeHead(code, head);
  if (req.method === "HEAD") return res.end();
  const rs = fs.createReadStream(file, { start, end }); rs.on("error", () => res.destroy()); res.on("close", () => rs.destroy()); rs.pipe(res);
}

/* ---------------- public catalogue (published items only) ---------------- */
function pubItem(it) {
  const sp = cat().settings.specialId === it.id;
  return {
    id: it.id, title: it.title, genre: it.genre, year: it.year, quality: it.quality, size: it.size || 0,
    modified: it.publishedAt || it.addedAt, cover: null, thumb: it.thumb ? "/img/" + it.thumb : null,
    url: "/media/" + it.id, subs: (it.subs || []).map((s, i) => ({ label: s.label, url: `/sub/${it.id}/${i}` })),
    duration: it.duration || null, desc: it.description || null, cast: it.cast?.length ? it.cast : null, tags: it.tags || [],
    rating: it.rating || null, introStart: it.introStart ?? null, introEnd: it.introEnd ?? null,
    series: it.series || null, season: it.season || 1, episode: it.episode || 1, featured: !!it.featured, special: sp
  };
}
const localFile = it => { const r = videoPath(it); if (!r) return null; const f = path.join(DIR.movies, ...r.split("/")); return inside(DIR.movies, f) ? f : null; };
const published = () => cat().items.filter(i => i.published && videoPath(i));

/* ---------------- admin auth ---------------- */
const sessions = new Map(), attempts = new Map();
let setupCode = null;
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString("hex");
const cookieToken = req => (/(?:^|;\s*)vx_admin=([a-f0-9]{48})/.exec(req.headers.cookie || "") || [])[1];
const authed = req => { const t = cookieToken(req), exp = t && sessions.get(t); if (exp && exp > Date.now()) return true; if (t) sessions.delete(t); return false; };
function startSession(res) {
  const t = crypto.randomBytes(24).toString("hex"); sessions.set(t, Date.now() + 7 * 864e5);
  return { "Set-Cookie": `vx_admin=${t}; HttpOnly; SameSite=Strict; Path=/;${PROD ? " Secure;" : ""} Max-Age=${7 * 86400}` };
}
if (!admS.data.hash && ADMIN_ENABLED) { setupCode = String(crypto.randomInt(100000, 999999)); }

/* ---------------- admin API ---------------- */
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const list = v => (Array.isArray(v) ? v : String(v || "").split(",")).map(x => str(x, 60)).filter(Boolean).slice(0, 30);
const num = v => (v === "" || v === null || v === undefined || !Number.isFinite(+v) ? null : +v);
function applyFields(it, d) {
  if ("title" in d) it.title = str(d.title, 160) || it.title || "Untitled";
  if ("description" in d) it.description = str(d.description, 3000);
  if ("genre" in d) it.genre = str(d.genre, 40) || null;
  if ("year" in d) it.year = num(d.year);
  if ("quality" in d) it.quality = str(d.quality, 8) || null;
  if ("rating" in d) it.rating = str(d.rating, 10) || null;
  if ("cast" in d) it.cast = list(d.cast);
  if ("tags" in d) it.tags = list(d.tags);
  if ("series" in d) it.series = str(d.series, 120) || null;
  if ("season" in d) it.season = Math.max(1, num(d.season) || 1);
  if ("episode" in d) it.episode = Math.max(1, num(d.episode) || 1);
  if ("introStart" in d) it.introStart = num(d.introStart);
  if ("introEnd" in d) it.introEnd = num(d.introEnd);
  if ("duration" in d && num(d.duration) > 0) it.duration = Math.round(+d.duration);
  if ("featured" in d) it.featured = !!d.featured;
  if ("published" in d) { const on = !!d.published; if (on && !it.published) it.publishedAt = new Date().toISOString(); it.published = on; }
  if ("thumb" in d) { const f = d.thumb ? path.basename(String(d.thumb)) : null; if (it.thumb && it.thumb !== f) rmImage(it.thumb); it.thumb = f && fs.existsSync(path.join(DIR.images, f)) ? f : null; }
  if ("subs" in d && Array.isArray(d.subs)) {
    const keep = d.subs.map(s => ({ label: str(s.label, 30) || "Subtitle", file: path.basename(String(s.file || "")) })).filter(s => fs.existsSync(path.join(DIR.subs, s.file)));
    (it.subs || []).filter(o => !keep.some(k => k.file === o.file)).forEach(o => fs.unlink(path.join(DIR.subs, o.file), () => {}));
    it.subs = keep;
  }
  return it;
}
const rmImage = f => fs.unlink(path.join(DIR.images, path.basename(f)), () => {});
function removeItem(it, deleteFile) {
  if (it.thumb) rmImage(it.thumb); (it.subs || []).forEach(s => fs.unlink(path.join(DIR.subs, s.file), () => {}));
    if (deleteFile && LOCAL_ADMIN && it.file?.startsWith("uploads/")) { const f = localFile(it); if (f) fs.unlink(f, () => {}); }
  cat().items = cat().items.filter(x => x !== it);
}
function adminView(it) {
  let size = it.size || 0, missing = false; if (LOCAL_ADMIN) { try { size = fs.statSync(localFile(it)).size; } catch { missing = true; } }
  return { ...it, size, missing, thumbUrl: it.thumb ? "/img/" + it.thumb : null };
}
const tidOf = it => it.series ? "series:" + it.series.toLowerCase() : it.id;

function walk(dir, rel = [], depth = 0) {
  let out = []; let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith(".")) continue; const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 4) out = out.concat(walk(full, [...rel, e.name], depth + 1));
    else if (e.isFile() && VIDEO.has(path.extname(e.name).toLowerCase())) out.push({ rel: [...rel, e.name].join("/"), size: fs.statSync(full).size });
  }
  return out;
}
function receive(req, res, dest, limit, payload = {}) {
  const tmp = dest + ".part"; let n = 0, dead = false; const ws = fs.createWriteStream(tmp);
  const fail = (code, msg) => { if (dead) return; dead = true; req.unpipe(ws); ws.destroy(); fs.unlink(tmp, () => {}); if (!res.headersSent) send(res, code, { error: msg }); };
  req.on("data", c => { n += c.length; if (n > limit) fail(413, "File too large"); });
  req.on("aborted", () => fail(499, "aborted")); ws.on("error", () => fail(500, "Could not write file"));
  ws.on("finish", () => { if (dead) return; fs.renameSync(tmp, dest); send(res, 200, { size: n, ...payload }); });
  req.pipe(ws);
}

async function adminApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1), [a, b, c] = parts, ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (req.method !== "GET" && req.headers["x-requested-with"] !== "vx") return send(res, 403, { error: "forbidden" });

  if (a === "status") return send(res, 200, { setup: !admS.data.hash, authed: authed(req) });
  if (a === "setup" && req.method === "POST") {
    const d = await json(req); if (admS.data.hash) return send(res, 400, { error: "Already set up" });
    if (String(d.code) !== setupCode) return send(res, 403, { error: "Wrong setup code. Check the server window." });
    if (String(d.password || "").length < 8) return send(res, 400, { error: "Password must be at least 8 characters" });
    const salt = crypto.randomBytes(16).toString("hex"); admS.data.salt = salt; admS.data.hash = hashPw(d.password, salt); admS.save(); setupCode = null;
    return send(res, 200, { ok: 1 }, undefined, startSession(res));
  }
  if (a === "login" && req.method === "POST") {
    const at = attempts.get(ip) || { n: 0, until: 0 }; if (at.until > Date.now()) return send(res, 429, { error: "Too many attempts. Wait a minute." });
    const d = await json(req); if (!admS.data.hash) return send(res, 400, { error: "Not set up yet" });
    const ok = crypto.timingSafeEqual(Buffer.from(hashPw(d.password || "", admS.data.salt)), Buffer.from(admS.data.hash));
    if (!ok) { at.n++; if (at.n >= 5) { at.until = Date.now() + 6e4; at.n = 0; } attempts.set(ip, at); return send(res, 401, { error: "Wrong password" }); }
    attempts.delete(ip); return send(res, 200, { ok: 1 }, undefined, startSession(res));
  }
  if (!authed(req)) return send(res, 401, { error: "login required" });
  if (a === "logout") { sessions.delete(cookieToken(req)); return send(res, 200, { ok: 1 }, undefined, { "Set-Cookie": "vx_admin=; Max-Age=0; Path=/" }); }

  if (a === "items" && req.method === "GET") return send(res, 200, { items: cat().items.map(adminView), settings: cat().settings, views: db().views });
  if (a === "items" && req.method === "POST" && !b) {
    const d = await json(req), f = String(d.file || "");
    if (!safeRel(f) || !VIDEO.has(path.extname(f).toLowerCase()) || (LOCAL_ADMIN && !fs.existsSync(localFile({ file: f }) || ""))) return send(res, 400, { error: "Video file not found" });
    const it = { id: uid(), file: f, size: LOCAL_ADMIN ? (() => { try { return fs.statSync(localFile({ file: f })).size; } catch { return 0; } })() : Number(d.size) || 0, title: pretty(f), description: "", genre: null, year: null, quality: null, rating: null, cast: [], tags: [], series: null, season: 1, episode: 1, subs: [], thumb: null, duration: null, introStart: null, introEnd: null, featured: false, published: false, addedAt: new Date().toISOString(), publishedAt: null };
    applyFields(it, d); cat().items.unshift(it); catS.save(); return send(res, 200, adminView(it));
  }
  if (a === "items" && b === "bulk" && req.method === "POST") {
    const d = await json(req), ids = new Set(d.ids || []), its = cat().items.filter(i => ids.has(i.id));
    for (const it of its) {
      if (d.action === "publish") applyFields(it, { published: true }); else if (d.action === "unpublish") it.published = false;
      else if (d.action === "feature") it.featured = true; else if (d.action === "unfeature") it.featured = false;
      else if (d.action === "delete") removeItem(it, !!d.deleteFiles);
    }
    catS.save(); return send(res, 200, { ok: its.length });
  }
  if (a === "items" && b) {
    const it = getItem(b); if (!it) return send(res, 404, { error: "not found" });
    if (req.method === "PUT") { applyFields(it, await json(req)); catS.save(); return send(res, 200, adminView(it)); }
    if (req.method === "DELETE") { removeItem(it, url.searchParams.get("deleteFile") === "1"); catS.save(); return send(res, 200, { ok: 1 }); }
    if (req.method === "POST" && c === "bump") { it.publishedAt = new Date().toISOString(); catS.save(); return send(res, 200, adminView(it)); }
  }
  if (a === "upload" && req.method === "POST") {
    const kind = url.searchParams.get("kind"), name = path.basename(decodeURIComponent(url.searchParams.get("name") || "file")), ext = path.extname(name).toLowerCase();
    if (kind === "video") { if (!LOCAL_ADMIN) return send(res, 400, { error: "Upload only works in the local admin." }); if (!VIDEO.has(ext)) return send(res, 400, { error: "Unsupported video type" }); fs.mkdirSync(path.join(DIR.movies, "uploads"), { recursive: true }); const f = uid() + ext; return receive(req, res, path.join(DIR.movies, "uploads", f), 60e9, { file: "uploads/" + f }); }
    if (kind === "image") { if (!IMGX.has(ext)) return send(res, 400, { error: "Use JPG, PNG or WEBP" }); const f = uid() + ext; return receive(req, res, path.join(DIR.images, f), 12e6, { file: f }); }
    if (kind === "sub") { if (![".vtt", ".srt"].includes(ext)) return send(res, 400, { error: "Use .vtt or .srt" }); const f = uid() + ext; return receive(req, res, path.join(DIR.subs, f), 3e6, { file: f, label: str(path.basename(name, ext).split(".").pop(), 30) }); }
    return send(res, 400, { error: "bad kind" });
  }
  if (a === "unregistered") {
    const have = new Set(cat().items.map(i => i.file));
    try { return send(res, 200, (LOCAL_ADMIN ? walk(DIR.movies) : await nodeList()).filter(f => !have.has(f.rel))); } catch (e) { return send(res, 503, { error: e.message }); }
  }
  if (a === "import" && req.method === "POST") {
    const d = await json(req), out = []; let avail; try { avail = new Map((LOCAL_ADMIN ? walk(DIR.movies) : await nodeList()).map(f => [f.rel, f.size])); } catch (e) { return send(res, 503, { error: e.message }); }
    for (const rel of d.files || []) {
      if (!avail.has(rel) || cat().items.some(i => i.file === rel)) continue;
      const parts = String(rel).split("/"), it = { id: uid(), file: rel, size: avail.get(rel), title: pretty(rel), description: "", genre: parts.length > 1 && parts[0] !== "uploads" ? parts[0] : null, year: Number((/\b(19\d{2}|20\d{2})\b/.exec(rel) || [])[1]) || null, quality: /2160p|4k/i.test(rel) ? "4K" : /1080p|720p/i.test(rel) ? "HD" : null, rating: null, cast: [], tags: [], series: null, season: 1, episode: 1, subs: [], thumb: null, duration: null, introStart: null, introEnd: null, featured: false, published: false, addedAt: new Date().toISOString(), publishedAt: null };
      cat().items.unshift(it); out.push(adminView(it));
    }
    catS.save(); return send(res, 200, out);
  }
  if (a === "preview" && b) { const it = getItem(b), f = videoPath(it); if (!f) return send(res, 404, {}); if (LOCAL_ADMIN) { const lf = localFile(it); return lf ? streamFile(req, res, lf) : send(res, 404, {}); } return viaNodeProxy(req, res, f); }
  if (a === "node") return send(res, 200, { online: nodeUp(), url: nodeS.data.url ? "connected" : null, mode: STREAM_MODE });
  if (a === "settings" && req.method === "PUT") {
    const d = await json(req), s = cat().settings;
    if ("specialId" in d) s.specialId = d.specialId && getItem(d.specialId) ? d.specialId : null;
    if ("newDays" in d) s.newDays = Math.min(90, Math.max(1, num(d.newDays) || 7));
    catS.save(); return send(res, 200, s);
  }
  if (a === "password" && req.method === "POST") {
    const d = await json(req);
    if (hashPw(d.current || "", admS.data.salt) !== admS.data.hash) return send(res, 403, { error: "Current password is wrong" });
    if (String(d.next || "").length < 8) return send(res, 400, { error: "New password must be at least 8 characters" });
    admS.data.hash = hashPw(d.next, admS.data.salt); admS.save(); sessions.clear(); return send(res, 200, { ok: 1 }, undefined, startSession(res));
  }
  if (a === "stats") {
    let bytes = 0; cat().items.forEach(i => { bytes += i.size || 0; });
    const views = db().views, byTitle = {};
    cat().items.forEach(i => { const k = tidOf(i); byTitle[k] ||= { name: i.series || i.title, views: views[k] || 0 }; });
    const viewers = db().profiles.map(p => { const st = db().state[p.id] || { progress: {}, list: [] }, pr = Object.values(st.progress); return { id: p.id, name: p.name, avatar: p.avatar, hours: +(pr.reduce((s, x) => s + x.t, 0) / 3600).toFixed(1), started: pr.length, list: st.list.length }; });
    return send(res, 200, { total: cat().items.length, published: cat().items.filter(i => i.published).length, bytes, plays: Object.values(views).reduce((s, x) => s + x, 0), top: Object.values(byTitle).sort((x, y) => y.views - x.views).slice(0, 6), viewers, free: os.freemem() });
  }
  if (a === "viewers" && b && req.method === "DELETE") {
    if (db().profiles.length <= 1) return send(res, 400, { error: "Keep at least one profile" });
    db().profiles = db().profiles.filter(p => p.id !== b); delete db().state[b]; dbS.save(); return send(res, 200, { ok: 1 });
  }
  return send(res, 404, { error: "unknown endpoint" });
}

/* ---------------- public API ---------------- */
function serveSub(req, res, id, idx) {
  const it = getItem(id); const sub = it?.published && it.subs?.[idx]; if (!sub) return send(res, 404, {});
  let text; try { text = fs.readFileSync(path.join(DIR.subs, sub.file), "utf8").replace(/^\uFEFF/, ""); } catch { return send(res, 404, {}); }
  if (/\.srt$/i.test(sub.file)) text = "WEBVTT\n\n" + text.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  send(res, 200, text, "text/vtt; charset=utf-8");
}
async function api(req, res, url) {
  const [a, b, c] = url.pathname.split("/").filter(Boolean).slice(1);
  if (a === "library" && req.method === "GET") return send(res, 200, { movies: published().map(pubItem), demo: false, views: db().views, newDays: cat().settings.newDays });
  if (a === "profiles") {
    if (req.method === "GET") return send(res, 200, db().profiles);
    if (req.method === "POST") {
      const d = await json(req); if (db().profiles.length >= 6) return send(res, 400, { error: "max 6 profiles" });
      const p = { id: "p" + uid().slice(0, 6), name: str(d.name, 16) || "Guest", avatar: Number(d.avatar) || 0 };
      db().profiles.push(p); dbS.save(); return send(res, 200, p);
    }
    if (req.method === "PUT" && b) {
      const d = await json(req), p = db().profiles.find(x => x.id === b); if (!p) return send(res, 404, {});
      if (d.name) p.name = str(d.name, 16); if (d.avatar !== undefined) p.avatar = Number(d.avatar) || 0; dbS.save(); return send(res, 200, p);
    }
    if (req.method === "DELETE" && b) {
      if (db().profiles.length <= 1) return send(res, 400, { error: "keep one profile" });
      db().profiles = db().profiles.filter(x => x.id !== b); delete db().state[b]; dbS.save(); return send(res, 200, { ok: 1 });
    }
  }
  if (a === "state" && b) {
    if (!db().profiles.some(p => p.id === b)) return send(res, 404, {});
    const st = stateOf(b);
    if (req.method === "GET") return send(res, 200, st);
    if (req.method === "POST") {
      const d = await json(req), id = str(d.id, 80);
      if (c === "progress" && id) {
        st.progress[id] = { t: Math.max(0, Number(d.t) || 0), d: Number(d.d) || st.progress[id]?.d || 0, at: Date.now(), tid: str(d.title, 160) };
        if (d.first) db().views[str(d.title, 160) || id] = (db().views[str(d.title, 160) || id] || 0) + 1;
      } else if (c === "list" && id) { st.list = st.list.filter(x => x !== id); if (d.on) st.list.unshift(id); }
      else if (c === "like" && id) { if (d.v) st.likes[id] = d.v > 0 ? 1 : -1; else delete st.likes[id]; }
      else if (c === "clear" && id) delete st.progress[id];
      dbS.save(); return send(res, 200, { ok: 1 });
    }
  }
  return send(res, 404, { error: "unknown endpoint" });
}

/* ---------------- router ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x"), p = decodeURIComponent(url.pathname);
    if ((p.startsWith("/admin-api/") || p === "/admin" || p.startsWith("/admin/")) && !ADMIN_ENABLED) return send(res, 404, { error: "not found" });
    if (p.startsWith("/admin-api/")) return await adminApi(req, res, url);
    if (p === "/admin" || p.startsWith("/admin/")) {
      let f = path.join(DIR.admin, p === "/admin" || p === "/admin/" ? "index.html" : p.slice(7));
      if (!inside(DIR.admin, f)) return send(res, 403, {}); return streamFile(req, res, f, { "X-Robots-Tag": "noindex" });
    }
    if (p.startsWith("/api/")) return await api(req, res, url);
    if (p === "/healthz") return send(res, 200, { ok: 1, node: nodeUp() });
    if (p === "/node-api/register" && req.method === "POST") {
      if (!keyEq(req.headers["x-api-key"])) return send(res, 401, { error: "bad api key" });
      const d = await json(req), u = String(d.url || ""); if (!/^https?:\/\/[^\s/]+$/i.test(u)) return send(res, 400, { error: "bad url" });
      nodeS.data.url = u; nodeS.data.seen = Date.now(); nodeS.save(); syncFromNode(); return send(res, 200, { ok: 1 });
    }
    if (p === "/node-api/catalog" && req.method === "POST") {
      if (!keyEq(req.headers["x-api-key"])) return send(res, 401, { error: "bad api key" });
      let b; try { b = JSON.parse(await readBody(req, 300e6)); } catch { return send(res, 400, { error: "bad body" }); }
      if (!Array.isArray(b?.catalog?.items)) return send(res, 400, { error: "bad catalog" });
      const mirror = (dir, files) => { for (const f of fs.readdirSync(dir)) if (!(f in files)) fs.unlink(path.join(dir, f), () => {}); writeDir(dir, files); };
      mirror(DIR.images, b.images || {}); mirror(DIR.subs, b.subs || {});
      catS.replace({ items: b.catalog.items, settings: b.catalog.settings || {} }); return send(res, 200, { ok: 1, items: b.catalog.items.length });
    }
    if (p.startsWith("/media/")) { const it = getItem(p.slice(7)), f = it?.published && videoPath(it); if (!f) return send(res, 404, {}); const lf = LOCAL_ADMIN && localFile(it); return lf ? streamFile(req, res, lf) : await viaNode(req, res, f); }
    if (p.startsWith("/sub/")) { const [, , id, i] = p.split("/"); return serveSub(req, res, id, Number(i)); }
    if (p.startsWith("/img/")) { const f = path.join(DIR.images, path.basename(p)); return streamFile(req, res, f, { "Cache-Control": "public, max-age=86400" }); }
    let f = path.join(DIR.pub, p === "/" ? "index.html" : p);
    if (!inside(DIR.pub, f)) return send(res, 403, {});
    if (!fs.existsSync(f)) f = path.join(DIR.pub, "index.html");
    return streamFile(req, res, f);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: "server error" }); else res.destroy(); }
});

server.listen(PORT, LOCAL_ADMIN ? "127.0.0.1" : HOST, () => {
  const lan = []; for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254.")) lan.push(i.address);
  console.log("\n  ╔══════════════════════════════════════════════╗\n  ║               V E X E R O  +                 ║\n  ╚══════════════════════════════════════════════╝");
  console.log(`   Site  : http://localhost:${PORT}`); [...new Set(lan)].forEach(a => console.log(`   Phone : http://${a}:${PORT}   (same Wi-Fi)`));
  console.log(`   Node  : ${API_KEY ? "API key set" : "NO API KEY SET (local test only)"}`);
  console.log(ADMIN_ENABLED ? `   Admin : http://localhost:${PORT}/admin   (sirf is PC par - bahar se nahi khulega)` : "   Admin : DISABLED on online server (use the local admin on your PC)");
  if (setupCode) console.log(`\n   >>> FIRST-TIME ADMIN SETUP CODE:  ${setupCode}   (enter it on the admin page to create your password)\n`);
});
