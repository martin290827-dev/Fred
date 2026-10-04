# Fred

Personal dashboard PWA. Hosted on GitHub Pages (static only, public repo).

## Rules
- Plain HTML, CSS and JavaScript. No build step, no framework, unless I ask.
- The repo is PUBLIC. NEVER put API keys, places, dates, trips, names or any personal data in code, comments, tests or commit messages. Personal values are entered in the app (Settings) and live in the browser (localStorage).
- NEVER put API keys or personal data in the code or the repo. Keys live in the browser (localStorage) via Settings.
- All internet calls happen from the browser. Only use APIs that allow CORS.
- Keep the code simple and readable. Small functions, short comments.
- One feature per session. Do not refactor unrelated code.
- After changing app files, bump `CACHE` in `sw.js` AND the `?v=` number on style.css, app.js, gcal.js, sync.js, food.js and recovery.js (and in `SHELL` in sw.js) in index.html (GitHub Pages caches files for 10 minutes).
- Phone and desktop always have the same features. Only the layout may differ.

## Files
- index.html, style.css: page and styles. app.js: everything else. gcal.js: Google Calendar (loaded after app.js; `init()` runs on DOMContentLoaded).
- archive.js: hidden history for later analysis, not shown in any card (loaded after food.js, before recovery.js).
- recovery.js: Recovery card and Sleep card (Whoop CSV import of up to three files, own provider-neutral score, sparklines; loaded after archive.js, uses its CSV reader).
- sw.js: offline cache.

## Current features Food is split into three cards: Food (input, stacked rings, meals), Health (goal with current weight and 3 key numbers, daily AI tips from the last 7 days; weight is entered in Settings), Trends (range W/M/3M: 7-day check on W, calories, protein, carbs, fat, weight); all rendered by renderFood().
Sparklines (30 days; Binance for crypto, Twelve Data key for stocks), second weather place (click to switch), optional current location as main weather place (per device, not synced; coords rounded to ~1 km; name via BigDataCloud reverse-geocode-client), events (read from Google Calendar, nothing typed in), card order and hiding (Layout button), settings backup as a file (Download / Load), timer, multi time zone clock, weather (Open-Meteo), tickers (Binance for crypto with prefix `c:`, Finnhub for stocks), Google Calendar view ("Tasks & reminders": timed appointments; all-day and multi-day items show under Events), shopping list (edit), notes (free text, autosave, in backup, share button: system share sheet, e.g. Apple Notes; clipboard fallback), stock exchange hours (Time card), earnings dates of stock tickers (Finnhub, under Events), market news card (full width; Finnhub company news for stocks, crypto feed matched by coin name; headlines only), Google reconnect row, food diary card (food.js: dictated text, calories by Claude API with the user's own key or '... kcal' in the text, weight, 30-day charts, mirrored to two Google Sheets via drive.file), sync between devices via a hidden file in Google Drive appDataFolder (sync.js, scope drive.appdata; newest change per setting wins; theme stays per device), add/edit/delete Google items from Fred (Google is the only copy; repeating items: only this or whole series; birthdays read-only), calculator (input field only, no keypad), day/night mode (button + device setting), countdowns, USD/EUR/MXN/GBP/CHF/JPY/CNY/PHP converter (default pair in Settings). Nutrition targets (calorie goal, protein/carbs/fat rings, 7-day check).

- Recovery card (score, HRV, resting HR, import) and Sleep card (duration, stages, debt, bedtime rhythm), traffic-light charts: manual import of a Whoop CSV (Physiologische Zyklen). Fred computes its own score from HRV and resting HR (deviation from a rolling 30-night baseline) minus sleep debt, not Whoop's proprietary recovery. Data in localStorage key `whoop` (synced, in backup). Only the CSV parser is provider-specific.

- Hidden history (archive.js): one JSON file in Drive ("Fred Archiv Daten.json", scope drive.file) is the real archive; Sheets "Fred Archiv Zyklen / Schlaf / Training / Essen / Gewicht" are generated from it. All three Whoop CSVs (all columns, naps included) and every meal and weight are upserted by key; history only grows. Only an explicit delete of a meal removes it. Missing entries after a sync are never treated as deleted. Changes wait in a local queue (`arcQueue`, not synced, not in backup) until Google is connected. Status line in the Recovery card, Daten.

## Ideas for later
- Strategy signal panel (for example price versus 200-day average)
- Edit for tasks and shopping list

## Storage
- Everything except notes and keys lives in the Google Sheet "Fred Daten" (sheets.js, one tab per set): tickers (with order), shopping list, food, weight, poker, daily Whoop values, raw Whoop history, and a settings tab (goals, tips, tolerance, weekly texts, weather places, default currencies, clocks, card layout per kind of device: touch = phone, else desktop). The browser only keeps a working copy. Needs the Google Sheets API enabled in the user's Cloud project.
- Food tracks sugar (total sugar, limit 10 % of calories); older meals get their sugar estimated once.
- Security: `index.html` has a Content-Security-Policy. A new API host must be added to `connect-src`, a new script must be a file (no inline scripts). `theme.js` runs first (theme + frame check).
- Cheat day: switch on in Settings (`nutri.cheatOn`); Food then lets you mark any of the last 7 days (also afterwards), strictly one per Mon–Sun week (`nutri.cheatDays`). Marked days are left out of the AI tips and shown with a diamond in the trend charts; totals still count them.
- Card "Health & Nutrition Tips" (the card before it is "Weight & Goal") (`tips.js`, `#card-tips`): the 14-day tips (moved out of Health), "Missing today" (AI from today's meals) and "What shall I cook?" (AI from foods at home and what is left today). Results are kept in `gaps` and `cook` in this browser only.
- Tasks and Events are one card "Tasks & Events" with ONE list sorted by day (events first on a day, then timed items). The + opens a form with a Task | Event switch.
- Places, clocks and tickers are edited in their cards (pencil / +), not in Settings. The converter remembers the last pair.
- Notes and API keys / Client ID sync through the hidden Drive file (sync.js). The Client ID cannot live in the Sheet: it is needed to sign in first.
