# Fred

Personal dashboard PWA. Hosted on GitHub Pages (static only, public repo).

## Rules
- Plain HTML, CSS and JavaScript. No build step, no framework, unless I ask.
- The repo is PUBLIC. NEVER put API keys, places, dates, trips, names or any personal data in code, comments, tests or commit messages. Personal values are entered in the app (Settings) and live in the browser (localStorage).
- NEVER put API keys or personal data in the code or the repo. Keys live in the browser (localStorage) via Settings.
- All internet calls happen from the browser. Only use APIs that allow CORS.
- Keep the code simple and readable. Small functions, short comments.
- One feature per session. Do not refactor unrelated code.
- After changing app files, bump `CACHE` in `sw.js` AND the `?v=` number on style.css, app.js and gcal.js (and in `SHELL` in sw.js) in index.html (GitHub Pages caches files for 10 minutes).
- Phone and desktop always have the same features. Only the layout may differ.

## Files
- index.html, style.css: page and styles. app.js: everything else. gcal.js: Google Calendar (loaded after app.js; `init()` runs on DOMContentLoaded).
- sw.js: offline cache.

## Current features Food is split into three cards: Food (input, stacked rings, meals), Health (goal with current weight and 3 key numbers, daily AI tips from the last 7 days; weight is entered in Settings), Trends (range W/M/3M: 7-day check on W, calories, protein, weight with 7-day average); all rendered by renderFood().
Sparklines (30 days; Binance for crypto, Twelve Data key for stocks), second weather place (click to switch), optional current location as main weather place (per device, not synced; coords rounded to ~1 km; name via BigDataCloud reverse-geocode-client), events (read from Google Calendar, nothing typed in), card order and hiding (Layout button), settings backup as a file (Download / Load), timer, multi time zone clock, weather (Open-Meteo), tickers (Binance for crypto with prefix `c:`, Finnhub for stocks), Google Calendar view ("Tasks & reminders": timed appointments; all-day and multi-day items show under Events), shopping list (edit), notes (free text, autosave, in backup, share button: system share sheet, e.g. Apple Notes; clipboard fallback), stock exchange hours (Time card), earnings dates of stock tickers (Finnhub, under Events), market news card (full width; Finnhub company news for stocks, crypto feed matched by coin name; headlines only), Google reconnect row, food diary card (food.js: dictated text, calories by Claude API with the user's own key or '... kcal' in the text, weight, 30-day charts, mirrored to two Google Sheets via drive.file), sync between devices via a hidden file in Google Drive appDataFolder (sync.js, scope drive.appdata; newest change per setting wins; theme stays per device), add/edit/delete Google items from Fred (Google is the only copy; repeating items: only this or whole series; birthdays read-only), calculator (input field only, no keypad), day/night mode (button + device setting), countdowns, USD/EUR/MXN/GBP/CHF/JPY/CNY/PHP converter (default pair in Settings). Nutrition targets (calorie goal, protein/carbs/fat rings, 7-day check).

## Ideas for later
- Strategy signal panel (for example price versus 200-day average)
- Edit for tasks and shopping list
