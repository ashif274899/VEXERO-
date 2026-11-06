/* VEXERO+ Studio — admin panel */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = { items: [], settings: {}, views: {}, q: "", status: "all", genre: "", sel: new Set(), upOpts: { publish: false } };
  const fmtSize = b => { if (!b) return "—"; const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i > 1 ? 1 : 0) + " " + u[i]; };
  const fmtDur = s => { if (!s) return "—"; const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m + "m"; };
  const ago = iso => { if (!iso) return "—"; const d = (Date.now() - new Date(iso)) / 864e5; return d < 1 ? "today" : d < 2 ? "yesterday" : d < 30 ? Math.floor(d) + "d ago" : new Date(iso).toLocaleDateString(); };
  const tidOf = it => it.series ? "series:" + it.series.toLowerCase() : it.id;
  const pretty = n => n.replace(/\.[^.]+$/, "").replace(/[._]+/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/\b(2160p|1080p|720p|480p|bluray|brrip|webrip|web-dl|x264|x265|h264|hevc|aac)\b.*$/i, "").replace(/\s+/g, " ").trim();
  function toast(m, bad) { const t = $("#toast"); t.textContent = m; t.className = "show" + (bad ? " bad" : ""); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = "", 3000); }

  async function A(path, o = {}) {
    const h = { "X-Requested-With": "vx", ...(o.json ? { "Content-Type": "application/json" } : {}) };
    const r = await fetch("/admin-api/" + path, { method: o.method || (o.json || o.body ? "POST" : "GET"), headers: h, body: o.json ? JSON.stringify(o.json) : o.body });
    let d = {}; try { d = await r.json(); } catch {}
    if (r.status === 401 && path !== "login") { showLogin(); throw new Error("Please sign in"); }
    if (!r.ok) throw new Error(d.error || "Request failed (" + r.status + ")");
    return d;
  }
  const put = (p, json) => A(p, { method: "PUT", json }), del = p => A(p, { method: "DELETE" });
  function upload(kind, file, onProg) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open("POST", `/admin-api/upload?kind=${kind}&name=${encodeURIComponent(file.name || "frame.jpg")}`);
      x.setRequestHeader("X-Requested-With", "vx");
      x.upload.onprogress = e => e.lengthComputable && onProg?.(e.loaded / e.total);
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status === 200 ? res(d) : rej(new Error(d.error || "Upload failed")); };
      x.onerror = () => rej(new Error("Network error during upload")); x.send(file);
    });
  }

  /* ---------------- login ---------------- */
  let setupMode = false;
  async function boot() {
    const st = await fetch("/admin-api/status").then(r => r.json());
    setupMode = st.setup; if (st.authed) return enter(); showLogin();
  }
  function showLogin() {
    $("#shell").hidden = true; $("#login").hidden = false; $("#lCode").hidden = $("#lPass2").hidden = !setupMode;
    $("#loginMsg").textContent = setupMode ? "First-time setup — enter the code shown in your server window and choose a strong password." : "Sign in to manage your platform.";
    $("#lBtn").textContent = setupMode ? "Create admin account" : "Sign in"; $("#lPass").autocomplete = setupMode ? "new-password" : "current-password";
  }
  $("#loginForm").onsubmit = async e => {
    e.preventDefault(); $("#lErr").textContent = ""; const pw = $("#lPass").value;
    try {
      if (setupMode) { if (pw !== $("#lPass2").value) throw new Error("Passwords don't match"); await A("setup", { json: { code: $("#lCode").value.trim(), password: pw } }); setupMode = false; }
      else await A("login", { json: { password: pw } });
      $("#lPass").value = ""; enter();
    } catch (err) { $("#lErr").textContent = err.message; }
  };
  $("#logoutBtn").onclick = async () => { await A("logout", { method: "POST" }).catch(() => {}); location.reload(); };

  async function enter() { $("#login").hidden = true; $("#shell").hidden = false; await load(); go(location.hash.slice(1) || "dash"); }
  async function load() { const d = await A("items"); S.items = d.items; S.settings = d.settings; S.views = d.views; }

  /* ---------------- routing ---------------- */
  const V = {};
  function go(v) { if (!V[v]) v = "dash"; S.view = v; location.hash = v; $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.v === v)); $("#main").style.animation = "none"; void $("#main").offsetWidth; $("#main").style.animation = ""; V[v](); }
  $("#nav").onclick = e => { const a = e.target.closest("a[data-v]"); if (a) go(a.dataset.v); };
  const refresh = () => V[S.view]();
  const main = html => $("#main").innerHTML = html;
  const genres = () => [...new Set(S.items.map(i => i.genre).filter(Boolean))].sort();

  /* ---------------- dashboard ---------------- */
  V.dash = async () => {
    main(`<h1>Dashboard</h1><p class="sub">Everything about your platform at a glance.</p><div class="muted">Loading…</div>`);
    const st = await A("stats"), recent = S.items.slice(0, 6), max = Math.max(1, ...st.top.map(t => t.views));
    main(`<h1>Dashboard</h1><p class="sub">Everything about your platform at a glance.</p>
    <div class="cards"><div class="card stat"><span>Published</span><b>${st.published}</b></div><div class="card stat"><span>Drafts</span><b>${st.total - st.published}</b></div><div class="card stat"><span>Storage used</span><b>${fmtSize(st.bytes)}</b></div><div class="card stat"><span>Total plays</span><b>${st.plays}</b></div><div class="card stat"><span>Viewer profiles</span><b>${st.viewers.length}</b></div></div>
    <div class="grid2"><div class="card"><h3>Recently uploaded</h3>${recent.length ? recent.map(i => `<div class="q" style="grid-template-columns:90px 1fr auto;margin:8px 0">${thumbHtml(i)}<div class="ttl">${esc(i.title)}<small>${ago(i.addedAt)} · ${fmtSize(i.size)}</small></div><span class="pill ${i.published ? "pub" : "draft"}">${i.published ? "LIVE" : "DRAFT"}</span></div>`).join("") : `<p class="muted">Nothing uploaded yet. Go to <a data-go="upload" style="color:var(--red)">Upload</a>.</p>`}</div>
    <div class="card"><h3>Most watched</h3>${st.top.filter(t => t.views).map(t => `<div class="bar"><span>${esc(t.name)}</span><i style="width:${t.views / max * 100}%"></i><b>${t.views}</b></div>`).join("") || `<p class="muted">No plays yet.</p>`}</div></div>`);
  };
  document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) go(g.dataset.go); });
  const thumbHtml = i => i.thumbUrl ? `<img class="thumb" src="${esc(i.thumbUrl)}" alt="">` : `<div class="thumb ph">No thumbnail</div>`;

  /* ---------------- library ---------------- */
  function filtered() {
    const q = S.q.toLowerCase();
    return S.items.filter(i => (S.status === "all" || (S.status === "pub" ? i.published : !i.published)) && (!S.genre || i.genre === S.genre) && (!q || (i.title + " " + (i.series || "") + " " + (i.genre || "")).toLowerCase().includes(q)));
  }
  V.library = () => {
    const rows = filtered();
    main(`<h1>Library</h1><p class="sub">${S.items.length} titles · only <b>published</b> titles appear on the public site.</p>
    <div class="toolbar"><input id="fq" placeholder="Search titles…" value="${esc(S.q)}"><select id="fs"><option value="all">All status</option><option value="pub" ${S.status === "pub" ? "selected" : ""}>Published</option><option value="draft" ${S.status === "draft" ? "selected" : ""}>Drafts</option></select><select id="fg"><option value="">All genres</option>${genres().map(g => `<option ${S.genre === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select><span style="flex:1"></span><button class="btn red" data-go="upload">⇪ Upload videos</button></div>
    ${S.sel.size ? `<div class="bulk"><b>${S.sel.size} selected</b><button class="btn sm" data-b="publish">Publish</button><button class="btn sm" data-b="unpublish">Unpublish</button><button class="btn sm" data-b="feature">★ Feature</button><button class="btn sm" data-b="unfeature">Unfeature</button><button class="btn sm danger" data-b="delete">Delete</button></div>` : ""}
    <div class="card tbl-wrap" style="padding:6px 10px"><table class="tbl"><thead><tr><th><input type="checkbox" id="all"></th><th>Thumbnail</th><th>Title</th><th>Genre</th><th>Status</th><th>Plays</th><th>Added</th><th></th></tr></thead><tbody>${rows.map(i => `<tr data-id="${i.id}"><td><input type="checkbox" class="ck" ${S.sel.has(i.id) ? "checked" : ""}></td><td>${thumbHtml(i)}</td><td class="ttl">${esc(i.title)}<small>${i.series ? `Series: ${esc(i.series)} · S${i.season}E${i.episode} · ` : ""}${fmtDur(i.duration)} · ${fmtSize(i.size)}</small></td><td>${esc(i.genre || "—")}</td><td>${i.missing ? `<span class="pill miss">FILE MISSING</span>` : `<span class="pill ${i.published ? "pub" : "draft"}">${i.published ? "LIVE" : "DRAFT"}</span>`}</td><td>${S.views[tidOf(i)] || 0}</td><td>${ago(i.addedAt)}</td><td><div class="acts"><button class="star ${i.featured ? "on" : ""}" data-a="feat" title="Feature on homepage billboard">★</button><button class="btn sm" data-a="toggle">${i.published ? "Unpublish" : "Publish"}</button><button class="btn sm" data-a="edit">Edit</button></div></td></tr>`).join("") || `<tr><td colspan="8" class="muted" style="text-align:center;padding:40px">No titles match. Upload your first video!</td></tr>`}</tbody></table></div>`);
    $("#fq").oninput = e => { S.q = e.target.value; clearTimeout(V._t); V._t = setTimeout(() => { V.library(); const f = $("#fq"); f.focus(); f.setSelectionRange(99, 99); }, 250); };
    $("#fs").onchange = e => { S.status = e.target.value; V.library(); }; $("#fg").onchange = e => { S.genre = e.target.value; V.library(); };
    $("#all").onchange = e => { rows.forEach(r => e.target.checked ? S.sel.add(r.id) : S.sel.delete(r.id)); V.library(); };
  };
  document.addEventListener("click", async e => {
    if (S.view !== "library") return;
    const tr = e.target.closest("tr[data-id]"), id = tr?.dataset.id, it = S.items.find(x => x.id === id);
    if (e.target.classList.contains("ck")) { e.target.checked ? S.sel.add(id) : S.sel.delete(id); return V.library(); }
    const a = e.target.closest("[data-a]")?.dataset.a;
    try {
      if (a === "edit") openEditor(id);
      else if (a === "toggle") { await put("items/" + id, { published: !it.published }); toast(it.published ? "Unpublished" : "Published — now live on the site"); await load(); V.library(); }
      else if (a === "feat") { await put("items/" + id, { featured: !it.featured }); await load(); V.library(); }
      const b = e.target.closest("[data-b]")?.dataset.b;
      if (b) { if (b === "delete" && !confirm(`Delete ${S.sel.size} title(s)? Uploaded video files will be removed too.`)) return; await A("items/bulk", { json: { ids: [...S.sel], action: b, deleteFiles: true } }); S.sel.clear(); toast("Done"); await load(); V.library(); }
    } catch (err) { toast(err.message, true); }
  });

  /* ---------------- upload ---------------- */
  V.upload = () => {
    main(`<h1>Upload</h1><p class="sub">Drop one or many videos. Duration and a thumbnail are generated automatically — fine-tune everything afterwards.</p>
    <div class="drop" id="drop"><big>⇪</big><b style="font-size:18px">Drag &amp; drop videos here</b><p class="muted">MP4 (H.264 + AAC) is recommended · MKV, WEBM, MOV, AVI also accepted</p><button class="btn red" id="pick">Choose files</button><input type="file" id="files" accept="video/*,.mkv,.avi" multiple hidden></div>
    <label class="opt"><input type="checkbox" id="pubNow" ${S.upOpts.publish ? "checked" : ""}> Publish immediately after upload (otherwise saved as draft so you can add details first)</label><div id="queue"></div>`);
    const drop = $("#drop"), inp = $("#files");
    $("#pick").onclick = () => inp.click(); inp.onchange = () => { addFiles([...inp.files]); inp.value = ""; };
    $("#pubNow").onchange = e => S.upOpts.publish = e.target.checked;
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => addFiles([...e.dataTransfer.files]));
  };
  const queue = []; let running = false;
  function addFiles(files) {
    files = files.filter(f => /\.(mp4|m4v|mkv|webm|mov|avi|ogv|3gp)$/i.test(f.name)); if (!files.length) return toast("Please choose video files", true);
    files.forEach(f => queue.push({ f, el: null, st: "wait" })); renderQueue(); if (!running) runQueue();
  }
  function renderQueue() {
    const q = $("#queue"); if (!q) return; q.innerHTML = queue.map((j, i) => `<div class="q"><div class="thumb ph" style="width:90px">${j.thumb ? `<img class="thumb" style="width:90px" src="${j.thumb}">` : "🎞"}</div><div style="min-width:0"><div class="ttl">${esc(j.f.name)}<small>${fmtSize(j.f.size)} · ${j.msg || "Waiting…"}</small></div><div class="prog"><i style="width:${(j.p || 0) * 100}%"></i></div></div>${j.item ? `<button class="btn sm" data-edit="${j.item.id}">Edit details</button>` : ""}</div>`).join("");
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-edit]"); if (b) openEditor(b.dataset.edit); });
  function probe(file) {
    return new Promise(res => {
      const v = document.createElement("video"), url = URL.createObjectURL(file); v.muted = true; v.preload = "metadata"; v.src = url;
      const end = r => { clearTimeout(to); URL.revokeObjectURL(url); v.removeAttribute("src"); res(r); }, to = setTimeout(() => end({}), 15000);
      v.onloadedmetadata = () => { v.currentTime = Math.min(Math.max(v.duration * .12, 3), Math.max(.5, v.duration - 1)); };
      v.onseeked = () => { const c = document.createElement("canvas"); c.width = 1280; c.height = 720; const x = c.getContext("2d"), k = Math.max(1280 / v.videoWidth, 720 / v.videoHeight); x.drawImage(v, (1280 - v.videoWidth * k) / 2, (720 - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k); c.toBlob(b => end({ duration: v.duration, blob: b, h: v.videoHeight }), "image/jpeg", .85); };
      v.onerror = () => end({});
    });
  }
  async function runQueue() {
    running = true;
    for (const j of queue) {
      if (j.st !== "wait") continue; j.st = "busy";
      try {
        j.msg = "Reading video…"; renderQueue(); const pr = await probe(j.f); if (pr.blob) j.thumb = URL.createObjectURL(pr.blob);
        j.msg = "Uploading…"; renderQueue();
        const up = await upload("video", j.f, p => { j.p = p; j.msg = `Uploading ${Math.round(p * 100)}%`; renderQueue(); });
        let thumb = null; if (pr.blob) { j.msg = "Saving thumbnail…"; renderQueue(); thumb = (await upload("image", new File([pr.blob], "thumb.jpg", { type: "image/jpeg" }))).file; }
        const base = pretty(j.f.name), ep = /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})/i.exec(base), yr = /\b(19\d{2}|20\d{2})\b/.exec(j.f.name);
        const body = { file: up.file, title: base, duration: pr.duration, thumb, year: yr ? +yr[1] : null, quality: pr.h >= 2000 ? "4K" : pr.h >= 700 ? "HD" : null, published: S.upOpts.publish };
        if (ep && ep[1].trim()) Object.assign(body, { series: ep[1].trim(), season: +ep[2], episode: +ep[3] });
        j.item = await A("items", { json: body }); j.st = "done"; j.p = 1; j.msg = S.upOpts.publish ? "✓ Live on the site" : "✓ Saved as draft — add details & publish";
      } catch (err) { j.st = "err"; j.msg = "✗ " + err.message; }
      renderQueue();
    }
    running = false; await load().catch(() => {}); toast("Uploads finished");
  }

  /* ---------------- editor drawer ---------------- */
  function openEditor(id) {
    const it = S.items.find(x => x.id === id); if (!it) return; const d = JSON.parse(JSON.stringify(it)), dr = $("#drawer");
    const isSeries = !!d.series; const seriesNames = [...new Set(S.items.map(i => i.series).filter(Boolean))];
    dr.innerHTML = `<div class="dr-h"><div><b style="font-size:17px">Edit title</b><div class="muted" style="font-size:12px">${esc(it.file)}</div></div><button class="btn sm ghost" id="dClose">✕ Close</button></div>
    <div class="dr-b">
      <div class="sec"><h4>Thumbnail</h4><img class="tpre" id="tPre" src="${d.thumbUrl || ""}" ${d.thumbUrl ? "" : "hidden"} alt=""><div class="muted" id="tNone" ${d.thumbUrl ? "hidden" : ""}>No thumbnail yet — upload one or pick a frame from the video.</div>
        <div class="acts" style="justify-content:flex-start"><button class="btn sm" id="tUp">Upload image</button><button class="btn sm" id="tFrame">Pick frame from video</button><button class="btn sm danger" id="tDel">Remove</button><input type="file" id="tFile" accept="image/*" hidden></div>
        <div id="framePick" hidden><video id="fv" muted preload="metadata" style="width:100%;border-radius:8px;background:#000" src="/admin-api/preview/${id}"></video><input type="range" id="fr" min="0" max="1000" value="120"><button class="btn sm red" id="fUse">Use this frame</button></div></div>
      <div class="sec"><h4>Details</h4><label class="f">Title<input id="eTitle" value="${esc(d.title)}"></label><label class="f">Description<textarea id="eDesc">${esc(d.description)}</textarea></label>
        <div class="row3"><label class="f">Genre / category<input id="eGenre" list="gl" value="${esc(d.genre || "")}" placeholder="Action"><datalist id="gl">${genres().map(g => `<option value="${esc(g)}">`).join("")}</datalist></label><label class="f">Year<input id="eYear" type="number" value="${d.year ?? ""}"></label><label class="f">Quality<select id="eQ"><option value="">—</option>${["HD", "4K", "SD"].map(q => `<option ${d.quality === q ? "selected" : ""}>${q}</option>`).join("")}</select></label></div>
        <div class="row2"><label class="f">Cast (comma separated)<input id="eCast" value="${esc((d.cast || []).join(", "))}"></label><label class="f">Extra tags (comma separated)<input id="eTags" value="${esc((d.tags || []).join(", "))}" placeholder="Thriller, Dark"></label></div></div>
      <div class="sec"><h4>Series</h4><label class="sw"><input type="checkbox" id="eIsS" ${isSeries ? "checked" : ""}> This video is an episode of a series (episodes group into one card)</label>
        <div id="sFields" class="row3" ${isSeries ? "" : "hidden"}><label class="f">Series name<input id="eSer" list="sl" value="${esc(d.series || "")}"><datalist id="sl">${seriesNames.map(s => `<option value="${esc(s)}">`).join("")}</datalist></label><label class="f">Season<input id="eSea" type="number" min="1" value="${d.season || 1}"></label><label class="f">Episode<input id="eEp" type="number" min="1" value="${d.episode || 1}"></label></div></div>
      <div class="sec"><h4>Player</h4><div class="row3"><label class="f">Intro starts (sec)<input id="eIS" type="number" min="0" value="${d.introStart ?? ""}"></label><label class="f">Intro ends (sec) — shows “Skip Intro”<input id="eIE" type="number" min="0" value="${d.introEnd ?? ""}"></label><label class="f">Duration<input value="${fmtDur(d.duration)}" disabled></label></div>
        <div><b style="font-size:12px;color:var(--mut)">SUBTITLES (.vtt / .srt)</b><div id="subs"></div><button class="btn sm" id="sUp" style="margin-top:8px">+ Add subtitle file</button><input type="file" id="sFile" accept=".vtt,.srt" hidden></div></div>
      <div class="sec"><h4>Visibility</h4><label class="sw"><input type="checkbox" id="ePub" ${d.published ? "checked" : ""}> Published — visible on the public site (appears in “Just Added”)</label><label class="sw"><input type="checkbox" id="eFeat" ${d.featured ? "checked" : ""}> Featured — can appear on the homepage billboard</label>
        ${d.published ? `<button class="btn sm" id="eBump" style="align-self:flex-start">↑ Move to top of “Just Added”</button>` : ""}</div>
    </div>
    <div class="dr-f"><button class="btn danger" id="eDel" style="margin-right:auto">Delete</button><button class="btn" id="eSave">Save</button><button class="btn red" id="ePublish">${d.published ? "Save changes" : "Save & publish"}</button></div>`;
    $("#drawerBack").hidden = dr.hidden = false; document.body.style.overflow = "hidden";
    const close = () => { dr.hidden = $("#drawerBack").hidden = true; dr.innerHTML = ""; document.body.style.overflow = ""; };
    $("#dClose").onclick = $("#drawerBack").onclick = close;
    const setThumb = f => { d.thumb = f; d.thumbUrl = f ? "/img/" + f : null; $("#tPre").src = d.thumbUrl || ""; $("#tPre").hidden = !f; $("#tNone").hidden = !!f; };
    $("#tUp").onclick = () => $("#tFile").click();
    $("#tFile").onchange = async e => { const f = e.target.files[0]; if (!f) return; try { setThumb((await upload("image", f)).file); toast("Thumbnail uploaded"); } catch (x) { toast(x.message, true); } };
    $("#tDel").onclick = () => setThumb(null);
    const fv = $("#fv"); $("#tFrame").onclick = () => { $("#framePick").hidden = !$("#framePick").hidden; };
    fv.onloadedmetadata = () => { fv.currentTime = fv.duration * .12; }; $("#fr").oninput = e => { if (fv.duration) fv.currentTime = fv.duration * e.target.value / 1000; };
    $("#fUse").onclick = () => {
      const c = document.createElement("canvas"); c.width = 1280; c.height = 720; const x = c.getContext("2d"), k = Math.max(1280 / fv.videoWidth, 720 / fv.videoHeight);
      x.drawImage(fv, (1280 - fv.videoWidth * k) / 2, (720 - fv.videoHeight * k) / 2, fv.videoWidth * k, fv.videoHeight * k);
      c.toBlob(async b => { try { setThumb((await upload("image", new File([b], "frame.jpg", { type: "image/jpeg" }))).file); toast("Frame saved as thumbnail"); $("#framePick").hidden = true; } catch (x) { toast(x.message, true); } }, "image/jpeg", .88);
    };
    $("#eIsS").onchange = e => $("#sFields").hidden = !e.target.checked;
    const drawSubs = () => { $("#subs").innerHTML = (d.subs || []).map((s, i) => `<div class="subrow" style="margin-top:8px"><input value="${esc(s.label)}" data-si="${i}" placeholder="Label (English)"><button class="btn sm danger" data-sd="${i}">Remove</button></div>`).join("") || `<div class="muted" style="margin-top:6px">None</div>`; };
    drawSubs(); $("#subs").oninput = e => { const i = e.target.dataset.si; if (i !== undefined) d.subs[i].label = e.target.value; }; $("#subs").onclick = e => { const i = e.target.dataset.sd; if (i !== undefined) { d.subs.splice(i, 1); drawSubs(); } };
    $("#sUp").onclick = () => $("#sFile").click();
    $("#sFile").onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const r = await upload("sub", f); (d.subs ||= []).push({ file: r.file, label: r.label || "English" }); drawSubs(); } catch (x) { toast(x.message, true); } };
    const collect = pub => ({
      title: $("#eTitle").value, description: $("#eDesc").value, genre: $("#eGenre").value, year: $("#eYear").value, quality: $("#eQ").value, cast: $("#eCast").value, tags: $("#eTags").value,
      series: $("#eIsS").checked ? $("#eSer").value : "", season: $("#eSea").value, episode: $("#eEp").value, introStart: $("#eIS").value, introEnd: $("#eIE").value,
      thumb: d.thumb || null, subs: d.subs || [], featured: $("#eFeat").checked, published: pub === undefined ? $("#ePub").checked : pub
    });
    const save = async pub => {
      const b = collect(pub); if (!b.title.trim()) return toast("Title is required", true); if ($("#eIsS").checked && !b.series.trim()) return toast("Enter the series name", true);
      try { await put("items/" + id, b); await load(); toast(b.published ? "Saved ✓ live on the site" : "Saved"); close(); refresh(); } catch (e) { toast(e.message, true); }
    };
    $("#eSave").onclick = () => save(); $("#ePublish").onclick = () => save(true);
    $("#eBump")?.addEventListener("click", async () => { await A(`items/${id}/bump`, { method: "POST" }); await load(); toast("Moved to top of Just Added"); });
    $("#eDel").onclick = async () => { if (!confirm(`Delete “${it.title}”? ${it.file.startsWith("uploads/") ? "The uploaded video file will be removed too." : "The video file in your folder is kept."}`)) return; try { await del(`items/${id}?deleteFile=1`); await load(); toast("Deleted"); close(); refresh(); } catch (e) { toast(e.message, true); } };
  }

  /* ---------------- import ---------------- */
  V.import = async () => {
    main(`<h1>Import from folder</h1><p class="sub">Videos already sitting inside your <code>movies</code> folder that aren't in the library yet. They stay private until you publish them.</p><div class="muted">Scanning…</div>`);
    const files = await A("unregistered");
    main(`<h1>Import from folder</h1><p class="sub">Videos already sitting inside your <code>movies</code> folder that aren't in the library yet. They stay private until you publish them.</p>
    ${files.length ? `<div class="toolbar"><button class="btn" id="iAll">Select all</button><button class="btn red" id="iGo">Import selected as drafts</button></div><div class="card"><table class="tbl"><tbody>${files.map(f => `<tr><td style="width:30px"><input type="checkbox" class="ic" value="${esc(f.rel)}"></td><td class="ttl">${esc(f.rel.split("/").pop())}<small>${esc(f.rel)}</small></td><td>${fmtSize(f.size)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card muted" style="text-align:center;padding:40px">No unregistered videos found. 🎉</div>`}`);
    $("#iAll")?.addEventListener("click", () => $$(".ic").forEach(c => c.checked = true));
    $("#iGo")?.addEventListener("click", async () => { const sel = $$(".ic:checked").map(c => c.value); if (!sel.length) return toast("Select some files", true); const r = await A("import", { json: { files: sel } }); await load(); toast(`${r.length} imported as drafts`); go("library"); });
  };

  /* ---------------- homepage control ---------------- */
  V.home = () => {
    const pub = S.items.filter(i => i.published), feat = pub.filter(i => i.featured), recent = pub.slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 10);
    main(`<h1>Homepage control</h1><p class="sub">Decide what visitors see first. Changes go live instantly.</p>
    <div class="grid2"><div class="card"><h3>★ Billboard (hero) titles</h3><p class="muted" style="margin-top:-6px">Featured titles rotate on the big homepage banner. If none are featured, VEXERO+ picks automatically.</p>
      ${pub.map(i => `<label class="sw" style="padding:6px 0"><input type="checkbox" class="fc" value="${i.id}" ${i.featured ? "checked" : ""}> <span>${esc(i.title)}</span></label>`).join("") || `<p class="muted">Publish a title first.</p>`}</div>
    <div class="card"><h3>Today's Special</h3><p class="muted" style="margin-top:-6px">Pin one title as the special. “Auto” rotates daily.</p><select id="sp"><option value="">Auto (rotate daily)</option>${pub.map(i => `<option value="${i.id}" ${S.settings.specialId === i.id ? "selected" : ""}>${esc(i.title)}</option>`).join("")}</select>
      <h3 style="margin-top:22px">“Just Added” window</h3><label class="f">Show the NEW badge for (days)<input id="nd" type="number" min="1" max="90" value="${S.settings.newDays || 7}"></label><button class="btn red" id="saveHome" style="margin-top:14px">Save homepage settings</button></div></div>
    <div class="card" style="margin-top:16px"><h3>Just Added — live order</h3><p class="muted" style="margin-top:-6px">Newest published first. Use ↑ to re-promote a title.</p>${recent.map((i, n) => `<div class="q" style="grid-template-columns:30px 90px 1fr auto;margin:8px 0"><b>${n + 1}</b>${thumbHtml(i)}<div class="ttl">${esc(i.title)}<small>published ${ago(i.publishedAt)}</small></div><button class="btn sm" data-bump="${i.id}">↑ Bump</button></div>`).join("") || `<p class="muted">Nothing published yet.</p>`}</div>`);
    $("#saveHome").onclick = async () => {
      try {
        for (const c of $$(".fc")) { const it = S.items.find(x => x.id === c.value); if (it && it.featured !== c.checked) await put("items/" + it.id, { featured: c.checked }); }
        await put("settings", { specialId: $("#sp").value || null, newDays: $("#nd").value }); await load(); toast("Homepage updated ✓"); V.home();
      } catch (e) { toast(e.message, true); }
    };
  };
  document.addEventListener("click", async e => { const b = e.target.closest("[data-bump]"); if (!b) return; await A(`items/${b.dataset.bump}/bump`, { method: "POST" }); await load(); toast("Bumped to top"); V.home(); });

  /* ---------------- viewers ---------------- */
  V.viewers = async () => {
    const st = await A("stats");
    main(`<h1>Viewers</h1><p class="sub">Profiles created on the site and how much they watch.</p><div class="card"><table class="tbl"><thead><tr><th>Profile</th><th>Hours watched</th><th>Titles started</th><th>My List</th><th></th></tr></thead><tbody>${st.viewers.map(v => `<tr><td class="ttl">${esc(v.name)}</td><td>${v.hours}h</td><td>${v.started}</td><td>${v.list}</td><td><div class="acts"><button class="btn sm danger" data-vd="${v.id}">Delete</button></div></td></tr>`).join("")}</tbody></table></div>`);
    $$("[data-vd]").forEach(b => b.onclick = async () => { if (!confirm("Delete this profile and its history?")) return; try { await del("viewers/" + b.dataset.vd); V.viewers(); } catch (e) { toast(e.message, true); } });
  };

  /* ---------------- settings ---------------- */
  V.settings = () => {
    main(`<h1>Settings</h1><p class="sub">Account & security.</p><div class="card" style="max-width:460px"><h3>Change admin password</h3><div style="display:flex;flex-direction:column;gap:10px"><input id="pc" type="password" placeholder="Current password"><input id="pn" type="password" placeholder="New password (min 8 chars)"><button class="btn red" id="pSave">Update password</button></div></div>
    <div class="card" style="max-width:460px;margin-top:16px"><h3>Good to know</h3><p class="muted" style="line-height:1.7;margin:0">This panel lives at <code>/admin</code> and is not linked anywhere on the public site. Keep your password private; only people with it can upload or change anything. Sessions last 7 days. For internet (production) use you'll also want HTTPS.</p></div>`);
    $("#pSave").onclick = async () => { try { await A("password", { json: { current: $("#pc").value, next: $("#pn").value } }); toast("Password updated ✓"); $("#pc").value = $("#pn").value = ""; } catch (e) { toast(e.message, true); } };
  };

  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#drawer").hidden) $("#dClose").click(); });
  boot();
})();
