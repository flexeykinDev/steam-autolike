/*
 * UI strings. Content script logs keys + params; the popup / background translate them,
 * so the log follows the language picked in settings, not the one the run started with.
 */
(function (root) {
  "use strict";

  const en = {
    // tabs
    tabRun: "Run", tabFriends: "Friends", tabSettings: "Settings", tabStats: "Stats", tabLog: "Log",
    // chip / status
    chipIdle: "idle", chipRunning: "running", chipDry: "dry run", chipCooldown: "cooldown", chipLimit: "limit",
    chipNoTab: "no tab", chipQuiet: "quiet hours",
    stRunning: "Running", stDry: "Dry run — nothing is clicked", stReady: "Ready", stNoFeed: "No feed on this page",
    stOpenFeed: "Open your Steam feed", stAntispam: "Steam anti-spam", stQuiet: "Quiet hours",
    openFeedHint: "steamcommunity.com/id/<you>/home, then reload the page",
    feedLabel: "Steam activity feed",
    ringPosts: "POSTS", ringMinCd: "MIN CD",
    ofPosts: "/ {n} posts", minLeft: "min until the limit lifts",
    resetCooldown: "reset cooldown",
    commentLabel: "Comment:", perRandom: "· {n} each, random",
    statsTitle: "Statistics", cardLikes: "Likes", cardComments: "Comments", cardSkipped: "Skipped",
    start: "Start", stop: "Stop",
    dryRun: "Dry run", dryRunHint: "check everything, click nothing",
    onlyNew: "Only new posts", onlyNewHint: "stop at what was done before",
    todayLine: "Today: {c} comments · {l} likes", todayLimit: "{v} / {max}",
    hotkeyHint: "Hotkey {key}",

    // friends
    whose: "Whose posts", modeAll: "All friends", modeOnly: "Only from the list", modeExcept: "Everyone except the list",
    listTitle: "List", listEmpty: "Empty. Add a profile link, SteamID64 or name — or pick friends from your feed below.",
    addPh: "Profile link, SteamID64 or name", add: "Add", remove: "remove",
    fromFeed: "From your feed", fromFeedEmpty: "Open your feed in this tab to see friends here.", refresh: "Refresh",
    inList: "in list", badEntry: "Couldn't read that. Paste a profile link, SteamID64 or a name.",
    postTypes: "Post types", colLike: "Like", colComment: "Comment",
    typeStatus: "Statuses", typeMedia: "Screenshots & art", typeReview: "Reviews", typeGame: "Games", typeOther: "Other",

    // settings
    secActions: "Actions", likePosts: "Like posts", leaveComment: "Leave a comment",
    poolTitle: "Emoticon pool", poolCount: "{n} pcs", poolEmpty: "Empty — {e} will be used", poolRemove: "{e} — remove",
    perComment: "Emoticons per comment", myEmoticons: "My emoticons", hide: "Hide",
    searchPh: "Search…", namePh: ":name:", loadingEmo: "Loading emoticons from Steam…",
    nothingFound: "Nothing found", emoListEmpty: "List is empty — add an emoticon by name",
    emoFailed: "Steam didn't return the list ({e}). You can add an emoticon by name.",
    emoNeedsTab: "Open any steamcommunity.com page to load your emoticons.",
    emoBadName: "Name: letters, digits and _ only",
    secSpeed: "Speed", afterLike: "After a like, ms", afterComment: "After a comment, ms",
    maxPosts: "Max posts", maxScrolls: "Max scrolls",
    secLimits: "Daily limits", likesPerDay: "Likes per day", commentsPerDay: "Comments per day", zeroNoLimit: "0 = no limit",
    secSchedule: "Schedule", quietHours: "Quiet hours — don't run", from: "from", to: "to",
    autoRun: "Run automatically", everyHours: "Every N hours", autoRunHint: "Opens your feed in a background tab, handles only new posts, closes the tab.",
    notify: "Notify when a run finishes",
    secAntispam: "Steam anti-spam", whenLimit: "When Steam hits the limit", limitStop: "Stop everything", limitLikes: "Keep liking only",
    cooldownMin: "Cooldown after the limit, min",
    secInterface: "Interface", language: "Language", langAuto: "Auto (browser)",
    secData: "Data", exportBtn: "Export", importBtn: "Import", clearHistory: "Clear history",
    save: "Save", saved: "Saved — applies on the next start.", historyCleared: "Processed-posts history cleared.",
    exported: "Settings exported.", imported: "Imported: settings{stats}.", importedStats: " and statistics",
    importBad: "This isn't a Steam Autolike export file.", importInTab: "Firefox closes the popup while picking a file — opened in a tab, press Import there.",
    hotkeyManage: "Change the hotkey: about:addons → ⚙ → Manage Extension Shortcuts.",

    // stats
    today: "Today", last14: "Last 14 days", allTime: "All time: {l} likes · {c} comments",
    topFriends: "Top friends", noStats: "Nothing yet — stats appear after the first run.",
    resetStats: "Reset statistics", statsReset: "Statistics reset.", legendLikes: "likes", legendComments: "comments",

    // log
    logTitle: "Log",

    // log lines (from the content script)
    "log.start": "▶ Start", "log.startDry": "▶ Dry run — nothing will be clicked", "log.startAuto": "▶ Auto run (only new posts)",
    "log.resume": "▶ Continuing after returning to the feed",
    "log.done": "■ Done: {likes} likes, {comments} comments, {skipped} skipped",
    "log.click.like": "click: like", "log.click.comment": "click: send comment", "log.click.showAll": "click: show all comments",
    "log.liked": "👍 Like ({n}) — {who}", "log.commented": "💬 Comment ({n}) — {who}: {text}", "log.commentedConfirmed": "💬 Comment (confirmed on the page)",
    "log.dryLike": "[dry] would like — {who}", "log.dryComment": "[dry] would comment — {who}: {text}",
    "log.already": "Already commented → skip", "log.cantVerify": "Couldn't check all comments → skip",
    "log.apiFallback": "Comment API didn't answer — trying the post page", "log.scanned": "Checked {seen}/{total} comments, mine isn't there",
    "log.skipFriend": "Filtered out: {who}", "log.skipType": "Type “{type}” is off → skip",
    "log.blockedNav": "🛑 Blocked navigation: {url}", "log.blockedLink": "🛑 Blocked link: {url}",
    "log.leftFeed": "↩ Left to {path} — going back to the feed", "log.skipLeaving": "Post {key} navigated away — skipping it",
    "log.tooManyLeaves": "Left the page too many times — stopped",
    "log.limit": "⛔ Steam limit: {error}", "log.cooldownStop": "Steam cooldown ~{min} min left",
    "log.cooldownLikes": "Cooldown ~{min} min left — likes only",
    "log.noProfile": "⚠ Couldn't detect your profile — checking by emoticons only",
    "log.scroll": "Scroll {n} | posts on page: {count}", "log.noMore": "No more new posts",
    "log.onlyNewStop": "Reached posts handled before — stopping (only new)",
    "log.dailyLikes": "Daily like limit reached ({n})", "log.dailyComments": "Daily comment limit reached ({n}) — likes only",
    "log.dailyAll": "Daily limits reached — stopping", "log.quiet": "Quiet hours — not running",
    "log.error": "Error: {msg}", "log.rejected": "Steam rejected the comment: {msg}", "log.noAnswer": "Steam didn't answer the comment",
    "log.threeErrors": "3 errors in a row", "log.noText": "no text",

    // run messages
    "msg.limitStop": "Steam anti-spam — stopped", "msg.limitLikes": "Steam anti-spam — likes only from now on",
    "msg.cooldown": "Steam cooldown ~{min} min left", "msg.noFeed": "No activity feed on this page",
    "msg.done": "Done", "msg.stopped": "Stopped", "msg.tooManyLeaves": "Stopped: the page kept navigating away",
    "msg.quiet": "Quiet hours — start is blocked", "msg.daily": "Daily limits reached",

    // notifications
    notifTitle: "Steam Autolike", notifDone: "{likes} likes, {comments} comments, {skipped} skipped",
    notifDry: "Dry run: would like {likes}, would comment {comments}", notifLimit: "Stopped by Steam anti-spam.",
    whoUnknown: "unknown"
  };

  const ru = {
    tabRun: "Запуск", tabFriends: "Друзья", tabSettings: "Опции", tabStats: "Стата", tabLog: "Лог",
    chipIdle: "ожидание", chipRunning: "работает", chipDry: "тест", chipCooldown: "кулдаун", chipLimit: "лимит",
    chipNoTab: "нет вкладки", chipQuiet: "тихие часы",
    stRunning: "Работает", stDry: "Тестовый прогон — ничего не нажимается", stReady: "Готов к запуску", stNoFeed: "Нет ленты на странице",
    stOpenFeed: "Открой ленту Steam", stAntispam: "Антиспам Steam", stQuiet: "Тихие часы",
    openFeedHint: "steamcommunity.com/id/<ты>/home, затем обнови страницу",
    feedLabel: "Лента активности Steam",
    ringPosts: "ПОСТОВ", ringMinCd: "МИН КД",
    ofPosts: "/ {n} постов", minLeft: "мин до снятия лимита",
    resetCooldown: "сбросить кулдаун",
    commentLabel: "Коммент:", perRandom: "· по {n}, случайно",
    statsTitle: "Статистика", cardLikes: "Лайков", cardComments: "Комментов", cardSkipped: "Пропущено",
    start: "Старт", stop: "Стоп",
    dryRun: "Тестовый прогон", dryRunHint: "всё проверяет, ничего не жмёт",
    onlyNew: "Только новые посты", onlyNewHint: "остановится на уже обработанных",
    todayLine: "Сегодня: {c} комментов · {l} лайков", todayLimit: "{v} / {max}",
    hotkeyHint: "Горячая клавиша {key}",

    whose: "Чьи посты", modeAll: "Все друзья", modeOnly: "Только из списка", modeExcept: "Все, кроме списка",
    listTitle: "Список", listEmpty: "Пусто. Добавь ссылку на профиль, SteamID64 или ник — или выбери друзей из ленты ниже.",
    addPh: "Ссылка, SteamID64 или ник", add: "Добавить", remove: "убрать",
    fromFeed: "Из твоей ленты", fromFeedEmpty: "Открой ленту в этой вкладке — здесь появятся друзья.", refresh: "Обновить",
    inList: "в списке", badEntry: "Не понял. Вставь ссылку на профиль, SteamID64 или ник.",
    postTypes: "Типы постов", colLike: "Лайк", colComment: "Коммент",
    typeStatus: "Статусы", typeMedia: "Скриншоты и арт", typeReview: "Обзоры", typeGame: "Игры", typeOther: "Прочее",

    secActions: "Действия", likePosts: "Лайкать посты", leaveComment: "Оставлять комментарий",
    poolTitle: "Пул смайликов", poolCount: "{n} шт.", poolEmpty: "Пусто — будет {e}", poolRemove: "{e} — убрать",
    perComment: "Смайликов в одном комменте", myEmoticons: "Мои смайлики", hide: "Скрыть",
    searchPh: "Поиск…", namePh: ":название:", loadingEmo: "Загружаю смайлики из Steam…",
    nothingFound: "Ничего не найдено", emoListEmpty: "Список пуст — добавь смайлик вручную по названию",
    emoFailed: "Steam не отдал список ({e}). Можно добавить смайлик вручную.",
    emoNeedsTab: "Открой любую страницу steamcommunity.com, чтобы подтянуть твои смайлики.",
    emoBadName: "Название — только буквы, цифры и _",
    secSpeed: "Скорость", afterLike: "После лайка, мс", afterComment: "После коммента, мс",
    maxPosts: "Макс. постов", maxScrolls: "Макс. скроллов",
    secLimits: "Дневные лимиты", likesPerDay: "Лайков в день", commentsPerDay: "Комментов в день", zeroNoLimit: "0 = без лимита",
    secSchedule: "Расписание", quietHours: "Тихие часы — не запускать", from: "с", to: "до",
    autoRun: "Запускать автоматически", everyHours: "Каждые N часов", autoRunHint: "Откроет ленту в фоновой вкладке, пройдёт только новые посты и закроет вкладку.",
    notify: "Уведомлять о завершении",
    secAntispam: "Антиспам Steam", whenLimit: "Когда Steam дал лимит", limitStop: "Остановить всё", limitLikes: "Продолжать только лайки",
    cooldownMin: "Кулдаун после лимита, мин",
    secInterface: "Интерфейс", language: "Язык", langAuto: "Авто (как в браузере)",
    secData: "Данные", exportBtn: "Экспорт", importBtn: "Импорт", clearHistory: "Очистить историю",
    save: "Сохранить", saved: "Сохранено — применится при следующем старте.", historyCleared: "История обработанных постов очищена.",
    exported: "Настройки выгружены.", imported: "Импортировано: настройки{stats}.", importedStats: " и статистика",
    importBad: "Это не файл экспорта Steam Autolike.", importInTab: "Firefox закрывает попап при выборе файла — открыл во вкладке, нажми «Импорт» там.",
    hotkeyManage: "Сменить клавишу: about:addons → ⚙ → Управление горячими клавишами.",

    today: "Сегодня", last14: "Последние 14 дней", allTime: "За всё время: {l} лайков · {c} комментов",
    topFriends: "Топ друзей", noStats: "Пока пусто — статистика появится после первого запуска.",
    resetStats: "Сбросить статистику", statsReset: "Статистика сброшена.", legendLikes: "лайки", legendComments: "комменты",

    logTitle: "Лог",

    "log.start": "▶ Старт", "log.startDry": "▶ Тестовый прогон — ничего не будет нажато", "log.startAuto": "▶ Автозапуск (только новые посты)",
    "log.resume": "▶ Продолжаю после возврата на ленту",
    "log.done": "■ Готово: лайков {likes}, комментов {comments}, пропущено {skipped}",
    "log.click.like": "клик: лайк", "log.click.comment": "клик: отправить коммент", "log.click.showAll": "клик: показать все комменты",
    "log.liked": "👍 Лайк ({n}) — {who}", "log.commented": "💬 Коммент ({n}) — {who}: {text}", "log.commentedConfirmed": "💬 Коммент (подтверждён по странице)",
    "log.dryLike": "[тест] лайкнул бы — {who}", "log.dryComment": "[тест] прокомментировал бы — {who}: {text}",
    "log.already": "Уже комментировал → пропуск", "log.cantVerify": "Не удалось проверить все комменты → пропуск",
    "log.apiFallback": "API комментов не ответил — пробую страницу поста", "log.scanned": "Проверено {seen}/{total} комментов, моего нет",
    "log.skipFriend": "Не в фильтре: {who}", "log.skipType": "Тип «{type}» выключен → пропуск",
    "log.blockedNav": "🛑 Заблокирован переход: {url}", "log.blockedLink": "🛑 Заблокирована ссылка: {url}",
    "log.leftFeed": "↩ Ушли на {path} — возвращаюсь на ленту", "log.skipLeaving": "Пост {key} уводил со страницы — пропускаю его",
    "log.tooManyLeaves": "Слишком много уходов со страницы — остановлено",
    "log.limit": "⛔ Лимит Steam: {error}", "log.cooldownStop": "Кулдаун Steam ещё ~{min} мин",
    "log.cooldownLikes": "Кулдаун ещё ~{min} мин — только лайки",
    "log.noProfile": "⚠ Не удалось определить свой профиль — проверка идёт только по смайликам",
    "log.scroll": "Скролл {n} | постов на странице: {count}", "log.noMore": "Новых постов больше нет",
    "log.onlyNewStop": "Дошёл до уже обработанных постов — стоп (только новые)",
    "log.dailyLikes": "Дневной лимит лайков ({n}) исчерпан", "log.dailyComments": "Дневной лимит комментов ({n}) исчерпан — дальше только лайки",
    "log.dailyAll": "Дневные лимиты исчерпаны — стоп", "log.quiet": "Тихие часы — не запускаюсь",
    "log.error": "Ошибка: {msg}", "log.rejected": "Steam отклонил комментарий: {msg}", "log.noAnswer": "Steam не ответил на комментарий",
    "log.threeErrors": "3 ошибки подряд", "log.noText": "без текста",

    "msg.limitStop": "Steam включил антиспам — остановлено", "msg.limitLikes": "Steam включил антиспам — дальше только лайки",
    "msg.cooldown": "Кулдаун Steam ещё ~{min} мин", "msg.noFeed": "На этой странице нет ленты активности",
    "msg.done": "Готово", "msg.stopped": "Остановлено", "msg.tooManyLeaves": "Остановлено: страница уходила слишком часто",
    "msg.quiet": "Тихие часы — запуск заблокирован", "msg.daily": "Дневные лимиты исчерпаны",

    notifTitle: "Steam Autolike", notifDone: "Лайков: {likes}, комментов: {comments}, пропущено: {skipped}",
    notifDry: "Тест: лайкнул бы {likes}, прокомментировал бы {comments}", notifLimit: "Остановлено антиспамом Steam.",
    whoUnknown: "неизвестно"
  };

  const STRINGS = { en, ru };

  function resolveLang(pref, uiLang) {
    if (pref === "en" || pref === "ru") return pref;
    return /^(ru|uk|be|kk)\b/i.test(String(uiLang || "")) ? "ru" : "en";
  }

  /** t("log.liked", {n: 3}) — falls back to English, then to the key itself. */
  function makeT(lang) {
    const dict = STRINGS[lang] || en;
    return function t(key, params) {
      let s = dict[key] != null ? dict[key] : en[key] != null ? en[key] : key;
      if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
      return s;
    };
  }

  const api = { STRINGS, resolveLang, makeT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SALStrings = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
