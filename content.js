/*
 * Steam Autolike — content script (runs on steamcommunity.com).
 * Walks the activity feed: likes posts, leaves one emoticon comment per post,
 * never twice, and backs off when Steam's anti-spam kicks in.
 * Pure logic lives in lib/core.js (SALCore); log lines are i18n keys translated by the popup.
 */
(() => {
  if (window.__steamAutolike) return;
  window.__steamAutolike = true;

  const C = globalThis.SALCore;

  const MAX_RESUMES = 25;            // guard against an endless "left the page — came back" loop
  const RUN_STALE_MS = 5 * 60000;    // don't resume a run that was abandoned long ago
  const RENDER_PAGE = 100;           // comments per request when reading a whole thread
  const RENDER_MAX_PAGES = 60;
  const STOP = Symbol("stop");
  const FINISH = Symbol("finish");

  // In Firefox content.fetch runs as the page (with its cookies); plain fetch runs as the extension.
  const pageFetch = (typeof content !== "undefined" && content.fetch)
    ? (...a) => content.fetch(...a)
    : (...a) => fetch(...a);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (ms) => Math.round(ms * (0.85 + Math.random() * 0.4));
  const pageWin = () => window.wrappedJSObject || window;

  let settings = C.normalizeSettings({});
  let stopRequested = false;
  let commentsDisabled = false;
  let likesDisabled = false;
  let consecutiveErrors = 0;
  let pendingResult = null;
  let processed = new Set();
  let processedBefore = new Set();     // snapshot at start: posts handled in earlier runs
  let commentedThreads = new Set();    // threads we definitely commented on
  let stats = C.emptyStats();
  let me = null;
  let lastComment = "";
  let knownStreak = 0;

  const state = {
    running: false, dry: false, auto: false,
    liked: 0, commented: 0, skipped: 0, total: 0, scrolls: 0,
    limited: false, msg: null, log: []
  };

  // ---------------------------------------------------------------- run persistence
  // run = { active, feedUrl, currentKey, resumes, dry, auto, touched, stats, log, msg }
  let run = null;
  let saveTimer = null;

  async function saveRun() {
    if (!run) return;
    run.touched = Date.now();
    run.stats = { liked: state.liked, commented: state.commented, skipped: state.skipped, total: state.total, scrolls: state.scrolls };
    run.log = state.log.slice(-120);
    run.msg = state.msg;
    run.limited = state.limited;
    await browser.storage.local.set({ run });
  }
  function saveRunSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveRun, 300);
  }
  async function endRun() {
    if (run) run.active = false;
    clearTimeout(saveTimer);
    await saveRun();
  }

  function log(k, p) {
    state.log.push({ ts: Date.now(), k, p: p || null });
    if (state.log.length > 120) state.log.shift();
    console.log("[Autolike]", k, p || "");
    saveRunSoon();
  }

  async function wait(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (stopRequested) throw STOP;
      await sleep(Math.min(250, end - Date.now()));
    }
  }

  // ---------------------------------------------------------------- navigation guard
  // 1) Navigation API: cancels both link clicks and JS navigations (location = …) not started by the user.
  try {
    const nav = window.navigation;
    if (nav && typeof nav.addEventListener === "function") {
      nav.addEventListener("navigate", (e) => {
        if (!state.running) return;
        if (e.userInitiated || e.navigationType === "traverse" || e.navigationType === "reload") return;
        if (e.destination && e.destination.sameDocument) return;
        if (e.cancelable) {
          e.preventDefault();
          log("log.blockedNav", { url: (e.destination && e.destination.url) || "?" });
        }
      });
    }
  } catch (_) {}

  // 2) Plain links — for browsers without the Navigation API.
  function isNavLink(a) {
    if (!a || a.tagName !== "A") return false;
    const href = (a.getAttribute("href") || "").trim();
    return !!href && !href.startsWith("#") && !/^javascript:/i.test(href);
  }
  document.addEventListener("click", (e) => {
    if (!state.running || e.isTrusted) return;
    const a = e.target.closest && e.target.closest("a[href]");
    if (isNavLink(a)) {
      e.preventDefault();
      log("log.blockedLink", { url: a.href });
    }
  }, true);

  // Record what we click before clicking: if the page still navigates away, we know which post did it.
  async function safeClick(el, what, key) {
    if (run) run.currentKey = key || null;
    log("log.click." + what);
    await saveRun();
    el.click();
  }

  // ---------------------------------------------------------------- who am I
  function getMe() {
    let steamID = null, vanity = null, accountId = null;
    try { if (pageWin().g_steamID) steamID = String(pageWin().g_steamID); } catch (_) {}
    const a = document.querySelector("#global_actions a.user_avatar, #global_actions .playerAvatar a, #headerUserAvatar a");
    const prof = a && C.profileFromUrl(a.href);
    if (prof) {
      if (prof.steamid) steamID = steamID || prof.steamid;
      if (prof.vanity) vanity = prof.vanity;
    }
    if (steamID && /^\d{17}$/.test(steamID)) accountId = C.toAccountId(steamID);
    else steamID = null;
    return { steamID, vanity, accountId };
  }

  function getProfile() {
    const img = document.querySelector("#global_actions a.user_avatar img, #global_actions .playerAvatar img, #headerUserAvatar img");
    const nameEl = document.querySelector("#account_pulldown, .persona_name_text_content");
    return { avatar: C.largeAvatar(img && img.src), name: (nameEl && nameEl.textContent.trim()) || null };
  }

  // ---------------------------------------------------------------- storage
  async function loadState() {
    const s = await browser.storage.local.get(["processed", "commentedThreads", "stats"]);
    processed = new Set(s.processed || []);
    processedBefore = new Set(processed);
    commentedThreads = new Set(s.commentedThreads || []);
    stats = s.stats && s.stats.days ? s.stats : C.emptyStats();
  }
  async function markProcessed(key) {
    if (!key) return;
    processed.add(key);
    let arr = [...processed];
    if (arr.length > 5000) { arr = arr.slice(-5000); processed = new Set(arr); }
    await browser.storage.local.set({ processed: arr });
  }
  async function markProcessedRaw(key) {
    const { processed: arr = [] } = await browser.storage.local.get("processed");
    if (!arr.includes(key)) arr.push(key);
    await browser.storage.local.set({ processed: arr.slice(-5000) });
  }
  async function rememberComment(threadKey) {
    if (!threadKey) return;
    commentedThreads.add(threadKey);
    await browser.storage.local.set({ commentedThreads: [...commentedThreads].slice(-10000) });
  }
  async function bump(kind, author) {
    // re-read so a reset from the popup during a run isn't overwritten
    const { stats: cur } = await browser.storage.local.get("stats");
    stats = C.bumpStats(cur && cur.days ? cur : C.emptyStats(), kind, author);
    await browser.storage.local.set({ stats });
  }

  // ---------------------------------------------------------------- whole comment thread
  function getThread(rootEl, html) {
    const key = C.threadKeyIn(rootEl);
    if (!key) return null;
    let fromObj = null;
    try { fromObj = C.threadFromObject(pageWin().g_rgCommentThreads && pageWin().g_rgCommentThreads[key]); } catch (_) {}
    const t = fromObj || C.threadFromHtml(key, html != null ? html : rootEl.innerHTML) || C.threadFromKey(key);
    return C.finalizeThread(key, t);
  }

  function getSessionId() {
    try { const s = pageWin().g_sessionID; if (s) return String(s); } catch (_) {}
    const m = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
    return m ? m[1] : null;
  }

  // true/false — is my comment anywhere in the thread; null — couldn't read it all
  async function scanThread(t) {
    const sessionid = getSessionId();
    if (!sessionid) return null;
    const pool = C.getPool(settings);
    let start = 0, total = Infinity, seen = 0;

    for (let page = 0; page < RENDER_MAX_PAGES && start < total; page++) {
      let j;
      try {
        const r = await pageFetch(t.endpoint, {
          method: "POST", credentials: "include",
          body: new URLSearchParams(C.renderParams(t, start, RENDER_PAGE, sessionid))
        });
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
      if (C.hasMyComment(doc, me, pool)) return true;
      seen += got;
      if (!got) break;
      start += got;
      if (start < total) await wait(jitter(500));
    }
    if (start < total) return null;
    if (total > 6) log("log.scanned", { seen, total });
    return false;
  }

  // Post page in the background (and its whole thread too)
  async function checkRemote(url) {
    try {
      const r = await pageFetch(url, { credentials: "include" });
      if (!r.ok) return null;
      const html = await r.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (C.hasMyComment(doc, me, C.getPool(settings))) return true;
      const t = getThread(doc, html);
      if (t) return await scanThread(t);
      return doc.querySelector('[id$="_pagebtn_next"]') ? null : false;
    } catch (e) {
      if (e === STOP) throw e;
      return null;
    }
  }

  function getPostPageUrl(post) {
    const a = post.querySelector('a[href*="/status/"], a[href*="/recommended/"], a[href*="/sharedfiles/filedetails/"], a[href*="/screenshot/"]');
    return a ? a.href : null;
  }

  // true/false — is there a comment of mine; null — couldn't check, skip the post
  async function fullCheck(post, key, threadKey) {
    if (C.hasMyComment(post, me, C.getPool(settings))) return true;
    if (threadKey && commentedThreads.has(threadKey)) return true;

    const t = getThread(post);
    let apiFailed = false;
    if (t) {
      const visible = post.querySelectorAll(".commentthread_comment").length;
      if (t.total && visible >= t.total) return false;
      const res = await scanThread(t);
      if (res !== null) return res;
      apiFailed = true;
      log("log.apiFallback");
    }

    const btn = post.querySelector(
      ".blotter_viewallcomments_container a, .blotter_viewallcomments a, a.blotter_viewallcomments, " +
      ".commentthread_showmore a, a.commentthread_expand"
    );
    const url = (btn && isNavLink(btn) ? btn.href : null) || getPostPageUrl(post);
    if (url) return await checkRemote(url);

    if (btn) {
      await safeClick(btn, "showAll", key);
      await wait(settings.expandWait);
      if (C.hasMyComment(post, me, C.getPool(settings))) return true;
    }
    // The thread exists but couldn't be read: we can't be sure → skip rather than risk a duplicate
    if (apiFailed) return null;
    const paged = post.querySelector('[id$="_pagebtn_next"], [id$="_pagelinks"] a, .commentthread_paging a');
    return paged || btn ? null : false;
  }

  // ---------------------------------------------------------------- posting
  function waitCommentResult(timeout) {
    return new Promise((resolve) => {
      const tm = setTimeout(() => { pendingResult = null; resolve({ timeout: true }); }, timeout);
      pendingResult = (r) => { clearTimeout(tm); pendingResult = null; resolve(r); };
    });
  }

  function onRateLimit(error) {
    if (state.limited) return;
    state.limited = true;
    commentsDisabled = true;
    log("log.limit", { error: error || "—" });
    if (settings.onLimit === "stop") {
      state.msg = { k: "msg.limitStop" };
      stopRequested = true;
    } else {
      state.msg = { k: "msg.limitLikes" };
    }
    browser.storage.local.set({ cooldownUntil: Date.now() + settings.cooldownMin * 60000, lastLimitError: error || "" });
  }

  async function postComment(post, key, threadKey, author, who) {
    const input = post.querySelector("textarea.commentthread_textarea");
    const submit = post.querySelector('.commentthread_entry_submitlink .btn_green_white_innerfade, [id^="commentthread_"][id$="_submit"]');
    if (!input || !submit) return "nobox";

    const text = C.pickComment(C.getPool(settings), settings.perComment, lastComment);
    lastComment = text;
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    await wait(500);

    const resultP = waitCommentResult(12000);
    await safeClick(submit, "comment", key);
    const r = await resultP;

    const success = async (confirmedByPage) => {
      consecutiveErrors = 0;
      state.commented++;
      await rememberComment(threadKey);
      await bump("comments", author);
      if (confirmedByPage) log("log.commentedConfirmed");
      else log("log.commented", { n: state.commented, who, text });
      await wait(jitter(settings.commentDelay));
      return "ok";
    };

    if (r.timeout) {
      const err = post.querySelector(".commentthread_entry_error");
      const t = err && err.offsetParent !== null ? err.textContent.trim() : "";
      if (t) {
        if (C.isRateLimit(t)) { onRateLimit(t); return "limited"; }
        log("log.error", { msg: t });
        return "error";
      }
      if (C.hasMyComment(post, me, C.getPool(settings))) return success(true);
      log("log.noAnswer");
      return "error";
    }
    if (r.ok) return success(false);
    if (r.rateLimited) { onRateLimit(r.error); return "limited"; }

    consecutiveErrors++;
    log("log.rejected", { msg: r.error || "HTTP " + r.status });
    if (consecutiveErrors >= 3) onRateLimit("3×");
    return "error";
  }

  // ---------------------------------------------------------------- likes
  function alreadyLiked(post) {
    return !!post.querySelector(
      '[id^="vote_up_"].active, [id^="vote_up_"].btn_active, [id^="VoteUpBtn_"].active, [id^="VoteUpBtn_"].btn_active, .rate_up.active'
    );
  }
  function getLikeButton(post) {
    return post.querySelector(
      'a[id^="vote_up_"]:not(.active):not(.btn_active), a[id^="VoteUpBtn_"]:not(.active):not(.btn_active), .rate_up:not(.active)'
    );
  }

  // ---------------------------------------------------------------- limits & schedule
  function checkDailyLimits() {
    const left = C.limitsLeft(stats, settings);
    if (!likesDisabled && settings.doLike && left.likes <= 0) {
      likesDisabled = true;
      log("log.dailyLikes", { n: settings.dailyLikes });
    }
    if (!commentsDisabled && settings.doComment && left.comments <= 0) {
      commentsDisabled = true;
      log("log.dailyComments", { n: settings.dailyComments });
    }
    const likesDone = !settings.doLike || likesDisabled;
    const commentsDone = !settings.doComment || commentsDisabled;
    if (likesDone && commentsDone) {
      log("log.dailyAll");
      if (!state.msg) state.msg = state.limited ? { k: "msg.limitStop" } : { k: "msg.daily" };
      throw FINISH;
    }
  }

  // ---------------------------------------------------------------- main loop
  async function processPost(post) {
    if (post.dataset.salDone) return false;
    post.dataset.salDone = "1";
    const key = C.getPostKey(post);
    const threadKey = C.threadKeyIn(post);

    // handled in an earlier run
    if (key && processedBefore.has(key)) {
      state.skipped++;
      if (settings.onlyNew && ++knownStreak >= settings.onlyNewStreak) {
        log("log.onlyNewStop");
        throw FINISH;
      }
      return false;
    }
    if (key && processed.has(key)) return false;
    knownStreak = 0;

    if (C.inQuietHours(settings)) {
      log("log.quiet");
      state.msg = { k: "msg.quiet" };
      throw FINISH;
    }

    const author = C.postAuthor(post, threadKey);
    const who = (author && (author.name || author.vanity)) || "?";
    if (!C.friendAllowed(author || {}, settings)) {
      log("log.skipFriend", { who });
      return false;
    }

    const type = C.postType(post, threadKey);
    const rule = settings.types[type] || { like: true, comment: false };
    if (!rule.like && !rule.comment) {
      log("log.skipType", { type });
      return false;
    }

    const wantLike = settings.doLike && rule.like && !likesDisabled;
    const commentPlanned = settings.doComment && rule.comment && !!threadKey;
    const wantComment = commentPlanned && !commentsDisabled;
    if (!wantLike && !wantComment) return false;

    post.scrollIntoView({ block: "center" });

    if (wantLike && !alreadyLiked(post)) {
      const b = getLikeButton(post);
      if (b) {
        state.liked++;
        if (state.dry) {
          log("log.dryLike", { who });
          await wait(jitter(Math.min(settings.likeDelay, 1200)));
        } else {
          await safeClick(b, "like", key);
          await bump("likes", author);
          log("log.liked", { n: state.liked, who });
          await wait(jitter(settings.likeDelay));
          checkDailyLimits();
        }
      }
    }

    let done = !commentPlanned;
    if (wantComment && !commentsDisabled) {
      const mine = await fullCheck(post, key, threadKey);
      if (mine === null) {
        state.skipped++;
        log("log.cantVerify");
      } else if (mine) {
        state.skipped++;
        log("log.already");
        done = true;
      } else if (state.dry) {
        const text = C.pickComment(C.getPool(settings), settings.perComment, lastComment);
        lastComment = text;
        state.commented++;
        log("log.dryComment", { who, text });
        await wait(jitter(Math.min(settings.commentDelay, 1500)));
      } else {
        const res = await postComment(post, key, threadKey, author, who);
        done = res === "ok" || res === "nobox";
        if (res === "ok") checkDailyLimits();
      }
    }

    if (run) run.currentKey = null;
    if (done && !state.dry) await markProcessed(key);
    return true;
  }

  async function runPass() {
    for (const post of document.querySelectorAll(".blotter_block")) {
      if (stopRequested) throw STOP;
      if (state.total >= settings.maxPosts) return;
      if (await processPost(post)) {
        state.total++;
        saveRunSoon();
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
      log("log.scroll", { n: state.scrolls, count: after });
      await runPass();
      if (after === before) { log("log.noMore"); break; }
    }
  }

  function finished() {
    browser.runtime.sendMessage({
      type: "runFinished", auto: state.auto, dry: state.dry, limited: state.limited,
      summary: { likes: state.liked, comments: state.commented, skipped: state.skipped }
    }).catch(() => {});
  }

  async function start(opts) {
    opts = opts || {};
    if (state.running) return;
    const stored = await browser.storage.local.get(["settings", "cooldownUntil"]);
    settings = C.normalizeSettings(stored.settings);

    if (!opts.resume) {
      Object.assign(state, {
        liked: 0, commented: 0, skipped: 0, total: 0, scrolls: 0, limited: false, msg: null, log: [],
        dry: !!(opts.dry != null ? opts.dry : settings.dryRun), auto: !!opts.auto
      });
      run = { active: true, feedUrl: location.href, currentKey: null, resumes: 0, dry: state.dry, auto: state.auto };
    } else {
      state.dry = !!run.dry;
      state.auto = !!run.auto;
    }
    if (state.auto) settings.onlyNew = true;
    stopRequested = false;
    commentsDisabled = false;
    likesDisabled = false;
    consecutiveErrors = 0;
    knownStreak = 0;

    const bail = async (msgKey, logKey, params) => {
      state.msg = { k: msgKey, p: params || null };
      if (logKey) log(logKey, params);
      await endRun();
      finished();
    };

    if (C.inQuietHours(settings)) return bail("msg.quiet", "log.quiet");

    const cd = stored.cooldownUntil || 0;
    if (cd > Date.now() && !state.dry) {
      const min = Math.ceil((cd - Date.now()) / 60000);
      if (settings.onLimit === "stop" || !settings.doLike) return bail("msg.cooldown", "log.cooldownStop", { min });
      commentsDisabled = true;
      log("log.cooldownLikes", { min });
    }

    if (!document.querySelector(".blotter_block")) return bail("msg.noFeed");

    me = getMe();
    if (!me.steamID && !me.vanity) log("log.noProfile");

    await loadState();
    state.running = true;
    log(opts.resume ? "log.resume" : state.dry ? "log.startDry" : state.auto ? "log.startAuto" : "log.start");
    try {
      if (!state.dry) checkDailyLimits();
      await loop();
    } catch (e) {
      if (e !== STOP && e !== FINISH) log("log.error", { msg: e && e.message });
    } finally {
      state.running = false;
      if (pendingResult) pendingResult({ timeout: true });
      log("log.done", { likes: state.liked, comments: state.commented, skipped: state.skipped });
      if (!state.msg) state.msg = { k: stopRequested && !state.limited ? "msg.stopped" : "msg.done" };
      await endRun();
      finished();
    }
  }

  // ---------------------------------------------------------------- resume after leaving the feed
  async function checkResume() {
    const { run: saved } = await browser.storage.local.get("run");
    if (!saved) return;

    // show the previous log even if that run is over
    state.log = (saved.log || []).filter((l) => l && typeof l === "object");
    Object.assign(state, saved.stats || {});
    state.msg = saved.msg || null;
    state.limited = !!saved.limited;
    state.dry = !!saved.dry;
    if (!saved.active) return;

    if (Date.now() - (saved.touched || 0) > RUN_STALE_MS) {
      saved.active = false;
      await browser.storage.local.set({ run: saved });
      return;
    }

    run = saved;
    const onFeed = !!document.querySelector(".blotter_block");
    if (!onFeed) {
      if (run.resumes >= MAX_RESUMES) {
        log("log.tooManyLeaves");
        state.msg = { k: "msg.tooManyLeaves" };
        await endRun();
        return;
      }
      log("log.leftFeed", { path: location.pathname });
      if (run.currentKey) {
        await markProcessedRaw(run.currentKey);
        log("log.skipLeaving", { key: run.currentKey });
        run.currentKey = null;
      }
      run.resumes++;
      await saveRun();
      location.replace(run.feedUrl);
      return;
    }
    if (run.currentKey) {
      await markProcessedRaw(run.currentKey);
      log("log.skipLeaving", { key: run.currentKey });
      run.currentKey = null;
    }
    await sleep(1500);
    start({ resume: true });
  }

  // ---------------------------------------------------------------- popup helpers
  async function getEmoticons() {
    const r = await pageFetch("https://steamcommunity.com/actions/EmoticonList", { credentials: "include" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return C.parseEmoticonList(await r.text());
  }

  function getFeedAuthors() {
    const seen = new Map();
    for (const post of document.querySelectorAll(".blotter_block")) {
      const a = C.postAuthor(post);
      if (!a) continue;
      const id = a.accountId || a.vanity || (a.name || "").toLowerCase();
      if (!id || seen.has(id)) continue;
      if (me && me.accountId && a.accountId === me.accountId) continue;
      seen.set(id, a);
      if (seen.size >= 80) break;
    }
    return [...seen.values()];
  }

  function snapshot() {
    return Object.assign({}, state, {
      log: state.log.slice(-60),
      hasFeed: !!document.querySelector(".blotter_block"),
      profile: getProfile()
    });
  }

  browser.runtime.onMessage.addListener((msg) => {
    switch (msg && msg.type) {
      case "commentResult":
        if (pendingResult) pendingResult(msg);
        else if (msg.rateLimited && state.running) onRateLimit(msg.error);
        return;
      case "start":
        start({ auto: !!msg.auto, dry: msg.dry });
        return Promise.resolve(snapshot());
      case "stop":
        stopRequested = true;
        if (run) { run.active = false; saveRun(); }
        return Promise.resolve(snapshot());
      case "toggle":
        if (state.running) { stopRequested = true; if (run) { run.active = false; saveRun(); } }
        else start({});
        return Promise.resolve(snapshot());
      case "status":
        return Promise.resolve(snapshot());
      case "ping":
        return Promise.resolve({ ok: true, hasFeed: !!document.querySelector(".blotter_block") });
      case "emoticons":
        return getEmoticons().then((list) => ({ list }), (e) => ({ error: e.message }));
      case "authors":
        if (!me) me = getMe();
        return Promise.resolve({ list: getFeedAuthors() });
    }
  });

  checkResume();
})();
