/* VEXERO+ custom player — window.Player.open({...}) */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const root = $("player"), v = $("pv"), seek = $("pSeek"), prog = $("pProg"), buf = $("pBuf"), knob = $("pKnob");
  const tip = $("pTip"), tipC = $("pTipC"), tipT = $("pTipT"), menu = $("pMenu"), flash = $("pFlash");
  const ls = { get: (k, d) => { try { const x = localStorage.getItem("vx_" + k); return x === null ? d : JSON.parse(x); } catch { return d; } }, set: (k, x) => { try { localStorage.setItem("vx_" + k, JSON.stringify(x)); } catch {} } };
  const fmt = s => { if (!Number.isFinite(s)) return "0:00"; s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

  let o = null, cur = null, idleT, saveT, lastSave = 0, sleepT = null, sleepEnd = false, wake = null, nextT = null, tipVid = null, tipBusy = false, tipWant = null, dragging = false;
  const ICON = { play: "▶", pause: "❚❚" };
  const epName = e => e.title.replace(/^.*?(S\d+E\d+|E\d+)\s*/i, "") || ("Episode " + (e.ep ? e.ep.e : ""));

  /* ---------- open / close ---------- */
  function open(opts) {
    o = opts; root.hidden = false; document.body.classList.add("lock");
    v.volume = ls.get("vol", 1); v.muted = ls.get("muted", false); $("pVol").value = v.muted ? 0 : v.volume; syncVol();
    load(opts.item, opts.startAt);
    showUI(); try { navigator.wakeLock?.request("screen").then(w => wake = w).catch(() => {}); } catch {}
  }
  function load(item, startAt) {
    cur = item; clearTimeout(nextT); $("pNext").hidden = true; $("pSkip").hidden = true; $("pErr").hidden = true; closeMenu();
    [...v.querySelectorAll("track")].forEach(t => t.remove());
    v.src = item.url; v.playbackRate = ls.get("speed", 1); $("pSpeed").textContent = v.playbackRate + "×";
    (item.subs || []).forEach((s, i) => { const t = document.createElement("track"); t.kind = "subtitles"; t.label = s.label; t.src = s.url; t.srclang = "en"; t.dataset.i = i; v.appendChild(t); });
    const ep = o.episodes || [], idx = ep.findIndex(e => e.id === item.id);
    $("pTitle").textContent = o.title || item.title;
    $("pSub").textContent = ep.length > 1 ? (item.ep ? `S${item.ep.s}:E${item.ep.e}  ` : "") + epName(item) : "";
    $("pNextBtn").hidden = !(ep.length > 1 && idx < ep.length - 1); $("pEps").hidden = ep.length < 2;
    tipVid = null; $("pDur").textContent = "0:00"; $("pCur").textContent = "0:00"; prog.style.width = buf.style.width = "0"; knob.style.left = "0";
    root.classList.add("wait");
    v.onloadedmetadata = () => {
      $("pDur").textContent = fmt(v.duration);
      if (startAt > 5 && startAt < v.duration - 15) v.currentTime = startAt;
      o.onMeta?.(item, v.duration);
      restoreSubs();
    };
    v.play().catch(() => {});
    updateMedia();
  }
  function close(silent) {
    saveNow(); clearInterval(sleepT); sleepT = null; clearTimeout(nextT);
    v.pause(); v.removeAttribute("src"); v.load(); tipVid = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    root.hidden = true; document.body.classList.remove("lock"); closeMenu();
    try { wake?.release(); } catch {} wake = null;
    if (navigator.mediaSession) navigator.mediaSession.playbackState = "none";
    const cb = o?.onClose; o = null; cur = null; if (!silent) cb?.();
  }

  /* ---------- progress save ---------- */
  function saveNow() { if (cur && Number.isFinite(v.duration) && v.currentTime > 1) o?.save?.(cur, v.currentTime, v.duration); }
  setInterval(() => { if (cur && !v.paused && Date.now() - lastSave > 5000) { lastSave = Date.now(); saveNow(); } }, 1000);

  /* ---------- UI plumbing ---------- */
  function showUI() { root.classList.remove("idle"); clearTimeout(idleT); if (!v.paused && menu.hidden) idleT = setTimeout(() => root.classList.add("idle"), 3200); }
  root.addEventListener("mousemove", showUI); root.addEventListener("touchstart", showUI, { passive: true });
  function toggle() { v.paused ? v.play().catch(() => {}) : v.pause(); }
  function skip(d, side) { v.currentTime = Math.min(Math.max(0, v.currentTime + d), v.duration || 1e9); pop(d > 0 ? "+" + d : d, side); }
  function pop(txt, side) { flash.textContent = txt; flash.className = "p-flash " + (side || ""); void flash.offsetWidth; flash.classList.add("go"); }
  function syncVol() { $("pMute").textContent = v.muted || v.volume === 0 ? "🔇" : v.volume < .5 ? "🔉" : "🔊"; }
  function setVol(x) { v.volume = Math.min(1, Math.max(0, x)); v.muted = v.volume === 0; $("pVol").value = v.volume; ls.set("vol", v.volume); ls.set("muted", v.muted); syncVol(); }
  async function fs() { try { document.fullscreenElement ? await document.exitFullscreen() : await root.requestFullscreen(); } catch {} }

  /* ---------- media events ---------- */
  v.addEventListener("play", () => { $("pPlay").textContent = ICON.pause; showUI(); if (navigator.mediaSession) navigator.mediaSession.playbackState = "playing"; });
  v.addEventListener("pause", () => { $("pPlay").textContent = ICON.play; root.classList.remove("idle"); saveNow(); if (navigator.mediaSession) navigator.mediaSession.playbackState = "paused"; });
  v.addEventListener("waiting", () => root.classList.add("wait"));
  ["playing", "canplay", "seeked"].forEach(e => v.addEventListener(e, () => root.classList.remove("wait")));
  v.addEventListener("error", () => { if (cur) { root.classList.remove("wait"); $("pErr").hidden = false; } });
  v.addEventListener("timeupdate", () => {
    if (dragging || !v.duration) return;
    const p = v.currentTime / v.duration * 100; prog.style.width = p + "%"; knob.style.left = p + "%"; $("pCur").textContent = fmt(v.currentTime);
    if (v.buffered.length) { for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) buf.style.width = v.buffered.end(i) / v.duration * 100 + "%"; }
    const sk = $("pSkip"), is = cur?.introStart ?? 0, ie = cur?.introEnd;
    sk.hidden = !(ie && v.currentTime >= is && v.currentTime < ie - 1);
    const hasNext = !$("pNextBtn").hidden, left = v.duration - v.currentTime;
    if (hasNext && left < 30 && left > 0 && $("pNext").hidden && !nextT) showNext(false);
    else if (left >= 35 && !$("pNext").hidden) { $("pNext").hidden = true; }
  });
  v.addEventListener("progress", () => v.dispatchEvent(new Event("timeupdate")));
  v.addEventListener("ended", () => {
    saveNow();
    if (sleepEnd) { sleepEnd = false; $("pSleep").style.color = ""; close(); o = null; return; }
    if (!$("pNextBtn").hidden) showNext(true); else { o?.onEnded?.(cur); }
  });
  function nextItem() { const ep = o?.episodes || [], i = ep.findIndex(e => e.id === cur.id); return ep[i + 1]; }
  function showNext(auto) {
    const n = nextItem(); if (!n) return; const box = $("pNext");
    $("pNextName").textContent = (n.ep ? `E${n.ep.e} · ` : "") + epName(n);
    box.hidden = false; box.classList.remove("count");
    if (auto) { void box.offsetWidth; box.classList.add("count"); nextT = setTimeout(goNext, 8000); }
  }
  function goNext() { clearTimeout(nextT); nextT = null; const n = nextItem(); if (!n) return; saveNow(); o.onSwitch?.(n); load(n, o.getStart?.(n) || 0); }
  $("pNextPlay").onclick = goNext; $("pNextBtn").onclick = goNext;
  $("pNextCancel").onclick = () => { clearTimeout(nextT); nextT = 1; $("pNext").hidden = true; };
  $("pSkip").onclick = () => { v.currentTime = cur.introEnd; };

  /* ---------- seek bar + preview thumbnails ---------- */
  const frac = e => { const r = seek.getBoundingClientRect(), x = (e.touches ? e.touches[0] : e).clientX; return Math.min(1, Math.max(0, (x - r.left) / r.width)); };
  function moveTip(e) {
    if (!v.duration) return; const f = frac(e), r = seek.getBoundingClientRect(), half = 114;
    const px = Math.min(Math.max(f * r.width, half), r.width - half); tip.style.left = px + "px"; tipT.textContent = fmt(f * v.duration);
    wantFrame(f * v.duration);
  }
  function wantFrame(t) {
    if (!tipVid) { tipVid = document.createElement("video"); tipVid.muted = true; tipVid.preload = "auto"; tipVid.src = cur.url; tipVid.addEventListener("seeked", () => { try { tipC.getContext("2d").drawImage(tipVid, 0, 0, 224, 126); } catch {} tipBusy = false; if (tipWant !== null) { const w = tipWant; tipWant = null; wantFrame(w); } }); }
    if (tipBusy) { tipWant = t; return; } tipBusy = true; try { tipVid.currentTime = t; } catch { tipBusy = false; }
  }
  seek.addEventListener("mousemove", moveTip);
  function startDrag(e) { if (!v.duration) return; dragging = true; seek.classList.add("drag"); doDrag(e); }
  function doDrag(e) { if (!dragging) return; const f = frac(e); prog.style.width = knob.style.left = f * 100 + "%"; $("pCur").textContent = fmt(f * v.duration); moveTip(e); }
  function endDrag(e) { if (!dragging) return; dragging = false; seek.classList.remove("drag"); v.currentTime = frac(e.changedTouches ? { clientX: e.changedTouches[0].clientX } : e) * v.duration; }
  seek.addEventListener("mousedown", startDrag); window.addEventListener("mousemove", doDrag); window.addEventListener("mouseup", endDrag);
  seek.addEventListener("touchstart", e => { startDrag(e); }, { passive: true }); seek.addEventListener("touchmove", doDrag, { passive: true }); seek.addEventListener("touchend", endDrag);

  /* ---------- click / double-tap on video ---------- */
  let lastTap = 0, tapT;
  v.addEventListener("click", e => {
    const r = v.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, now = Date.now();
    if (now - lastTap < 320) { clearTimeout(tapT); lastTap = 0; if (x < .35) skip(-10, "l"); else if (x > .65) skip(10, "r"); else fs(); return; }
    lastTap = now; tapT = setTimeout(() => { if (!menu.hidden) closeMenu(); else if (matchMedia("(hover:none)").matches) { root.classList.contains("idle") ? showUI() : root.classList.add("idle"); } else toggle(); }, 300);
  });

  /* ---------- buttons ---------- */
  $("pPlay").onclick = toggle; $("pBk").onclick = () => skip(-10, "l"); $("pFw").onclick = () => skip(10, "r");
  $("pMute").onclick = () => { v.muted = !v.muted; ls.set("muted", v.muted); $("pVol").value = v.muted ? 0 : v.volume; syncVol(); };
  $("pVol").oninput = e => setVol(+e.target.value);
  $("pFs").onclick = fs; $("pBack").onclick = () => close();
  $("pPip").onclick = async () => { try { document.pictureInPictureElement ? await document.exitPictureInPicture() : await v.requestPictureInPicture(); } catch { o?.toast?.("Picture-in-picture isn't available here"); } };
  $("pRetry").onclick = () => { $("pErr").hidden = true; const t = v.currentTime; v.load(); v.currentTime = t; v.play().catch(() => {}); };
  $("pErrClose").onclick = () => close();
  document.addEventListener("fullscreenchange", () => { $("pFs").textContent = document.fullscreenElement ? "⤢" : "⛶"; });

  /* ---------- popup menus ---------- */
  function closeMenu() { menu.hidden = true; menu.innerHTML = ""; }
  function openMenu(kind, build) {
    if (!menu.hidden && menu.dataset.k === kind) return closeMenu();
    menu.dataset.k = kind; menu.innerHTML = ""; build(menu); menu.hidden = false; root.classList.remove("idle"); clearTimeout(idleT);
  }
  const mItem = (parent, text, on, fn) => { const b = document.createElement("button"); b.textContent = text; if (on) b.className = "on"; b.onclick = () => { fn(); closeMenu(); showUI(); }; parent.appendChild(b); };
  const mHead = (parent, text) => { const h = document.createElement("h5"); h.textContent = text; parent.appendChild(h); };

  $("pSpeed").onclick = () => openMenu("speed", m => { mHead(m, "Playback speed"); [.5, .75, 1, 1.25, 1.5, 1.75, 2].forEach(s => mItem(m, s === 1 ? "Normal" : s + "×", v.playbackRate === s, () => { v.playbackRate = s; ls.set("speed", s); $("pSpeed").textContent = s + "×"; })); });
  function textTracks() { return [...v.textTracks]; }
  function restoreSubs() { const want = ls.get("sub", null); textTracks().forEach((t, i) => t.mode = (want !== null && want === i) ? "showing" : "disabled"); $("pCC").style.color = textTracks().some(t => t.mode === "showing") ? "var(--red)" : ""; }
  $("pCC").onclick = () => openMenu("cc", m => {
    mHead(m, "Subtitles"); const tr = textTracks();
    mItem(m, "Off", !tr.some(t => t.mode === "showing"), () => { tr.forEach(t => t.mode = "disabled"); ls.set("sub", null); $("pCC").style.color = ""; });
    if (!tr.length) { const d = document.createElement("h5"); d.textContent = "Put .vtt or .srt next to the video"; m.appendChild(d); }
    tr.forEach((t, i) => mItem(m, t.label || "Track " + (i + 1), t.mode === "showing", () => { tr.forEach(x => x.mode = "disabled"); t.mode = "showing"; ls.set("sub", i); $("pCC").style.color = "var(--red)"; }));
  });
  $("pSleep").onclick = () => openMenu("sleep", m => {
    mHead(m, "Sleep timer");
    mItem(m, "Off", !sleepT && !sleepEnd, () => setSleep(0));
    [15, 30, 45, 60].forEach(x => mItem(m, x + " minutes", false, () => setSleep(x)));
    mItem(m, "End of this episode", sleepEnd, () => { setSleep(0); sleepEnd = true; $("pSleep").style.color = "var(--red)"; o?.toast?.("Sleep timer: stops after this one"); });
  });
  function setSleep(min) {
    clearInterval(sleepT); sleepT = null; sleepEnd = false; $("pSleep").style.color = "";
    if (!min) return; const end = Date.now() + min * 6e4; $("pSleep").style.color = "var(--red)"; o?.toast?.(`Sleep timer set · ${min} min`);
    sleepT = setInterval(() => { if (Date.now() >= end) { clearInterval(sleepT); sleepT = null; v.pause(); $("pSleep").style.color = ""; o?.toast?.("Sleep timer ended — sweet dreams 🌙"); } }, 1000);
  }
  $("pEps").onclick = () => openMenu("eps", m => {
    mHead(m, "Episodes"); (o.episodes || []).forEach(e => mItem(m, (e.ep ? `E${e.ep.e} · ` : "") + epName(e), e.id === cur.id, () => { if (e.id !== cur.id) { saveNow(); o.onSwitch?.(e); load(e, o.getStart?.(e) || 0); } }));
  });

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", e => {
    if (root.hidden || e.target.tagName === "INPUT" && e.target.type !== "range") return;
    const k = e.key; let used = true;
    if (k === " " || k === "k" || k === "K") toggle();
    else if (k === "ArrowLeft" || k === "j" || k === "J") skip(e.shiftKey ? -30 : -10, "l");
    else if (k === "ArrowRight" || k === "l" || k === "L") skip(e.shiftKey ? 30 : 10, "r");
    else if (k === "ArrowUp") { setVol(v.volume + .1); pop(Math.round(v.volume * 100) + "%"); }
    else if (k === "ArrowDown") { setVol(v.volume - .1); pop(Math.round(v.volume * 100) + "%"); }
    else if (k === "m" || k === "M") $("pMute").click();
    else if (k === "f" || k === "F") fs();
    else if (k === "c" || k === "C") { const tr = textTracks(); if (tr.length) { const on = tr.some(t => t.mode === "showing"); tr.forEach((t, i) => t.mode = !on && i === 0 ? "showing" : "disabled"); ls.set("sub", on ? null : 0); $("pCC").style.color = on ? "" : "var(--red)"; } }
    else if (k === "n" || k === "N") { if (!$("pNextBtn").hidden) goNext(); }
    else if (k === ">" ) { v.playbackRate = Math.min(2, v.playbackRate + .25); $("pSpeed").textContent = v.playbackRate + "×"; ls.set("speed", v.playbackRate); pop(v.playbackRate + "×"); }
    else if (k === "<") { v.playbackRate = Math.max(.25, v.playbackRate - .25); $("pSpeed").textContent = v.playbackRate + "×"; ls.set("speed", v.playbackRate); pop(v.playbackRate + "×"); }
    else if (/^[0-9]$/.test(k) && v.duration) v.currentTime = v.duration * (+k / 10);
    else if (k === "Escape") { if (!menu.hidden) closeMenu(); else if (!document.fullscreenElement) close(); }
    else used = false;
    if (used) { e.preventDefault(); showUI(); }
  });

  /* ---------- media session (lock-screen / headset controls) ---------- */
  function updateMedia() {
    if (!navigator.mediaSession || !cur) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: cur.title, artist: "VEXERO+", artwork: cur.thumb || cur.cover ? [{ src: cur.thumb || cur.cover, sizes: "1280x720" }] : [] });
      navigator.mediaSession.setActionHandler("play", () => v.play()); navigator.mediaSession.setActionHandler("pause", () => v.pause());
      navigator.mediaSession.setActionHandler("seekbackward", () => skip(-10, "l")); navigator.mediaSession.setActionHandler("seekforward", () => skip(10, "r"));
      navigator.mediaSession.setActionHandler("nexttrack", () => { if (!$("pNextBtn").hidden) goNext(); });
    } catch {}
  }
  window.addEventListener("beforeunload", saveNow);
  window.Player = { open, close, get active() { return !root.hidden; } };
})();
