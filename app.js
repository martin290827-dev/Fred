'use strict';
/* Fred - personal dashboard. No build step, no server, no keys in this file.
   All settings live in this browser's localStorage. */

const $ = (id) => document.getElementById(id);

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
  }
  for (const kid of kids) n.append(kid);
  return n;
}

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('fred.' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('fred.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- Defaults ----------
   Nothing personal in the code: this repo is public. Enter place, tickers, time zones and
   countdowns in the app (Settings). They are stored only in your own browser. */
const DEFAULT_ZONES = [{ label: 'UTC', tz: 'UTC' }];

let place = store.get('place', null);
let tickers = store.get('tickers', []);
let zones = store.get('zones', DEFAULT_ZONES);
let finnhubKey = store.get('finnhubKey', '');
let twelveKey = store.get('twelveKey', '');
let place2 = store.get('place2', null);
let googleClientId = store.get('googleClientId', '');

/* ---------- Banners and notifications ---------- */
function banner(text, silent) {
  const b = el('div', { class: 'banner' }, el('span', null, text),
    el('button', { type: 'button', onclick: () => b.remove() }, 'Dismiss'));
  $('banners').append(b);
  if (!silent) notify(text);
}

function notify(text) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Fred', { body: text });
    }
  } catch { /* some mobile browsers only allow service-worker notifications */ }
}

function askNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch { /* ignore */ }
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.4;
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t); o.stop(t + 0.3);
    }
  } catch { /* ignore */ }
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + ' ' + new URL(url).hostname); // never put the URL (it can hold a key) in a message
  return res.json();
}

/* ---------- 2) Clocks (multi time zone) ---------- */
function fmtTime(tz, now) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
}
function fmtDate(tz, now) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(now);
}

let clockNodes = [];
function renderClocks() {
  const box = $('clocks');
  box.replaceChildren();
  clockNodes = [];
  for (const z of zones) {
    const t = el('span', { class: 't' });
    const d = el('span', { class: 'muted small' });
    box.append(el('div', { class: 'clock' },
      el('span', null, z.label, el('br'), d), t));
    clockNodes.push({ tz: z.tz, t, d });
  }
  tickClocks();
}
function tickClocks() {
  const now = new Date();
  const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if ($('today').textContent !== today) $('today').textContent = today;
  for (const c of clockNodes) {
    try {
      c.t.textContent = fmtTime(c.tz, now);
      c.d.textContent = fmtDate(c.tz, now);
    } catch { c.t.textContent = 'bad zone'; }
  }
}

/* ---------- 3) Weather (Open-Meteo, no key) ---------- */
const WMO = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail',
};

async function fetchWeather(p) {
  return getJSON('https://api.open-meteo.com/v1/forecast?latitude=' + p.lat + '&longitude=' + p.lon +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&hourly=temperature_2m,precipitation' +
    '&timezone=auto&forecast_days=2');
}

// Warnings for the next 12 hours: rain (or snow) and frost. Returns short texts, empty if all is calm.
function weatherWarnings(w) {
  const h = w.hourly;
  if (!h || !h.time || !w.current || !w.current.time) return [];
  const hourNow = w.current.time.slice(0, 13); // e.g. 2026-09-29T06 (place time, both from the same response)
  const from = h.time.findIndex((t) => t.slice(0, 13) >= hourNow);
  if (from < 0) return [];
  const idx = h.time.map((_, i) => i).slice(from, from + 12);
  const at = (i) => (h.time[i].slice(0, 13) === hourNow ? 'now' : 'from ' + h.time[i].slice(11, 16));
  const out = [];
  const wet = idx.filter((i) => h.precipitation[i] >= 0.2);
  if (wet.length) {
    const mm = wet.reduce((s, i) => s + h.precipitation[i], 0);
    const cold = h.temperature_2m[wet[0]] <= 1;
    out.push((cold ? 'Snow or sleet ' : 'Rain ') + at(wet[0]) + ', about ' + mm.toFixed(1) + ' mm in 12 h');
  }
  const icy = idx.filter((i) => h.temperature_2m[i] <= 0);
  if (icy.length) {
    const low = Math.min(...icy.map((i) => h.temperature_2m[i]));
    out.push('Frost ' + at(icy[0]) + ', down to ' + Math.round(low) + '\u00b0');
  }
  return out;
}

function renderWeatherMain(box, w) {
  const warn = weatherWarnings(w).map((t) => el('div', { class: 'wx-warn' }, '\u26a0 ' + t));
  box.replaceChildren(
    ...warn,
    el('div', { class: 'wx-now' },
      el('div', { class: 'big' }, Math.round(w.current.temperature_2m) + '°C'),
      el('div', null, WMO[w.current.weather_code] || 'Unknown',
        el('br'),
        el('span', { class: 'muted small' },
          'Feels ' + Math.round(w.current.apparent_temperature) + '°, wind ' + Math.round(w.current.wind_speed_10m) + ' km/h'))),
    ...['Today', 'Tomorrow'].map((label, i) =>
      el('div', { class: 'wx-day' },
        el('span', null, label + ': ' + (WMO[w.daily.weather_code[i]] || '?')),
        el('span', null,
          Math.round(w.daily.temperature_2m_min[i]) + '° / ' + Math.round(w.daily.temperature_2m_max[i]) + '°, rain ' +
          (w.daily.precipitation_probability_max[i] ?? '?') + '%'))));
}

// Second place as a quiet block below the main one. Click it to make it the main place.
function renderWeatherAlt(box, p, w) {
  const warn = weatherWarnings(w)[0];
  const desc = (WMO[w.current.weather_code] || '?') + ' · ' +
    Math.round(w.daily.temperature_2m_min[0]) + '° / ' + Math.round(w.daily.temperature_2m_max[0]) + '°' + (warn ? ' · \u26a0 ' + warn.split(',')[0] : '');
  box.replaceChildren(el('button', { type: 'button', class: 'wx-alt', title: p.name + ' – click to show as the main place', onclick: swapPlaces },
    el('span', { class: 'wx-alt-text' },
      el('span', { class: 'wx-alt-name' }, p.name.split(',')[0]),
      el('span', { class: 'wx-alt-desc' }, desc)),
    el('span', { class: 'wx-alt-temp' }, Math.round(w.current.temperature_2m) + '°C'),
    el('span', { class: 'wx-alt-swap', 'aria-hidden': 'true' }, '⇄')));
}

function swapPlaces() {
  const t = place;
  place = place2;
  place2 = t;
  store.set('place', place);
  store.set('place2', place2);
  loadWeather();
}

async function loadWeather() {
  const box = $('weather');
  const alt = $('weather2');
  alt.replaceChildren();
  if (!place) { $('weather-place').textContent = ''; box.textContent = 'Set your location in Settings.'; return; }
  $('weather-place').textContent = place.name;
  const [main, second] = await Promise.allSettled([fetchWeather(place), place2 ? fetchWeather(place2) : Promise.resolve(null)]);
  if (main.status === 'fulfilled') renderWeatherMain(box, main.value);
  else box.textContent = 'Weather not available. ' + main.reason.message;
  if (place2) {
    if (second.status === 'fulfilled') renderWeatherAlt(alt, place2, second.value);
    else alt.textContent = 'Second place not available.';
  }
}

async function geocode(name) {
  const r = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(name));
  if (!r.results || !r.results.length) throw new Error('Place not found');
  const p = r.results[0];
  return { name: [p.name, p.admin1, p.country_code].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude };
}

/* ---------- 4) Tickers (Binance public data for crypto, Finnhub for stocks) ---------- */
let lastQuotes = {};

async function fetchQuote(sym) {
  if (sym.startsWith('c:')) {
    const pair = sym.slice(2).toUpperCase() + 'USDT';
    const r = await getJSON('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=' + pair);
    return { price: parseFloat(r.lastPrice), pct: parseFloat(r.priceChangePercent), cur: 'USD' };
  }
  if (!finnhubKey) throw new Error('no Finnhub key');
  const r = await getJSON('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(sym) + '&token=' + encodeURIComponent(finnhubKey));
  if (!r || !r.c) throw new Error('unknown symbol');
  return { price: r.c, pct: r.dp, cur: 'USD' };
}

function fmtPrice(p) {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return p.toPrecision(3);
}

function tickerLabel(s) { return s.startsWith('c:') ? s.slice(2).toUpperCase() : s.toUpperCase(); }

async function loadQuotes() {
  const syms = [...new Set(tickers)];
  const results = await Promise.allSettled(syms.map(fetchQuote));
  const errors = {};
  syms.forEach((s, i) => {
    if (results[i].status === 'fulfilled') lastQuotes[s] = results[i].value;
    else errors[s] = results[i].reason.message;
  });

  const box = $('tickers');
  box.replaceChildren();
  if (!tickers.length) box.textContent = 'No tickers. Add some in Settings.';
  for (const s of tickers) {
    const q = lastQuotes[s];
    const slot = el('span', { class: 'sparkslot', 'data-sym': s });
    if (errors[s] && !q) {
      box.append(el('div', { class: 'tick' }, el('span', null, tickerLabel(s)), slot, el('span', { class: 'muted tprice' }, errors[s])));
      continue;
    }
    const cls = q.pct >= 0 ? 'up' : 'down';
    box.append(el('div', { class: 'tick' },
      el('span', null, tickerLabel(s)),
      slot,
      el('span', { class: 'tprice' }, '$' + fmtPrice(q.price) + '  ',
        el('span', { class: cls }, (q.pct >= 0 ? '+' : '') + (q.pct ?? 0).toFixed(2) + '%'))));
  }
  $('tickers-status').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB') + '. Stocks may be delayed.';
  paintSparks();
}

/* ---------- Sparklines: 30 daily closes, cached for 6 hours ---------- */
const SPARK_TTL = 6 * 3600 * 1000;
const SPARK_RETRY = 10 * 60 * 1000;
let sparkCache = store.get('spark', {});
const sparkFail = {}; // sym -> { msg, retryAt }
let sparkBusy = false;
let sparkAgain = false;

async function fetchSeries(sym) {
  if (sym.startsWith('c:')) {
    const pair = sym.slice(2).toUpperCase() + 'USDT';
    const r = await getJSON('https://data-api.binance.vision/api/v3/klines?symbol=' + pair + '&interval=1d&limit=30');
    return r.map((k) => parseFloat(k[4]));
  }
  if (twelveKey) {
    const r = await getJSON('https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(sym) +
      '&interval=1day&outputsize=30&apikey=' + encodeURIComponent(twelveKey));
    if (r.status === 'error' || !r.values) throw new Error(r.message || 'no data');
    return r.values.map((v) => parseFloat(v.close)).reverse();
  }
  // Finnhub stock candles are a paid feature on most accounts. Try once, remember a refusal.
  if (finnhubKey && !store.get('candleBlocked', false)) {
    const now = Math.floor(Date.now() / 1000);
    try {
      const r = await getJSON('https://finnhub.io/api/v1/stock/candle?symbol=' + encodeURIComponent(sym) +
        '&resolution=D&from=' + (now - 45 * 86400) + '&to=' + now + '&token=' + encodeURIComponent(finnhubKey));
      if (r.s === 'ok' && r.c && r.c.length > 1) return r.c.slice(-30);
    } catch (e) {
      if (/^(401|403)/.test(e.message)) store.set('candleBlocked', true);
    }
  }
  throw new Error('no chart source for stocks (add a Twelve Data key in Settings)');
}

// Calm line in the muted ink, one accent dot on the latest value. Colour is never the only carrier:
// the price and percent next to it say the same, and the title names first, last and range.
function sparkSVG(values, name) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 90;
  const H = 28;
  const P = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = (max - min) || 1;
  const pts = values.map((v, i) => [P + (i * (W - 2 * P)) / Math.max(values.length - 1, 1), H - P - ((v - min) / span) * (H - 2 * P)]);
  const first = values[0];
  const last = values[values.length - 1];
  const pct = ((last - first) / first) * 100;
  const text = name + ': ' + values.length + '-day trend, ' + fmtPrice(first) + ' to ' + fmtPrice(last) +
    ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%), range ' + fmtPrice(min) + ' to ' + fmtPrice(max);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', text);
  const title = document.createElementNS(NS, 'title');
  title.textContent = text;
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '));
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', pts[pts.length - 1][0].toFixed(1));
  dot.setAttribute('cy', pts[pts.length - 1][1].toFixed(1));
  dot.setAttribute('r', '3.5');
  svg.append(title, line, dot);
  return svg;
}

// Draw one slot: a chart, or a quiet dash whose tooltip says why there is no chart.
function paintSlot(slot, sym, series, why) {
  if (series && series.length > 1) slot.replaceChildren(sparkSVG(series, tickerLabel(sym)));
  else if (why) slot.replaceChildren(el('span', { class: 'muted', title: why }, '–'));
}

function slotsFor(sym) {
  return [...document.querySelectorAll('#tickers .sparkslot')].filter((s) => s.getAttribute('data-sym') === sym);
}

async function paintSparks() {
  if (sparkBusy) { sparkAgain = true; return; } // the slots were rebuilt meanwhile: run once more
  sparkBusy = true;
  try {
    const syms = [...new Set([...document.querySelectorAll('#tickers .sparkslot')].map((s) => s.getAttribute('data-sym')))];
    // 1) Instantly draw everything we already know (cache, or the reason it is missing).
    for (const sym of syms) {
      const c = sparkCache[sym];
      const why = sparkFail[sym] && sparkFail[sym].msg;
      slotsFor(sym).forEach((s) => paintSlot(s, sym, c && c.v, why));
    }
    // 2) Download what is missing or old. Stocks: max 5 per pass (Twelve Data free plan: 8 per minute).
    let stockBudget = 5;
    let rateLimited = false;
    for (const sym of syms) {
      const c = sparkCache[sym];
      const f = sparkFail[sym];
      if (c && Date.now() - c.t < SPARK_TTL) continue;
      if (f && Date.now() < f.retryAt) continue;
      if (!sym.startsWith('c:')) { if (stockBudget <= 0) { rateLimited = true; continue; } stockBudget--; }
      try {
        const v = await fetchSeries(sym);
        sparkCache[sym] = { t: Date.now(), v };
        delete sparkFail[sym];
        store.set('spark', sparkCache);
        slotsFor(sym).forEach((s) => paintSlot(s, sym, v, ''));
      } catch (e) {
        const limit = /limit|credits|429|too many/i.test(e.message);
        if (limit) rateLimited = true;
        sparkFail[sym] = { msg: e.message, retryAt: Date.now() + (limit ? 65 * 1000 : SPARK_RETRY) };
        slotsFor(sym).forEach((s) => paintSlot(s, sym, c && c.v, e.message));
      }
    }
    if (rateLimited) setTimeout(paintSparks, 66 * 1000); // try the rest after the per-minute limit resets
  } finally {
    sparkBusy = false;
    if (sparkAgain) { sparkAgain = false; paintSparks(); }
  }
}

/* ---------- 1) Timer (stores the end time, so it stays correct in background tabs) ---------- */
let timerEnd = store.get('timerEnd', null);
if (timerEnd && timerEnd <= Date.now()) { timerEnd = null; store.set('timerEnd', null); }

function fmtDuration(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return (h ? h + ':' : '') + pad(m) + ':' + pad(sec);
}

function tickTimer() {
  const disp = $('timer-display');
  if (!timerEnd) { $('timer-start').textContent = 'Start'; return; }
  const left = timerEnd - Date.now();
  if (left <= 0) {
    timerEnd = null;
    store.set('timerEnd', null);
    disp.textContent = '00:00';
    $('timer-start').textContent = 'Start';
    beep();
    banner('Timer finished');
    return;
  }
  disp.textContent = fmtDuration(left);
  $('timer-start').textContent = 'Running';
}

function startTimer() {
  const min = parseFloat($('timer-min').value);
  if (!(min > 0)) return;
  timerEnd = Date.now() + min * 60000;
  store.set('timerEnd', timerEnd);
  askNotificationPermission();
  tickTimer();
}

function resetTimer() {
  timerEnd = null;
  store.set('timerEnd', null);
  $('timer-display').textContent = '00:00';
  $('timer-start').textContent = 'Start';
}

/* ---------- Stopwatch (keeps running across reloads: stores start time and the time before it) ---------- */
let sw = store.get('sw', { acc: 0, start: null });

function swElapsed() { return sw.acc + (sw.start ? Date.now() - sw.start : 0); }

function fmtStopwatch(ms) {
  const t = Math.floor(ms / 100); // tenths
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(t / 36000);
  return (h ? h + ':' : '') + pad(Math.floor((t % 36000) / 600)) + ':' + pad(Math.floor((t % 600) / 10)) + '.' + (t % 10);
}

function tickStopwatch() {
  $('sw-display').textContent = fmtStopwatch(swElapsed());
  $('sw-start').textContent = sw.start ? 'Stop' : (sw.acc ? 'Resume' : 'Start');
}

function toggleStopwatch() {
  if (sw.start) { sw = { acc: swElapsed(), start: null }; } else { sw = { acc: sw.acc, start: Date.now() }; }
  store.set('sw', sw);
  tickStopwatch();
}

function resetStopwatch() {
  sw = { acc: 0, start: null };
  store.set('sw', sw);
  tickStopwatch();
}

/* ---------- Events (date only, from Google Calendar) ---------- */
function fmtRemaining(ms) {
  if (ms <= 0) return 'passed';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d >= 1) return d + 'd ' + h + 'h';
  return h + 'h ' + m + 'm';
}

function toDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function dayDiff(dateStr) { return Math.round((new Date(dateStr + 'T00:00') - startOfDay(new Date())) / 86400000); }
// Text for the right side of an event row: counts to the start, then the days left until the end.
function fmtEventWhen(e) {
  if (!e.to) return fmtDaysLeft(e.at);
  const s = dayDiff(e.at);
  const t = dayDiff(e.to);
  if (t < 0) return 'passed';
  if (s > 1) return 'in ' + s + ' days';
  if (s === 1) return 'tomorrow';
  if (s === 0) return 'starts today';
  return t === 0 ? 'last day' : 'ongoing, ' + t + 'd left';
}

function fmtEventDates(e) {
  const f = (d, withYear) => new Date(d + 'T00:00').toLocaleDateString('en-GB',
    withYear ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
  if (!e.to || e.google) return f(e.at, true); // Google items: start date only
  return f(e.at, e.at.slice(0, 4) !== e.to.slice(0, 4)) + ' \u2013 ' + f(e.to, true);
}

function fmtDaysLeft(dateStr) {
  const d = dayDiff(dateStr);
  return d < 0 ? 'passed' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days';
}

// Events come from Google Calendar only (all-day and multi-day items). Nothing is typed in here.
function eventList() {
  return typeof gGoogleEvents === 'function' ? gGoogleEvents() : [];
}

// Highlight an event that is today or already running.
function isEventNow(e) { return dayDiff(e.at) <= 0 && dayDiff(e.to || e.at) >= 0; }

function renderEvents() {
  const ul = $('events');
  ul.replaceChildren();
  const sorted = eventList().filter((e) => dayDiff(e.to || e.at) >= -30).sort((a, b) => a.at.localeCompare(b.at));
  if (!sorted.length) {
    const on = typeof gHasToken === 'function' && gHasToken();
    ul.append(el('li', { class: 'muted' }, on ? 'No events.' : 'Connect Google Calendar to see your events.'));
  }
  for (const e of sorted) {
    ul.append(el('li', { class: isEventNow(e) ? 'now' : '' },
      el('span', { class: 'grow' }, e.label, el('br'), el('span', { class: 'muted small' }, fmtEventDates(e))),
      el('span', { 'data-id': e.id })));
  }
  tickEvents();
}

function tickEvents() {
  document.querySelectorAll('#events [data-id]').forEach((n) => {
    const e = eventList().find((x) => x.id === n.getAttribute('data-id'));
    n.textContent = e ? fmtEventWhen(e) : '';
    if (n.parentElement) n.parentElement.classList.toggle('now', !!e && isEventNow(e)); // also right after midnight
  });
}

/* ---------- 9) Currency converter (Frankfurter, ECB rates, no key) ---------- */
const CURRENCIES = ['EUR', 'USD', 'MXN', 'GBP', 'CHF', 'PHP'];
let fx = store.get('fx', null); // { date, rates }

async function loadFx() {
  try {
    const r = await getJSON('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=' + CURRENCIES.filter((c) => c !== 'EUR').join(','));
    fx = { date: r.date, rates: { EUR: 1, ...r.rates } };
    store.set('fx', fx);
    $('fx-status').textContent = '';
  } catch {
    $('fx-status').textContent = fx ? 'Offline, showing saved rates.' : 'Rates not available.';
  }
  convert();
}

function convert() {
  if (!fx) { $('fx-result').textContent = '-'; return; }
  const amt = parseFloat($('fx-amount').value);
  const from = $('fx-from').value;
  const to = $('fx-to').value;
  $('fx-date').textContent = 'ECB ' + fx.date;
  if (!(amt >= 0) || !fx.rates[from] || !fx.rates[to]) { $('fx-result').textContent = '-'; return; }
  const out = (amt / fx.rates[from]) * fx.rates[to];
  $('fx-result').textContent = out.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + to;
}

function initFx() {
  for (const id of ['fx-from', 'fx-to']) {
    for (const c of CURRENCIES) $(id).append(el('option', { value: c }, c));
  }
  $('fx-from').value = 'EUR';
  $('fx-to').value = 'MXN';
  ['fx-amount', 'fx-from', 'fx-to'].forEach((id) => $(id).addEventListener('input', convert));
  $('fx-swap').addEventListener('click', () => {
    const a = $('fx-from').value; $('fx-from').value = $('fx-to').value; $('fx-to').value = a; convert();
  });
}

/* ---------- Date helpers ---------- */
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function toLocalISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function fmtDue(t) {
  const d = new Date(t.due);
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  const day = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff === -1 ? 'yesterday'
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return t.allDay ? day : day + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/* ---------- 8) Shopping list (manual) ---------- */
let shop = store.get('shop', []);

let editingShopId = null;

function renderShop() {
  const ul = $('shop');
  ul.replaceChildren();
  if (!shop.length) ul.append(el('li', { class: 'muted' }, 'List is empty.'));
  for (const it of shop) {
    if (editingShopId === it.id) { ul.append(shopEditRow(it)); continue; }
    const box = el('input', { type: 'checkbox', 'aria-label': 'Got it' });
    box.checked = it.done;
    box.addEventListener('change', () => { it.done = box.checked; store.set('shop', shop); renderShop(); });
    ul.append(el('li', { class: it.done ? 'done' : '' },
      box, el('span', { class: 'grow t' }, it.text),
      el('button', { type: 'button', class: 'ghost small', onclick: () => { editingShopId = it.id; renderShop(); } }, 'Edit'),
      el('button', { type: 'button', class: 'ghost small', onclick: () => {
        shop = shop.filter((x) => x.id !== it.id); store.set('shop', shop); renderShop();
      } }, 'Delete')));
  }
}

// One item as a text field: Enter or Save keeps the change, Escape or Cancel drops it.
function shopEditRow(it) {
  const input = el('input', { type: 'text', maxlength: '60', 'aria-label': 'Item' });
  input.value = it.text;
  const save = () => {
    const v = input.value.trim();
    if (v) it.text = v;
    editingShopId = null;
    store.set('shop', shop);
    renderShop();
  };
  const cancel = () => { editingShopId = null; renderShop(); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') cancel();
  });
  requestAnimationFrame(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
  return el('li', null, el('span', { class: 'grow' }, input),
    el('button', { type: 'button', class: 'small', onclick: save }, 'Save'),
    el('button', { type: 'button', class: 'ghost small', onclick: cancel }, 'Cancel'));
}

/* ---------- 10) Calculator (own parser, no eval) ---------- */
function calcEval(src) {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.').replace(/\s+/g, '');
  let i = 0;
  let pctFlag = false; // true when the last operand ended with %

  function number() {
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    const n = parseFloat(s.slice(start, i));
    if (start === i || Number.isNaN(n)) throw new Error('syntax');
    return n;
  }
  function factor() {
    if (s[i] === '-') { i++; return -factor(); }
    if (s[i] === '+') { i++; return factor(); }
    let v;
    if (s[i] === '(') {
      i++;
      v = expr();
      if (s[i] !== ')') throw new Error('syntax');
      i++;
    } else {
      v = number();
    }
    let pct = false;
    while (s[i] === '%') { i++; v /= 100; pct = true; }
    pctFlag = pct;
    return v;
  }
  function term() {
    let v = factor();
    let single = true;
    while (s[i] === '*' || s[i] === '/') {
      const op = s[i++];
      const r = factor();
      v = op === '*' ? v * r : v / r;
      single = false;
    }
    pctFlag = pctFlag && single;
    return v;
  }
  function expr() {
    let v = term();
    while (s[i] === '+' || s[i] === '-') {
      const op = s[i++];
      let r = term();
      if (pctFlag) r = v * r; // 200+10% = 220
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  const v = expr();
  if (i !== s.length || !Number.isFinite(v)) throw new Error('syntax');
  return v;
}

function fmtCalc(v) {
  return parseFloat(v.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 10 });
}

function calcUpdate() {
  const src = $('calc-expr').value;
  const out = $('calc-result');
  if (!src.trim()) { out.textContent = '0'; return; }
  try { out.textContent = fmtCalc(calcEval(src)); } catch { out.textContent = '...'; }
}

function calcEnter() {
  const inp = $('calc-expr');
  try { inp.value = String(parseFloat(calcEval(inp.value).toPrecision(12))); } catch { $('calc-result').textContent = 'Error'; return; }
  calcUpdate();
}

function calcReset() {
  $('calc-expr').value = '';
  calcUpdate();
  $('calc-expr').focus();
}

function initCalc() {
  $('calc-expr').addEventListener('input', calcUpdate);
  $('calc-expr').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); calcEnter(); }
    if (e.key === 'Escape') calcReset();
  });
  $('calc-reset').addEventListener('click', calcReset);
}

/* ---------- Settings ---------- */
let pendingPlace = null;
let pendingPlace2 = null;

function openSettings() {
  pendingPlace = null;
  pendingPlace2 = null;
  $('set-place').value = place ? place.name : '';
  $('set-place-status').textContent = '';
  $('set-place2').value = place2 ? place2.name : '';
  $('set-place2-status').textContent = '';
  $('set-tickers').value = tickers.join(', ');
  $('set-key').value = finnhubKey;
  $('set-twelve').value = twelveKey;
  $('set-zones').value = zones.map((z) => z.label + '=' + z.tz).join('\n');
  $('set-gclient').value = googleClientId;
  $('g-status').textContent = gHasToken() ? 'Connected.' : '';
  $('bk-status').textContent = '';
  $('dlg-settings').showModal();
}

function saveSettings() {
  if (pendingPlace) { place = pendingPlace; store.set('place', place); }
  if (pendingPlace2) place2 = pendingPlace2;
  else if (!$('set-place2').value.trim()) place2 = null;
  store.set('place2', place2);

  tickers = $('set-tickers').value.split(',').map((s) => s.trim()).filter(Boolean);
  store.set('tickers', tickers);

  finnhubKey = $('set-key').value.trim();
  store.set('finnhubKey', finnhubKey);
  twelveKey = $('set-twelve').value.trim();
  store.set('twelveKey', twelveKey);
  sparkCache = {}; // new key or symbols: draw the charts again
  store.set('spark', sparkCache);

  const parsed = [];
  for (const line of $('set-zones').value.split('\n')) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const label = line.slice(0, i).trim();
    const tz = line.slice(i + 1).trim();
    try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); parsed.push({ label, tz }); } catch { /* skip invalid zone */ }
  }
  if (parsed.length) { zones = parsed; store.set('zones', zones); }

  setGoogleSettings($('set-gclient').value.trim());

  renderClocks();
  loadWeather();
  loadQuotes();
}

/* ---------- Backup: download and upload the settings as a file ---------- */
const BACKUP_KEYS = ['place', 'place2', 'tickers', 'zones', 'shop', 'theme', 'layout', 'finnhubKey', 'twelveKey', 'googleClientId'];
const SECRET_KEYS = ['finnhubKey', 'twelveKey', 'googleClientId'];
const ARRAY_KEYS = ['tickers', 'zones', 'shop'];

function exportSettings() {
  const withKeys = $('bk-keys').checked;
  const data = {};
  for (const k of BACKUP_KEYS) {
    if (!withKeys && SECRET_KEYS.includes(k)) continue;
    const v = store.get(k, undefined);
    if (v !== undefined) data[k] = v;
  }
  const blob = new Blob([JSON.stringify({ app: 'fred', version: 1, exported: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'fred-settings-' + toDateStr(new Date()) + '.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  $('bk-status').textContent = 'Saved ' + Object.keys(data).length + ' items to your Downloads folder.';
}

async function importSettings(file) {
  const st = $('bk-status');
  try {
    const j = JSON.parse(await file.text());
    if (!j || j.app !== 'fred' || typeof j.data !== 'object' || j.data === null) throw new Error('This is not a Fred settings file.');
    let n = 0;
    for (const k of BACKUP_KEYS) {
      if (!(k in j.data)) continue;
      if (ARRAY_KEYS.includes(k) && !Array.isArray(j.data[k])) continue;
      store.set(k, j.data[k]);
      n++;
    }
    st.textContent = 'Imported ' + n + ' items. Reloading...';
    setTimeout(() => location.reload(), 700);
  } catch (e) {
    st.textContent = 'Import failed: ' + e.message;
  }
}

/* ---------- Day / night mode ---------- */
// Saved choice wins; without a choice the device setting decides.
function effectiveTheme() {
  const saved = store.get('theme', null);
  if (saved) return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme() {
  const saved = store.get('theme', null);
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  else document.documentElement.removeAttribute('data-theme');
  const now = effectiveTheme();
  $('btn-theme').textContent = now === 'dark' ? 'Day' : 'Night'; // the mode you switch to
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', now === 'dark' ? '#0f1720' : '#f3f6f9');
}

function toggleTheme() {
  store.set('theme', effectiveTheme() === 'dark' ? 'light' : 'dark');
  applyTheme();
}

/* ---------- Layout: order and hide cards ---------- */
let layout = store.get('layout', { order: [], hidden: [] });

function cardEls() { return [...document.querySelectorAll('main.grid > .card')]; }
function cardTitle(c) { const h = c.querySelector('h2'); return h ? h.firstChild.textContent.trim() : c.id; }

function currentOrder() {
  const ids = cardEls().map((c) => c.id);
  const known = layout.order.filter((id) => ids.includes(id));
  return known.concat(ids.filter((id) => !known.includes(id)));
}

function applyLayout() {
  const order = currentOrder();
  layout.order = order;
  order.forEach((id, i) => {
    const c = $(id);
    c.style.order = i;
    c.hidden = layout.hidden.includes(id);
  });
  renderLayoutBar();
}

function saveLayout() { store.set('layout', layout); applyLayout(); }

function moveCard(id, dir) {
  const order = currentOrder();
  const visible = order.filter((x) => !layout.hidden.includes(x));
  const i = visible.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= visible.length) return;
  const a = order.indexOf(id);
  const b = order.indexOf(visible[j]);
  [order[a], order[b]] = [order[b], order[a]];
  layout.order = order;
  saveLayout();
}

function hideCard(id) { if (!layout.hidden.includes(id)) layout.hidden.push(id); saveLayout(); }
function showCard(id) { layout.hidden = layout.hidden.filter((x) => x !== id); saveLayout(); }

function renderLayoutBar() {
  const hiddenIds = layout.hidden.filter((id) => $(id));
  $('layoutbar').replaceChildren(
    el('span', { class: 'muted small' }, 'Layout: move cards with the arrows, remove them with Hide.'),
    ...(hiddenIds.length
      ? [el('span', { class: 'muted small' }, 'Hidden:'),
        ...hiddenIds.map((id) => el('button', { type: 'button', class: 'chip', onclick: () => showCard(id) }, '+ ' + cardTitle($(id))))]
      : []),
    el('button', { type: 'button', class: 'ghost small', onclick: () => { layout = { order: [], hidden: [] }; saveLayout(); } }, 'Reset'),
    el('button', { type: 'button', class: 'small', onclick: toggleLayoutMode }, 'Done'));
}

function toggleLayoutMode() {
  const on = document.body.classList.toggle('editing');
  $('layoutbar').hidden = !on;
  $('btn-layout').textContent = on ? 'Done' : 'Layout';
}

function initLayout() {
  for (const c of cardEls()) {
    c.prepend(el('div', { class: 'cardtools' },
      el('button', { type: 'button', class: 'ghost small', 'aria-label': 'Move earlier', onclick: () => moveCard(c.id, -1) }, '‹ Earlier'),
      el('button', { type: 'button', class: 'ghost small', 'aria-label': 'Move later', onclick: () => moveCard(c.id, 1) }, 'Later ›'),
      el('button', { type: 'button', class: 'ghost small', onclick: () => hideCard(c.id) }, 'Hide')));
  }
  applyLayout();
}

/* ---------- Wiring ---------- */
// Every card: title stays, the rest sits in a scrolling body.
function initCards() {
  for (const card of document.querySelectorAll('main.grid > .card')) {
    const h2 = card.querySelector('h2');
    const body = el('div', { class: 'cardbody' });
    while (h2.nextSibling) body.append(h2.nextSibling);
    card.append(body);
  }
}

function init() {
  initCards();
  renderClocks();
  renderEvents();
  initFx();
  initCalc();
  renderShop();
  initLayout();
  gcalInit();
  tickTimer();

  $('timer-start').addEventListener('click', startTimer);
  $('timer-reset').addEventListener('click', resetTimer);
  $('sw-start').addEventListener('click', toggleStopwatch);
  $('sw-reset').addEventListener('click', resetStopwatch);
  tickStopwatch();
  document.querySelectorAll('.presets button').forEach((b) =>
    b.addEventListener('click', () => { $('timer-min').value = b.dataset.min; }));


  $('shop-form').addEventListener('submit', (e) => {
    e.preventDefault();
    shop.push({ id: uid(), text: $('shop-text').value.trim(), done: false });
    store.set('shop', shop);
    e.target.reset();
    renderShop();
  });
  $('shop-clear').addEventListener('click', () => { shop = shop.filter((x) => !x.done); store.set('shop', shop); renderShop(); });

  $('btn-theme').addEventListener('click', toggleTheme);
  applyTheme();
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  $('btn-refresh').addEventListener('click', loadQuotes);
  $('btn-layout').addEventListener('click', toggleLayoutMode);
  $('btn-settings').addEventListener('click', openSettings);
  $('set-cancel').addEventListener('click', () => $('dlg-settings').close());
  $('set-place-btn').addEventListener('click', async () => {
    const status = $('set-place-status');
    status.textContent = 'Searching...';
    try {
      pendingPlace = await geocode($('set-place').value.trim());
      status.textContent = 'Found: ' + pendingPlace.name;
    } catch (e) {
      pendingPlace = null;
      status.textContent = e.message;
    }
  });
  $('set-place2-btn').addEventListener('click', async () => {
    const status = $('set-place2-status');
    status.textContent = 'Searching...';
    try {
      pendingPlace2 = await geocode($('set-place2').value.trim());
      status.textContent = 'Found: ' + pendingPlace2.name;
    } catch (e) {
      pendingPlace2 = null;
      status.textContent = e.message;
    }
  });
  $('bk-export').addEventListener('click', exportSettings);
  $('bk-import').addEventListener('click', () => $('bk-file').click());
  $('bk-file').addEventListener('change', (e) => { if (e.target.files[0]) importSettings(e.target.files[0]); });
  $('dlg-settings').addEventListener('close', () => {
    if ($('dlg-settings').returnValue === 'ok') saveSettings();
    $('dlg-settings').returnValue = '';
  });

  setInterval(() => { tickClocks(); tickTimer(); }, 250);
  setInterval(() => { if (sw.start) tickStopwatch(); }, 100);
  setInterval(tickEvents, 30000);
  setInterval(loadQuotes, 60000);
  setInterval(loadWeather, 15 * 60000);
  setInterval(loadFx, 60 * 60000);

  loadWeather();
  loadQuotes();
  loadFx();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init); // after gcal.js has been loaded as well
