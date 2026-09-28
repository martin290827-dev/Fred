# Fred

Personal dashboard PWA. Hosted on GitHub Pages (static only, public repo).

## Rules
- Plain HTML, CSS and JavaScript. No build step, no framework, unless I ask.
- The repo is PUBLIC. NEVER put API keys, places, dates, trips, names or any personal data in code, comments, tests or commit messages. Personal values are entered in the app (Settings) and live in the browser (localStorage).
- NEVER put API keys or personal data in the code or the repo. Keys live in the browser (localStorage) via Settings.
- All internet calls happen from the browser. Only use APIs that allow CORS.
- Keep the code simple and readable. Small functions, short comments.
- One feature per session. Do not refactor unrelated code.
- After changing app files, bump `CACHE` in `sw.js` AND the `?v=` number on style.css and app.js in index.html (GitHub Pages caches files for 10 minutes).

## Current features
Timer, multi time zone clock, weather (Open-Meteo), tickers (Binance for crypto with prefix `c:`, Finnhub for stocks), tasks and reminders (smart text input, only ring while open), shopping list, calculator (input field only, no keypad), day/night mode (button + device setting), countdowns, EUR/USD/MXN/GBP/CHF/PHP converter.

## Ideas for later
- Real calendar for "next up" (Google Calendar via OAuth)
- Push alerts when closed (Cloudflare Worker or GitHub Actions cron)
- Sparkline charts, strategy signal panel
