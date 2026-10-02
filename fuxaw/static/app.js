"use strict";
// fuxaw arayüzü: sunucudaki /api uçlarını kullanır (fuxaw/web.py).

const $ = (id) => document.getElementById(id);
const S = { projects: [], path: null, status: null, tags: [], lint: [], designer: null, sel: null, tagSel: new Set(), openUses: new Set() };

const STATE_CLASS = {
  "yerelde değişti": ["publish", "st-publish"],
  "hedefte değişti": ["pull", "st-pull"],
  "çakışma": ["çakışma", "st-conflict"],
  "farklı (taban yok)": ["farklı", "st-unknown"],
  "aynı": ["aynı", "st-same"],
};

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

async function api(path, body) {
  const opt = body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json", "X-Fuxaw": "1" }, body: JSON.stringify(body),
  };
  const r = await fetch("/api/" + path, opt);
  let data;
  try { data = await r.json(); } catch { data = { error: `HTTP ${r.status}` }; }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
const q = (path, params) => path + "?" + new URLSearchParams(params).toString();

// ---------------------------------------------------------------- yardımcılar
function toast(msg, err = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (err ? " err" : "");
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => (t.hidden = true), err ? 6000 : 3000);
}

function logOut(title, lines) {
  const body = $("console-body");
  const stamp = new Date().toLocaleTimeString("tr-TR");
  body.textContent += `── ${stamp} ${title}\n${(lines || []).join("\n")}\n`;
  body.scrollTop = body.scrollHeight;
  $("console-last").textContent = lines && lines.length ? lines[lines.length - 1] : title;
}

function busy(btns, on) {
  for (const b of btns) b.disabled = on;
}

function fmtTime(iso) {
  if (!iso) return "henüz senkron yok";
  const d = new Date(iso);
  return "son senkron " + d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

function modal(title, body, actions) {
  $("modal-title").textContent = title;
  $("modal-body").replaceChildren(...[body].flat());
  const box = $("modal-actions");
  box.replaceChildren();
  const dlg = $("modal");
  return new Promise((resolve) => {
    for (const a of actions) {
      box.append(el("button", { class: a.cls || "", value: a.value, type: "button", onclick: () => { dlg.close(); resolve(a.value); } }, a.label));
    }
    dlg.onclose = () => resolve(dlg.returnValue || null);
    dlg.returnValue = "";
    dlg.showModal();
  });
}

const current = () => S.projects.find((p) => p.path === S.path);

// ---------------------------------------------------------------- projeler
async function loadProjects() {
  const d = await api("projects");
  S.projects = d.projects;
  renderRoots(d.roots);
  const sel = $("project");
  sel.replaceChildren(...S.projects.map((p) => el("option", { value: p.path }, `${p.name}  ·  ${p.target || "?"}`)));
  let saved = null;
  try { saved = localStorage.getItem("fuxaw.project"); } catch {}
  S.path = S.projects.some((p) => p.path === saved) ? saved : (S.projects[0] || {}).path || null;
  if (S.path) sel.value = S.path;
  renderPlist();
  if (!S.path) {
    $("status-banner").hidden = false;
    $("status-banner").className = "banner info";
    $("status-banner").textContent = "Proje bulunamadı. Projeler sekmesinden fuxaw.json içeren bir klasör ekle.";
  }
}

function renderRoots(roots) {
  $("roots").replaceChildren(...roots.map((r) => el("li", {},
    el("span", { class: "path" }, r),
    el("button", { class: "ghost", type: "button", onclick: async () => {
      try { await api("roots", { remove: r }); await loadProjects(); await refreshAll(); } catch (e) { toast(e.message, true); }
    } }, "Çıkar"))));
  if (!roots.length) $("roots").append(el("li", { class: "muted" }, "Kök yok."));
}

function renderPlist() {
  $("plist").replaceChildren(...S.projects.map((p) => el("li", { class: "pick", title: "Seç", onclick: () => {
      $("project").value = p.path;
      $("project").dispatchEvent(new Event("change"));
      switchTab("changes");
    } },
    el("span", { class: "name" }, p.name),
    el("span", { class: "path" }, p.path),
    el("span", { class: "muted" }, p.target || ""))));
  if (!S.projects.length) $("plist").append(el("li", { class: "muted" }, "Proje yok."));
}

// ---------------------------------------------------------------- durum
async function loadStatus() {
  if (!S.path) return;
  $("target-dot").className = "dot busy";
  const p = current();
  $("target-label").textContent = p ? p.target : "—";
  try {
    S.status = await api(q("status", { path: S.path }));
  } catch (e) {
    S.status = null;
    $("target-dot").className = "dot err";
    showBanner(e.message, "err");
    renderEntries();
    return;
  }
  const st = S.status;
  $("target-dot").className = "dot " + (st.reachable ? "ok" : "err");
  $("target").title = st.reachable ? "Yerel test FUXA'sına ulaşıldı" : "Yerel test FUXA'sına ulaşılamadı";
  $("synced").textContent = fmtTime(st.synced_at);
  if (!st.reachable) showBanner(`Yerel FUXA'ya ulaşılamadı: ${st.error}` + (st.has_base ? " — sadece yerel değişiklikler gösteriliyor. Designer sekmesinden başlatabilirsin." : ""), "err");
  else if ((st.counts["hedefte değişti"] || 0) + (st.counts["çakışma"] || 0))
    showBanner("Hedefte değişiklik var (FUXA editöründe kaydedilmiş olabilir). Publish'ten önce Pull yap.", "");
  else $("status-banner").hidden = true;
  renderEntries();
}

function showBanner(text, kind) {
  const b = $("status-banner");
  b.hidden = false;
  b.className = "banner " + kind;
  b.textContent = text;
}

function renderEntries() {
  const st = S.status;
  const ul = $("entries");
  if (!st) { ul.replaceChildren(); $("counts").replaceChildren(); $("badge-changes").textContent = ""; return; }
  const c = st.counts;
  const changed = st.entries.filter((e) => e.state !== "aynı");
  $("badge-changes").textContent = changed.length || "";
  $("badge-changes").className = "badge" + (c["çakışma"] ? " err" : "");
  $("counts").replaceChildren(
    el("span", {}, el("b", {}, c["yerelde değişti"] || 0), " publish"),
    el("span", {}, el("b", {}, c["hedefte değişti"] || 0), " pull"),
    el("span", {}, el("b", {}, c["çakışma"] || 0), " çakışma"),
    ...(c["farklı (taban yok)"] ? [el("span", {}, el("b", {}, c["farklı (taban yok)"]), " taban yok")] : []),
  );
  const list = $("show-same").checked ? st.entries : changed;
  if (!list.length) {
    ul.replaceChildren(el("li", { class: "empty" }, st.reachable ? "Yerel proje ve hedef aynı." : "Yerel değişiklik yok."));
    return;
  }
  ul.replaceChildren(...list.map((e) => {
    const [txt, cls] = STATE_CLASS[e.state] || [e.state, "st-unknown"];
    const sub = [e.change, e.detail, e.readonly ? "API ile yazılamaz" : ""].filter(Boolean).join(" · ");
    return el("li", { class: e.key === S.sel ? "sel" : "", onclick: () => selectEntry(e) },
      el("span", { class: "state " + cls }, txt),
      el("span", { class: "lbl", title: e.key }, e.label),
      sub ? el("span", { class: "sub" }, sub) : null);
  }));
}

async function selectEntry(e) {
  S.sel = e.key;
  renderEntries();
  $("diff-title").textContent = e.label;
  $("diff-sub").textContent = e.state === "aynı" ? "" : "hedef → yerel";
  const pre = $("diff");
  if (e.state === "aynı") { pre.replaceChildren(el("span", { class: "muted" }, "Yerel ve hedef aynı.")); return; }
  pre.replaceChildren(el("span", { class: "muted" }, "Yükleniyor…"));
  try {
    const base = S.status && !S.status.reachable ? "1" : "0";
    const d = await api(q("diff", { path: S.path, key: e.key, base }));
    const item = d.diffs[0];
    if (!item) { pre.replaceChildren(el("span", { class: "muted" }, "Fark yok.")); return; }
    pre.replaceChildren(...item.lines.map((ln) => {
      const s = ln.replace(/\n$/, "");
      const cls = s.startsWith("+++") || s.startsWith("---") || s.startsWith("@@") ? "h" : s.startsWith("+") ? "a" : s.startsWith("-") ? "d" : "";
      return el("span", { class: cls }, s + (cls ? "" : "\n"));
    }));
  } catch (err) {
    pre.replaceChildren(el("span", { class: "muted" }, err.message));
  }
}

// ---------------------------------------------------------------- pull / publish
async function doPull(force = false) {
  const btns = [$("btn-pull"), $("btn-publish"), $("btn-export")];
  busy(btns, true);
  try {
    const r = await api("pull", { path: S.path, force });
    logOut(force ? "pull --force" : "pull", r.log);
    if (r.rc === 2) {
      const v = await modal("Pull durduruldu: çakışma", [
        el("p", {}, "Şu öğeler hem yerelde hem hedefte değişmiş:"),
        el("ul", {}, r.blocked.map((b) => el("li", {}, b))),
        el("p", { class: "muted" }, "Hedefteki hali alırsan bu öğelerdeki yerel değişiklikler kaybolur (git'te durur)."),
      ], [{ label: "Vazgeç", value: "no", cls: "ghost" }, { label: "Hedefteki hali al", value: "force", cls: "danger" }]);
      if (v === "force") return doPull(true);
    } else {
      toast(r.pulled.length ? `${r.pulled.length} öğe alındı.` : "Alınacak değişiklik yok.");
    }
  } catch (e) {
    logOut("pull: hata", [e.message]);
    toast(e.message, true);
  } finally {
    busy(btns, false);
  }
  await refreshAll();
}

async function doPublish(force = false) {
  const btns = [$("btn-pull"), $("btn-publish"), $("btn-export")];
  busy(btns, true);
  let plan;
  try {
    plan = await api("publish", { path: S.path, dry_run: true, force });
  } catch (e) {
    toast(e.message, true);
    busy(btns, false);
    return;
  }
  busy(btns, false);
  const lintList = (plan.lint || []).map(([lvl, where, msg]) =>
    el("li", {}, el("span", { class: "state " + (lvl === "HATA" ? "lvl-err" : "lvl-warn") }, lvl), " ", where, ": ", msg));
  const p = current();
  const body = [];
  if (lintList.length) body.push(el("p", {}, el("strong", {}, "Lint")), el("ul", {}, lintList));

  if (plan.rc === 2 && plan.blocked && plan.blocked.length) {
    body.push(el("p", {}, "Şu öğeler hedefte de değişmiş veya son senkron kaydı yok:"),
      el("ul", {}, plan.blocked.map((b) => el("li", {}, b))),
      el("p", { class: "muted" }, "Önce Pull yap. Yereldeki hali zorla göndermek hedefteki (editörde kaydedilmiş) değişiklikleri ezer."));
    const v = await modal("Publish durduruldu", body, [
      { label: "Kapat", value: "no", cls: "ghost" }, { label: "Pull yap", value: "pull" }, { label: "Zorla gönder", value: "force", cls: "danger" }]);
    if (v === "pull") return doPull();
    if (v === "force") return doPublish(true);
    return;
  }
  if (plan.rc === 2) {
    body.push(el("p", {}, "Lint hataları olduğu için publish yapılmaz. Hataları düzeltip tekrar dene."));
    await modal("Publish yapılamaz", body, [{ label: "Kapat", value: "no" }]);
    return;
  }
  if (!plan.plan.length) {
    toast("Gönderilecek değişiklik yok.");
    return;
  }
  body.push(el("p", {}, el("strong", {}, `Yerel test FUXA'sı: ${p ? p.target : ""}`)),
    el("ul", { class: "plan" }, plan.plan.map((x) => el("li", {}, el("code", {}, x.cmd), x.label, x.detail ? el("span", { class: "muted" }, ` (${x.detail})`) : null))));
  if (plan.skipped.length) body.push(el("p", { class: "muted" }, "Atlanacak (API ile yazılamaz): " + plan.skipped.join(", ")));
  if (plan.plan.some((x) => x.cmd === "set-device" || x.cmd === "del-device"))
    body.push(el("p", { class: "banner" }, "set-device ADS sürücüsünü yeniden başlatır, bağlantı ~1 sn kopar."));
  body.push(el("p", { class: "muted" }, "Göndermeden önce yerel FUXA'nın yedeği proje klasörüne (.fuxaw/backups) alınır. Açık bir editör eski haliyle kaydederse bu değişiklikler ezilir. Hedef makine için Export kullan."));
  const v = await modal("Publish", body, [{ label: "Vazgeç", value: "no", cls: "ghost" }, { label: `Gönder (${plan.plan.length})`, value: "go", cls: "primary" }]);
  if (v !== "go") return;

  busy(btns, true);
  try {
    const r = await api("publish", { path: S.path, force });
    logOut(force ? "publish --force" : "publish", r.log);
    if (r.rc === 0) toast(`Publish tamam: ${r.done.length} öğe gönderildi ve doğrulandı.`);
    else {
      $("console").classList.add("open");
      toast(r.rc === 3 ? "Publish yarıda kaldı veya doğrulama tutmadı; çıktıya bak." : "Publish durduruldu; çıktıya bak.", true);
    }
  } catch (e) {
    logOut("publish: hata", [e.message]);
    toast(e.message, true);
  } finally {
    busy(btns, false);
  }
  await refreshAll();
}

// ---------------------------------------------------------------- taglar
async function loadTags() {
  if (!S.path) return;
  try {
    S.tags = (await api(q("tags", { path: S.path }))).tags;
  } catch (e) {
    S.tags = [];
    toast(e.message, true);
  }
  $("badge-tags").textContent = S.tags.length || "";
  const fill = (id, values, first) => {
    const sel = $(id);
    const keep = sel.value;
    sel.replaceChildren(el("option", { value: "" }, first), ...[...new Set(values)].sort().map((v) => el("option", { value: v }, v)));
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "";
  };
  fill("tag-device", S.tags.map((t) => t.device), "Tüm cihazlar");
  fill("tag-type", S.tags.map((t) => t.type), "Tüm tipler");
  S.tagSel = new Set([...S.tagSel].filter((id) => S.tags.some((t) => t.id === id)));
  renderTags();
}

function filteredTags() {
  const s = $("tag-search").value.trim().toLowerCase();
  const dev = $("tag-device").value, typ = $("tag-type").value, unused = $("tag-unused").checked;
  return S.tags.filter((t) =>
    (!s || t.name.toLowerCase().includes(s) || String(t.address).toLowerCase().includes(s) || t.id.toLowerCase().includes(s)) &&
    (!dev || t.device === dev) && (!typ || t.type === typ) && (!unused || !t.uses.length));
}

function renderTags() {
  const rows = filteredTags();
  const tb = $("tag-rows");
  const out = [];
  for (const t of rows) {
    const sel = S.tagSel.has(t.id);
    out.push(el("tr", { class: sel ? "sel" : "" },
      el("td", { class: "cb" }, el("input", { type: "checkbox", checked: sel, "aria-label": t.name, onchange: (ev) => {
        ev.target.checked ? S.tagSel.add(t.id) : S.tagSel.delete(t.id);
        renderTags();
      } })),
      el("td", { title: t.id }, t.name),
      el("td", {}, t.type),
      el("td", { class: "mono" }, t.address),
      el("td", {}, t.device),
      el("td", { class: "num" }, el("button", { class: "uses-btn" + (t.uses.length ? "" : " zero"), type: "button", onclick: () => {
        S.openUses.has(t.id) ? S.openUses.delete(t.id) : S.openUses.add(t.id);
        renderTags();
      } }, t.uses.length))));
    if (S.openUses.has(t.id)) {
      out.push(el("tr", { class: "uses" }, el("td", { colspan: "6" },
        t.uses.length ? el("ul", {}, t.uses.map((u) => el("li", {}, el("strong", {}, u.where), " — ", u.how)))
          : el("span", { class: "muted" }, "Hiçbir ekranda veya script'te kullanılmıyor."))));
    }
  }
  if (!rows.length) out.push(el("tr", {}, el("td", { colspan: "6", class: "muted" }, S.tags.length ? "Filtreye uyan tag yok." : "Tag yok.")));
  tb.replaceChildren(...out);
  const visSel = rows.filter((t) => S.tagSel.has(t.id)).length;
  $("tag-all").checked = rows.length > 0 && visSel === rows.length;
  $("tag-all").indeterminate = visSel > 0 && visSel < rows.length;
  $("tag-selinfo").textContent = S.tagSel.size ? `${S.tagSel.size} seçili` : "";
  $("tag-copy").disabled = !S.tagSel.size;
}

async function copyTags() {
  const chosen = S.tags.filter((t) => S.tagSel.has(t.id));
  const text = ["Ad\tTip\tAdres\tCihaz\tId", ...chosen.map((t) => [t.name, t.type, t.address, t.device, t.id].join("\t"))].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast(`${chosen.length} tag panoya kopyalandı (sekmeyle ayrılmış, Excel'e yapıştırılabilir).`);
  } catch {
    toast("Panoya kopyalanamadı.", true);
  }
}

// ---------------------------------------------------------------- lint
async function loadLint() {
  if (!S.path) return;
  let d;
  try {
    d = await api(q("lint", { path: S.path }));
  } catch (e) {
    $("findings").replaceChildren(el("li", {}, e.message));
    return;
  }
  const errs = d.findings.filter((f) => f.level === d.error_level).length;
  $("badge-lint").textContent = d.findings.length || "";
  $("badge-lint").className = "badge" + (errs ? " err" : " muted");
  if (!d.findings.length) {
    $("findings").replaceChildren(el("li", { class: "ok" }, "Sorun bulunmadı."));
    return;
  }
  $("findings").replaceChildren(...d.findings.map((f) => el("li", {},
    el("span", { class: "state " + (f.level === d.error_level ? "lvl-err" : "lvl-warn") }, f.level),
    el("span", { class: "where" }, f.where),
    el("span", { class: "msg" }, f.msg))));
}

// ---------------------------------------------------------------- designer
async function loadDesigner() {
  try {
    S.designer = await api("designer");
  } catch (e) {
    S.designer = null;
  }
  renderDesigner();
}

function renderDesigner() {
  const d = S.designer;
  const chipDot = $("designer-dot");
  if (!d) { chipDot.className = "dot err"; $("designer-label").textContent = "Designer ?"; return; }
  chipDot.className = "dot " + (d.running ? "ok" : "");
  $("designer-label").textContent = d.running ? "Designer çalışıyor" : "Designer kapalı";
  const missing = !d.node || d.fuxa_version !== d.fuxa_wanted;
  const kv = [
    ["Durum", d.running ? `çalışıyor${d.pid ? " (pid " + d.pid + ")" : ""}` : "çalışmıyor"],
    ["Adres", d.url],
    ["Node.js", d.node ? `${d.node_version}  ${d.node}` : "yok (kurulacak)"],
    ["FUXA", d.fuxa_version ? d.fuxa_version + (d.fuxa_version !== d.fuxa_wanted ? `  (istenen ${d.fuxa_wanted})` : "") : `yok (${d.fuxa_wanted} kurulacak)`],
    ["winget", d.winget || "yok (Node.js zip olarak indirilir)"],
    ["Klasör", d.app_dir],
  ];
  $("designer-kv").replaceChildren(...kv.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
  $("d-start").textContent = missing ? "Kur ve başlat" : "Başlat";
  $("d-start").disabled = d.running;
  $("d-stop").disabled = !d.running;
  for (const [id, path] of [["d-editor", "/editor"], ["d-runtime", "/home"]]) {
    const a = $(id);
    a.href = d.url + path;
    a.style.pointerEvents = d.running ? "" : "none";
    a.style.opacity = d.running ? "" : ".5";
  }
}

async function designerStart() {
  const d = S.designer || {};
  const missing = !d.node || d.fuxa_version !== d.fuxa_wanted;
  if (missing) {
    const what = [];
    if (!d.node) what.push(d.winget ? "Node.js LTS (winget, yönetici onayı isteyebilir)" : "Node.js LTS (nodejs.org'dan zip)");
    if (d.fuxa_version !== d.fuxa_wanted) what.push(`FUXA ${d.fuxa_wanted} (npm, birkaç yüz MB)`);
    const v = await modal("Eksik bileşenler kurulsun mu?", [
      el("ul", {}, what.map((w) => el("li", {}, w))),
      el("p", { class: "muted" }, "Kurulum birkaç dakika sürebilir. winget açılırsa Windows yönetici onayı penceresini onayla."),
    ], [{ label: "Vazgeç", value: "no", cls: "ghost" }, { label: "Kur ve başlat", value: "yes", cls: "primary" }]);
    if (v !== "yes") return;
  }
  const b = $("d-start");
  b.disabled = true;
  b.textContent = missing ? "Kuruluyor…" : "Başlatılıyor…";
  $("designer-dot").className = "dot busy";
  try {
    const r = await api("designer/start", { install: missing });
    logOut("designer start", r.log);
    toast("Designer hazır.");
  } catch (e) {
    logOut("designer start: hata", [e.message]);
    toast(e.message, true);
  }
  await loadDesigner();
}

async function designerStop() {
  try {
    const r = await api("designer/stop", {});
    logOut("designer stop", r.log);
  } catch (e) {
    toast(e.message, true);
  }
  await loadDesigner();
}

// ---------------------------------------------------------------- export (hedef makine için klasöre)
async function doExport() {
  const b = $("btn-export");
  b.disabled = true;
  let r;
  try {
    r = await api("export", { path: S.path });
    logOut("export", r.log);
  } catch (e) {
    logOut("export: hata", [e.message]);
    toast(e.message, true);
    return;
  } finally {
    b.disabled = false;
  }
  const lint = (r.lint || []).map(([lvl, where, msg]) =>
    el("li", {}, el("span", { class: "state " + (lvl === "HATA" ? "lvl-err" : "lvl-warn") }, lvl), " ", where, ": ", msg));
  if (r.rc !== 0) {
    await modal("Export yapılmadı", [el("p", {}, "Lint hataları var; düzeltip tekrar dene."), el("ul", {}, lint)],
      [{ label: "Kapat", value: "no" }]);
    return;
  }
  const body = [
    el("p", {}, "Hedef makine için dosyalar yazıldı:"),
    el("pre", {}, r.dir),
    el("ul", {}, r.files.map((f) => el("li", {}, el("code", {}, f.split(/[\\/]/).pop())))),
    el("p", { class: "muted" }, "Klasörü hedef makineye taşı; README.md nereye ve nasıl koyulacağını anlatıyor " +
      "(FUXA editöründe ☰ → Open Project)."),
  ];
  if (lint.length) body.push(el("p", {}, el("strong", {}, "Lint uyarıları")), el("ul", {}, lint));
  await modal("Export tamam", body, [{ label: "Tamam", value: "ok", cls: "primary" }]);
}

// ---------------------------------------------------------------- genel
async function refreshAll() {
  await Promise.all([loadStatus(), loadTags(), loadLint(), loadDesigner()]);
}

function switchTab(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b.dataset.tab === name);
  for (const s of document.querySelectorAll(".tab")) s.classList.toggle("active", s.id === "tab-" + name);
  try { localStorage.setItem("fuxaw.tab", name); } catch {}
}

function bind() {
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => switchTab(b.dataset.tab));
  $("project").addEventListener("change", (e) => {
    S.path = e.target.value;
    S.sel = null;
    S.tagSel.clear();
    S.openUses.clear();
    try { localStorage.setItem("fuxaw.project", S.path); } catch {}
    $("diff").replaceChildren(el("span", { class: "muted" }, "Soldan bir öğe seç."));
    $("diff-title").textContent = "Fark";
    $("diff-sub").textContent = "";
    refreshAll();
  });
  $("btn-refresh").addEventListener("click", refreshAll);
  $("btn-pull").addEventListener("click", () => doPull());
  $("btn-publish").addEventListener("click", () => doPublish());
  $("show-same").addEventListener("change", renderEntries);
  for (const id of ["tag-search", "tag-device", "tag-type", "tag-unused"]) $(id).addEventListener("input", renderTags);
  $("tag-all").addEventListener("change", (e) => {
    for (const t of filteredTags()) e.target.checked ? S.tagSel.add(t.id) : S.tagSel.delete(t.id);
    renderTags();
  });
  $("tag-copy").addEventListener("click", copyTags);
  $("designer-chip").addEventListener("click", () => switchTab("designer"));
  $("d-start").addEventListener("click", designerStart);
  $("d-stop").addEventListener("click", designerStop);
  $("btn-export").addEventListener("click", doExport);
  $("console-toggle").addEventListener("click", () => $("console").classList.toggle("open"));
  $("root-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("roots", { add: $("root-input").value.trim() });
      $("root-input").value = "";
      await loadProjects();
      await refreshAll();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

(async function init() {
  bind();
  let tab = null;
  try { tab = localStorage.getItem("fuxaw.tab"); } catch {}
  if (tab && $("tab-" + tab)) switchTab(tab);
  try {
    await loadProjects();
  } catch (e) {
    toast(e.message, true);
  }
  await refreshAll();
})();
