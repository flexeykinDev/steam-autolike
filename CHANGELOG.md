# Changelog

All notable changes to Steam Autolike. Versions follow [SemVer](https://semver.org/).

## [2.0.0] — 2026-10-16

### Added
- **Friends filter** — process all friends, only the ones on your list, or everyone except the list. Add people by profile link, SteamID64, `[U:1:…]` or name, or pick them straight from your feed.
- **Post types** — choose separately whether to like and/or comment on statuses, screenshots & art, reviews, games and everything else.
- **Dry run** — walks the feed and checks every thread but clicks nothing; the log shows what it *would* do.
- **Only new posts** — stops after a streak of posts handled in earlier runs instead of scrolling through the whole history.
- **Daily limits** for likes and comments, plus **quiet hours** (wrap around midnight).
- **Auto-run** every N hours: opens the feed in a background tab, handles only new posts, closes the tab.
- **Statistics** tab: today's counters, a 14-day pixel chart and top friends.
- **Export / import** of settings and statistics as JSON.
- **Hotkey** `Alt+Shift+L` to start / stop, and a **notification** when a run finishes.
- **English interface** (auto-detected from the browser, switchable in settings); the log follows the chosen language.
- PNG icons for notifications and the add-ons manager.
- Unit tests (`node --test` + jsdom, fixtures taken from real Steam markup), GitHub Actions CI and tag-based releases.

### Changed
- Core logic moved to `lib/core.js`, UI strings to `lib/strings.js`.
- Log entries are stored as keys + parameters and translated when shown.

## [1.4.0] — 2026-10-16

### Fixed
- Comments on page 2+ of a thread were missed, so the extension could comment again. The whole thread is now read through Steam's comment render endpoint before commenting; if it can't be read completely, the post is skipped.

### Added
- A separate journal of threads already commented on (not cleared by “Clear history”).

### Changed
- Default emoticon is `:steamhappy:`, which every account has.

## [1.3.0] — 2026-10-15

### Added
- Emoticon pool picked from your own Steam emoticons, rendered as images; 1–5 random emoticons per comment.

## [1.2.0] — 2026-10-15

### Added
- Pixel dot-matrix popup design, mosaic avatar, dot-matrix icon.

## [1.1.0] — 2026-10-15

### Fixed
- The feed no longer navigates to post pages: script-initiated navigations are cancelled, and if one slips through the run returns to the feed and continues.

## [1.0.0] — 2026-10-15

- First version: likes, one comment per post, Steam anti-spam detection with cooldown.
