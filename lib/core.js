/*
 * Steam Autolike — core logic.
 * Pure functions shared by the content script, popup, background page and tests.
 * No browser.* calls here: everything takes plain data / DOM nodes and returns plain data.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ defaults
  const POST_TYPES = ["status", "media", "review", "game", "other"];

  const DEFAULTS = Object.freeze({
    // actions
    doLike: true,
    doComment: true,
    emoji: ":steamhappy:",            // fallback when the pool is empty (every account has it)
    emojiPool: [":steamhappy:"],
    perComment: 1,                    // emoticons per comment, 1..5
    // per post type: what to do
    types: {
      status: { like: true, comment: true },
      media:  { like: true, comment: true },
      review: { like: true, comment: true },
      game:   { like: true, comment: false },
      other:  { like: true, comment: false }
    },
    // friends filter
    friendMode: "all",                // all | only | except
    friendList: [],                   // [{ accountId, steamid, vanity, name, avatar }]
    // run modes
    dryRun: false,
    onlyNew: true,
    onlyNewStreak: 6,                 // stop after N posts in a row that were handled before
    // pacing
    likeDelay: 2500,
    commentDelay: 7000,
    scrollDelay: 2200,
    expandWait: 1500,
    maxPosts: 200,
    maxScrolls: 30,
    // limits & schedule
    dailyLikes: 0,                    // 0 = unlimited
    dailyComments: 50,
    quietEnabled: false,
    quietFrom: "00:00",
    quietTo: "08:00",
    autoRun: false,
    autoRunHours: 6,
    // Steam anti-spam
    onLimit: "stop",                  // stop | likesOnly
    cooldownMin: 30,
    // misc
    notify: true,
    lang: "auto"                      // auto | en | ru
  });

  const NUMERIC_LIMITS = {
    perComment: [1, 5], onlyNewStreak: [2, 50],
    likeDelay: [500, 120000], commentDelay: [1000, 300000], scrollDelay: [500, 60000], expandWait: [300, 20000],
    maxPosts: [1, 2000], maxScrolls: [0, 500],
    dailyLikes: [0, 10000], dailyComments: [0, 10000],
    autoRunHours: [1, 48], cooldownMin: [1, 1440]
  };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function clampNum(v, [lo, hi], fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }

  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const EMO_CODE_RE = /^:[A-Za-z0-9_]+:$/;

  /** Merge saved settings over defaults, dropping/clamping anything malformed. */
  function normalizeSettings(saved) {
    const s = clone(DEFAULTS);
    if (!saved || typeof saved !== "object") return s;

    for (const k of ["doLike", "doComment", "dryRun", "onlyNew", "quietEnabled", "autoRun", "notify"]) {
      if (typeof saved[k] === "boolean") s[k] = saved[k];
    }
    for (const [k, range] of Object.entries(NUMERIC_LIMITS)) {
      if (saved[k] != null) s[k] = clampNum(saved[k], range, DEFAULTS[k]);
    }
    if (typeof saved.emoji === "string" && EMO_CODE_RE.test(saved.emoji)) s.emoji = saved.emoji;
    if (Array.isArray(saved.emojiPool)) {
      s.emojiPool = [...new Set(saved.emojiPool.filter((e) => typeof e === "string" && EMO_CODE_RE.test(e)))].slice(0, 200);
    }
    if (saved.types && typeof saved.types === "object") {
      for (const t of POST_TYPES) {
        const v = saved.types[t];
        if (v && typeof v === "object") {
          if (typeof v.like === "boolean") s.types[t].like = v.like;
          if (typeof v.comment === "boolean") s.types[t].comment = v.comment;
        }
      }
    }
    if (["all", "only", "except"].includes(saved.friendMode)) s.friendMode = saved.friendMode;
    if (Array.isArray(saved.friendList)) {
      s.friendList = saved.friendList.map(cleanEntry).filter(Boolean).slice(0, 1000);
    }
    if (typeof saved.quietFrom === "string" && TIME_RE.test(saved.quietFrom)) s.quietFrom = saved.quietFrom;
    if (typeof saved.quietTo === "string" && TIME_RE.test(saved.quietTo)) s.quietTo = saved.quietTo;
    if (["stop", "likesOnly"].includes(saved.onLimit)) s.onLimit = saved.onLimit;
    if (["auto", "en", "ru"].includes(saved.lang)) s.lang = saved.lang;
    return s;
  }

  // ------------------------------------------------------------------ steam ids
  const STEAM64_BASE = 76561197960265728n;

  function toAccountId(steam64) {
    if (!/^\d{17}$/.test(String(steam64 || ""))) return null;
    return String(BigInt(steam64) - STEAM64_BASE);
  }
  function toSteam64(accountId) {
    if (!/^\d{1,10}$/.test(String(accountId || ""))) return null;
    return String(BigInt(accountId) + STEAM64_BASE);
  }

  /** Parse "/id/name", "/profiles/7656…" out of a URL. */
  function profileFromUrl(href) {
    const m = String(href || "").match(/steamcommunity\.com\/(id|profiles)\/([^\/?#\s]+)/i);
    if (!m) return null;
    return m[1].toLowerCase() === "profiles"
      ? { steamid: /^\d{17}$/.test(m[2]) ? m[2] : null, vanity: null }
      : { steamid: null, vanity: decodeURIComponent(m[2]).toLowerCase() };
  }

  // ------------------------------------------------------------------ friend list
  function cleanEntry(e) {
    if (!e || typeof e !== "object") return null;
    const out = {};
    if (/^\d{1,10}$/.test(String(e.accountId || ""))) out.accountId = String(e.accountId);
    if (/^\d{17}$/.test(String(e.steamid || ""))) out.steamid = String(e.steamid);
    if (!out.accountId && out.steamid) out.accountId = toAccountId(out.steamid);
    if (!out.steamid && out.accountId) out.steamid = toSteam64(out.accountId);
    if (typeof e.vanity === "string" && /^[A-Za-z0-9_-]{2,64}$/.test(e.vanity)) out.vanity = e.vanity.toLowerCase();
    if (typeof e.name === "string" && e.name.trim()) out.name = e.name.trim().slice(0, 64);
    if (typeof e.avatar === "string" && /^https:\/\/[^\s"']+$/.test(e.avatar)) out.avatar = e.avatar;
    return out.accountId || out.vanity || out.name ? out : null;
  }

  /** Text the user typed (profile link, SteamID64, vanity or display name) -> list entry. */
  function parseFriendInput(text) {
    const s = String(text || "").trim();
    if (!s) return null;
    const p = profileFromUrl(s);
    if (p) return cleanEntry(p.steamid ? { steamid: p.steamid } : { vanity: p.vanity, name: p.vanity });
    if (/^\d{17}$/.test(s)) return cleanEntry({ steamid: s });
    if (/^\[?U:1:(\d+)\]?$/i.test(s)) return cleanEntry({ accountId: s.match(/(\d+)\]?$/)[1] });
    return cleanEntry({ name: s });
  }

  function sameFriend(a, b) {
    if (!a || !b) return false;
    if (a.accountId && b.accountId) return a.accountId === b.accountId;
    if (a.vanity && b.vanity) return a.vanity === b.vanity;
    return !!(a.name && b.name && a.name.toLowerCase() === b.name.toLowerCase());
  }

  function entryMatches(author, entry) {
    if (!author || !entry) return false;
    if (entry.accountId && author.accountId) return entry.accountId === author.accountId;
    if (entry.vanity && author.vanity && entry.vanity === author.vanity) return true;
    if (entry.name && !entry.accountId && author.name) return entry.name.toLowerCase() === author.name.toLowerCase();
    return false;
  }

  /** Is this author allowed by the friends filter? */
  function friendAllowed(author, settings) {
    const mode = settings.friendMode || "all";
    if (mode === "all") return true;
    const listed = (settings.friendList || []).some((e) => entryMatches(author, e));
    return mode === "only" ? listed : !listed;
  }

  // ------------------------------------------------------------------ comment threads
  const THREAD_EL_SELECTOR =
    '[id^="commentthread_"][id$="_area"], [id^="commentthread_"][id$="_posts"], ' +
    '[id^="commentthread_"][id$="_textarea"], [id^="commentthread_"][id$="_postcontainer"]';

  function threadKeyIn(rootEl) {
    const el = rootEl && rootEl.querySelector(THREAD_EL_SELECTOR);
    const m = el && el.id.match(/^commentthread_(.+)_(area|posts|textarea|postcontainer)$/);
    return m ? m[1] : null;
  }

  /** "UserStatusPublished_7656…_123" -> { type, owner, feature } ("Profile_7656…" -> feature "-1"). */
  function parseThreadKey(key) {
    const parts = String(key || "").split("_");
    const i = parts.findIndex((p) => /^\d{10,}$/.test(p));
    if (i < 1) return null;
    return {
      type: parts.slice(0, i).join("_"),
      owner: parts[i],
      feature: parts.length > i + 1 ? parts.slice(i + 1).join("_") : "-1"
    };
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function threadInfo(d, url) {
    return {
      url,
      owner: d.owner != null ? String(d.owner) : null,
      feature: d.feature != null ? String(d.feature) : null,
      feature2: d.feature2 != null ? String(d.feature2) : null,
      extended: d.extended_data != null ? String(d.extended_data) : null,
      total: Number(d.total_count) || 0
    };
  }

  /** Read InitializeCommentThread("Type", "key", {…}, "https://…/comment/Type/") out of page HTML. */
  function threadFromHtml(key, html) {
    if (!key || !html) return null;
    const re = new RegExp(
      `InitializeCommentThread\\(\\s*["'][^"']*["']\\s*,\\s*["']${escRe(key)}["']\\s*,\\s*(\\{[\\s\\S]*?\\})\\s*,\\s*["']([^"']+)["']`
    );
    const m = html.match(re);
    if (!m) return null;
    try { return threadInfo(JSON.parse(m[1]), m[2]); } catch (_) { return null; }
  }

  function threadFromKey(key) {
    const p = parseThreadKey(key);
    if (!p) return null;
    return { url: `https://steamcommunity.com/comment/${p.type}/`, owner: p.owner, feature: p.feature,
             feature2: null, extended: null, total: 0 };
  }

  /** Data from a live CCommentThread object (g_rgCommentThreads[key]). */
  function threadFromObject(obj) {
    if (!obj || !obj.m_rgCommentData) return null;
    const t = threadInfo(obj.m_rgCommentData, String(obj.m_strActionURL || ""));
    t.total = Number(obj.m_cTotalCount != null ? obj.m_cTotalCount : obj.m_rgCommentData.total_count) || 0;
    return t;
  }

  function finalizeThread(key, t) {
    if (!t || !t.url || !t.owner || t.feature == null) return null;
    const url = t.url.endsWith("/") ? t.url : t.url + "/";
    return Object.assign({ key }, t, { url, endpoint: `${url}render/${t.owner}/${t.feature}/` });
  }

  function renderParams(t, start, count, sessionid) {
    const p = { start: String(start), count: String(count), sessionid: String(sessionid) };
    if (t.feature2 != null) p.feature2 = t.feature2;
    if (t.extended) p.extended_data = t.extended;
    return p;
  }

  // ------------------------------------------------------------------ posts
  function getPostKey(post) {
    const vote = post.querySelector('[id^="vote_up_"], [id^="VoteUpBtn_"]');
    if (vote && vote.id) return vote.id;
    const k = threadKeyIn(post);
    return k ? "thread_" + k : null;
  }

  const TYPE_BY_THREAD = [
    [/^UserStatusPublished$/i, "status"],
    [/^Recommendation$/i, "review"],
    [/^PublishedFile/i, "media"],
    [/^(UserReceivedNewGame|UserPurchased|GamePurchase)/i, "game"]
  ];

  /** Classify a feed post: status | media | review | game | other. */
  function postType(post, threadKey) {
    const key = threadKey !== undefined ? threadKey : threadKeyIn(post);
    const p = key && parseThreadKey(key);
    if (p) for (const [re, t] of TYPE_BY_THREAD) if (re.test(p.type)) return t;

    const cls = (sel) => !!post.querySelector(sel) || post.matches(sel);
    if (cls(".blotter_userstatus")) return "status";
    if (cls(".blotter_recommendation") || post.querySelector('a[href*="/recommended/"]')) return "review";
    if (cls(".blotter_screenshot, .blotter_workshopitempublished, .blotter_videopublished, .blotter_artwork") ||
        post.querySelector('a[href*="/sharedfiles/filedetails/"]')) return "media";
    if (cls(".blotter_gamepurchase")) return "game";
    return "other";
  }

  function largeAvatar(src) {
    if (!src) return null;
    return src.replace(/(_medium|_full)?\.(jpg|png|gif)(\?.*)?$/i, "_full.$2");
  }

  /** Author of a feed post: { accountId, steamid, vanity, name, avatar }. */
  function postAuthor(post, threadKey) {
    const key = threadKey !== undefined ? threadKey : threadKeyIn(post);
    const p = key && parseThreadKey(key);
    const a = post.querySelector(".blotter_author_block a[data-miniprofile], .blotter_avatar_holder a[data-miniprofile]") ||
              [...post.querySelectorAll("a[data-miniprofile]")].find((x) => !x.closest(".commentthread_area, .commentthread_comment"));
    const out = {};
    if (p && /^\d{17}$/.test(p.owner)) { out.steamid = p.owner; out.accountId = toAccountId(p.owner); }
    if (a) {
      if (!out.accountId && a.getAttribute("data-miniprofile")) {
        out.accountId = a.getAttribute("data-miniprofile");
        out.steamid = toSteam64(out.accountId);
      }
      const prof = profileFromUrl(a.getAttribute("href"));
      if (prof && prof.vanity) out.vanity = prof.vanity;
      if (prof && prof.steamid && !out.steamid) { out.steamid = prof.steamid; out.accountId = toAccountId(prof.steamid); }
    }
    const nameEl = [...post.querySelectorAll(".blotter_author_block a[data-miniprofile], .blotter_author_block .persona_name, a[data-miniprofile]")]
      .find((x) => !x.closest(".commentthread_area, .commentthread_comment") && x.textContent.trim());
    if (nameEl && nameEl.textContent.trim()) out.name = nameEl.textContent.trim().slice(0, 64);
    const img = post.querySelector(".blotter_author_block img, .blotter_avatar_holder img");
    if (img && img.getAttribute("src")) out.avatar = largeAvatar(img.getAttribute("src"));
    return out.accountId || out.vanity || out.name ? out : null;
  }

  /** Does `rootEl` contain a comment written by `me` (or one made only of our pool emoticons)? */
  function hasMyComment(rootEl, me, pool) {
    me = me || {};
    pool = pool || [];
    for (const c of rootEl.querySelectorAll(".commentthread_comment")) {
      const author = c.querySelector("a.commentthread_author_link, .commentthread_comment_author a[href], .commentthread_comment_avatar a[href]");
      if (author) {
        const href = (author.getAttribute("href") || "").toLowerCase().replace(/\/+$/, "");
        const mp = author.getAttribute("data-miniprofile") ||
                   (author.closest("[data-miniprofile]") && author.closest("[data-miniprofile]").getAttribute("data-miniprofile"));
        if ((me.steamID && href.endsWith("/profiles/" + me.steamID)) ||
            (me.vanity && href.endsWith("/id/" + me.vanity)) ||
            (me.accountId && mp === me.accountId)) return true;
      }
      const text = c.querySelector(".commentthread_comment_text");
      if (text && pool.length) {
        const t = text.textContent;
        if (pool.some((e) => t.includes(e))) return true;
        for (const img of text.querySelectorAll("img[alt]")) if (pool.includes(img.getAttribute("alt"))) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ comments
  function getPool(settings) {
    const p = (settings.emojiPool || []).filter((e) => EMO_CODE_RE.test(e));
    return p.length ? p : [settings.emoji || DEFAULTS.emoji];
  }

  /** Pick `n` random emoticons from the pool, avoiding an exact repeat of `last`. */
  function pickComment(pool, n, last, rnd) {
    rnd = rnd || Math.random;
    n = Math.max(1, Math.min(5, Number(n) || 1));
    let text = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      const bag = [...pool];
      const out = [];
      for (let k = 0; k < n; k++) {
        if (!bag.length) bag.push(...pool);
        out.push(bag.splice(Math.floor(rnd() * bag.length), 1)[0]);
      }
      text = out.join(" ");
      if (text !== last || pool.length === 1) return text;
    }
    return text;
  }

  const LIMIT_RE = /too frequently|too many|posting too|rate limit|try again later|слишком часто|слишком много|попробуйте позже|подождите/i;
  function isRateLimit(errorText, status) {
    return status === 429 || LIMIT_RE.test(String(errorText || ""));
  }

  /** Emoticon list endpoint: JSON in several shapes, or HTML. -> [":name:", …] */
  function parseEmoticonList(text) {
    const names = new Set();
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : (j.emoticons || j.rgEmoticons || Object.values(j));
      for (const it of arr) {
        const n = typeof it === "string" ? it : ((it && (it.name || it.emoticon)) || "");
        if (n) names.add(n.replace(/:/g, ""));
      }
    } catch (_) {
      for (const m of String(text).matchAll(/:([A-Za-z0-9_]{2,}):/g)) names.add(m[1]);
      for (const m of String(text).matchAll(/emoticon\/([A-Za-z0-9_]{2,})/g)) names.add(m[1]);
    }
    return [...names].filter((n) => /^[A-Za-z0-9_]+$/.test(n)).sort((a, b) => a.localeCompare(b)).map((n) => `:${n}:`);
  }

  // ------------------------------------------------------------------ time, limits, stats
  function dayKey(date) {
    const d = date || new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function minutesOf(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  /** Quiet hours may wrap midnight (23:00 → 07:00). from == to means "never quiet". */
  function inQuietHours(settings, now) {
    if (!settings.quietEnabled) return false;
    const d = now || new Date();
    const cur = d.getHours() * 60 + d.getMinutes();
    const a = minutesOf(settings.quietFrom), b = minutesOf(settings.quietTo);
    if (a === b) return false;
    return a < b ? cur >= a && cur < b : cur >= a || cur < b;
  }

  function emptyStats() { return { days: {}, friends: {} }; }

  function todayCounts(stats, now) {
    const d = (stats && stats.days && stats.days[dayKey(now)]) || {};
    return { likes: d.likes || 0, comments: d.comments || 0, skipped: d.skipped || 0 };
  }

  /** How many likes/comments are still allowed today (Infinity = unlimited). */
  function limitsLeft(stats, settings, now) {
    const t = todayCounts(stats, now);
    return {
      likes: settings.dailyLikes > 0 ? Math.max(0, settings.dailyLikes - t.likes) : Infinity,
      comments: settings.dailyComments > 0 ? Math.max(0, settings.dailyComments - t.comments) : Infinity
    };
  }

  /** Immutable update of the stats object. kind: "likes" | "comments" | "skipped". */
  function bumpStats(stats, kind, author, now) {
    const s = stats ? clone(stats) : emptyStats();
    s.days = s.days || {};
    s.friends = s.friends || {};
    const dk = dayKey(now);
    const day = s.days[dk] || (s.days[dk] = { likes: 0, comments: 0, skipped: 0 });
    day[kind] = (day[kind] || 0) + 1;

    const keys = Object.keys(s.days).sort();
    while (keys.length > 120) delete s.days[keys.shift()];

    if (author && author.accountId && kind !== "skipped") {
      const f = s.friends[author.accountId] || (s.friends[author.accountId] = { likes: 0, comments: 0 });
      f[kind] = (f[kind] || 0) + 1;
      if (author.name) f.name = author.name;
      if (author.avatar) f.avatar = author.avatar;
      if (author.vanity) f.vanity = author.vanity;
      f.last = (now || new Date()).getTime();
      const ids = Object.keys(s.friends);
      if (ids.length > 600) {
        ids.sort((a, b) => (s.friends[a].last || 0) - (s.friends[b].last || 0));
        for (const id of ids.slice(0, ids.length - 600)) delete s.friends[id];
      }
    }
    return s;
  }

  /** Last `n` days, oldest first: [{ day, likes, comments }]. */
  function seriesForDays(stats, n, now) {
    const out = [];
    const base = now ? new Date(now) : new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      const k = dayKey(d);
      const v = (stats && stats.days && stats.days[k]) || {};
      out.push({ day: k, likes: v.likes || 0, comments: v.comments || 0 });
    }
    return out;
  }

  function topFriends(stats, n) {
    const f = (stats && stats.friends) || {};
    return Object.entries(f)
      .map(([accountId, v]) => Object.assign({ accountId }, v, { total: (v.likes || 0) + (v.comments || 0) }))
      .sort((a, b) => b.total - a.total || (b.last || 0) - (a.last || 0))
      .slice(0, n);
  }

  function totals(stats) {
    let likes = 0, comments = 0;
    for (const v of Object.values((stats && stats.days) || {})) { likes += v.likes || 0; comments += v.comments || 0; }
    return { likes, comments };
  }

  // ------------------------------------------------------------------ export / import
  const EXPORT_APP = "steam-autolike";

  function buildExport(settings, extra) {
    return Object.assign({ app: EXPORT_APP, format: 1, exportedAt: new Date().toISOString(), settings: normalizeSettings(settings) }, extra || {});
  }

  /** Validate an imported file. Throws Error("bad_file") on anything that isn't ours. */
  function parseImport(text) {
    let j;
    try { j = JSON.parse(text); } catch (_) { throw new Error("bad_file"); }
    if (!j || j.app !== EXPORT_APP || typeof j.settings !== "object") throw new Error("bad_file");
    const out = { settings: normalizeSettings(j.settings) };
    if (j.stats && typeof j.stats === "object" && j.stats.days) out.stats = { days: j.stats.days || {}, friends: j.stats.friends || {} };
    return out;
  }

  const api = {
    POST_TYPES, DEFAULTS, NUMERIC_LIMITS, normalizeSettings,
    toAccountId, toSteam64, profileFromUrl,
    cleanEntry, parseFriendInput, sameFriend, entryMatches, friendAllowed,
    threadKeyIn, parseThreadKey, threadFromHtml, threadFromKey, threadFromObject, finalizeThread, renderParams,
    getPostKey, postType, postAuthor, largeAvatar, hasMyComment,
    getPool, pickComment, LIMIT_RE, isRateLimit, parseEmoticonList,
    dayKey, inQuietHours, emptyStats, todayCounts, limitsLeft, bumpStats, seriesForDays, topFriends, totals,
    buildExport, parseImport
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SALCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
