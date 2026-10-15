// Следит за ответами Steam на отправку комментариев.
// Steam отвечает JSON вида {"success": false, "error": "You've been posting too frequently..."}
// Читаем тело ответа (Firefox: filterResponseData), не меняя его, и сообщаем вкладке.

const LIMIT_RE = /too frequently|too many|posting too|rate limit|try again later|слишком часто|слишком много|попробуйте позже|подождите/i;
const DEFAULT_COOLDOWN_MIN = 30;

const statusCodes = new Map();

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
      filter.write(e.data); // отдаём странице без изменений
    };
    filter.onstop = () => {
      body += decoder.decode();
      filter.close();
      analyze(details, body);
    };
    filter.onerror = () => {
      try { filter.disconnect(); } catch (_) {}
    };
  },
  { urls: ["*://steamcommunity.com/comment/*"], types: ["xmlhttprequest"] },
  ["blocking"]
);

async function analyze(details, body) {
  const status = statusCodes.get(details.requestId) || 0;
  statusCodes.delete(details.requestId);

  let ok = false;
  let error = "";
  try {
    const j = JSON.parse(body);
    ok = j.success === true || j.success === 1;
    error = j.error || "";
  } catch (_) {
    error = body.slice(0, 200);
  }

  const rateLimited = !ok && (status === 429 || LIMIT_RE.test(error));

  if (rateLimited) {
    const { settings = {} } = await browser.storage.local.get("settings");
    const minutes = Number(settings.cooldownMin) || DEFAULT_COOLDOWN_MIN;
    await browser.storage.local.set({ cooldownUntil: Date.now() + minutes * 60000, lastLimitError: error });
    updateBadge();
  }

  if (details.tabId >= 0) {
    browser.tabs
      .sendMessage(details.tabId, { type: "commentResult", ok, rateLimited, error, status })
      .catch(() => {});
  }
}

async function updateBadge() {
  const { cooldownUntil = 0 } = await browser.storage.local.get("cooldownUntil");
  const active = cooldownUntil > Date.now();
  browser.browserAction.setBadgeText({ text: active ? "⏸" : "" });
  browser.browserAction.setBadgeBackgroundColor({ color: "#c0392b" });
}

browser.storage.onChanged.addListener((changes) => {
  if (changes.cooldownUntil) updateBadge();
});

// Снимаем бейдж, когда кулдаун истёк
setInterval(updateBadge, 60000);
updateBadge();
