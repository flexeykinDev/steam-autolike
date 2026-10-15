/* Steam Autolike — popup (also works as a full page: popup.html?full=1). */
const C = globalThis.SALCore;
const S = globalThis.SALStrings;

const $ = (id) => document.getElementById(id);
const el = (tag, props, ...kids) => {
  const n = Object.assign(document.createElement(tag), props || {});
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const form = $("settings");
const FULL = new URLSearchParams(location.search).has("full");
const NUMERIC = Object.keys(C.NUMERIC_LIMITS);
const BOOLS = ["doLike", "doComment", "quietEnabled", "autoRun", "notify"];
const TEXTS = ["onLimit", "lang", "quietFrom", "quietTo"];
const TYPE_LABEL = { status: "typeStatus", media: "typeMedia", review: "typeReview", game: "typeGame", other: "typeOther" };

let t = S.makeT("en");
let settings = C.normalizeSettings({});
let tabId = null;
let lastSnap = null;
let avatarDrawnFor = null;
let feedAuthors = [];
let hotkey = "Alt+Shift+L";

// ================================================================= i18n
function applyLang() {
  t = S.makeT(S.resolveLang(settings.lang, browser.i18n.getUILanguage()));
  document.documentElement.lang = S.resolveLang(settings.lang, browser.i18n.getUILanguage());
  document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach((n) => { n.placeholder = t(n.dataset.i18nPh); });
  $("hotkey").textContent = t("hotkeyHint", { key: hotkey });
  renderTypes();
  renderFriends();
  renderPool();
  renderStats();
  if (lastSnap !== undefined) render(lastSnap);
}

// ================================================================= dot-matrix digits (5×7)
const FONT = {
  "0": ["01110","10001","10011","10101","11001","10001","01110"],
  "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"],
  "3": ["11111","00010","00100","00010","00001","10001","01110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"],
  "5": ["11111","10000","11110","00001","00001","10001","01110"],
  "6": ["00110","01000","10000","11110","10001","10001","01110"],
  "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"],
  "9": ["01110","10001","10001","01111","00001","00010","01100"],
  "-": ["00000","00000","00000","11111","00000","00000","00000"]
};
function setDots(node, value) {
  const s = String(value);
  if (node.dataset.v === s) return;
  node.dataset.v = s;
  node.textContent = "";
  for (const ch of s) {
    const g = el("div", { className: "dg" });
    for (const row of FONT[ch] || FONT["-"]) for (const bit of row) g.append(el("i", { className: bit === "1" ? "on" : "" }));
    node.append(g);
  }
}

// ================================================================= tick ring
const TICKS = 44;
function buildRing() {
  const svg = $("ring"), ns = "http://www.w3.org/2000/svg";
  for (let k = 0; k < TICKS; k++) {
    const r = document.createElementNS(ns, "rect");
    r.setAttribute("x", "48.5"); r.setAttribute("y", "3"); r.setAttribute("width", "3"); r.setAttribute("height", "6");
    r.setAttribute("transform", `rotate(${(360 / TICKS) * k} 50 50)`);
    svg.append(r);
  }
}
function setRing(frac, color) {
  const lit = Math.round(Math.max(0, Math.min(1, frac)) * TICKS);
  $("ring").querySelectorAll("rect").forEach((r, k) => r.setAttribute("fill", k < lit ? color : "#24242a"));
}

function sprinkleDust() {
  const d = $("dust");
  for (let k = 0; k < 26; k++) {
    const i = el("i", { className: Math.random() < .3 ? "l" : "" });
    i.style.left = Math.random() * 100 + "%";
    i.style.top = Math.random() * 100 + "%";
    d.append(i);
  }
}

// ================================================================= avatar mosaic
const CELL = 6, GAP = 1;
function hash(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
async function drawAvatar(url, name) {
  const key = url || name || "";
  if (avatarDrawnFor === key) return;
  avatarDrawnFor = key;
  const canvas = $("avatar");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const step = CELL + GAP;
  const cols = Math.ceil(W / step), rows = Math.ceil(H / step);
  let pixels = null;
  if (url) {
    try {
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      const small = new OffscreenCanvas(cols, rows);
      const sctx = small.getContext("2d");
      const drawH = bmp.height * (cols / bmp.width);
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(bmp, 0, -drawH * 0.22, cols, drawH);
      pixels = sctx.getImageData(0, 0, cols, rows).data;
    } catch (_) { pixels = null; }
  }
  let seed = hash(key || "x");
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const n = rnd();
      if (n < 0.04) continue;
      let r, g, b;
      if (pixels) {
        const o = (y * cols + x) * 4, k = 0.72 + n * 0.22;
        r = pixels[o] * k; g = pixels[o + 1] * k; b = pixels[o + 2] * k;
      } else {
        const v = 18 + n * 26, hit = rnd() < 0.08;
        r = hit ? 120 : v; g = hit ? 100 : v; b = hit ? 200 : v + 6;
      }
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x * step, y * step, CELL, CELL);
    }
  }
}

// ================================================================= Steam emoticons
const EMO_HOSTS = [
  "https://community.fastly.steamstatic.com/economy/emoticon/",
  "https://community.akamai.steamstatic.com/economy/emoticon/",
  "https://steamcommunity-a.akamaihd.net/economy/emoticon/"
];
const EMO_RE = /:([A-Za-z][A-Za-z0-9_]+):/g;
function emoImg(code, cls) {
  const img = el("img", { className: cls == null ? "emo" : cls, alt: code, title: code, loading: "lazy" });
  let h = 0;
  const bare = code.replace(/:/g, "");
  img.src = EMO_HOSTS[0] + bare;
  img.onerror = () => { if (++h < EMO_HOSTS.length) img.src = EMO_HOSTS[h] + bare; };
  return img;
}
// text with :codes: turned into images (no innerHTML — the log comes from the page)
function emoText(node, text) {
  let last = 0;
  for (const m of text.matchAll(EMO_RE)) {
    if (m.index > last) node.append(text.slice(last, m.index));
    node.append(emoImg(m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) node.append(text.slice(last));
}

let emoList = [];

function renderPool() {
  const pool = settings.emojiPool;
  const box = $("poolPreview");
  box.textContent = "";
  if (!pool.length) box.append(el("span", { className: "muted", textContent: t("poolEmpty", { e: settings.emoji }) }));
  for (const code of pool) {
    const img = emoImg(code);
    img.title = t("poolRemove", { e: code });
    img.addEventListener("click", () => togglePool(code));
    box.append(img);
  }
  $("poolCount").textContent = pool.length ? t("poolCount", { n: pool.length }) : "";

  const prev = $("cmtPreview");
  prev.textContent = "";
  const shown = pool.length ? pool : [settings.emoji];
  for (const code of shown.slice(0, 8)) prev.append(emoImg(code));
  if (shown.length > 8) prev.append(` +${shown.length - 8}`);
  if (shown.length > 1) prev.append(el("span", { className: "muted", textContent: " " + t("perRandom", { n: settings.perComment }) }));
  renderPicker();
}

async function patchSettings(patch) {
  settings = C.normalizeSettings(Object.assign({}, settings, patch));
  await browser.storage.local.set({ settings });
}

function togglePool(code) {
  const pool = [...settings.emojiPool];
  const i = pool.indexOf(code);
  if (i >= 0) pool.splice(i, 1); else pool.push(code);
  patchSettings({ emojiPool: pool }).then(renderPool);
}

function renderPicker() {
  const grid = $("emoPicker");
  if (grid.classList.contains("hidden")) return;
  const q = $("emoSearch").value.trim().toLowerCase().replace(/:/g, "");
  grid.textContent = "";
  const list = emoList.filter((c) => !q || c.toLowerCase().includes(q));
  if (!list.length) {
    grid.append(el("div", { className: "muted", textContent: emoList.length ? t("nothingFound") : t("emoListEmpty") }));
    return;
  }
  for (const code of list.slice(0, 400)) {
    const b = el("button", { type: "button", title: code, className: settings.emojiPool.includes(code) ? "sel" : "" }, emoImg(code, ""));
    b.addEventListener("click", () => togglePool(code));
    grid.append(b);
  }
}

async function openPicker() {
  const grid = $("emoPicker"), btn = $("loadEmoticons");
  if (!grid.classList.contains("hidden")) {
    grid.classList.add("hidden"); $("emoTools").classList.add("hidden");
    btn.textContent = t("myEmoticons");
    return;
  }
  grid.classList.remove("hidden"); $("emoTools").classList.remove("hidden");
  btn.textContent = t("hide");
  const { emoCache } = await browser.storage.local.get("emoCache");
  if (emoCache && emoCache.list && emoCache.list.length) emoList = emoCache.list;
  grid.textContent = "";
  grid.append(el("div", { className: "muted", textContent: t("loadingEmo") }));
  const res = await send("emoticons");
  if (res && res.list && res.list.length) {
    emoList = res.list;
    browser.storage.local.set({ emoCache: { list: emoList, at: Date.now() } });
  } else if (!emoList.length) {
    $("formMsg").textContent = res && res.error ? t("emoFailed", { e: res.error }) : t("emoNeedsTab");
  }
  renderPicker();
}

function addManualEmo() {
  let v = $("manualEmo").value.trim();
  if (!v) return;
  v = ":" + v.replace(/:/g, "") + ":";
  if (!/^:[A-Za-z0-9_]+:$/.test(v)) { $("formMsg").textContent = t("emoBadName"); return; }
  if (!settings.emojiPool.includes(v)) togglePool(v);
  if (!emoList.includes(v)) emoList.unshift(v);
  $("manualEmo").value = "";
  renderPicker();
}

// ================================================================= friends
function avatarNode(entry, size) {
  if (entry && entry.avatar) {
    const img = el("img", { alt: "", loading: "lazy", referrerPolicy: "no-referrer" });
    img.src = entry.avatar.replace(/_full\.(jpg|png|gif)$/i, "_medium.$1");
    img.width = img.height = size;
    return img;
  }
  return el("span", { className: "ph" });
}
const label = (e) => e.name || e.vanity || e.steamid || e.accountId || "?";

function renderFriends() {
  document.querySelectorAll("#friendMode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === settings.friendMode));
  const box = $("friendList");
  box.textContent = "";
  const list = settings.friendList;
  $("listCount").textContent = list.length ? t("poolCount", { n: list.length }) : "";
  if (!list.length) box.append(el("div", { className: "muted", textContent: t("listEmpty") }));
  list.forEach((e, i) => {
    const chip = el("button", { type: "button", className: "fchip", title: t("remove") },
      avatarNode(e, 18), el("span", { className: "nm", textContent: label(e) }), el("span", { className: "x", textContent: "×" }));
    chip.addEventListener("click", () => {
      const next = [...settings.friendList];
      next.splice(i, 1);
      patchSettings({ friendList: next }).then(renderFriends);
    });
    box.append(chip);
  });
  renderFeedAuthors();
}

function renderFeedAuthors() {
  const box = $("feedAuthors");
  box.textContent = "";
  if (!feedAuthors.length) { box.append(el("div", { className: "muted", textContent: t("fromFeedEmpty") })); return; }
  for (const a of feedAuthors) {
    const listed = settings.friendList.some((e) => C.sameFriend(e, a));
    const chip = el("button", { type: "button", className: "fchip add" + (listed ? " in" : ""), title: listed ? t("inList") : t("add") },
      avatarNode(a, 18), el("span", { className: "nm", textContent: label(a) }), el("span", { className: "x", textContent: listed ? "✓" : "+" }));
    if (!listed) chip.addEventListener("click", () => addFriend(C.cleanEntry(a)));
    box.append(chip);
  }
}

function addFriend(entry) {
  if (!entry) { $("friendMsg").textContent = t("badEntry"); return; }
  $("friendMsg").textContent = "";
  if (settings.friendList.some((e) => C.sameFriend(e, entry))) return;
  patchSettings({ friendList: [...settings.friendList, entry] }).then(renderFriends);
}

async function loadFeedAuthors() {
  const res = await send("authors");
  feedAuthors = (res && res.list) || [];
  renderFeedAuthors();
}

function renderTypes() {
  const body = $("typesBody");
  body.textContent = "";
  for (const type of C.POST_TYPES) {
    const tr = el("tr");
    tr.append(el("td", { textContent: t(TYPE_LABEL[type]) }));
    for (const what of ["like", "comment"]) {
      const input = el("input", { type: "checkbox", checked: !!settings.types[type][what] });
      input.addEventListener("change", () => {
        const types = JSON.parse(JSON.stringify(settings.types));
        types[type][what] = input.checked;
        patchSettings({ types });
      });
      tr.append(el("td", null, el("label", { className: "check" }, input, el("span", { className: "box" }))));
    }
    body.append(tr);
  }
}

// ================================================================= stats
let statsCache = C.emptyStats();

function renderStats() {
  const st = statsCache;
  const today = C.todayCounts(st);
  setDots($("sToday0"), today.likes);
  setDots($("sToday1"), today.comments);
  $("sToday0Lim").textContent = settings.dailyLikes ? t("todayLimit", { v: today.likes, max: settings.dailyLikes }) : "";
  $("sToday1Lim").textContent = settings.dailyComments ? t("todayLimit", { v: today.comments, max: settings.dailyComments }) : "";

  const series = C.seriesForDays(st, 14);
  const max = Math.max(1, ...series.map((d) => d.likes + d.comments));
  const CELLS = 14;
  const chart = $("chart");
  chart.textContent = "";
  series.forEach((d, i) => {
    const col = el("div", { className: "col" + (i === series.length - 1 ? " today" : ""), title: `${d.day}: ${d.likes} / ${d.comments}` });
    const cc = d.comments ? Math.max(1, Math.round((d.comments / max) * CELLS)) : 0;
    const lc = d.likes ? Math.max(1, Math.round((d.likes / max) * CELLS)) : 0;
    for (let k = 0; k < CELLS; k++) col.append(el("i", { className: k < cc ? "c" : k < cc + lc ? "l" : "" }));
    chart.append(col);
  });
  const fmt = (k) => k.slice(5).replace("-", ".");
  $("chartAxis").textContent = "";
  $("chartAxis").append(el("span", { textContent: fmt(series[0].day) }), el("span", { textContent: fmt(series[series.length - 1].day) }));
  const tot = C.totals(st);
  $("allTime").textContent = t("allTime", { l: tot.likes, c: tot.comments });

  const top = C.topFriends(st, 6);
  const box = $("topFriends");
  box.textContent = "";
  if (!top.length) { box.append(el("div", { className: "muted", textContent: t("noStats") })); return; }
  const best = top[0].total || 1;
  for (const f of top) {
    const bar = el("div", { className: "bar" });
    bar.style.width = Math.max(4, Math.round((f.total / best) * 100)) + "%";
    box.append(el("div", { className: "row-f" },
      avatarNode(f, 22),
      el("div", { style: "min-width:0" }, el("div", { className: "nm", textContent: f.name || f.vanity || f.accountId }), bar),
      el("div", { className: "num" }, el("b", { textContent: String(f.likes || 0) }), " · ", el("b", { textContent: String(f.comments || 0) }))));
  }
}

// ================================================================= tab messaging
async function getSteamTab() {
  if (FULL) {
    const tabs = await browser.tabs.query({ url: "*://steamcommunity.com/*" });
    const feed = tabs.find((x) => /\/home\/?/.test(x.url || "")) || tabs[0];
    return feed ? feed.id : null;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab && /^https?:\/\/steamcommunity\.com\//.test(tab.url || "") ? tab.id : null;
}
async function send(type, extra) {
  if (tabId == null) return null;
  try { return await browser.tabs.sendMessage(tabId, Object.assign({ type }, extra || {})); } catch (_) { return null; }
}

// ================================================================= main render
function logLine(entry) {
  if (typeof entry === "string") return entry;
  const time = new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${time}  ${t(entry.k, entry.p)}`;
}

async function render(s) {
  lastSnap = s;
  const { cooldownUntil = 0, profile } = await browser.storage.local.get(["cooldownUntil", "profile"]);
  const cdLeft = cooldownUntil - Date.now();
  const inCooldown = cdLeft > 0;
  const quiet = C.inQuietHours(settings);

  const p = s && s.profile && (s.profile.avatar || s.profile.name) ? s.profile : profile;
  if (s && s.profile && (s.profile.avatar || s.profile.name)) browser.storage.local.set({ profile: s.profile });
  $("name").textContent = (p && p.name) || "Steam";
  drawAvatar(p && p.avatar, p && p.name);

  const chip = $("chip"), st = $("statusText"), title = st.parentElement;
  title.className = "bullet-title";
  if (!s) {
    chip.className = "chip"; chip.textContent = t("chipNoTab");
    st.textContent = t("stOpenFeed");
    $("message").textContent = t("openFeedHint");
    $("start").disabled = $("stop").disabled = true;
  } else {
    if (s.running) {
      chip.className = "chip run"; chip.textContent = s.dry ? t("chipDry") : t("chipRunning");
      st.textContent = s.dry ? t("stDry") : t("stRunning"); title.classList.add("on");
    } else if (s.limited || inCooldown) {
      chip.className = "chip warn"; chip.textContent = inCooldown ? t("chipCooldown") : t("chipLimit");
      st.textContent = t("stAntispam"); title.classList.add("warn");
    } else if (quiet) {
      chip.className = "chip warn"; chip.textContent = t("chipQuiet");
      st.textContent = t("stQuiet"); title.classList.add("warn");
    } else {
      chip.className = "chip"; chip.textContent = t("chipIdle");
      st.textContent = s.hasFeed ? t("stReady") : t("stNoFeed");
    }
    $("message").textContent = s.msg ? t(s.msg.k, s.msg.p) : s.hasFeed ? t("feedLabel") : t("msg.noFeed");
    $("start").disabled = s.running || !s.hasFeed;
    $("stop").disabled = !s.running;
  }

  const total = (s && s.total) || 0;
  if (inCooldown && !(s && s.running)) {
    const mins = Math.ceil(cdLeft / 60000);
    setRing(cdLeft / (settings.cooldownMin * 60000), "#e2683a");
    setDots($("ringNum"), mins);
    $("ringLabel").textContent = t("ringMinCd");
    $("bigNum").textContent = mins;
    $("bigSub").textContent = t("minLeft");
  } else {
    setRing(total / settings.maxPosts, "#b9a8ff");
    setDots($("ringNum"), total);
    $("ringLabel").textContent = t("ringPosts");
    $("bigNum").textContent = total;
    $("bigSub").textContent = t("ofPosts", { n: settings.maxPosts });
  }
  $("clearCooldown").classList.toggle("hidden", !inCooldown);

  setDots($("dLiked"), (s && s.liked) || 0);
  setDots($("dCommented"), (s && s.commented) || 0);
  setDots($("dSkipped"), (s && s.skipped) || 0);

  const today = C.todayCounts(statsCache);
  const lim = (v, max) => (max ? `${v}/${max}` : String(v));
  const tl = $("todayLine");
  tl.textContent = "";
  const parts = t("todayLine", { c: "\u0001", l: "\u0002" }).split(/(\u0001|\u0002)/);
  for (const part of parts) {
    if (part === "\u0001") tl.append(el("b", { textContent: lim(today.comments, settings.dailyComments) }));
    else if (part === "\u0002") tl.append(el("b", { textContent: lim(today.likes, settings.dailyLikes) }));
    else tl.append(part);
  }

  if (s) {
    const lines = (s.log || []).map(logLine);
    const text = lines.join("\n");
    const log = $("log");
    if (log.dataset.raw !== text) {
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 5;
      log.dataset.raw = text;
      log.textContent = "";
      emoText(log, text);
      if (atBottom) log.scrollTop = log.scrollHeight;
    }
  }
}

// ================================================================= settings form
function fillForm() {
  for (const n of form.elements) {
    if (!n.name) continue;
    if (n.type === "checkbox") n.checked = !!settings[n.name];
    else if (settings[n.name] != null) n.value = settings[n.name];
  }
  $("quickDry").checked = settings.dryRun;
  $("quickOnlyNew").checked = settings.onlyNew;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const patch = {};
  for (const n of form.elements) {
    if (!n.name) continue;
    if (BOOLS.includes(n.name)) patch[n.name] = n.checked;
    else if (NUMERIC.includes(n.name)) patch[n.name] = Number(n.value);
    else if (TEXTS.includes(n.name)) patch[n.name] = n.value;
  }
  const langChanged = patch.lang !== settings.lang;
  await patchSettings(patch);
  fillForm();
  if (langChanged) applyLang(); else { renderPool(); renderStats(); }
  $("formMsg").textContent = t("saved");
});

// ================================================================= export / import
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

$("exportBtn").addEventListener("click", async () => {
  const { stats } = await browser.storage.local.get("stats");
  const data = C.buildExport(settings, { stats: stats || C.emptyStats() });
  download(`steam-autolike-${C.dayKey()}.json`, JSON.stringify(data, null, 2));
  $("formMsg").textContent = t("exported");
});

$("importBtn").addEventListener("click", () => {
  if (!FULL) {
    // Firefox closes the popup when a file dialog opens — do it from a tab instead
    browser.tabs.create({ url: browser.runtime.getURL("popup.html?full=1#settings") });
    window.close();
    return;
  }
  $("importFile").click();
});

$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files[0];
  if (!file) return;
  try {
    const data = C.parseImport(await file.text());
    settings = data.settings;
    const save = { settings };
    if (data.stats) save.stats = data.stats;
    await browser.storage.local.set(save);
    if (data.stats) statsCache = data.stats;
    fillForm();
    applyLang();
    $("formMsg").textContent = t("imported", { stats: data.stats ? t("importedStats") : "" });
  } catch (_) {
    $("formMsg").textContent = t("importBad");
  }
  $("importFile").value = "";
});

$("clearHistory").addEventListener("click", async () => {
  await browser.storage.local.set({ processed: [], commentedThreads: [] });
  $("formMsg").textContent = t("historyCleared");
});

$("resetStats").addEventListener("click", async () => {
  statsCache = C.emptyStats();
  await browser.storage.local.set({ stats: statsCache });
  renderStats();
  $("statsMsg").textContent = t("statsReset");
});

// ================================================================= wiring
$("start").addEventListener("click", async () => render(await send("start", { dry: settings.dryRun })));
$("stop").addEventListener("click", async () => render(await send("stop")));
$("clearCooldown").addEventListener("click", async () => {
  await browser.storage.local.set({ cooldownUntil: 0 });
  render(await send("status"));
});
$("quickDry").addEventListener("change", (e) => patchSettings({ dryRun: e.target.checked }));
$("quickOnlyNew").addEventListener("change", (e) => patchSettings({ onlyNew: e.target.checked }));

$("loadEmoticons").addEventListener("click", openPicker);
$("emoSearch").addEventListener("input", renderPicker);
$("manualAdd").addEventListener("click", addManualEmo);
$("manualEmo").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addManualEmo(); } });
form.elements.perComment.addEventListener("change", () => patchSettings({ perComment: Number(form.elements.perComment.value) }).then(renderPool));

document.querySelectorAll("#friendMode button").forEach((b) =>
  b.addEventListener("click", () => patchSettings({ friendMode: b.dataset.mode }).then(renderFriends)));
$("friendAdd").addEventListener("click", () => { addFriend(C.parseFriendInput($("friendInput").value)); $("friendInput").value = ""; });
$("friendInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("friendAdd").click(); } });
$("feedRefresh").addEventListener("click", loadFeedAuthors);

function showTab(name) {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== name));
  if (name === "log") $("log").scrollTop = $("log").scrollHeight;
  if (name === "friends") loadFeedAuthors();
  if (name === "stats") renderStats();
  try { localStorage.setItem("sal-tab", name); } catch (_) {}
}
document.querySelectorAll(".tab").forEach((x) => x.addEventListener("click", () => showTab(x.dataset.tab)));

browser.storage.onChanged.addListener((ch) => {
  if (ch.stats) { statsCache = ch.stats.newValue || C.emptyStats(); renderStats(); }
});

// ================================================================= boot
(async () => {
  if (FULL) document.body.classList.add("full");
  buildRing();
  sprinkleDust();
  const stored = await browser.storage.local.get(["settings", "stats"]);
  settings = C.normalizeSettings(stored.settings);
  statsCache = stored.stats && stored.stats.days ? stored.stats : C.emptyStats();
  try {
    const cmds = await browser.commands.getAll();
    const c = cmds.find((x) => x.name === "toggle-run");
    if (c && c.shortcut) hotkey = c.shortcut;
  } catch (_) {}
  fillForm();
  tabId = await getSteamTab();
  lastSnap = await send("status");
  applyLang();
  let startTab = location.hash.slice(1);
  if (!startTab) { try { startTab = localStorage.getItem("sal-tab") || "run"; } catch (_) { startTab = "run"; } }
  showTab(["run", "friends", "settings", "stats", "log"].includes(startTab) ? startTab : "run");
  setInterval(async () => render(await send("status")), 1000);
})();
