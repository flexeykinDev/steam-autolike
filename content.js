(() => {
  if (window.__steamAutolike) return;
  window.__steamAutolike = true;

  const DEFAULTS = {
    emoji: ":steamhappy:",          // запасной, если пул пуст (есть у всех)
    emojiPool: [":steamhappy:"],    // из пула берутся случайные смайлики
    perComment: 1,                  // сколько смайликов в одном комменте
    doLike: true,
    doComment: true,
    likeDelay: 2500,      // мс после лайка
    commentDelay: 7000,   // мс после комментария
    scrollDelay: 2200,
    expandWait: 1500,
    maxPosts: 200,
    maxScrolls: 30,
    onLimit: "stop",      // "stop" — остановить всё, "likesOnly" — дальше только лайки
    cooldownMin: 30
  };

  const LIMIT_RE = /too frequently|too many|posting too|rate limit|try again later|слишком часто|слишком много|попробуйте позже|подождите/i;
  const MAX_RESUMES = 25;          // защита от бесконечного цикла «ушёл — вернулся»
  const RUN_STALE_MS = 5 * 60000;  // старый незавершённый запуск не возобновляем
  const STOP = Symbol("stop");

  // В Firefox content.fetch идёт от имени страницы (с её куками), обычный fetch — от расширения
  const pageFetch = (typeof content !== "undefined" && content.fetch)
    ? (...a) => content.fetch(...a)
    : (...a) => fetch(...a);

  function getPool() {
    const p = (settings.emojiPool || []).filter((e) => /^:[^:\s]+:$/.test(e));
    return p.length ? p : [settings.emoji || DEFAULTS.emoji];
  }
  let lastComment = "";
  function buildComment() {
    const pool = getPool();
    const n = Math.max(1, Math.min(5, Number(settings.perComment) || 1));
    for (let attempt = 0; attempt < 5; attempt++) {
      const bag = [...pool];
      const out = [];
      for (let k = 0; k < n; k++) {
        if (!bag.length) bag.push(...pool); // пул меньше n — допускаем повторы
        out.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
      }
      const text = out.join(" ");
      if (text !== lastComment || pool.length === 1) { lastComment = text; return text; }
    }
    return lastComment;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (ms) => Math.round(ms * (0.85 + Math.random() * 0.4));

  let settings = { ...DEFAULTS };
  let stopRequested = false;
  let commentsDisabled = false;
  let consecutiveErrors = 0;
  let pendingResult = null;
  let processed = new Set();
  let commentedThreads = new Set(); // ветки, где мы точно оставили коммент
  let me = null;

  const state = {
    running: false, liked: 0, commented: 0, skipped: 0, total: 0, scrolls: 0,
    limited: false, message: "", log: []
  };

  // ---------- Состояние запуска, переживающее перезагрузку страницы ----------
  // run = { active, feedUrl, currentKey, resumes, touched, stats, log }
  let run = null;

  async function saveRun() {
    if (!run) return;
    run.touched = Date.now();
    run.stats = {
      liked: state.liked, commented: state.commented, skipped: state.skipped,
      total: state.total, scrolls: state.scrolls
    };
    run.log = state.log.slice(-80);
    await browser.storage.local.set({ run });
  }
  async function endRun() {
    if (run) run.active = false;
    await saveRun();
  }

  function log(msg) {
    const line = `${new Date().toLocaleTimeString()}  ${msg}`;
    state.log.push(line);
    if (state.log.length > 80) state.log.shift();
    console.log("[Autolike]", msg);
    saveRun();
  }

  async function wait(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (stopRequested) throw STOP;
      await sleep(Math.min(250, end - Date.now()));
    }
  }

  // ---------- Блокировка переходов, вызванных скриптом ----------
  // 1) Navigation API: ловит и ссылки, и JS-переходы (location = ...), если их начал не пользователь.
  try {
    const nav = window.navigation;
    if (nav && typeof nav.addEventListener === "function") {
      nav.addEventListener("navigate", (e) => {
        if (!state.running) return;
        if (e.userInitiated || e.navigationType === "traverse" || e.navigationType === "reload") return;
        if (e.destination?.sameDocument) return; // pushState/хэш — не трогаем, может использоваться лентой
        if (e.cancelable) {
          e.preventDefault();
          log(`🛑 Заблокирован переход: ${e.destination?.url || "?"}`);
        }
      });
    }
  } catch (_) {}

  // 2) Обычные ссылки — на случай браузера без Navigation API.
  function isNavLink(a) {
    if (!a || a.tagName !== "A") return false;
    const href = (a.getAttribute("href") || "").trim();
    return !!href && !href.startsWith("#") && !/^javascript:/i.test(href);
  }
  document.addEventListener("click", (e) => {
    if (!state.running || e.isTrusted) return;
    const a = e.target.closest?.("a[href]");
    if (isNavLink(a)) {
      e.preventDefault();
      log(`🛑 Заблокирована ссылка: ${a.href}`);
    }
  }, true);

  // Клик с записью «что кликаем» до клика — если страница всё же уйдёт, будет видно виновника.
  async function safeClick(el, what, key) {
    if (run) run.currentKey = key || null;
    log(`клик: ${what}`);
    await saveRun();
    el.click();
  }

  // ---------- Кто я ----------
  function getMe() {
    const w = window.wrappedJSObject || window;
    let steamID = null, vanity = null, accountId = null;
    try { if (w.g_steamID) steamID = String(w.g_steamID); } catch (_) {}

    const a = document.querySelector(
      "#global_actions a.user_avatar, #global_actions .playerAvatar a, #headerUserAvatar a"
    );
    if (a) {
      const m = (a.href || "").match(/\/(id|profiles)\/([^\/?#]+)/);
      if (m) {
        if (m[1] === "profiles") steamID = steamID || m[2];
        else vanity = m[2].toLowerCase();
      }
    }
    if (steamID && /^\d{17}$/.test(steamID)) {
      accountId = String(BigInt(steamID) - 76561197960265728n); // = data-miniprofile
    }
    return { steamID, vanity, accountId };
  }

  // ---------- Обработанные посты ----------
  async function loadProcessed() {
    const { processed: arr = [], commentedThreads: ct = [] } =
      await browser.storage.local.get(["processed", "commentedThreads"]);
    processed = new Set(arr);
    commentedThreads = new Set(ct);
  }
  async function markProcessed(key) {
    if (!key) return;
    processed.add(key);
    let arr = [...processed];
    if (arr.length > 3000) { arr = arr.slice(-3000); processed = new Set(arr); }
    await browser.storage.local.set({ processed: arr });
  }

  function getPostKey(post) {
    const vote = post.querySelector('[id^="vote_up_"], [id^="VoteUpBtn_"]');
    if (vote?.id) return vote.id;
    const thread = post.querySelector('[id^="commentthread_"]');
    if (thread?.id) return thread.id.replace(/_(area|textarea|submit|posts|footer).*$/, "");
    return null;
  }

  // ---------- Комментарии ----------
  function hasMyComment(root) {
    const comments = root.querySelectorAll(".commentthread_comment");
    const pool = getPool();
    for (const c of comments) {
      const author = c.querySelector(
        "a.commentthread_author_link, .commentthread_comment_author a[href], .commentthread_comment_avatar a[href]"
      );
      if (author) {
        const href = (author.getAttribute("href") || "").toLowerCase().replace(/\/+$/, "");
        const mp = author.dataset?.miniprofile || author.closest("[data-miniprofile]")?.dataset?.miniprofile;
        if ((me.steamID && href.endsWith("/profiles/" + me.steamID)) ||
            (me.vanity && href.endsWith("/id/" + me.vanity)) ||
            (me.accountId && mp === me.accountId)) return true;
      }
      const text = c.querySelector(".commentthread_comment_text");
      if (text) {
        const t = text.textContent;
        if (pool.some((e) => t.includes(e))) return true;
        for (const img of text.querySelectorAll("img[alt]")) if (pool.includes(img.alt)) return true;
      }
    }
    return false;
  }

  // ---------- Ветка комментариев целиком (все страницы) ----------
  // Steam хранит параметры ветки в g_rgCommentThreads[key] и в вызове
  // InitializeCommentThread("Тип", "key", {owner, feature, feature2, total_count…}, "https://…/comment/Тип/").
  // Все комменты отдаёт POST …/comment/<Тип>/render/<owner>/<feature>/ с start/count.

  const RENDER_PAGE = 100;   // комментов за запрос
  const RENDER_MAX_PAGES = 60;

  function threadKeyIn(root) {
    const el = root.querySelector(
      '[id^="commentthread_"][id$="_area"], [id^="commentthread_"][id$="_posts"], ' +
      '[id^="commentthread_"][id$="_textarea"], [id^="commentthread_"][id$="_postcontainer"]'
    );
    const m = el?.id.match(/^commentthread_(.+)_(area|posts|textarea|postcontainer)$/);
    return m ? m[1] : null;
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function threadFromGlobal(key) {
    try {
      const t = (window.wrappedJSObject || window).g_rgCommentThreads?.[key];
      const d = t?.m_rgCommentData;
      if (!t || !d) return null;
      return {
        url: String(t.m_strActionURL || ""),
        owner: d.owner != null ? String(d.owner) : null,
        feature: d.feature != null ? String(d.feature) : null,
        feature2: d.feature2 != null ? String(d.feature2) : null,
        extended: d.extended_data != null ? String(d.extended_data) : null,
        total: Number(t.m_cTotalCount ?? d.total_count) || 0
      };
    } catch (_) { return null; }
  }

  function threadFromHtml(key, html) {
    if (!html) return null;
    const re = new RegExp(
      `InitializeCommentThread\\(\\s*["'][^"']*["']\\s*,\\s*["']${escRe(key)}["']\\s*,\\s*(\\{[\\s\\S]*?\\})\\s*,\\s*["']([^"']+)["']`
    );
    const m = html.match(re);
    if (!m) return null;
    try {
      const d = JSON.parse(m[1]);
      return {
        url: m[2],
        owner: d.owner != null ? String(d.owner) : null,
        feature: d.feature != null ? String(d.feature) : null,
        feature2: d.feature2 != null ? String(d.feature2) : null,
        extended: d.extended_data != null ? String(d.extended_data) : null,
        total: Number(d.total_count) || 0
      };
    } catch (_) { return null; }
  }

  // Запасной вариант: ключ вида Тип_<owner>_<feature>, у профиля — Тип_<owner>
  function threadFromKey(key) {
    const parts = key.split("_");
    const i = parts.findIndex((p) => /^\d{10,}$/.test(p));
    if (i < 1) return null;
    const type = parts.slice(0, i).join("_");
    return {
      url: `https://steamcommunity.com/comment/${type}/`,
      owner: parts[i],
      feature: parts.length > i + 1 ? parts.slice(i + 1).join("_") : "-1",
      feature2: null, extended: null, total: 0
    };
  }

  function getThread(root, html) {
    const key = threadKeyIn(root);
    if (!key) return null;
    const t = threadFromGlobal(key) || threadFromHtml(key, html ?? root.innerHTML) || threadFromKey(key);
    if (!t || !t.url || !t.owner || t.feature == null) return null;
    if (!t.url.endsWith("/")) t.url += "/";
    return { key, ...t };
  }

  function getSessionId() {
    try {
      const s = (window.wrappedJSObject || window).g_sessionID;
      if (s) return String(s);
    } catch (_) {}
    return document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/)?.[1] || null;
  }

  // true/false — есть ли мой коммент во всей ветке; null — проверить не удалось
  async function scanThread(t) {
    const sessionid = getSessionId();
    if (!sessionid) return null;
    const endpoint = `${t.url}render/${t.owner}/${t.feature}/`;
    let start = 0, total = Infinity, seen = 0;

    for (let page = 0; page < RENDER_MAX_PAGES && start < total; page++) {
      const body = new URLSearchParams({ start, count: RENDER_PAGE, sessionid });
      if (t.feature2 != null) body.set("feature2", t.feature2);
      if (t.extended) body.set("extended_data", t.extended);
      let j;
      try {
        const r = await pageFetch(endpoint, { method: "POST", body, credentials: "include" });
        if (!r.ok) return null;
        j = await r.json();
      } catch (e) {
        if (e === STOP) throw e;
        return null;
      }
      if (!j || !j.success) return null;

      total = Number(j.total_count) || 0;
      const doc = new DOMParser().parseFromString(j.comments_html || "", "text/html");
      const got = doc.querySelectorAll(".commentthread_comment").length;
      if (hasMyComment(doc)) return true;
      seen += got;
      if (!got) break;
      start += got;
      if (start < total) await wait(jitter(500));
    }
    if (start < total) return null; // не дочитали — лучше пропустить пост
    if (total > 6) log(`Проверено ${seen}/${total} комментов, моего нет`);
    return false;
  }

  // Проверка по странице самого поста — фоном через fetch, без перехода
  async function checkRemote(url) {
    try {
      const r = await pageFetch(url, { credentials: "include" });
      if (!r.ok) return null;
      const html = await r.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (hasMyComment(doc)) return true;
      const t = getThread(doc, html);
      if (t) return await scanThread(t);
      // ветку не нашли — верим странице только если на ней нет пагинации
      return doc.querySelector('[id$="_pagecontrols"]:not([style*="none"]), [id$="_pagebtn_next"]') ? null : false;
    } catch (e) {
      if (e === STOP) throw e;
      return null;
    }
  }

  // Ссылка на отдельную страницу поста (status/recommended/screenshot и т.п.)
  function getPostPageUrl(post) {
    const a = post.querySelector(
      'a[href*="/status/"], a[href*="/recommended/"], a[href*="/sharedfiles/filedetails/"], a[href*="/screenshot/"]'
    );
    return a ? a.href : null;
  }

  // true/false — есть ли мой коммент; null — проверить не удалось
  async function fullCheck(post, key) {
    if (hasMyComment(post)) return true;

    // 0) Свой журнал: на этой ветке мы уже оставляли коммент
    const tKey = threadKeyIn(post);
    if (tKey && commentedThreads.has(tKey)) return true;

    // 1) Основной путь: выгружаем ВСЕ страницы ветки через API Steam
    const t = getThread(post);
    if (t) {
      const visible = post.querySelectorAll(".commentthread_comment").length;
      if (t.total && visible >= t.total) return false; // и так всё видно
      const res = await scanThread(t);
      if (res !== null) return res;
      log("API комментов не ответил — пробую страницу поста");
    }

    // 2) Запасной: страница поста фоном (и её ветка — тоже целиком)
    const btn = post.querySelector(
      ".blotter_viewallcomments_container a, .blotter_viewallcomments a, a.blotter_viewallcomments, " +
      ".commentthread_showmore a, a.commentthread_expand"
    );
    const url = (btn && isNavLink(btn) ? btn.href : null) || getPostPageUrl(post);
    if (url) return await checkRemote(url);

    // 3) Ни API, ни страницы: уверены только если признаков других страниц нет
    if (btn) {
      await safeClick(btn, "показать все комменты", key);
      await wait(settings.expandWait);
      if (hasMyComment(post)) return true;
    }
    const paged = post.querySelector('[id$="_pagebtn_next"], [id$="_pagelinks"] a, .commentthread_paging a');
    return paged || btn ? null : false;
  }

  function waitCommentResult(timeout) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { pendingResult = null; resolve({ timeout: true }); }, timeout);
      pendingResult = (r) => { clearTimeout(t); pendingResult = null; resolve(r); };
    });
  }

  function onRateLimit(error) {
    if (state.limited) return;
    state.limited = true;
    commentsDisabled = true;
    log(`⛔ Лимит Steam: ${error || "без текста"}`);
    if (settings.onLimit === "stop") {
      state.message = "Steam включил антиспам — остановлено";
      stopRequested = true;
    } else {
      state.message = "Steam включил антиспам — дальше только лайки";
    }
    browser.storage.local.set({ cooldownUntil: Date.now() + settings.cooldownMin * 60000, lastLimitError: error || "" });
  }

  async function rememberComment(post) {
    const k = threadKeyIn(post);
    if (!k) return;
    commentedThreads.add(k);
    const arr = [...commentedThreads].slice(-10000);
    await browser.storage.local.set({ commentedThreads: arr });
  }

  async function postComment(post, key) {
    const input = post.querySelector("textarea.commentthread_textarea");
    const submit = post.querySelector(
      '.commentthread_entry_submitlink .btn_green_white_innerfade, [id^="commentthread_"][id$="_submit"]'
    );
    if (!input || !submit) return "nobox";

    input.focus();
    const commentText = buildComment();
    input.value = commentText;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    await wait(500);

    const resultP = waitCommentResult(12000);
    await safeClick(submit, "отправить коммент", key);
    const r = await resultP;

    if (r.timeout) {
      const err = post.querySelector(".commentthread_entry_error");
      const t = err && err.offsetParent !== null ? err.textContent.trim() : "";
      if (t) {
        if (LIMIT_RE.test(t)) { onRateLimit(t); return "limited"; }
        log(`Ошибка: ${t}`);
        return "error";
      }
      if (hasMyComment(post)) { state.commented++; await rememberComment(post); log("💬 Коммент (подтверждён по странице)"); return "ok"; }
      log("Steam не ответил на комментарий");
      return "error";
    }

    if (r.ok) {
      consecutiveErrors = 0;
      state.commented++;
      await rememberComment(post);
      log(`💬 Коммент (${state.commented}): ${commentText}`);
      await wait(jitter(settings.commentDelay));
      return "ok";
    }
    if (r.rateLimited) { onRateLimit(r.error); return "limited"; }

    consecutiveErrors++;
    log(`Steam отклонил комментарий: ${r.error || "HTTP " + r.status}`);
    if (consecutiveErrors >= 3) onRateLimit("3 ошибки подряд");
    return "error";
  }

  // ---------- Лайки ----------
  function alreadyLiked(post) {
    return !!post.querySelector(
      '[id^="vote_up_"].active, [id^="vote_up_"].btn_active, ' +
      '[id^="VoteUpBtn_"].active, [id^="VoteUpBtn_"].btn_active, .rate_up.active'
    );
  }
  function getLikeButton(post) {
    return post.querySelector(
      'a[id^="vote_up_"]:not(.active):not(.btn_active), ' +
      'a[id^="VoteUpBtn_"]:not(.active):not(.btn_active), .rate_up:not(.active)'
    );
  }

  // ---------- Основная логика ----------
  async function processPost(post) {
    if (post.dataset.salDone) return false;
    const key = getPostKey(post);
    post.dataset.salDone = "1";
    if (key && processed.has(key)) { state.skipped++; return false; }
    post.scrollIntoView({ block: "center" });

    if (settings.doLike && !alreadyLiked(post)) {
      const b = getLikeButton(post);
      if (b) {
        await safeClick(b, "лайк", key);
        state.liked++;
        log(`👍 Лайк (${state.liked})`);
        await wait(jitter(settings.likeDelay));
      }
    }

    let done = !settings.doComment;
    if (settings.doComment && !commentsDisabled) {
      const mine = await fullCheck(post, key);
      if (mine === null) {
        state.skipped++;
        log("Не удалось проверить все комменты → пропуск");
      } else if (mine) {
        state.skipped++;
        log("Уже комментировал → пропуск");
        done = true;
      } else {
        const res = await postComment(post, key);
        done = res === "ok" || res === "nobox";
      }
    }
    if (run) run.currentKey = null;
    if (done) await markProcessed(key);
    return true;
  }

  async function runPass() {
    for (const post of document.querySelectorAll(".blotter_block")) {
      if (stopRequested) throw STOP;
      if (state.total >= settings.maxPosts) return;
      if (await processPost(post)) {
        state.total++;
        await saveRun();
      }
    }
  }

  async function loop() {
    await runPass();
    while (state.scrolls < settings.maxScrolls && state.total < settings.maxPosts) {
      const before = document.querySelectorAll(".blotter_block").length;
      window.scrollTo(0, document.body.scrollHeight);
      await wait(settings.scrollDelay);
      window.scrollBy(0, 350);
      await wait(1000);
      state.scrolls++;
      const after = document.querySelectorAll(".blotter_block").length;
      log(`Скролл ${state.scrolls} | постов на странице: ${after}`);
      await runPass();
      if (after === before) { log("Новых постов больше нет"); break; }
    }
  }

  async function start(resume = false) {
    if (state.running) return;
    const stored = await browser.storage.local.get(["settings", "cooldownUntil"]);
    settings = { ...DEFAULTS, ...(stored.settings || {}) };
    stopRequested = false;
    commentsDisabled = false;
    consecutiveErrors = 0;

    if (!resume) {
      Object.assign(state, { liked: 0, commented: 0, skipped: 0, total: 0, scrolls: 0, limited: false, message: "", log: [] });
      run = { active: true, feedUrl: location.href, currentKey: null, resumes: 0 };
    }

    const cd = stored.cooldownUntil || 0;
    if (cd > Date.now()) {
      const mins = Math.ceil((cd - Date.now()) / 60000);
      if (settings.onLimit === "stop" || !settings.doLike) {
        state.message = `Кулдаун Steam ещё ~${mins} мин`;
        log(state.message);
        await endRun();
        return;
      }
      commentsDisabled = true;
      log(`Кулдаун ещё ~${mins} мин — только лайки`);
    }

    if (!document.querySelector(".blotter_block")) {
      state.message = "На этой странице нет ленты активности";
      await endRun();
      return;
    }

    me = getMe();
    if (!me.steamID && !me.vanity) log("⚠ Не удалось определить свой профиль — проверка идёт только по эмодзи");

    await loadProcessed();
    state.running = true;
    log(resume ? "▶ Продолжаю после возврата на ленту" : "▶ Старт");
    try {
      await loop();
    } catch (e) {
      if (e !== STOP) log(`Ошибка: ${e.message}`);
    } finally {
      state.running = false;
      if (pendingResult) pendingResult({ timeout: true });
      log(`■ Готово: лайков ${state.liked}, комментов ${state.commented}, пропущено ${state.skipped}`);
      if (!state.message) state.message = stopRequested && !state.limited ? "Остановлено" : "Готово";
      await endRun();
    }
  }

  // ---------- Возобновление после ухода со страницы ----------
  async function checkResume() {
    const { run: saved } = await browser.storage.local.get("run");
    if (!saved) return;

    // показываем прошлый лог даже если запуск завершён
    state.log = saved.log || [];
    Object.assign(state, saved.stats || {});
    if (!saved.active) return;

    if (Date.now() - (saved.touched || 0) > RUN_STALE_MS) {
      saved.active = false;
      await browser.storage.local.set({ run: saved });
      return;
    }

    run = saved;
    const onFeed = !!document.querySelector(".blotter_block");

    if (!onFeed) {
      // Скрипт увёл нас на страницу поста — возвращаемся на ленту
      if (run.resumes >= MAX_RESUMES) {
        log("Слишком много уходов со страницы — остановлено");
        state.message = "Остановлено: страница уходила слишком часто";
        await endRun();
        return;
      }
      log(`↩ Ушли на ${location.pathname} — возвращаюсь на ленту`);
      if (run.currentKey) {
        await markProcessedRaw(run.currentKey);
        log(`Пост ${run.currentKey} уводил со страницы — пропускаю его`);
        run.currentKey = null;
      }
      run.resumes++;
      await saveRun();
      location.replace(run.feedUrl);
      return;
    }

    // Снова на ленте — продолжаем
    if (run.currentKey) {
      await markProcessedRaw(run.currentKey);
      log(`Пост ${run.currentKey} уводил со страницы — пропускаю его`);
      run.currentKey = null;
    }
    await sleep(1500);
    start(true);
  }

  async function markProcessedRaw(key) {
    const { processed: arr = [] } = await browser.storage.local.get("processed");
    if (!arr.includes(key)) arr.push(key);
    await browser.storage.local.set({ processed: arr.slice(-3000) });
  }

  // Смайлики, которые есть у аккаунта
  async function getEmoticons() {
    const r = await pageFetch("https://steamcommunity.com/actions/EmoticonList", { credentials: "include" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const text = await r.text();
    const names = new Set();
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : (j.emoticons || j.rgEmoticons || Object.values(j));
      for (const it of arr) {
        const n = typeof it === "string" ? it : (it?.name || it?.emoticon || "");
        if (n) names.add(n.replace(/:/g, ""));
      }
    } catch (_) {
      // не JSON — выдёргиваем имена из текста/HTML
      for (const m of text.matchAll(/:([A-Za-z0-9_]{2,}):/g)) names.add(m[1]);
      for (const m of text.matchAll(/emoticon\/([A-Za-z0-9_]{2,})/g)) names.add(m[1]);
    }
    return [...names].map((n) => `:${n}:`);
  }

  function getProfile() {
    const img = document.querySelector(
      "#global_actions a.user_avatar img, #global_actions .playerAvatar img, #headerUserAvatar img"
    );
    const nameEl = document.querySelector("#account_pulldown, .persona_name_text_content");
    let avatar = img?.src || null;
    // берём полноразмерную аватарку: xxx.jpg / xxx_medium.jpg -> xxx_full.jpg
    if (avatar) avatar = avatar.replace(/(_medium|_full)?\.(jpg|png|gif)(\?.*)?$/i, "_full.$2");
    return { avatar, name: nameEl?.textContent.trim() || null };
  }

  function snapshot() {
    return {
      ...state,
      log: state.log.slice(-40),
      hasFeed: !!document.querySelector(".blotter_block"),
      profile: getProfile()
    };
  }

  browser.runtime.onMessage.addListener((msg) => {
    switch (msg?.type) {
      case "commentResult":
        if (pendingResult) pendingResult(msg);
        else if (msg.rateLimited && state.running) onRateLimit(msg.error);
        return;
      case "start":
        start(false);
        return Promise.resolve(snapshot());
      case "stop":
        stopRequested = true;
        if (run) { run.active = false; saveRun(); }
        return Promise.resolve(snapshot());
      case "status":
        return Promise.resolve(snapshot());
      case "emoticons":
        return getEmoticons().then((list) => ({ list }), (e) => ({ error: e.message }));
    }
  });

  checkResume();
})();
