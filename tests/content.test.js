// Runs the real content script inside jsdom against the feed fixture, with a fake `browser`
// and a fake Steam comment API. Checks the behaviour end to end, not just the helpers.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const FEED = fs.readFileSync(path.join(__dirname, "fixtures", "feed.html"), "utf8");
const ME = "76561198000000099";
const STATUS_THREAD = "UserStatusPublished_76561199070365729_1792068223";

const myComment = `<div class="commentthread_comment"><div class="commentthread_comment_author">
  <a class="commentthread_author_link" href="https://steamcommunity.com/profiles/${ME}" data-miniprofile="39734371">me</a></div>
  <div class="commentthread_comment_text">hi</div></div>`;
const otherComment = `<div class="commentthread_comment"><div class="commentthread_comment_author">
  <a class="commentthread_author_link" href="https://steamcommunity.com/id/someone" data-miniprofile="1">x</a></div>
  <div class="commentthread_comment_text">hello</div></div>`;

/**
 * @param settings  saved settings
 * @param thread    (start) => { total, html } — what the comment API returns for the status thread
 * @param storage   initial storage
 */
function harness({ settings = {}, thread, storage = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${FEED}</body>`, { url: "https://steamcommunity.com/id/me/home/", runScripts: "outside-only" });
  const w = dom.window;
  const store = Object.assign({ settings: Object.assign({ likeDelay: 500, commentDelay: 1000, maxScrolls: 0 }, settings) }, storage);
  const listeners = [];
  const sent = [];
  const clicks = { like: 0, submit: 0 };
  const apiCalls = [];

  w.g_steamID = ME;
  w.g_sessionID = "sess";
  w.Element.prototype.scrollIntoView = function () {};
  w.scrollTo = () => {};
  w.scrollBy = () => {};

  w.fetch = async (url, opts) => {
    apiCalls.push({ url: String(url), body: opts && String(opts.body) });
    const start = Number(new URLSearchParams(String(opts && opts.body)).get("start") || 0);
    const r = thread ? thread(start, String(url)) : { total: 0, html: "" };
    return { ok: true, json: async () => ({ success: true, total_count: r.total, comments_html: r.html }) };
  };

  w.document.getElementById("vote_up_1792068223").addEventListener("click", () => clicks.like++);
  w.document.getElementById(`commentthread_${STATUS_THREAD}_submit`).addEventListener("click", () => {
    clicks.submit++;
    // Steam answers the POST; background.js relays it to the tab
    setTimeout(() => listeners.forEach((l) => l({ type: "commentResult", ok: true, error: "", status: 200 })), 20);
  });

  w.browser = {
    storage: { local: {
      get: async (keys) => {
        const out = {};
        for (const k of [].concat(keys == null ? Object.keys(store) : keys)) if (store[k] !== undefined) out[k] = JSON.parse(JSON.stringify(store[k]));
        return out;
      },
      set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); }
    } },
    runtime: {
      sendMessage: async (m) => { sent.push(m); },
      onMessage: { addListener: (fn) => listeners.push(fn) }
    }
  };

  w.eval(read("lib/core.js"));
  w.eval(read("content.js"));

  const message = (m) => listeners.map((l) => l(m)).find((x) => x !== undefined);
  const finished = () => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const f = sent.find((m) => m.type === "runFinished");
      if (f) { clearInterval(iv); resolve(f); }
      if (Date.now() - t0 > 20000) { clearInterval(iv); reject(new Error("run did not finish")); }
    }, 50);
  });
  const logKeys = () => (store.run && store.run.log || []).map((l) => l.k);
  return { w, store, sent, clicks, apiCalls, message, finished, logKeys, textarea: w.document.querySelector("textarea") };
}

describe("content script, end to end", { concurrency: false }, () => {
  test("dry run clicks nothing and stores nothing", async () => {
    const h = harness({ settings: { dryRun: true } });
    await new Promise((r) => setTimeout(r, 50));
    await h.message({ type: "start" });
    const f = await h.finished();
    assert.equal(f.dry, true);
    assert.equal(h.clicks.like, 0);
    assert.equal(h.clicks.submit, 0);
    assert.ok(h.logKeys().includes("log.dryLike"));
    assert.ok(h.logKeys().includes("log.dryComment"));
    assert.equal((h.store.processed || []).length, 0);
    assert.equal(h.store.stats, undefined);
  });

  test("real run: likes, reads the whole thread, comments once with :steamhappy:", async () => {
    const h = harness({ thread: (start) => ({ total: 230, html: (start < 200 ? otherComment.repeat(100) : otherComment.repeat(30)) }) });
    await new Promise((r) => setTimeout(r, 50));
    await h.message({ type: "start" });
    const f = await h.finished();
    assert.equal(h.clicks.like, 1, "the status post is liked");
    assert.equal(h.clicks.submit, 1, "one comment is sent");
    assert.equal(h.textarea.value, ":steamhappy:");
    const statusCalls = h.apiCalls.filter((c) => c.url.includes("/comment/UserStatusPublished/render/76561199070365729/1792068223/"));
    assert.deepEqual(statusCalls.map((c) => new URLSearchParams(c.body).get("start")), ["0", "100", "200"], "all three pages were read");
    assert.ok(h.store.processed.includes("vote_up_1792068223"));
    assert.ok(h.store.commentedThreads.includes(STATUS_THREAD));
    const day = Object.values(h.store.stats.days)[0];
    assert.equal(day.likes, 1);
    assert.equal(day.comments, 1);
    assert.equal(f.summary.comments, 1);
  });

  test("post types: statuses set to 'like only' → liked, not commented", async () => {
    const h = harness({ settings: { types: { status: { like: true, comment: false } } } });
    await new Promise((r) => setTimeout(r, 50));
    await h.message({ type: "start" });
    await h.finished();
    assert.equal(h.clicks.like, 1);
    assert.equal(h.clicks.submit, 0);
  });

  test("post types: everything off → skipped with a log line", async () => {
    const off = { like: false, comment: false };
    const h = harness({ settings: { types: { status: off, media: off, review: off, game: off, other: off } } });
    await new Promise((r) => setTimeout(r, 50));
    await h.message({ type: "start" });
    await h.finished();
    assert.equal(h.clicks.like + h.clicks.submit, 0);
    assert.ok(h.logKeys().includes("log.skipType"));
  });

  test("my comment on a later page of the thread → no second comment", async () => {
    const h = harness({ thread: (start) => ({ total: 150, html: start === 0 ? otherComment.repeat(100) : otherComment.repeat(49) + myComment }) });
    await new Promise((r) => setTimeout(r, 50));
    await h.message({ type: "start" });
    await h.finished();
    assert.equal(h.clicks.submit, 0);
    assert.ok(h.logKeys().includes("log.already"));
  });

  test("thread that can't be read → the post is skipped, not commented", async () => {
    const h = harness();
    h.w.fetch = async () => ({ ok: false, json: async () => ({}) });
    await new Promise((r) => setTimeout(r, 50));
    await h.message({ type: "start" });
    await h.finished();
    assert.equal(h.clicks.submit, 0);
    assert.ok(h.logKeys().includes("log.cantVerify"));
  });

  test("friends filter: 'only from the list' with someone else listed", async () => {
    const h = harness({ settings: { friendMode: "only", friendList: [{ name: "nobody here" }] } });
    await new Promise((r) => setTimeout(r, 50));
    await h.message({ type: "start" });
    await h.finished();
    assert.equal(h.clicks.like + h.clicks.submit, 0);
    assert.ok(h.logKeys().includes("log.skipFriend"));
  });

  test("daily comment limit already used up → likes only", async () => {
    const today = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
    const h = harness({ settings: { dailyComments: 2 }, storage: { stats: { days: { [today]: { likes: 0, comments: 2, skipped: 0 } }, friends: {} } } });
    await new Promise((r) => setTimeout(r, 50));
    await h.message({ type: "start" });
    await h.finished();
    assert.equal(h.clicks.like, 1);
    assert.equal(h.clicks.submit, 0);
    assert.ok(h.logKeys().includes("log.dailyComments"));
  });

  test("only new posts: stops at a streak of posts handled before", async () => {
    const h = harness({ settings: { onlyNew: true, onlyNewStreak: 2 }, storage: { processed: ["vote_up_1792068223", "VoteUpBtn_3333"] } });
    await new Promise((r) => setTimeout(r, 50));
    await h.message({ type: "start" });
    await h.finished();
    assert.equal(h.clicks.like + h.clicks.submit, 0);
    assert.ok(h.logKeys().includes("log.onlyNewStop"));
    assert.ok(!h.logKeys().includes("log.skipType"), "nothing after the stop point was touched");
  });

  test("Steam cooldown + 'stop everything' → doesn't start", async () => {
    const h = harness({ storage: { cooldownUntil: Date.now() + 10 * 60000 } });
    await new Promise((r) => setTimeout(r, 50));
    await h.message({ type: "start" });
    await h.finished();
    assert.equal(h.clicks.like + h.clicks.submit, 0);
    assert.equal(h.store.run.msg.k, "msg.cooldown");
  });
});
