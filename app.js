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
let events = store.get('events', []);
let finnhubKey = store.get('finnhubKey', '');

/* ---------- Banners and notifications ---------- */
function banner(text) {
  const b = el('div', { class: 'banner' }, el('span', null, text),
    el('button', { type: 'button', onclick: () => b.remove() }, 'Dismiss'));
  $('banners').append(b);
  notify(text);
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
  if (!res.ok) throw new Error(res.status + ' ' + url);
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

async function loadWeather() {
  const box = $('weather');
  if (!place) { $('weather-place').textContent = ''; box.textContent = 'Set your location in Settings.'; return; }
  $('weather-place').textContent = place.name;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + place.lat + '&longitude=' + place.lon +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=auto&forecast_days=2';
    const w = await getJSON(url);
    box.replaceChildren(
      el('div', { class: 'wx-now' },
        el('div', { class: 'big' }, Math.round(w.current.temperature_2m) + '\u00b0C'),
        el('div', null, WMO[w.current.weather_code] || 'Unknown',
          el('br'),
          el('span', { class: 'muted small' },
            'Feels ' + Math.round(w.current.apparent_temperature) + '\u00b0, wind ' + Math.round(w.current.wind_speed_10m) + ' km/h'))),
      ...['Today', 'Tomorrow'].map((label, i) =>
        el('div', { class: 'wx-day' },
          el('span', null, label + ': ' + (WMO[w.daily.weather_code[i]] || '?')),
          el('span', null,
            Math.round(w.daily.temperature_2m_min[i]) + '\u00b0 / ' + Math.round(w.daily.temperature_2m_max[i]) + '\u00b0, rain ' +
            (w.daily.precipitation_probability_max[i] ?? '?') + '%'))));
  } catch (e) {
    box.textContent = 'Weather not available. ' + e.message;
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
    const label = s.startsWith('c:') ? s.slice(2).toUpperCase() : s.toUpperCase();
    if (errors[s] && !q) {
      box.append(el('div', { class: 'tick' }, el('span', null, label), el('span', { class: 'muted' }, errors[s])));
      continue;
    }
    const cls = q.pct >= 0 ? 'up' : 'down';
    box.append(el('div', { class: 'tick' },
      el('span', null, label),
      el('span', null, '$' + fmtPrice(q.price) + '  ',
        el('span', { class: cls }, (q.pct >= 0 ? '+' : '') + (q.pct ?? 0).toFixed(2) + '%'))));
  }
  $('tickers-status').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB') + '. Stocks may be delayed.';
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

/* ---------- 8) Countdowns and "next up" ---------- */
function fmtRemaining(ms) {
  if (ms <= 0) return 'passed';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d >= 1) return d + 'd ' + h + 'h';
  return h + 'h ' + m + 'm';
}

function renderEvents() {
  const ul = $('events');
  ul.replaceChildren();
  const sorted = [...events].sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!sorted.length) ul.append(el('li', { class: 'muted' }, 'No countdowns.'));
  for (const e of sorted) {
    const span = el('span', { 'data-at': e.at });
    ul.append(el('li', null,
      el('span', { class: 'grow' }, e.label, el('br'),
        el('span', { class: 'muted small' }, new Date(e.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))),
      span,
      el('button', { type: 'button', class: 'ghost small', onclick: () => {
        events = events.filter((x) => x.id !== e.id); store.set('events', events); renderEvents();
      } }, 'Delete')));
  }
  tickEvents();
}

function tickEvents() {
  const now = Date.now();
  document.querySelectorAll('#events [data-at]').forEach((n) => {
    n.textContent = fmtRemaining(new Date(n.getAttribute('data-at')) - now);
  });
  // "Next up": nearest future countdown. A real calendar needs Google OAuth (later step).
  const next = events
    .map((e) => ({ ...e, ms: new Date(e.at) - now }))
    .filter((e) => e.ms > 0)
    .sort((a, b) => a.ms - b.ms)[0];
  $('nextup').textContent = next ? 'Next: ' + next.label + ' in ' + fmtRemaining(next.ms) : 'No upcoming events';
}

/* ---------- 9) Currency converter (Frankfurter, ECB rates, no key) ---------- */
const CURRENCIES = ['EUR', 'USD', 'MXN', 'GBP', 'CHF'];
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

/* ---------- 7+9) Tasks and reminders (one list; a due time makes it a reminder) ---------- */
let tasks = store.get('tasks', []);

const WEEKDAYS = {
  sunday: 0, sonntag: 0, monday: 1, montag: 1, tuesday: 2, dienstag: 2, wednesday: 3, mittwoch: 3,
  thursday: 4, donnerstag: 4, friday: 5, freitag: 5, saturday: 6, samstag: 6,
};

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function toLocalISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// Turns "remind me to pay rent tomorrow urgent" into { text: 'pay rent', urgent: true, due: <tomorrow 09:00>, allDay: true }.
// Understands English and German: today/heute, tomorrow/morgen, day after tomorrow/uebermorgen, weekdays,
// "in 2 hours / in 2 Stunden", "at 17:30 / um 17:30 / at 5pm", urgent/dringend/asap.
function parseTask(raw, now = new Date()) {
  // \b does not work next to umlauts, so write them as ue/ae first
  let text = ' ' + raw.trim().replace(/\u00fcbermorgen/gi, 'uebermorgen').replace(/f\u00fcr/gi, 'fuer').replace(/n\u00e4chsten/gi, 'naechsten') + ' ';
  let urgent = false;
  let date = null;
  let hasTime = false;

  text = text.replace(/^\s*(remind me( to)?|erinnere mich( daran)?,?( zu)?|erinner mich( daran)?,?( zu)?)\s+/i, ' ');

  if (/\b(urgent|asap|dringend|wichtig)\b|!\s*$/i.test(text)) {
    urgent = true;
    text = text.replace(/\b(urgent|asap|dringend|wichtig)\b/gi, ' ').replace(/!+\s*$/, ' ');
  }

  const rel = text.match(/\b(?:in|en)\s+(\d+)\s*(minutes?|mins?|minuten|hours?|hrs?|h|stunden|stunde|std|days?|tagen|tage|tag)\b/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const u = rel[2][0].toLowerCase();
    text = text.replace(rel[0], ' ');
    if (u === 'm') { date = new Date(now.getTime() + n * 60000); hasTime = true; }
    else if (u === 'h' || u === 's') { date = new Date(now.getTime() + n * 3600000); hasTime = true; }
    else { date = addDays(startOfDay(now), n); }
  }

  if (!date) {
    const dm = text.match(/(?:\b(?:on|by|due|am|bis|until|for|für)\s+)?\b(day after tomorrow|übermorgen|uebermorgen|tomorrow|morgen|today|tonight|heute)\b/i);
    if (dm) {
      const w = dm[1].toLowerCase();
      const off = /after|bermorgen/.test(w) ? 2 : (w === 'tomorrow' || w === 'morgen') ? 1 : 0;
      date = addDays(startOfDay(now), off);
      text = text.replace(dm[0], ' ');
    } else {
      const wm = text.match(/(?:\b(?:on|by|due|next|am|bis|until|nächsten|naechsten)\s+)?\b(sunday|sonntag|monday|montag|tuesday|dienstag|wednesday|mittwoch|thursday|donnerstag|friday|freitag|saturday|samstag)\b/i);
      if (wm) {
        let diff = (WEEKDAYS[wm[1].toLowerCase()] - now.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        date = addDays(startOfDay(now), diff);
        text = text.replace(wm[0], ' ');
      }
    }
  }

  if (!hasTime) {
    let hh = null;
    let mm = 0;
    let ap = '';
    const t1 = text.match(/(?:\b(?:at|um)\s+)?\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
    const t2 = t1 ? null : text.match(/\b(?:at|um)\s+(\d{1,2})\s*(am|pm|uhr)?\b/i);
    if (t1) { hh = +t1[1]; mm = +t1[2]; ap = t1[3] || ''; }
    else if (t2) { hh = +t2[1]; ap = t2[2] || ''; }
    if (hh !== null) {
      if (/pm/i.test(ap) && hh < 12) hh += 12;
      if (/am/i.test(ap) && hh === 12) hh = 0;
      if (hh <= 23 && mm <= 59) {
        text = text.replace((t1 || t2)[0], ' ');
        const dayGiven = !!date;
        date = date ? new Date(date) : startOfDay(now);
        date.setHours(hh, mm, 0, 0);
        hasTime = true;
        if (!dayGiven && date <= now) date = addDays(date, 1);
      }
    }
  }

  if (date && !hasTime) date.setHours(9, 0, 0, 0); // date only: remind at 09:00

  text = text.replace(/\s{2,}/g, ' ').replace(/^[\s,.\-:]+|[\s,.\-:]+$/g, '').trim();
  if (!text) text = raw.trim();
  return { text, urgent, due: date, allDay: !!date && !hasTime };
}

function fmtDue(t) {
  const d = new Date(t.due);
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  const day = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff === -1 ? 'yesterday'
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return t.allDay ? day : day + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function isOverdue(t) {
  if (t.done || !t.due) return false;
  const d = new Date(t.due);
  return (t.allDay ? addDays(startOfDay(d), 1) : d) <= new Date();
}

function saveTasks() { store.set('tasks', tasks); }

function renderTasks() {
  const ul = $('tasks');
  ul.replaceChildren();
  const sorted = [...tasks].sort((a, b) =>
    (a.done - b.done) || (b.urgent - a.urgent) ||
    ((a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity)));
  if (!sorted.length) ul.append(el('li', { class: 'muted' }, 'No tasks.'));
  for (const t of sorted) {
    const box = el('input', { type: 'checkbox', 'aria-label': 'Done' });
    box.checked = t.done;
    box.addEventListener('change', () => { t.done = box.checked; saveTasks(); renderTasks(); });
    const meta = t.due
      ? el('span', { class: 'small ' + (isOverdue(t) ? 'down' : 'muted') }, (isOverdue(t) ? 'overdue: ' : '') + fmtDue(t))
      : '';
    ul.append(el('li', { class: t.done ? 'done' : '' },
      box,
      el('span', { class: 'grow' },
        t.urgent ? el('span', { class: 'badge' }, 'URGENT') : '',
        el('span', { class: 't' }, t.text), el('br'), meta),
      el('button', { type: 'button', class: 'ghost small', onclick: () => {
        tasks = tasks.filter((x) => x.id !== t.id); saveTasks(); renderTasks();
      } }, 'Delete')));
  }
}

function checkReminders() {
  const now = new Date();
  let changed = false;
  for (const t of tasks) {
    if (t.done || t.notified || !t.due || new Date(t.due) > now) continue;
    t.notified = true;
    changed = true;
    banner((t.urgent ? 'URGENT: ' : 'Reminder: ') + t.text);
  }
  if (changed) saveTasks();
  renderTasks();
}

function addTask(e) {
  e.preventDefault();
  const p = parseTask($('task-text').value);
  let due = p.due;
  let allDay = p.allDay;
  const manual = $('task-due').value;
  if (manual) { due = new Date(manual); allDay = false; }
  const t = {
    id: uid(), text: p.text, urgent: p.urgent || $('task-urgent').checked, done: false,
    due: due ? toLocalISO(due) : null, allDay, notified: false,
  };
  if (t.due && new Date(t.due) <= new Date()) t.notified = true; // already past when created: no instant alarm
  tasks.push(t);
  saveTasks();
  e.target.reset();
  askNotificationPermission();
  renderTasks();
}

/* ---------- 8) Shopping list (manual) ---------- */
let shop = store.get('shop', []);

function renderShop() {
  const ul = $('shop');
  ul.replaceChildren();
  if (!shop.length) ul.append(el('li', { class: 'muted' }, 'List is empty.'));
  for (const it of shop) {
    const box = el('input', { type: 'checkbox', 'aria-label': 'Got it' });
    box.checked = it.done;
    box.addEventListener('change', () => { it.done = box.checked; store.set('shop', shop); renderShop(); });
    ul.append(el('li', { class: it.done ? 'done' : '' },
      box, el('span', { class: 'grow t' }, it.text),
      el('button', { type: 'button', class: 'ghost small', onclick: () => {
        shop = shop.filter((x) => x.id !== it.id); store.set('shop', shop); renderShop();
      } }, 'Delete')));
  }
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

function calcPress(k) {
  const inp = $('calc-expr');
  if (k === 'C') inp.value = '';
  else if (k === '⌫') inp.value = inp.value.slice(0, -1);
  else if (k === '=') {
    try { inp.value = String(parseFloat(calcEval(inp.value).toPrecision(12))); } catch { $('calc-result').textContent = 'Error'; return; }
  } else inp.value += k;
  calcUpdate();
}

function initCalc() {
  const keys = ['C', '⌫', '(', ')', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '%', '+'];
  for (const k of keys) $('calc-keys').append(el('button', { type: 'button', class: 'ghost', onclick: () => calcPress(k) }, k));
  $('calc-keys').append(el('button', { type: 'button', class: 'eq', onclick: () => calcPress('=') }, '='));
  $('calc-expr').addEventListener('input', calcUpdate);
  $('calc-expr').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); calcPress('='); } });
}

/* ---------- Settings ---------- */
let pendingPlace = null;

function openSettings() {
  pendingPlace = null;
  $('set-place').value = place ? place.name : '';
  $('set-place-status').textContent = '';
  $('set-tickers').value = tickers.join(', ');
  $('set-key').value = finnhubKey;
  $('set-zones').value = zones.map((z) => z.label + '=' + z.tz).join('\n');
  $('dlg-settings').showModal();
}

function saveSettings() {
  if (pendingPlace) { place = pendingPlace; store.set('place', place); }

  tickers = $('set-tickers').value.split(',').map((s) => s.trim()).filter(Boolean);
  store.set('tickers', tickers);

  finnhubKey = $('set-key').value.trim();
  store.set('finnhubKey', finnhubKey);

  const parsed = [];
  for (const line of $('set-zones').value.split('\n')) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const label = line.slice(0, i).trim();
    const tz = line.slice(i + 1).trim();
    try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); parsed.push({ label, tz }); } catch { /* skip invalid zone */ }
  }
  if (parsed.length) { zones = parsed; store.set('zones', zones); }

  renderClocks();
  loadWeather();
  loadQuotes();
}

/* ---------- Wiring ---------- */
function init() {
  renderClocks();
  renderEvents();
  initFx();
  initCalc();
  renderTasks();
  renderShop();
  tickTimer();

  $('timer-start').addEventListener('click', startTimer);
  $('timer-reset').addEventListener('click', resetTimer);
  document.querySelectorAll('.presets button').forEach((b) =>
    b.addEventListener('click', () => { $('timer-min').value = b.dataset.min; }));

  $('event-form').addEventListener('submit', (e) => {
    e.preventDefault();
    events.push({ id: uid(), label: $('event-label').value.trim(), at: $('event-at').value });
    store.set('events', events);
    e.target.reset();
    renderEvents();
  });

  $('task-form').addEventListener('submit', addTask);
  $('shop-form').addEventListener('submit', (e) => {
    e.preventDefault();
    shop.push({ id: uid(), text: $('shop-text').value.trim(), done: false });
    store.set('shop', shop);
    e.target.reset();
    renderShop();
  });
  $('shop-clear').addEventListener('click', () => { shop = shop.filter((x) => !x.done); store.set('shop', shop); renderShop(); });

  $('btn-refresh').addEventListener('click', loadQuotes);
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
  $('dlg-settings').addEventListener('close', () => {
    if ($('dlg-settings').returnValue === 'ok') saveSettings();
    $('dlg-settings').returnValue = '';
  });

  setInterval(() => { tickClocks(); tickTimer(); }, 250);
  setInterval(tickEvents, 30000);
  setInterval(checkReminders, 30000);
  setInterval(loadQuotes, 60000);
  setInterval(loadWeather, 15 * 60000);
  setInterval(loadFx, 60 * 60000);

  loadWeather();
  loadQuotes();
  loadFx();
  checkReminders();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
