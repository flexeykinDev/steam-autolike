/*
 * Steam Autolike — background page.
 *  - reads Steam's answers to comment posts (filterResponseData) and detects the anti-spam limit;
 *  - badge while the cooldown is on;
 *  - auto-run on a timer (opens the feed in a background tab, only new posts, closes the tab);
 *  - notification when a run finishes; hotkey to start / stop.
 */
const C = globalThis.SALCore;
const S = globalThis.SALStrings;

const FEED_URL = "https://steamcommunity.com/my/home/";
const FEED_RE = /^https:\/\/steamcommunity\.com\/(id|profiles)\/[^/]+\/home\/?/;
const statusCodes = new Map();
const autoTabs = new Set();          // tabs opened by auto-run, closed when the run ends

async function getSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return C.normalizeSettings(settings);
}
async function tr() {
  const s = await getSettings();
  return S.makeT(S.resolveLang(s.lang, browser.i18n.getUILanguage()));
}

// ---------------------------------------------------------------- Steam comment responses
browser.webRequest.onHeadersReceived.addListener(
  (d) => { statusCodes.set(d.requestId, d.statusCode); },
  { urls: ["*://steamcommunity.com/comment/*"] }
);

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method !== "POST" || !/\/comment\/[^/]+\/post\//.test(details.url)) return;
    const filter = browser.webRequest.filterResponseData(details.requestId);
    const decoder = new TextDecoder("utf-8");
    let body = "";
    filter.ondata = (e) => {
      body += decoder.decode(e.data, { stream: true });
      filter.write(e.data); // pass through untouched
    };
    filter.onstop = () => {
      body += decoder.decode();
      filter.close();
      analyze(details, body);
    };
    filter.onerror = () => { try { filter.disconnect(); } catch (_) {} };
  },
  { urls: ["*://steamcommunity.com/comment/*"], types: ["xmlhttprequest"] },
  ["blocking"]
);

async function analyze(details, body) {
  const status = statusCodes.get(details.requestId) || 0;
  statusCodes.delete(details.requestId);
  let ok = false, error = "";
  try {
    const j = JSON.parse(body);
    ok = j.success === true || j.success === 1;
    error = j.error || "";
  } catch (_) {
    error = body.slice(0, 200);
  }
  const rateLimited = !ok && C.isRateLimit(error, status);
  if (rateLimited) {
    const s = await getSettings();
    await browser.storage.local.set({ cooldownUntil: Date.now() + s.cooldownMin * 60000, lastLimitError: error });
    updateBadge();
  }
  if (details.tabId >= 0) {
    browser.tabs.sendMessage(details.tabId, { type: "commentResult", ok, rateLimited, error, status }).catch(() => {});
  }
}

// ---------------------------------------------------------------- badge
async function updateBadge() {
  const { cooldownUntil = 0 } = await browser.storage.local.get("cooldownUntil");
  browser.browserAction.setBadgeText({ text: cooldownUntil > Date.now() ? "⏸" : "" });
  browser.browserAction.setBadgeBackgroundColor({ color: "#c0392b" });
}
setInterval(updateBadge, 60000);

// ---------------------------------------------------------------- auto-run
async function scheduleAutoRun() {
  const s = await getSettings();
  await browser.alarms.clear("autorun");
  if (s.autoRun) browser.alarms.create("autorun", { delayInMinutes: 1, periodInMinutes: s.autoRunHours * 60 });
}

function waitForComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const done = (ok) => { browser.tabs.onUpdated.removeListener(onUpd); clearTimeout(tm); resolve(ok); };
    const onUpd = (id, info) => { if (id === tabId && info.status === "complete") done(true); };
    const tm = setTimeout(() => done(false), timeoutMs);
    browser.tabs.onUpdated.addListener(onUpd);
    browser.tabs.get(tabId).then((t) => { if (t.status === "complete") done(true); }, () => done(false));
  });
}

async function sendWhenReady(tabId, msg, tries) {
  for (let i = 0; i < (tries || 15); i++) {
    try {
      const pong = await browser.tabs.sendMessage(tabId, { type: "ping" });
      if (pong && pong.hasFeed) return await browser.tabs.sendMessage(tabId, msg);
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function autoRun() {
  const s = await getSettings();
  if (!s.autoRun || C.inQuietHours(s)) return;
  const { cooldownUntil = 0, run } = await browser.storage.local.get(["cooldownUntil", "run"]);
  if (cooldownUntil > Date.now() && s.onLimit === "stop") return;
  if (run && run.active && Date.now() - (run.touched || 0) < 5 * 60000) return; // something is running

  const tabs = await browser.tabs.query({ url: "*://steamcommunity.com/*" });
  let tab = tabs.find((t) => FEED_RE.test(t.url || ""));
  if (!tab) {
    tab = await browser.tabs.create({ url: FEED_URL, active: false });
    autoTabs.add(tab.id);
    await waitForComplete(tab.id, 45000);
  }
  const res = await sendWhenReady(tab.id, { type: "start", auto: true });
  if (!res && autoTabs.has(tab.id)) { autoTabs.delete(tab.id); browser.tabs.remove(tab.id).catch(() => {}); }
}

browser.alarms.onAlarm.addListener((a) => { if (a.name === "autorun") autoRun(); });

// ---------------------------------------------------------------- run finished → notification
browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (!msg) return;
  if (msg.type === "runFinished") {
    const s = await getSettings();
    const tabId = sender.tab && sender.tab.id;
    if (s.notify && (msg.summary.likes || msg.summary.comments || msg.limited || msg.auto)) {
      const t = await tr();
      const text = msg.limited ? t("notifLimit") + " " + t("notifDone", msg.summary)
                 : msg.dry ? t("notifDry", msg.summary) : t("notifDone", msg.summary);
      browser.notifications.create("run-" + Date.now(), {
        type: "basic", iconUrl: browser.runtime.getURL("icons/icon-96.png"), title: t("notifTitle"), message: text
      });
    }
    if (tabId != null && autoTabs.has(tabId)) {
      autoTabs.delete(tabId);
      setTimeout(() => browser.tabs.remove(tabId).catch(() => {}), 3000);
    }
  }
  if (msg.type === "rescheduleAutoRun") await scheduleAutoRun();
});

browser.tabs.onRemoved.addListener((id) => autoTabs.delete(id));

// ---------------------------------------------------------------- hotkey
browser.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "toggle-run") return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https:\/\/steamcommunity\.com\//.test(tab.url || "")) {
    browser.tabs.sendMessage(tab.id, { type: "toggle" }).catch(() => {});
  }
});

// ---------------------------------------------------------------- init
browser.storage.onChanged.addListener((changes) => {
  if (changes.cooldownUntil) updateBadge();
  if (changes.settings) {
    const a = changes.settings.oldValue || {}, b = changes.settings.newValue || {};
    if (a.autoRun !== b.autoRun || a.autoRunHours !== b.autoRunHours) scheduleAutoRun();
  }
});
browser.runtime.onInstalled.addListener(scheduleAutoRun);
browser.runtime.onStartup.addListener(scheduleAutoRun);
updateBadge();
