/* VEXERO+ — main app */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const h = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const api = async (p, o) => { const r = await fetch(p, o); if (!r.ok) throw new Error(r.status); return r.json(); };
  const post = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).catch(() => null);
  const hash = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  const rng = seed => { let a = hash(seed); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const dayKey = () => new Date().toLocaleDateString("en-CA");
  const ls = { get: k => { try { return localStorage.getItem("vx_" + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem("vx_" + k, v); } catch {} } };
  const AV = ["😎", "🦊", "🐼", "👾", "🔥", "🦄", "🎧", "🐯"], COL = ["#e50914", "#1f6feb", "#2ea043", "#a371f7", "#f0883e", "#db61a2", "#00b8d9", "#d4a72c"];
  const PAL = [["#7a1f2b", "#1b0b14"], ["#1f3a7a", "#0b1224"], ["#1f6a5a", "#0a1a1a"], ["#6a4a1f", "#1a1209"], ["#4a1f6a", "#140b1a"], ["#2b6a1f", "#0d1a0a"], ["#6a1f55", "#1a0b15"]];
  const hoverOK = matchMedia("(hover:hover) and (pointer:fine)").matches;

  const S = { newDays: 7, movies: [], titles: [], byId: {}, epMap: {}, demo: false, views: {}, profiles: [], profile: null, state: { progress: {}, list: [], likes: {} } };
  let timers = [], io = null, popT = null, popHideT = null, popCard = null, scrollY0 = 0;

  /* ---------------- helpers ---------------- */
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800); }
  const fmtDur = s => { if (!s) return ""; const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  const fmtSize = b => { if (!b) return ""; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i > 1 ? 1 : 0) + " " + u[i]; };
  const ago = iso => { const d = (Date.now() - new Date(iso)) / 864e5; return d < 1 ? "today" : d < 2 ? "yesterday" : d < 30 ? Math.floor(d) + " days ago" : new Date(iso).toLocaleDateString(); };
  const metaInfo = t => t.type === "series" ? `${t.episodes.length} Episode${t.episodes.length > 1 ? "s" : ""}` : fmtDur(t.duration);

  /* ---------------- title model ---------------- */
  function buildTitles(movies) {
    const map = new Map(), out = [];
    for (const m of movies) {
      m.ep = m.series ? { series: m.series, s: m.season || 1, e: m.episode || 1 } : null;
      if (m.ep) {
        const k = "series:" + m.ep.series.toLowerCase();
        let t = map.get(k); if (!t) { t = { id: k, type: "series", name: m.ep.series, episodes: [] }; map.set(k, t); out.push(t); }
        t.episodes.push(m);
      } else out.push({ id: m.id, type: "movie", name: m.title, episodes: [m] });
    }
    S.epMap = {};
    for (const t of out) {
      t.episodes.sort((a, b) => t.type === "series" ? (a.ep.s - b.ep.s || a.ep.e - b.ep.e) : 0);
      const r = t.episodes[0]; t.demo = !!r.demo;
      t.featured = t.episodes.some(e => e.featured); t.special = t.episodes.some(e => e.special); t.genre = t.episodes.map(e => e.genre).find(Boolean) || null; t.genres = [...new Set([t.genre, ...t.episodes.flatMap(e => e.tags || [])].filter(Boolean))];
      t.year = r.year; t.quality = r.quality; t.desc = t.episodes.find(e => e.desc)?.desc || null; t.cast = r.cast;
      t.modified = t.episodes.reduce((a, e) => e.modified > a ? e.modified : a, "");
      t.duration = t.type === "series" ? 0 : r.duration; t.size = t.episodes.reduce((a, e) => a + (e.size || 0), 0);
      t.words = new Set(t.name.toLowerCase().split(/\W+/).filter(w => w.length > 3));
      refreshThumb(t); t.episodes.forEach(e => S.epMap[e.id] = { t, ep: e });
    }
    S.titles = out; S.byId = Object.fromEntries(out.map(t => [t.id, t]));
  }
  const refreshThumb = t => { t.thumb = t.episodes.map(e => e.cover || e.thumb).find(Boolean) || null; };

  /* ---------------- user state ---------------- */
  const prog = id => S.state.progress[id];
  const done = p => p && p.d > 0 && p.t > p.d * .95;
  const inList = t => S.state.list.includes(t.id);
  const likeOf = t => S.state.likes[t.id] || 0;
  function titleProg(t) { let best = null; for (const e of t.episodes) { const p = prog(e.id); if (p && (!best || p.at > best.p.at)) best = { ep: e, p }; } return best; }
  function target(t) {
    const b = titleProg(t);
    if (!b) return { ep: t.episodes[0], start: 0 };
    if (!done(b.p)) return { ep: b.ep, start: b.p.t, resume: true };
    const i = t.episodes.indexOf(b.ep), nx = t.episodes[i + 1];
    return nx ? { ep: nx, start: 0, next: true } : { ep: t.episodes[0], start: 0, again: true };
  }
  function toggleList(t) { const on = !inList(t); S.state.list = S.state.list.filter(x => x !== t.id); if (on) S.state.list.unshift(t.id); post(`/api/state/${S.profile.id}/list`, { id: t.id, on }); toast(on ? `Added "${t.name}" to My List` : "Removed from My List"); syncBtns(); if (location.hash.startsWith("#/mylist")) render(); }
  function setLike(t, v) { const nv = likeOf(t) === v ? 0 : v; if (nv) S.state.likes[t.id] = nv; else delete S.state.likes[t.id]; post(`/api/state/${S.profile.id}/like`, { id: t.id, v: nv }); toast(nv > 0 ? "Great — we'll show you more like this" : nv < 0 ? "Got it — fewer picks like this" : "Rating removed"); syncBtns(); }
  function syncBtns() { $$("[data-act]").forEach(b => { const t = S.byId[b.dataset.t]; if (!t) return; const a = b.dataset.act; if (a === "list") { b.classList.toggle("on", inList(t)); b.textContent = inList(t) ? "✓" : "+"; } if (a === "up") b.classList.toggle("on", likeOf(t) > 0); if (a === "down") b.classList.toggle("on", likeOf(t) < 0); }); }

  /* ---------------- recommendation engine ---------------- */
  function affinity() {
    const w = {}, add = (t, x) => t.genres.forEach(g => w[g] = (w[g] || 0) + x);
    for (const t of S.titles) {
      const b = titleProg(t); if (b && b.p.d) add(t, .5 + Math.min(1, b.p.t / b.p.d) * 1.5);
      if (likeOf(t) > 0) add(t, 3); if (likeOf(t) < 0) add(t, -4); if (inList(t)) add(t, 1.5);
    }
    return w;
  }
  function ranked() {
    const w = affinity(), r = rng(dayKey() + S.profile.id), now = Date.now(), max = Math.max(1, ...Object.values(w).map(Math.abs));
    return S.titles.map(t => {
      const a = t.genres.reduce((s, g) => s + (w[g] || 0), 0) / Math.max(1, t.genres.length), b = titleProg(t);
      const fin = b && done(b.p) ? -3 : 0, age = (now - new Date(t.modified)) / 864e5, fresh = Math.max(0, 1.2 - age / 20);
      const dis = likeOf(t) < 0 ? -6 : 0, partial = b && !done(b.p) ? .4 : 0, views = Math.log1p(S.views[t.id] || 0) * .3;
      return { t, a: Math.max(0, Math.min(1, a / max)), score: a + fin + fresh + dis + partial + views + r() * .7 };
    }).sort((x, y) => y.score - x.score);
  }
  function match(t, R) { const base = 62 + hash(t.id + S.profile.id) % 22, e = R?.find(x => x.t === t); return Math.min(99, Math.round(base + (e ? e.a * 14 : 0))); }
  function similar(t, n = 9) {
    return S.titles.filter(o => o !== t).map(o => ({ o, s: o.genres.filter(g => t.genres.includes(g)).length * 2 + [...o.words].filter(x => t.words.has(x)).length * 1.5 + (hash(t.id + o.id) % 100) / 400 }))
      .sort((a, b) => b.s - a.s).slice(0, n).map(x => x.o);
  }
  function continueList() {
    const seen = new Set(), out = [];
    Object.entries(S.state.progress).sort((a, b) => b[1].at - a[1].at).forEach(([id, p]) => {
      const m = S.epMap[id]; if (!m || seen.has(m.t.id)) return; seen.add(m.t.id);
      if (!done(p)) out.push({ t: m.t, ep: m.ep, frac: p.d ? p.t / p.d : 0 });
      else { const nx = m.t.episodes[m.t.episodes.indexOf(m.ep) + 1]; if (nx) out.push({ t: m.t, ep: nx, frac: 0, next: true }); }
    });
    return out.slice(0, 20);
  }
  function dailySpecial() {
    const r = rng("special" + dayKey()), pool = S.titles.slice(), out = [];
    pool.sort((a, b) => (titleProg(a) ? 1 : 0) - (titleProg(b) ? 1 : 0) || r() - .5);
    const pin = S.titles.find(t => t.special);
    return pin ? [pin, ...pool.filter(t => t !== pin)].slice(0, 4) : pool.slice(0, 4);
  }
  const top10 = () => { const r = rng("top" + dayKey()); return S.titles.map(t => ({ t, s: (S.views[t.id] || 0) * 3 + r() * 2 })).sort((a, b) => b.s - a.s).slice(0, 10).map(x => x.t); };

  /* ---------------- art / cards ---------------- */
  function artHTML(t, o = {}) {
    const p = PAL[hash(t.name) % PAL.length];
    return `<div class="art" data-tid="${esc(t.id)}" style="--a:${p[0]};--b:${p[1]}">${t.thumb ? `<img src="${esc(t.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<div class="art-fallback"><span>${esc(t.name)}</span></div>${o.noTitle || !t.thumb ? "" : `<div class="art-title">${esc(o.label || t.name)}</div>`}${t.quality && !o.noQ ? `<span class="q">${esc(t.quality)}</span>` : ""}${o.frac !== undefined && o.frac > 0 ? `<div class="bar"><i style="width:${Math.min(100, o.frac * 100)}%"></i></div>` : ""}</div>`;
  }
  function refreshArt(t) {
    refreshThumb(t);
    $$(`.art[data-tid="${CSS.escape(t.id)}"]`).forEach(a => {
      if (!t.thumb) return; const im = $("img", a);
      if (im) im.src = t.thumb; else { const n = document.createElement("img"); n.src = t.thumb; n.alt = ""; n.onerror = () => n.remove(); a.insertBefore(n, a.firstChild); if (!$(".art-title", a) && !a.closest(".sp-main,.m-hero")) { const d = document.createElement("div"); d.className = "art-title"; d.textContent = t.name; a.appendChild(d); } }
    });
    $$(`.bb-slide[data-btid="${CSS.escape(t.id)}"]`).forEach(s => { if (!$(".bb-img", s)) { const n = document.createElement("img"); n.className = "bb-img"; n.src = t.thumb; s.insertBefore(n, s.firstChild); } });
  }
  function card(t, o = {}) {
    const c = h(`<div class="card ${o.kind || ""}" data-tid="${esc(t.id)}">${o.rank ? `<span class="num">${o.rank}</span>` : ""}${artHTML(t, { frac: o.frac, label: o.label, noQ: !!o.rank })}</div>`);
    c.addEventListener("click", () => { hidePop(true); o.kind === "cw" ? play(t, o.ep) : openModal(t); });
    if (hoverOK) {
      c.addEventListener("mouseenter", () => { clearTimeout(popHideT); clearTimeout(popT); popT = setTimeout(() => showPop(c, t, o), popCard ? 120 : 480); });
      c.addEventListener("mouseleave", () => { clearTimeout(popT); popHideT = setTimeout(hidePop, 140); });
    }
    return c;
  }
  function rowEl(title, items, o = {}) {
    const r = h(`<section class="row"><div class="row-h"><h2>${esc(title)}</h2>${o.href ? `<a href="${o.href}"><small>Explore All ›</small></a>` : ""}</div><div class="slider"><button class="arr l" aria-label="Previous">‹</button><div class="track"></div><button class="arr r" aria-label="Next">›</button></div></section>`);
    const tr = $(".track", r);
    items.forEach((it, i) => { const t = it.t || it; const c = card(t, { kind: o.kind, rank: o.kind === "top10" ? i + 1 : 0, frac: it.frac, ep: it.ep, label: it.ep && t.type === "series" ? `${t.name} · E${it.ep.ep?.e ?? ""}` : undefined }); c.style.animationDelay = Math.min(i * 40, 400) + "ms"; c.classList.add("in-anim"); tr.appendChild(c); });
    const step = d => tr.scrollBy({ left: d * tr.clientWidth * .9, behavior: "smooth" });
    $(".arr.l", r).onclick = () => step(-1); $(".arr.r", r).onclick = () => step(1);
    tr.addEventListener("scroll", () => hidePop(true), { passive: true });
    return r;
  }

  /* ---------------- popover (hover card) ---------------- */
  const pop = $("#pop");
  function actBtns(t, big) { return `<button class="round play ${big ? "" : ""}" data-act="play" data-t="${esc(t.id)}" aria-label="Play">▶</button><button class="round sm ${inList(t) ? "on" : ""}" data-act="list" data-t="${esc(t.id)}" title="My List">${inList(t) ? "✓" : "+"}</button><button class="round sm ${likeOf(t) > 0 ? "on" : ""}" data-act="up" data-t="${esc(t.id)}" title="I like this">👍</button><button class="round sm ${likeOf(t) < 0 ? "on" : ""}" data-act="down" data-t="${esc(t.id)}" title="Not for me">👎</button>`; }
  function showPop(c, t, o) {
    if (Player.active || !$("#modal").hidden) return;
    const a = $(".art", c).getBoundingClientRect(), W = Math.max(a.width * 1.4, 290), tg = target(t);
    pop.innerHTML = `<div style="position:relative">${artHTML(t, { noTitle: true, noQ: true })}</div><div class="pop-body"><div class="pop-btns">${actBtns(t)}<button class="round sm more" data-act="more" data-t="${esc(t.id)}" title="More info">⌄</button></div><div class="pop-meta"><span class="match">${match(t)}% Match</span>${t.quality ? `<span class="badge">${esc(t.quality)}</span>` : ""}<span>${esc(metaInfo(t))}</span>${t.year ? `<span>${t.year}</span>` : ""}</div><div class="pop-gen">${t.genres.slice(0, 3).map(g => `<span>${esc(g)}</span>`).join("")}</div></div>`;
    pop.style.width = W + "px";
    const left = Math.min(Math.max(8, a.left - (W - a.width) / 2), innerWidth - W - 8), ph = pop.offsetHeight || W * .56 + 120;
    pop.style.left = left + "px"; pop.style.top = Math.min(Math.max(72, a.top - a.height * .22), innerHeight - ph - 10) + "px";
    pop.style.transformOrigin = `${a.left + a.width / 2 - left}px 30%`;
    pop.classList.add("show"); popCard = c; sfx("hover");
    $$("[data-act]", pop).forEach(b => b.onclick = e => { e.stopPropagation(); const a = b.dataset.act; if (a === "play") { hidePop(true); play(t, o.ep); } else if (a === "list") toggleList(t); else if (a === "up") setLike(t, 1); else if (a === "down") setLike(t, -1); else if (a === "more") { hidePop(true); openModal(t); } });
    pop.onclick = () => { hidePop(true); openModal(t); };
    // short muted preview
    if (!t.demo) { clearTimeout(pop._pv); pop._pv = setTimeout(() => { if (popCard !== c) return; previewInto($(".art", pop), tg.ep, 1); }, 900); }
  }
  function previewInto(box, ep, mute) {
    if (!box || !ep?.url) return; const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.src = ep.url; v.preload = "metadata"; let s = 0;
    v.onloadedmetadata = () => { s = Math.min(Math.max(v.duration * .18, 8), Math.max(0, v.duration - 25)); v.currentTime = s; v.play().catch(() => {}); };
    v.onplaying = () => v.classList.add("on"); v.ontimeupdate = () => { if (s && v.currentTime > s + 22) v.currentTime = s; };
    v.onerror = () => v.remove(); box.appendChild(v); return v;
  }
  function hidePop(now) { clearTimeout(popT); clearTimeout(pop._pv); pop.classList.remove("show"); popCard = null; const v = $("video", pop); if (v) { v.pause(); v.removeAttribute("src"); v.load(); } if (now) pop.style.transition = "none"; requestAnimationFrame(() => pop.style.transition = ""); }
  pop.addEventListener("mouseenter", () => clearTimeout(popHideT)); pop.addEventListener("mouseleave", () => popHideT = setTimeout(hidePop, 120));
  addEventListener("scroll", () => { hidePop(true); $("#nav").classList.toggle("solid", scrollY > 20); }, { passive: true });

  /* ---------------- modal ---------------- */
  function openModal(t) {
    sfx("open");
    const m = $("#modal"), R = ranked(), tg = target(t), b = titleProg(t);
    const more = similar(t, 9);
    m.innerHTML = `<div class="m-box"><button class="m-x" aria-label="Close">✕</button><div class="m-hero">${artHTML(t, { noTitle: true, noQ: true })}<div class="m-hi"><h2>${esc(t.name)}</h2><div class="btns"><button class="btn play" data-a="play">▶ ${tg.resume ? "Resume" : tg.next ? "Play Next" : "Play"}</button>${actBtns(t).replace(/<button class="round play[^>]*>.*?<\/button>/, "").replace(/round sm/g, "round")}</div></div></div>
      <div class="m-body"><div><div class="pop-meta" style="font-size:16px"><span class="match">${match(t, R)}% Match</span>${t.year ? `<span>${t.year}</span>` : ""}<span>${esc(metaInfo(t))}</span>${t.quality ? `<span class="badge">${esc(t.quality)}</span>` : ""}${t.episodes[0].subs?.length ? `<span class="badge">CC</span>` : ""}</div>${t.desc ? `<p>${esc(t.desc)}</p>` : ""}${b && !done(b.p) ? `<p style="color:#aaa;font-size:13px">You're ${Math.round(b.p.t / b.p.d * 100)}% through${t.type === "series" ? " · " + esc(b.ep.title) : ""}</p>` : ""}</div>
      <div class="m-side">${t.genres.length ? `<div><b>Genres:</b> ${t.genres.map(esc).join(", ")}</div>` : ""}${t.cast ? `<div><b>Cast:</b> ${esc([].concat(t.cast).join(", "))}</div>` : ""}<div><b>Added:</b> ${ago(t.modified)}</div>${t.size ? `<div><b>Size:</b> ${fmtSize(t.size)}</div>` : ""}</div></div>
      ${t.type === "series" ? `<div class="m-sec"><h3>Episodes</h3><div class="eps">${t.episodes.map((e, i) => { const p = prog(e.id); return `<div class="ep" data-i="${i}"><b>${e.ep.e}</b>${artHTML({ ...t, id: e.id, thumb: e.cover || e.thumb || t.thumb, name: e.title, quality: null }, { noTitle: true, frac: p && p.d ? p.t / p.d : 0 })}<div><h4><span>${esc(e.title.replace(/^.*?(S\d+E\d+|E\d+)\s*/i, "") || "Episode " + e.ep.e)}</span><small>${fmtDur(e.duration)}</small></h4><small>Season ${e.ep.s} · Episode ${e.ep.e}</small></div></div>`; }).join("")}</div></div>` : ""}
      ${more.length ? `<div class="m-sec"><h3>More Like This</h3><div class="more-grid">${more.map(o => `<div class="mcard" data-id="${esc(o.id)}">${artHTML(o, { noTitle: true, noQ: true })}<div class="in"><b>${esc(o.name)}</b><span class="match">${match(o, R)}% Match</span> · ${esc(metaInfo(o))}<br>${esc((o.desc || o.genres.join(" • ")).slice(0, 90))}</div></div>`).join("")}</div></div>` : ""}</div>`;
    m.hidden = false; m.scrollTop = 0; document.body.classList.add("lock"); hidePop(true);
    const close = () => { m.hidden = true; m.innerHTML = ""; if (!Player.active) document.body.classList.remove("lock"); };
    m._close = close;
    $(".m-x", m).onclick = close; m.onclick = e => { if (e.target === m) close(); };
    $('[data-a="play"]', m).onclick = () => { close(); play(t); };
    $$("[data-act]", m).forEach(x => x.onclick = () => { const a = x.dataset.act; if (a === "list") toggleList(t); else if (a === "up") setLike(t, 1); else if (a === "down") setLike(t, -1); });
    $$(".ep", m).forEach(e => e.onclick = () => { const ep = t.episodes[+e.dataset.i]; close(); play(t, ep); });
    $$(".mcard", m).forEach(c => c.onclick = () => openModal(S.byId[c.dataset.id]));
    if (!t.demo) setTimeout(() => { if (!m.hidden) { const v = previewInto($(".m-hero .art", m), tg.ep); } }, 1200);
  }

  /* ---------------- play ---------------- */
  function play(t, ep) {
    if (t.demo) return toast("Demo title — put real videos in the movies folder to play them 🎬");
    sfx("play"); const tg = target(t); const item = ep?.url ? ep : (ep && ep.ep) ? ep.ep : tg.ep; let first = true; hidePop(true);
    const startFor = e => { const p = prog(e.id); return p && !done(p) ? p.t : 0; };
    Player.open({
      item, title: t.name, episodes: t.type === "series" ? t.episodes : [item], startAt: startFor(item), toast, getStart: startFor,
      save: (e, tm, d) => { S.state.progress[e.id] = { t: tm, d, at: Date.now(), tid: t.id }; post(`/api/state/${S.profile.id}/progress`, { id: e.id, t: tm, d, title: t.id, first: first }); first = false; },
      onSwitch: () => { first = true; },
      onMeta: (e, d) => { if (!e.duration) e.duration = d; },
      onEnded: () => Player.close(),
      onClose: () => { if (["home", "mylist", "new", ""].includes(routeName())) render(true); }
    });
  }

  /* ---------------- pages ---------------- */
  const routeName = () => (location.hash.slice(2) || "home").split("/")[0];
  const routeArg = () => decodeURIComponent((location.hash.slice(2) || "").split("/").slice(1).join("/"));
  function clearPage() { timers.forEach(clearInterval); timers = []; io?.disconnect(); hidePop(true); }
  function observeRows(root) { io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" }); $$(".row", root).forEach(r => io.observe(r)); }

  function billboard(list, R) {
    const top = top10(), bb = h(`<div class="bb"></div>`);
    list.forEach((t, i) => {
      const p = PAL[hash(t.name) % PAL.length], tg = target(t), idx = top.indexOf(t);
      const tag = idx >= 0 && idx < 3 ? `<b>TOP ${idx + 1}</b> #${idx + 1} IN VEXERO+ TODAY` : (Date.now() - new Date(t.modified)) / 864e5 < S.newDays ? "<b>NEW</b> JUST ADDED" : tg.resume ? "<b>RESUME</b> PICK UP WHERE YOU LEFT" : "<b>★</b> PICKED FOR YOU";
      const s = h(`<div class="bb-slide ${i ? "" : "on"}" data-btid="${esc(t.id)}"><div class="bb-fb" style="--a:${p[0]};--b:${p[1]}"></div>${t.thumb ? `<img class="bb-img" src="${esc(t.thumb)}" alt="">` : ""}<div class="bb-info"><div class="bb-tag">${tag}</div><h1 class="bb-title">${esc(t.name)}</h1><div class="bb-meta"><span class="match">${match(t, R)}% Match</span>${t.year ? `<span>${t.year}</span>` : ""}${t.quality ? `<span class="badge">${esc(t.quality)}</span>` : ""}<span>${esc(metaInfo(t))}</span></div><p class="bb-desc">${esc(t.desc || t.genres.join(" • "))}</p><div class="btns"><button class="btn play">▶ ${tg.resume ? "Resume" : "Play"}</button><button class="btn info">ⓘ More Info</button></div></div></div>`);
      $(".play", s).onclick = () => play(t); $(".info", s).onclick = () => openModal(t); bb.appendChild(s);
    });
    const ctrl = h(`<div class="bb-ctrl"><button class="round" id="bbMute" aria-label="Sound">🔇</button><div class="bb-age">${list.length ? esc(list[0].genres[0] || "") : ""}</div></div>`); bb.appendChild(ctrl);
    const dots = h(`<div class="bb-dots">${list.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>`); bb.appendChild(dots);
    let cur = 0, vid = null, vt = null, muted = true;
    const go = n => {
      cur = (n + list.length) % list.length; $$(".bb-slide", bb).forEach((s, i) => s.classList.toggle("on", i === cur));
      $$("i", dots).forEach((d, i) => { d.classList.remove("on"); void d.offsetWidth; if (i === cur) d.classList.add("on"); });
      $(".bb-age", ctrl).textContent = list[cur].genres[0] || ""; $(".bb-age", ctrl).style.display = list[cur].genres[0] ? "" : "none"; stopVid(); vt = setTimeout(startVid, 2600);
    };
    const stopVid = () => { clearTimeout(vt); if (vid) { vid.classList.remove("on"); const x = vid; setTimeout(() => { x.pause(); x.remove(); }, 900); vid = null; } };
    const startVid = () => {
      const t = list[cur]; if (t.demo || Player.active || !$("#modal").hidden) return; const ep = target(t).ep;
      vid = document.createElement("video"); vid.className = "bb-vid"; vid.muted = muted; vid.playsInline = true; vid.src = ep.url; let st = 0;
      vid.onloadedmetadata = () => { st = Math.min(Math.max(vid.duration * .15, 10), Math.max(0, vid.duration - 30)); vid.currentTime = st; vid.play().catch(() => {}); };
      vid.onplaying = () => vid.classList.add("on"); vid.onerror = () => vid?.remove();
      $$(".bb-slide", bb)[cur].insertBefore(vid, $(".bb-info", $$(".bb-slide", bb)[cur]));
    };
    $("#bbMute", ctrl).onclick = e => { muted = !muted; e.currentTarget.textContent = muted ? "🔇" : "🔊"; if (vid) vid.muted = muted; };
    $$("i", dots).forEach((d, i) => d.onclick = () => go(i));
    if (list.length > 1) timers.push(setInterval(() => { if (!document.hidden && !Player.active && $("#modal").hidden) go(cur + 1); }, 9000));
    vt = setTimeout(startVid, 2600); bb._stop = stopVid;
    new MutationObserver(() => { if (!bb.isConnected) stopVid(); }).observe($("#app"), { childList: true });
    return bb;
  }

  function specialBand() {
    const sp = dailySpecial(); if (!sp.length) return null; const f = sp[0];
    const d = new Date(); d.setHours(24, 0, 0, 0);
    const el = h(`<section class="special row"><div class="sp-main">${artHTML(f, { noTitle: true, noQ: true })}<div class="sp-txt"><span class="sp-ribbon">★ Today's Special</span><h3>${esc(f.name)}</h3><div class="pop-meta"><span class="match">${match(f)}% Match</span><span>${esc(metaInfo(f))}</span>${f.year ? `<span>${f.year}</span>` : ""}</div><button class="btn play" data-p>▶ Play now</button></div></div>
      <div class="sp-side"><h4><span>${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }).toUpperCase()}</span><span>REFRESHES IN <b class="cd">--:--:--</b></span></h4>${sp.slice(1).map(t => `<div class="sp-item" data-id="${esc(t.id)}">${artHTML(t, { noTitle: true, noQ: true })}<div><b>${esc(t.name)}</b><small>${esc(t.genres[0] || "Featured")} · ${esc(metaInfo(t))}</small></div></div>`).join("")}</div></section>`);
    $(".sp-main", el).onclick = () => openModal(f); $("[data-p]", el).onclick = e => { e.stopPropagation(); play(f); };
    $$(".sp-item", el).forEach(i => i.onclick = () => openModal(S.byId[i.dataset.id]));
    const tick = () => { const s = Math.max(0, Math.floor((d - Date.now()) / 1e3)); $(".cd", el).textContent = [s / 3600, s % 3600 / 60, s % 60].map(x => String(Math.floor(x)).padStart(2, "0")).join(":"); if (s <= 0) render(); };
    tick(); timers.push(setInterval(tick, 1000)); return el;
  }

  function page(html, cls = "") { const app = $("#app"); app.innerHTML = ""; const w = h(`<div class="page-in ${cls}">${html || ""}</div>`); app.appendChild(w); return w; }
  const demoNote = () => S.demo ? `<div style="margin:0 var(--pad) 22px;padding:12px 16px;border:1px dashed #555;border-radius:8px;color:#bbb;font-size:13px;background:#1b1b1b">🎬 <b style="color:#fff">Demo mode</b> — these are sample titles. Drop your videos into the <code style="color:#f5c518">movies</code> folder (sub-folders become categories), then refresh.</div>` : "";

  function renderHome() {
    const R = ranked(), name = S.profile.name, w = page("", "");
    if (!S.titles.length) { w.innerHTML = `<div class="empty page-pad" style="padding-top:25vh"><big>🍿</big><h2>Coming soon</h2><p>New titles are on the way. Check back shortly.</p></div>`; return; }
    const feat = S.titles.filter(t => t.featured), heroList = [...feat, ...R.map(x => x.t).filter(t => !feat.includes(t))].slice(0, Math.max(4, Math.min(feat.length, 6))); w.appendChild(billboard(heroList, R));
    const rows = h(`<div class="rows"></div>`); w.appendChild(rows); rows.appendChild(h(`<div style="height:1px"></div>`));
    const dn = h(`<div>${demoNote()}</div>`); if (S.demo) rows.appendChild(dn);
    const add = (title, items, o) => { if (items.length) rows.appendChild(rowEl(title, items, o)); };
    add("Continue Watching for " + name, continueList(), { kind: "cw" });
    const sp = specialBand(); if (sp) rows.appendChild(sp);
    if (S.titles.length >= 3) add("Top 10 in VEXERO+ Today", top10(), { kind: "top10" });
    add("Top Picks for " + name, R.filter(x => !done(titleProg(x.t)?.p)).slice(0, 14).map(x => x.t));
    const hist = Object.entries(S.state.progress).sort((a, b) => b[1].at - a[1].at).map(([id]) => S.epMap[id]?.t).find(Boolean);
    if (hist) add("Because you watched " + hist.name, similar(hist, 12));
    add("My List", S.state.list.map(id => S.byId[id]).filter(Boolean));
    const r2 = rng("trend" + dayKey());
    add("Trending Now", S.titles.slice().sort((a, b) => ((S.views[b.id] || 0) + r2()) - ((S.views[a.id] || 0) + r2())).slice(0, 14));
    add("Just Added", S.titles.slice().sort((a, b) => new Date(b.modified) - new Date(a.modified)).slice(0, 14));
    add("Quick Watch · Under 30 minutes", S.titles.filter(t => t.type === "movie" && t.duration && t.duration <= 1800 || t.type === "series"));
    add("Epic Marathons · 2 hours+", S.titles.filter(t => t.type === "movie" && t.duration >= 7200));
    const gen = {}; S.titles.forEach(t => { if (t.genre) (gen[t.genre] ||= []).push(t); });
    Object.keys(gen).sort().forEach(g => gen[g].length >= 2 && add(g, gen[g], { href: "#/genre/" + encodeURIComponent(g) }));
    const r3 = rng("gems" + dayKey() + S.profile.id);
    add("Hidden Gems", S.titles.filter(t => !(S.views[t.id] > 0) && !titleProg(t)).sort(() => r3() - .5).slice(0, 12));
    observeRows(w);
    if (scrollY0) { scrollTo(0, scrollY0); scrollY0 = 0; }
  }

  function renderNew() {
    const w = page(`<div class="page-pad"><h1 class="page-title">New &amp; Popular</h1><p class="page-sub">What's fresh and what everyone's watching on VEXERO+.</p></div>`), rows = h(`<div></div>`); w.appendChild(rows);
    if (S.demo) rows.appendChild(h(`<div>${demoNote()}</div>`));
    const sp = specialBand(); if (sp) rows.appendChild(sp);
    if (S.titles.length >= 3) rows.appendChild(rowEl("Top 10 in VEXERO+ Today", top10(), { kind: "top10" }));
    rows.appendChild(rowEl("Just Added", S.titles.slice().sort((a, b) => new Date(b.modified) - new Date(a.modified)).slice(0, 16)));
    rows.appendChild(rowEl("Everyone's Watching", S.titles.slice().sort((a, b) => (S.views[b.id] || 0) - (S.views[a.id] || 0)).slice(0, 16)));
    observeRows(w);
  }
  function gridPage(title, sub, items, chips) {
    const w = page(`<div class="page-pad"><h1 class="page-title">${esc(title)}</h1><p class="page-sub">${esc(sub)}</p></div>${chips || ""}<div class="grid-wrap" style="padding:0 var(--pad)"><div class="grid"></div></div>`);
    const g = $(".grid", w); if (!items.length) g.outerHTML = `<div class="empty"><big>🍿</big>Nothing here yet.</div>`;
    items.forEach((t, i) => { const c = card(t, {}); c.style.animationDelay = Math.min(i * 30, 500) + "ms"; c.classList.add("in-anim"); g.appendChild(c); });
    return w;
  }
  function renderGenre(g) {
    const chips = `<div class="chips">${[...new Set(S.titles.map(t => t.genre).filter(Boolean))].sort().map(x => `<a class="chip ${x === g ? "on" : ""}" href="#/genre/${encodeURIComponent(x)}">${esc(x)}</a>`).join("")}</div>`;
    gridPage(g, `${S.titles.filter(t => t.genre === g).length} titles`, S.titles.filter(t => t.genre === g), chips);
  }
  function renderSearch(q) {
    q = q.trim().toLowerCase(); const items = !q ? [] : S.titles.map(t => ({ t, s: (t.name.toLowerCase().includes(q) ? 3 : 0) + (t.genres.some(g => g.toLowerCase().includes(q)) ? 2 : 0) + (String(t.year) === q ? 2 : 0) + ((t.desc || "").toLowerCase().includes(q) ? 1 : 0) })).filter(x => x.s).sort((a, b) => b.s - a.s).map(x => x.t);
    const w = gridPage(q ? `Results for "${q}"` : "Search", q ? `${items.length} match${items.length === 1 ? "" : "es"}` : "Type a title, genre or year", items);
    if (q && !items.length) $(".grid-wrap", w).innerHTML = `<div class="empty"><big>🔍</big>No matches. Try another title or genre — or hit 🎲 for a surprise.</div>`;
  }

  function render(keepScroll) {
    if (!S.profile) return; if (keepScroll === true) scrollY0 = scrollY; clearPage();
    const r = routeName(); $$("#nav .links>a").forEach(a => a.classList.toggle("on", a.dataset.r === r || (r === "" && a.dataset.r === "home")));
    if (!$("#modal").hidden) $("#modal")._close?.();
    if (r === "new") renderNew(); else if (r === "mylist") gridPage("My List", `${S.state.list.length} saved`, S.state.list.map(id => S.byId[id]).filter(Boolean));
    else if (r === "genre") renderGenre(routeArg()); else if (r === "search") renderSearch(routeArg()); else renderHome();
    if (keepScroll !== true) scrollTo(0, 0);
    syncBtns();
  }

  /* ---------------- nav ---------------- */
  function setupNav() {
    const nav = $("#nav"); nav.hidden = false; $("#profileBtn").textContent = AV[S.profile.avatar % AV.length]; $("#profileBtn").style.background = COL[S.profile.avatar % COL.length];
    $("#genreMenu").innerHTML = [...new Set(S.titles.map(t => t.genre).filter(Boolean))].sort().map(g => `<a href="#/genre/${encodeURIComponent(g)}">${esc(g)}</a>`).join("") || `<a href="#/home" style="color:#888">Add folders to create categories</a>`;
    const pm = $("#profileMenu");
    pm.innerHTML = S.profiles.filter(p => p.id !== S.profile.id).map(p => `<button data-sw="${p.id}"><span class="mini" style="background:${COL[p.avatar % COL.length]}">${AV[p.avatar % AV.length]}</span>${esc(p.name)}</button>`).join("") + `<hr><button data-m="manage">✎ Manage Profiles</button><button data-m="stats">📊 Your Stats</button><button data-m="switch">⇄ Switch Profile</button><button data-m="sound">${sfxOn ? "🔊 Sound effects: On" : "🔇 Sound effects: Off"}</button><button data-m="refresh">↻ Refresh Library</button><hr><button data-m="clear">🗑 Clear Watch History</button>`;
    $$("[data-sw]", pm).forEach(b => b.onclick = () => enter(S.profiles.find(p => p.id === b.dataset.sw)));
    $$("[data-m]", pm).forEach(b => b.onclick = () => ({ manage: () => gate(true), switch: () => gate(false), sound: () => { sfxOn = !sfxOn; ls.set("sfx", sfxOn ? "1" : "0"); ctx(); sfx("ok"); setupNav(); toast(sfxOn ? "Sound effects on" : "Sound effects off"); }, stats: stats, refresh: async () => { await loadLibrary(); setupNav(); render(); toast("Library refreshed"); }, clear: clearHist }[b.dataset.m])());
    const fresh = S.titles.filter(t => (Date.now() - new Date(t.modified)) < S.newDays * 864e5), seen = +ls.get("seen") || 0;
    $("#bellDot").style.display = fresh.some(t => new Date(t.modified) > seen) ? "block" : "none";
    $("#bellMenu").innerHTML = S.titles.slice().sort((a, b) => new Date(b.modified) - new Date(a.modified)).slice(0, 5).map(t => `<a class="bell-item" href="#/home" data-id="${esc(t.id)}">${artHTML(t, { noTitle: true, noQ: true }).replace('class="art"', 'class="art bi"')}<div><b style="font-size:13px">New: ${esc(t.name)}</b><small>${ago(t.modified)}</small></div></a>`).join("") || `<a style="color:#888">Nothing new yet</a>`;
    $$(".bell-item", $("#bellMenu")).forEach(a => a.onclick = e => { e.preventDefault(); openModal(S.byId[a.dataset.id]); });
  }
  $("#bellBtn").addEventListener("mouseenter", () => { ls.set("seen", Date.now()); $("#bellDot").style.display = "none"; });
  const search = $("#search"), sInput = $("#searchInput"); let sT;
  $("#searchBtn").onclick = () => { search.classList.add("open"); sInput.focus(); };
  sInput.addEventListener("input", () => { clearTimeout(sT); sT = setTimeout(() => { const q = sInput.value.trim(); if (q) location.replace("#/search/" + encodeURIComponent(q)); else if (routeName() === "search") location.replace("#/home"); }, 220); });
  sInput.addEventListener("blur", () => { if (!sInput.value) search.classList.remove("open"); });
  sInput.addEventListener("keydown", e => { if (e.key === "Escape") { sInput.value = ""; sInput.blur(); if (routeName() === "search") location.hash = "#/home"; } });
  $("#surpriseBtn").onclick = () => {
    const R = ranked().filter(x => !done(titleProg(x.t)?.p)); const pool = (R.length ? R : ranked()).slice(0, 8); if (!pool.length) return;
    const t = pool[Math.floor(Math.random() * pool.length)].t; toast("🎲 Tonight's pick: " + t.name); openModal(t);
  };
  $$(".dd").forEach(d => { const b = $("button", d); b?.addEventListener("click", e => { if (!hoverOK) { $$(".dd").forEach(x => x !== d && x.classList.remove("open")); d.classList.toggle("open"); } }); });
  document.addEventListener("click", e => { if (!e.target.closest(".dd")) $$(".dd.open").forEach(x => x.classList.remove("open")); const b = e.target.closest(".btn"); if (b) { const r = b.getBoundingClientRect(), s = document.createElement("span"), d = Math.max(r.width, r.height); s.className = "rip"; s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`; b.appendChild(s); setTimeout(() => s.remove(), 600); } });
  document.addEventListener("keydown", e => {
    if (Player.active) return; const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === "/" && !typing) { e.preventDefault(); $("#searchBtn").click(); }
    if (e.key === "Escape" && !$("#modal").hidden) $("#modal")._close?.();
  });

  /* ---------------- stats / history ---------------- */
  function stats() {
    const m = $("#modal"), P = Object.values(S.state.progress), secs = P.reduce((a, p) => a + p.t, 0), w = affinity(), top = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
    const started = new Set(P.map(p => p.tid).filter(Boolean)).size, fin = P.filter(done).length;
    m.innerHTML = `<div class="m-box" style="max-width:560px"><button class="m-x">✕</button><div style="padding:34px"><h2 style="margin:0 0 4px;font-size:28px">${AV[S.profile.avatar % AV.length]} ${esc(S.profile.name)}'s Stats</h2><p style="color:#aaa;margin:0 0 10px">Your VEXERO+ watch time</p><div class="stats"><div class="stat"><b>${(secs / 3600).toFixed(1)}h</b><small>Watched</small></div><div class="stat"><b>${started}</b><small>Titles started</small></div><div class="stat"><b>${fin}</b><small>Finished</small></div></div><p>Favourite genre: <b>${top ? esc(top[0]) : "—"}</b> · My List: <b>${S.state.list.length}</b></p></div></div>`;
    m.hidden = false; document.body.classList.add("lock"); const close = () => { m.hidden = true; m.innerHTML = ""; document.body.classList.remove("lock"); }; m._close = close; $(".m-x", m).onclick = close; m.onclick = e => e.target === m && close();
  }
  async function clearHist() {
    if (!confirm("Clear all watch history for this profile?")) return;
    for (const id of Object.keys(S.state.progress)) await post(`/api/state/${S.profile.id}/clear`, { id }); S.state.progress = {}; render(); toast("Watch history cleared");
  }

  /* ---------------- profiles gate ---------------- */
  /* ---------------- sound engine (Web Audio, no files needed) ---------------- */
  let AC = null, REV = null, sfxOn = ls.get("sfx") !== "0";
  function ctx() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (AC.state === "suspended") AC.resume().catch(() => {}); return AC;
  }
  function reverb(c) {
    if (REV) return REV; const len = c.sampleRate * 2.6, b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    const cv = c.createConvolver(); cv.buffer = b; const g = c.createGain(); g.gain.value = .55; cv.connect(g); g.connect(c.destination); return REV = cv;
  }
  const noiseBuf = (c, d) => { const b = c.createBuffer(1, c.sampleRate * d, c.sampleRate), a = b.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; return b; };
  function tone(c, out, type, f0, f1, t, dur, vol, atk = .005) {
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + atk); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + .05); return g;
  }
  function sweep(c, out, t, dur, f0, f1, vol, q = 1.2, shape = "up") {
    const n = c.createBufferSource(); n.buffer = noiseBuf(c, dur + .1); const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    if (shape === "up") { g.gain.exponentialRampToValueAtTime(vol, t + dur * .95); g.gain.linearRampToValueAtTime(0, t + dur); } else { g.gain.exponentialRampToValueAtTime(vol, t + dur * .25); g.gain.exponentialRampToValueAtTime(.0001, t + dur); }
    n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t + dur + .1);
  }
  let introNodes = null;
  function introSound() {
    const c = ctx(); if (!c || !sfxOn) return; const t = c.currentTime + .05, master = c.createGain(), comp = c.createDynamicsCompressor();
    master.gain.value = .85; master.connect(comp); comp.connect(c.destination); const rv = reverb(c), send = c.createGain(); send.gain.value = .6; send.connect(rv);
    introNodes = master;
    // 0.0s  deep rumble swell + rising air
    const rg = tone(c, master, "sine", 34, 70, t, 2.0, .5, 1.4); tone(c, master, "triangle", 68, 140, t, 2.0, .08, 1.5);
    sweep(c, master, t + .2, 1.8, 250, 6000, .3, .9, "up");
    // 0.65s+  six letter ticks
    for (let i = 0; i < 6; i++) { const tt = t + .78 + i * .125; tone(c, master, "triangle", 2100 + i * 90, 1300, tt, .07, .07); tone(c, send, "sine", 3200, 2600, tt, .05, .03); }
    // 2.1s  impact: sub boom + noise crack + shimmer
    const T = t + 2.12; tone(c, master, "sine", 120, 30, T, 1.7, .95, .003); tone(c, master, "sine", 62, 28, T, 2.2, .6, .003);
    const n = c.createBufferSource(); n.buffer = noiseBuf(c, .6); const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(5000, T); lp.frequency.exponentialRampToValueAtTime(120, T + .5);
    const ng = c.createGain(); ng.gain.setValueAtTime(.55, T); ng.gain.exponentialRampToValueAtTime(.001, T + .5); n.connect(lp); lp.connect(ng); ng.connect(master); ng.connect(send); n.start(T);
    [880, 1318.5, 1760, 2637, 3520].forEach((f, i) => { tone(c, send, "sine", f * 1.003, f * .998, T + .02 + i * .03, 2.4 - i * .25, .055); tone(c, master, "sine", f, f, T + .02 + i * .03, 1.2, .018); });
    tone(c, send, "sawtooth", 220, 220, T, 1.8, .03, .02);
    // 3.5s  closing whoosh as the logo flies through the screen
    sweep(c, master, t + 3.45, 1.1, 5000, 250, .35, .7, "down"); tone(c, master, "sine", 55, 40, t + 3.5, 1.2, .25, .2);
  }
  function stopIntroSound() { if (introNodes && AC) { try { introNodes.gain.cancelScheduledValues(AC.currentTime); introNodes.gain.setValueAtTime(introNodes.gain.value, AC.currentTime); introNodes.gain.linearRampToValueAtTime(0, AC.currentTime + .25); } catch {} introNodes = null; } }
  function sfx(kind) {
    if (!sfxOn || !AC || AC.state !== "running") return; const t = AC.currentTime, o = AC.destination;
    if (kind === "hover") tone(AC, o, "sine", 520, 760, t, .09, .025, .01);
    else if (kind === "open") { tone(AC, o, "triangle", 380, 620, t, .12, .045); tone(AC, o, "sine", 760, 1100, t + .04, .12, .02); }
    else if (kind === "play") { tone(AC, o, "sine", 90, 45, t, .5, .22, .004); tone(AC, o, "triangle", 440, 880, t, .18, .05); }
    else if (kind === "ok") { tone(AC, o, "sine", 660, 990, t, .14, .05); }
  }

  /* ---------------- cinematic intro ---------------- */
  function playIntro() {
    return new Promise(resolve => {
      const el = $("#intro"), logo = $("#inLogo"); el.hidden = false; el.classList.remove("play", "out");
      logo.innerHTML = "VEXERO".split("").map((ch, i) => `<span class="l" style="--i:${i}">${ch}</span>`).join("") + `<span class="plus">+</span>`;
      void el.offsetWidth; el.classList.add("play"); introSound();
      let finished = false;
      const end = quick => { if (finished) return; finished = true; clearTimeout(tt); document.removeEventListener("keydown", key); el.onclick = null; if (quick) stopIntroSound(); el.classList.add("out"); setTimeout(() => { el.hidden = true; el.classList.remove("play", "out"); }, quick ? 350 : 700); resolve(); };
      const key = e => { if (["Escape", " ", "Enter"].includes(e.key)) end(true); };
      el.onclick = () => end(true); document.addEventListener("keydown", key); const tt = setTimeout(() => end(false), 4700);
    });
  }

  function gate(manage) {
    const g = $("#gate"); g.hidden = false; $("#nav").hidden = true; hidePop(true);
    const draw = man => {
      g.innerHTML = `<h1>${man ? "Manage Profiles" : "Who's watching?"}</h1><div class="gate-list">${S.profiles.map((p, i) => `<button class="gp" data-id="${p.id}" style="animation-delay:${i * 70}ms"><div class="av" style="background:${COL[p.avatar % COL.length]}">${man ? "✎" : AV[p.avatar % AV.length]}</div><span>${esc(p.name)}</span></button>`).join("")}${S.profiles.length < 6 ? `<button class="gp add" data-add><div class="av">＋</div><span>Add Profile</span></button>` : ""}</div><button class="gate-manage">${man ? "DONE" : "MANAGE PROFILES"}</button>`;
      $(".gate-manage", g).onclick = () => draw(!man);
      $$(".gp[data-id]", g).forEach(b => b.onclick = async () => {
        const p = S.profiles.find(x => x.id === b.dataset.id);
        if (!man) { ctx(); sessionStorage.setItem("vx_in", p.id); playIntro(); return enter(p); }
        const n = prompt("Profile name (leave empty to DELETE this profile):", p.name); if (n === null) return;
        if (!n.trim()) { if (S.profiles.length > 1 && confirm("Delete " + p.name + "?")) await api("/api/profiles/" + p.id, { method: "DELETE" }).catch(() => {}); }
        else { const nx = (p.avatar + 1) % AV.length; await api("/api/profiles/" + p.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n.trim(), avatar: confirm("Change avatar too?") ? nx : p.avatar }) }).catch(() => {}); }
        S.profiles = await api("/api/profiles"); draw(true);
      });
      const add = $("[data-add]", g); if (add) add.onclick = async () => { const n = prompt("New profile name:"); if (!n || !n.trim()) return; await post("/api/profiles", { name: n.trim(), avatar: S.profiles.length % AV.length }); S.profiles = await api("/api/profiles"); draw(man); };
    };
    draw(!!manage);
  }
  async function enter(p) {
    S.profile = p; ls.set("profile", p.id); $("#gate").hidden = true;
    try { S.state = { progress: {}, list: [], likes: {}, ...(await api("/api/state/" + p.id)) }; } catch {}
    setupNav(); if (!location.hash) location.hash = "#/home"; render();
  }

  /* ---------------- boot ---------------- */
  async function loadLibrary() {
    const lib = await api("/api/library"); S.movies = lib.movies; S.demo = lib.demo; S.views = lib.views || {}; S.newDays = lib.newDays || 7; buildTitles(S.movies);
  }
  async function boot() {
    $("#app").innerHTML = `<div class="page-pad"><div class="sk" style="height:46vw;max-height:60vh;margin:-100px calc(var(--pad)*-1) 30px"></div>${[0, 1, 2].map(() => `<div style="display:flex;gap:6px;margin-bottom:34px">${Array(5).fill('<div class="sk" style="flex:1;aspect-ratio:16/9"></div>').join("")}</div>`).join("")}</div>`;
    try { [S.profiles] = await Promise.all([api("/api/profiles"), loadLibrary()]); }
    catch { $("#app").innerHTML = `<div class="empty page-pad"><big>📡</big><h2>Can't reach VEXERO+</h2><p>The server seems to be offline. Please try again in a moment.</p></div>`; return; }
    const inSession = S.profiles.find(p => p.id === sessionStorage.getItem("vx_in"));
    inSession ? enter(inSession) : gate(false);
  }
  addEventListener("hashchange", () => { if (S.profile) render(); });
  addEventListener("focus", () => { if (S.profile && !Player.active) loadLibrary().then(() => { setupNav(); }).catch(() => {}); });
  window.VX = { S, toast, post };
  boot();
})();
