const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const C = require("../lib/core.js");
const S = require("../lib/strings.js");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const dom = (html) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;

describe("settings", () => {
  test("defaults use :steamhappy:", () => {
    const s = C.normalizeSettings({});
    assert.deepEqual(s.emojiPool, [":steamhappy:"]);
    assert.equal(s.emoji, ":steamhappy:");
  });

  test("bad values are dropped or clamped", () => {
    const s = C.normalizeSettings({
      perComment: 99, dailyComments: -5, friendMode: "nope", lang: "de",
      emojiPool: [":ok:", "not an emoticon", ":ok:", "<script>"], quietFrom: "25:99",
      types: { status: { like: false }, bogus: { like: true } }
    });
    assert.equal(s.perComment, 5);
    assert.equal(s.dailyComments, 0);
    assert.equal(s.friendMode, "all");
    assert.equal(s.lang, "auto");
    assert.deepEqual(s.emojiPool, [":ok:"]);
    assert.equal(s.quietFrom, "00:00");
    assert.equal(s.types.status.like, false);
    assert.equal(s.types.status.comment, true);
    assert.equal(s.types.bogus, undefined);
  });
});

describe("steam ids & friend entries", () => {
  test("SteamID64 <-> account id", () => {
    assert.equal(C.toAccountId("76561197960435530"), "169802");
    assert.equal(C.toSteam64("169802"), "76561197960435530");
    assert.equal(C.toAccountId("nope"), null);
  });

  test("parseFriendInput understands links, ids and names", () => {
    assert.deepEqual(C.parseFriendInput("https://steamcommunity.com/profiles/76561197960435530/"),
      { accountId: "169802", steamid: "76561197960435530" });
    assert.deepEqual(C.parseFriendInput("steamcommunity.com/id/Robin_Walker"), { vanity: "robin_walker", name: "robin_walker" });
    assert.deepEqual(C.parseFriendInput("76561197960435530"), { accountId: "169802", steamid: "76561197960435530" });
    assert.deepEqual(C.parseFriendInput("[U:1:169802]"), { accountId: "169802", steamid: "76561197960435530" });
    assert.deepEqual(C.parseFriendInput("  кот  "), { name: "кот" });
    assert.equal(C.parseFriendInput("   "), null);
  });

  test("friend filter modes", () => {
    const a = { accountId: "1", name: "A" }, b = { accountId: "2", name: "B" };
    const list = [{ accountId: "1" }];
    assert.equal(C.friendAllowed(a, { friendMode: "all", friendList: list }), true);
    assert.equal(C.friendAllowed(a, { friendMode: "only", friendList: list }), true);
    assert.equal(C.friendAllowed(b, { friendMode: "only", friendList: list }), false);
    assert.equal(C.friendAllowed(a, { friendMode: "except", friendList: list }), false);
    assert.equal(C.friendAllowed(b, { friendMode: "except", friendList: list }), true);
    // a name-only entry matches by display name, case-insensitively
    assert.equal(C.friendAllowed({ accountId: "3", name: "Kot" }, { friendMode: "except", friendList: [{ name: "kot" }] }), false);
  });
});

describe("comment threads (real Steam markup)", () => {
  const html = fixture("thread-profile.html");
  const doc = dom(html);

  test("thread key from element ids", () => {
    assert.equal(C.threadKeyIn(doc), "Profile_76561197960435530");
  });

  test("InitializeCommentThread is parsed", () => {
    const t = C.finalizeThread("Profile_76561197960435530", C.threadFromHtml("Profile_76561197960435530", html));
    assert.equal(t.owner, "76561197960435530");
    assert.equal(t.feature, "-1");
    assert.equal(t.feature2, "-1");
    assert.equal(t.total, 54);
    assert.equal(t.endpoint, "https://steamcommunity.com/comment/Profile/render/76561197960435530/-1/");
  });

  test("fallback from the key gives the same endpoint", () => {
    const a = C.finalizeThread("k", C.threadFromKey("Profile_76561197960435530"));
    assert.equal(a.endpoint, "https://steamcommunity.com/comment/Profile/render/76561197960435530/-1/");
    const b = C.finalizeThread("k", C.threadFromKey("PublishedFile_Public_76561198000000001_3333"));
    assert.equal(b.endpoint, "https://steamcommunity.com/comment/PublishedFile_Public/render/76561198000000001/3333/");
  });

  test("live CCommentThread object", () => {
    const t = C.threadFromObject({ m_strActionURL: "https://steamcommunity.com/comment/Profile/", m_cTotalCount: 60,
      m_rgCommentData: { owner: "76561197960435530", feature: "-1", feature2: -1, total_count: 54 } });
    assert.equal(t.total, 60);
    assert.equal(t.feature2, "-1");
  });

  test("render params", () => {
    const t = { feature2: "-1", extended: null };
    assert.deepEqual(C.renderParams(t, 100, 100, "abc"), { start: "100", count: "100", sessionid: "abc", feature2: "-1" });
  });

  test("hasMyComment by vanity, /profiles/ link, account id and pool emoticon", () => {
    assert.equal(C.hasMyComment(doc, { vanity: "mattrod" }, []), true);
    assert.equal(C.hasMyComment(doc, { steamID: "76561198037225309" }, []), true);
    assert.equal(C.hasMyComment(doc, { accountId: "34093805" }, []), true);
    assert.equal(C.hasMyComment(doc, { accountId: "1" }, [":steamhappy:"]), true, "rendered emoticon <img alt> counts");
    assert.equal(C.hasMyComment(doc, { accountId: "1", vanity: "someone" }, [":heart:"]), false);
  });
});

describe("feed posts", () => {
  const doc = dom(fixture("feed.html"));
  const post = (id) => doc.getElementById(id);

  test("post types", () => {
    assert.equal(C.postType(post("post-status")), "status");
    assert.equal(C.postType(post("post-screenshot")), "media");
    assert.equal(C.postType(post("post-review")), "review");
    assert.equal(C.postType(post("post-game")), "game");
    assert.equal(C.postType(post("post-other")), "other");
  });

  test("authors", () => {
    const a = C.postAuthor(post("post-status"));
    assert.equal(a.steamid, "76561199070365729");          // from the thread key
    assert.equal(a.accountId, "1110100001");
    assert.equal(a.vanity, "dariottoo");
    assert.equal(a.name, "Dariottoo");
    assert.equal(a.avatar, "https://avatars.akamai.steamstatic.com/aaa_full.jpg");
    const r = C.postAuthor(post("post-review"));
    assert.equal(r.name, "Max_Payne");
    assert.equal(C.postAuthor(post("post-other")).name, "zzz");
  });

  test("post keys prefer the vote button id", () => {
    assert.equal(C.getPostKey(post("post-status")), "vote_up_1792068223");
    assert.equal(C.getPostKey(post("post-review")), "thread_Recommendation_76561197960266283_570");
    assert.equal(C.getPostKey(post("post-game")), null);
  });
});

describe("comments", () => {
  test("pickComment uses the pool and avoids an exact repeat", () => {
    const pool = [":a:", ":b:", ":c:"];
    let rndI = 0;
    const seq = [0, 0, 0, 0, 0.9, 0.9];
    const rnd = () => seq[rndI++ % seq.length];
    const first = C.pickComment(pool, 2, "", rnd);
    const second = C.pickComment(pool, 2, first, rnd);
    assert.equal(first.split(" ").length, 2);
    assert.notEqual(second, first);
    assert.equal(C.pickComment([":only:"], 3, ":only: :only: :only:"), ":only: :only: :only:");
  });

  test("rate limit detection", () => {
    assert.equal(C.isRateLimit("You've been posting too frequently, and can't make another post right now"), true);
    assert.equal(C.isRateLimit("", 429), true);
    assert.equal(C.isRateLimit("The comment could not be posted"), false);
  });

  test("emoticon list in JSON and HTML shapes", () => {
    assert.deepEqual(C.parseEmoticonList('[":steamhappy:", {"name":"heart"}]'), [":heart:", ":steamhappy:"]);
    assert.deepEqual(C.parseEmoticonList('<img src="/economy/emoticon/tf2spy"> :csgoglobe:'), [":csgoglobe:", ":tf2spy:"]);
  });
});

describe("schedule, limits, stats", () => {
  const at = (h, m) => new Date(2026, 9, 16, h, m);

  test("quiet hours, including over midnight", () => {
    const s = { quietEnabled: true, quietFrom: "23:00", quietTo: "07:00" };
    assert.equal(C.inQuietHours(s, at(23, 30)), true);
    assert.equal(C.inQuietHours(s, at(3, 0)), true);
    assert.equal(C.inQuietHours(s, at(7, 0)), false);
    assert.equal(C.inQuietHours(s, at(12, 0)), false);
    assert.equal(C.inQuietHours({ quietEnabled: true, quietFrom: "09:00", quietTo: "17:00" }, at(12, 0)), true);
    assert.equal(C.inQuietHours({ ...s, quietEnabled: false }, at(3, 0)), false);
    assert.equal(C.inQuietHours({ quietEnabled: true, quietFrom: "08:00", quietTo: "08:00" }, at(8, 0)), false);
  });

  test("stats and daily limits", () => {
    const now = at(12, 0);
    let st = C.emptyStats();
    const who = { accountId: "7", name: "kot" };
    for (let i = 0; i < 3; i++) st = C.bumpStats(st, "comments", who, now);
    st = C.bumpStats(st, "likes", who, now);
    assert.deepEqual(C.todayCounts(st, now), { likes: 1, comments: 3, skipped: 0 });
    const left = C.limitsLeft(st, { dailyLikes: 0, dailyComments: 3 }, now);
    assert.equal(left.likes, Infinity);
    assert.equal(left.comments, 0);
    assert.deepEqual(C.topFriends(st, 1)[0], { accountId: "7", likes: 1, comments: 3, name: "kot", last: now.getTime(), total: 4 });
    const series = C.seriesForDays(st, 3, now);
    assert.deepEqual(series.map((d) => d.comments), [0, 0, 3]);
    assert.deepEqual(C.totals(st), { likes: 1, comments: 3 });
  });

  test("old days are pruned", () => {
    let st = C.emptyStats();
    for (let i = 0; i < 130; i++) st = C.bumpStats(st, "likes", null, new Date(2026, 0, 1 + i));
    assert.equal(Object.keys(st.days).length, 120);
  });
});

describe("export / import", () => {
  test("round trip", () => {
    const s = C.normalizeSettings({ emojiPool: [":heart:"], friendMode: "only", friendList: [{ name: "kot" }] });
    const file = JSON.stringify(C.buildExport(s, { stats: { days: { "2026-10-16": { likes: 1 } }, friends: {} } }));
    const back = C.parseImport(file);
    assert.deepEqual(back.settings.emojiPool, [":heart:"]);
    assert.equal(back.settings.friendMode, "only");
    assert.equal(back.stats.days["2026-10-16"].likes, 1);
  });

  test("foreign files are rejected", () => {
    assert.throws(() => C.parseImport("{}"), /bad_file/);
    assert.throws(() => C.parseImport("not json"), /bad_file/);
    assert.throws(() => C.parseImport('{"app":"other","settings":{}}'), /bad_file/);
  });
});

describe("strings", () => {
  test("every key exists in both languages", () => {
    const en = Object.keys(S.STRINGS.en).sort();
    const ru = Object.keys(S.STRINGS.ru).sort();
    assert.deepEqual(ru.filter((k) => !en.includes(k)), []);
    assert.deepEqual(en.filter((k) => !ru.includes(k)), []);
  });

  test("placeholders match between languages", () => {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    for (const k of Object.keys(S.STRINGS.en)) assert.equal(ph(S.STRINGS.ru[k]), ph(S.STRINGS.en[k]), k);
  });

  test("keys used in the code and markup exist", () => {
    const root = path.join(__dirname, "..");
    const src = ["content.js", "popup.js", "background.js", "popup.html"].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
    const used = new Set();
    for (const m of src.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/\blog\("([\w.]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bt\("([\w.]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/\{ k: "([\w.]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/bail\("([\w.]+)", "([\w.]+)"/g)) { used.add(m[1]); used.add(m[2]); }
    for (const w of ["like", "comment", "showAll"]) used.add("log.click." + w);
    const missing = [...used].filter((k) => !k.endsWith(".") && S.STRINGS.en[k] == null);
    assert.deepEqual(missing, []);
  });

  test("language resolution and interpolation", () => {
    assert.equal(S.resolveLang("auto", "ru-RU"), "ru");
    assert.equal(S.resolveLang("auto", "uk"), "ru");
    assert.equal(S.resolveLang("auto", "pl"), "en");
    assert.equal(S.resolveLang("en", "ru"), "en");
    assert.equal(S.makeT("ru")("log.liked", { n: 2, who: "kot" }), "👍 Лайк (2) — kot");
    assert.equal(S.makeT("en")("no.such.key"), "no.such.key");
  });
});
