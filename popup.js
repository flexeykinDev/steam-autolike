const DEFAULTS = {
  emoji: ":CVRChanHeart:", emojiPool: [":CVRChanHeart:"], perComment: 1, doLike: true, doComment: true,
  likeDelay: 2500, commentDelay: 7000, maxPosts: 200, maxScrolls: 30,
  onLimit: "stop", cooldownMin: 30
};
const NUMERIC = ["perComment", "likeDelay", "commentDelay", "maxPosts", "maxScrolls", "cooldownMin"];

const $ = (id) => document.getElementById(id);
const form = $("settings");
let tabId = null;
let settings = { ...DEFAULTS };
let avatarDrawnFor = null;

// ================= Цифры из точек (5×7) =================
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

function setDots(el, value) {
  const s = String(value);
  if (el.dataset.v === s) return; // не перерисовываем без изменений
  el.dataset.v = s;
  el.textContent = "";
  for (const ch of s) {
    const rows = FONT[ch] || FONT["-"];
    const g = document.createElement("div");
    g.className = "dg";
    for (const row of rows) for (const bit of row) {
      const i = document.createElement("i");
      if (bit === "1") i.className = "on";
      g.appendChild(i);
    }
    el.appendChild(g);
  }
}

// ================= Кольцо из засечек =================
const TICKS = 44;
function buildRing() {
  const svg = $("ring");
  const ns = "http://www.w3.org/2000/svg";
  for (let k = 0; k < TICKS; k++) {
    const r = document.createElementNS(ns, "rect");
    r.setAttribute("x", "48.5");
    r.setAttribute("y", "3");
    r.setAttribute("width", "3");
    r.setAttribute("height", "6");
    r.setAttribute("transform", `rotate(${(360 / TICKS) * k} 50 50)`);
    svg.appendChild(r);
  }
}
function setRing(frac, color) {
  const lit = Math.round(Math.max(0, Math.min(1, frac)) * TICKS);
  $("ring").querySelectorAll("rect").forEach((r, k) => {
    r.setAttribute("fill", k < lit ? color : "#24242a");
  });
}

// ================= Пылинки =================
function sprinkleDust() {
  const d = $("dust");
  for (let k = 0; k < 26; k++) {
    const i = document.createElement("i");
    if (Math.random() < .3) i.className = "l";
    i.style.left = Math.random() * 100 + "%";
    i.style.top = Math.random() * 100 + "%";
    d.appendChild(i);
  }
}

// ================= Аватарка мозаикой =================
const CELL = 6;   // размер «пикселя»
const GAP = 1;    // зазор между пикселями

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
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const step = CELL + GAP;
  const cols = Math.ceil(W / step), rows = Math.ceil(H / step);

  let pixels = null;
  if (url) {
    try {
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob);
      const small = new OffscreenCanvas(cols, rows);
      const sctx = small.getContext("2d");
      // «cover»: квадратную аватарку растягиваем по ширине, берём центр по высоте
      const scale = cols / bmp.width;
      const drawH = bmp.height * scale;
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
      if (n < 0.04) continue; // выпавшие пиксели — тот самый шум
      let r, g, b;
      if (pixels) {
        const o = (y * cols + x) * 4;
        r = pixels[o]; g = pixels[o + 1]; b = pixels[o + 2];
        const k = 0.72 + n * 0.22; // лёгкое затемнение + разброс яркости
        r *= k; g *= k; b *= k;
      } else {
        // нет аватарки — генерируем из ника
        const v = 18 + n * 26;
        const hit = rnd() < 0.08;
        r = hit ? 120 : v; g = hit ? 100 : v; b = hit ? 200 : v + 6;
      }
      ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
      ctx.fillRect(x * step, y * step, CELL, CELL);
    }
  }
}

// ================= Смайлики Steam =================
const EMO_HOSTS = [
  "https://community.fastly.steamstatic.com/economy/emoticon/",
  "https://community.akamai.steamstatic.com/economy/emoticon/",
  "https://steamcommunity-a.akamaihd.net/economy/emoticon/"
];
const EMO_RE = /:([A-Za-z][A-Za-z0-9_]+):/g;
const bare = (code) => code.replace(/:/g, "");

function emoImg(code, cls = "emo") {
  const img = document.createElement("img");
  img.className = cls;
  img.alt = img.title = code;
  img.loading = "lazy";
  let h = 0;
  img.src = EMO_HOSTS[0] + bare(code);
  img.onerror = () => { if (++h < EMO_HOSTS.length) img.src = EMO_HOSTS[h] + bare(code); };
  return img;
}

// Текст, где :коды: заменены картинками (без innerHTML — лог приходит со страницы)
function renderEmoText(el, text) {
  el.textContent = "";
  let last = 0;
  for (const m of text.matchAll(EMO_RE)) {
    if (m.index > last) el.append(text.slice(last, m.index));
    el.append(emoImg(m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) el.append(text.slice(last));
}

let pool = [];
let emoList = [];

function renderPool() {
  const box = $("poolPreview");
  box.textContent = "";
  if (!pool.length) {
    box.append(Object.assign(document.createElement("span"), {
      className: "muted", textContent: `Пусто — будет ${settings.emoji || DEFAULTS.emoji}`
    }));
  }
  for (const code of pool) {
    const img = emoImg(code);
    img.title = `${code} — убрать`;
    img.addEventListener("click", () => togglePool(code));
    box.append(img);
  }
  $("poolCount").textContent = pool.length ? `${pool.length} шт.` : "";

  // превью на главном экране
  const prev = $("cmtPreview");
  prev.textContent = "";
  const shown = pool.length ? pool : [settings.emoji || DEFAULTS.emoji];
  for (const code of shown.slice(0, 8)) prev.append(emoImg(code));
  if (shown.length > 8) prev.append(` +${shown.length - 8}`);
  if (shown.length > 1) prev.append(Object.assign(document.createElement("span"), {
    className: "muted", textContent: ` · по ${settings.perComment || 1}, случайно`
  }));
  renderPicker();
}

async function savePool() {
  settings.emojiPool = [...pool];
  const { settings: saved = {} } = await browser.storage.local.get("settings");
  await browser.storage.local.set({ settings: { ...DEFAULTS, ...saved, emojiPool: [...pool] } });
}

function togglePool(code) {
  const i = pool.indexOf(code);
  if (i >= 0) pool.splice(i, 1); else pool.push(code);
  renderPool();
  savePool();
}

function renderPicker() {
  const grid = $("emoPicker");
  if (grid.classList.contains("hidden")) return;
  const q = $("emoSearch").value.trim().toLowerCase().replace(/:/g, "");
  grid.textContent = "";
  const list = emoList.filter((c) => !q || c.toLowerCase().includes(q));
  if (!list.length) {
    grid.append(Object.assign(document.createElement("div"), {
      className: "muted",
      textContent: emoList.length ? "Ничего не найдено" : "Список пуст — добавь смайлик вручную по названию"
    }));
    return;
  }
  for (const code of list.slice(0, 400)) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = code;
    if (pool.includes(code)) b.className = "sel";
    b.append(emoImg(code, ""));
    b.addEventListener("click", () => togglePool(code));
    grid.append(b);
  }
}

async function openPicker() {
  const grid = $("emoPicker");
  const btn = $("loadEmoticons");
  if (!grid.classList.contains("hidden")) {
    grid.classList.add("hidden"); $("emoTools").classList.add("hidden");
    btn.textContent = "Мои смайлики";
    return;
  }
  grid.classList.remove("hidden"); $("emoTools").classList.remove("hidden");
  btn.textContent = "Скрыть";

  const { emoCache } = await browser.storage.local.get("emoCache");
  if (emoCache?.list?.length) emoList = emoCache.list;
  grid.textContent = "";
  grid.append(Object.assign(document.createElement("div"), { className: "muted", textContent: "Загружаю смайлики из Steam…" }));

  const res = await send("emoticons");
  if (res?.list?.length) {
    emoList = res.list.sort((a, b) => a.localeCompare(b));
    browser.storage.local.set({ emoCache: { list: emoList, at: Date.now() } });
  } else if (!emoList.length) {
    $("formMsg").textContent = res?.error
      ? `Steam не отдал список (${res.error}). Можно добавить смайлик вручную.`
      : "Открой любую страницу steamcommunity.com, чтобы подтянуть твои смайлики.";
  }
  renderPicker();
}

function addManual() {
  let v = $("manualEmo").value.trim();
  if (!v) return;
  v = ":" + v.replace(/:/g, "") + ":";
  if (!/^:[A-Za-z0-9_]+:$/.test(v)) { $("formMsg").textContent = "Название — только буквы, цифры и _"; return; }
  if (!pool.includes(v)) togglePool(v);
  if (!emoList.includes(v)) emoList.unshift(v);
  $("manualEmo").value = "";
  renderPicker();
}

// ================= Общение с вкладкой =================
async function getSteamTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https?:\/\/steamcommunity\.com\//.test(tab.url || "")) return tab.id;
  return null;
}
async function send(type) {
  if (tabId == null) return null;
  try { return await browser.tabs.sendMessage(tabId, { type }); }
  catch (_) { return null; }
}

// ================= Отрисовка =================
async function render(s) {
  const { cooldownUntil = 0, profile } = await browser.storage.local.get(["cooldownUntil", "profile"]);
  const cdLeft = cooldownUntil - Date.now();
  const inCooldown = cdLeft > 0;

  // профиль: из вкладки или из кэша
  const p = s?.profile?.avatar || s?.profile?.name ? s.profile : profile;
  if (s?.profile && (s.profile.avatar || s.profile.name)) browser.storage.local.set({ profile: s.profile });
  $("name").textContent = p?.name || "Steam";
  drawAvatar(p?.avatar, p?.name);

  const chip = $("chip");
  const st = $("statusText");
  const title = st.parentElement;
  title.className = "bullet-title";

  if (!s) {
    chip.className = "chip"; chip.textContent = "нет вкладки";
    st.textContent = "Открой ленту Steam";
    $("message").textContent = "steamcommunity.com/id/<ты>/home, затем обнови страницу";
    $("start").disabled = $("stop").disabled = true;
  } else {
    if (s.running) {
      chip.className = "chip run"; chip.textContent = "работает";
      st.textContent = "Работает"; title.classList.add("on");
    } else if (s.limited || inCooldown) {
      chip.className = "chip warn"; chip.textContent = inCooldown ? "кулдаун" : "лимит";
      st.textContent = "Антиспам Steam"; title.classList.add("warn");
    } else {
      chip.className = "chip"; chip.textContent = "ожидание";
      st.textContent = s.hasFeed ? "Готов к запуску" : "Нет ленты на странице";
    }
    $("message").textContent = s.message || (s.hasFeed ? "Лента активности Steam" : "Открой ленту активности");
    $("start").disabled = s.running || !s.hasFeed;
    $("stop").disabled = !s.running;
  }

  const total = s?.total || 0;
  if (inCooldown && !s?.running) {
    const mins = Math.ceil(cdLeft / 60000);
    setRing(cdLeft / ((settings.cooldownMin || 30) * 60000), "#e2683a");
    setDots($("ringNum"), mins);
    $("ringLabel").textContent = "МИН КД";
    $("bigNum").textContent = mins;
    $("bigSub").textContent = "мин до снятия лимита";
  } else {
    setRing(total / (settings.maxPosts || 200), "#b9a8ff");
    setDots($("ringNum"), total);
    $("ringLabel").textContent = "ПОСТОВ";
    $("bigNum").textContent = total;
    $("bigSub").textContent = `/ ${settings.maxPosts} постов`;
  }
  $("clearCooldown").classList.toggle("hidden", !inCooldown);

  setDots($("dLiked"), s?.liked || 0);
  setDots($("dCommented"), s?.commented || 0);
  setDots($("dSkipped"), s?.skipped || 0);

  if (s) {
    const log = $("log");
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 5;
    const text = s.log.join("\n");
    if (log.dataset.raw !== text) {
      log.dataset.raw = text;
      renderEmoText(log, text);
      if (atBottom) log.scrollTop = log.scrollHeight;
    }
  }
}

// ================= Настройки =================
async function loadSettings() {
  const { settings: saved = {} } = await browser.storage.local.get("settings");
  settings = { ...DEFAULTS, ...saved };
  pool = Array.isArray(saved.emojiPool) ? [...saved.emojiPool] : [settings.emoji || DEFAULTS.emoji];
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") el.checked = !!settings[el.name];
    else el.value = settings[el.name];
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const s = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") s[el.name] = el.checked;
    else if (NUMERIC.includes(el.name)) s[el.name] = Number(el.value) || DEFAULTS[el.name];
    else s[el.name] = el.value;
  }
  s.emoji = settings.emoji || DEFAULTS.emoji;
  s.emojiPool = [...pool];
  s.perComment = Math.max(1, Math.min(5, s.perComment));
  settings = s;
  await browser.storage.local.set({ settings: s });
  $("formMsg").textContent = "Сохранено — применится при следующем старте.";
});

$("clearHistory").addEventListener("click", async () => {
  await browser.storage.local.set({ processed: [] });
  $("formMsg").textContent = "История обработанных постов очищена.";
});

// ================= Кнопки и табы =================
$("loadEmoticons").addEventListener("click", openPicker);
$("emoSearch").addEventListener("input", renderPicker);
$("manualAdd").addEventListener("click", addManual);
$("manualEmo").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } });
form.elements.perComment.addEventListener("change", () => { settings.perComment = Number(form.elements.perComment.value) || 1; renderPool(); });
$("start").addEventListener("click", async () => render(await send("start")));
$("stop").addEventListener("click", async () => render(await send("stop")));
$("clearCooldown").addEventListener("click", async () => {
  await browser.storage.local.set({ cooldownUntil: 0 });
  render(await send("status"));
});

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== t.dataset.tab));
    if (t.dataset.tab === "log") $("log").scrollTop = $("log").scrollHeight;
  });
});

// ================= Старт =================
(async () => {
  buildRing();
  sprinkleDust();
  await loadSettings();
  tabId = await getSteamTab();
  renderPool();
  render(await send("status"));
  setInterval(async () => render(await send("status")), 1000);
})();
