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
    try { localStorage.setItem('fred.' + key, JSON.stringify(value)); } catch (e) { storeFull(key, e); }
    if (typeof syncTouch === 'function') syncTouch(key); // sync.js: send the change to your other devices
    if (typeof shTouch === 'function') shTouch(key);   // sheets.js: save the change to the Google Sheet
  },
};

// The browser storage is full (or blocked): say so once, instead of losing changes without a word.
let storeWarned = false;
function storeFull(key, e) {
  if (storeWarned || typeof banner !== 'function' || !document.getElementById('banners')) return;
  storeWarned = true;
  banner('This browser could not save "' + key + '" (' + (e && e.name || 'storage error') + '). The Google Sheet still has your data; download a backup in Settings.', true);
}

const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- Defaults ----------
   Nothing personal in the code: this repo is public. Enter place, tickers and
   countdowns in the app (Settings). They are stored only in your own browser. */

let place = store.get('place', null);
let tickers = store.get('tickers', []);
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

// Once a second: the date in the header.
function tickClocks() {
  const now = new Date();
  const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if ($('today').textContent !== today) $('today').textContent = today;
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
  return (typeof gGoogleEvents === 'function' ? gGoogleEvents() : []).concat(earn.list || []);
}

/* ---------- 9) Currency converter (Frankfurter, ECB rates, no key) ---------- */
const CURRENCIES = ['USD', 'EUR', 'MXN', 'GBP', 'CHF', 'JPY', 'CNY', 'PHP'];
// Default pair for the converter: the last pair you picked (starts as USD -> EUR).
let fxDefault = store.get('fxDefault', { from: 'USD', to: 'EUR' });
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
  if (!fx) { $('fx-result').textContent = '\u2013'; $('fx-rate').textContent = ''; return; }
  const amt = parseFloat($('fx-amount').value);
  const from = $('fx-from').value;
  const to = $('fx-to').value;
  $('fx-date').textContent = 'ECB \u00b7 ' + new Date(fx.date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!fx.rates[from] || !fx.rates[to]) { $('fx-result').textContent = '\u2013'; return; }
  const rate = fx.rates[to] / fx.rates[from];
  $('fx-rate').textContent = '1 ' + from + ' = ' + rate.toLocaleString('en-US', { maximumFractionDigits: rate < 1 ? 4 : 2 }) + ' ' + to;
  $('fx-result').textContent = amt >= 0 ? (amt * rate).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '\u2013';
}

function initFx() {
  for (const id of ['fx-from', 'fx-to']) {
    for (const c of CURRENCIES) $(id).append(el('option', { value: c }, c));
  }
  $('fx-from').value = fxDefault.from;
  $('fx-to').value = fxDefault.to;
  ['fx-amount', 'fx-from', 'fx-to'].forEach((id) => $(id).addEventListener('input', convert));
  // the pair you pick is the default for next time (saved in the Sheet)
  const saveFxPair = () => { fxDefault = { from: $('fx-from').value, to: $('fx-to').value }; store.set('fxDefault', fxDefault); };
  $('fx-from').addEventListener('change', saveFxPair);
  $('fx-to').addEventListener('change', saveFxPair);
  $('fx-swap').addEventListener('click', () => {
    const a = $('fx-from').value; $('fx-from').value = $('fx-to').value; $('fx-to').value = a; convert(); saveFxPair();
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

// Small outline icons (stroke = text colour). The label goes to aria-label and the tooltip.
const ICONS = {
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
};
function iconButton(name, label, onclick) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  const b = el('button', { type: 'button', class: 'icon', 'aria-label': label, title: label, onclick });
  b.append(svg);
  return b;
}

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
      iconButton('edit', 'Edit ' + it.text, () => { editingShopId = it.id; renderShop(); }),
      iconButton('trash', 'Delete ' + it.text, () => {
        shop = shop.filter((x) => x.id !== it.id); store.set('shop', shop); renderShop();
      })));
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

/* ---------- Notes (free text, saved in this browser while you type) ---------- */
let notesTimer = null;

function initNotes() {
  const box = $('notes');
  box.value = store.get('notes', '');
  box.addEventListener('input', () => {
    $('notes-status').textContent = 'Saving...';
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      store.set('notes', box.value);
      $('notes-status').textContent = 'Saved';
    }, 400);
  });
  // save at once when leaving the page, so nothing typed is lost
  window.addEventListener('beforeunload', () => { if (notesTimer) store.set('notes', box.value); });
  $('notes-share').addEventListener('click', shareNote);
  $('notes-clear').addEventListener('click', clearNote);
  $('notes-mic').addEventListener('click', toggleDictation);
}

/* Dictation into the note. Uses the browser's speech recognition where it exists (Chrome, Safari).
   Where it does not (e.g. Brave, some home-screen apps), the note opens for typing and the keyboard's own microphone can be used. */
let dictation = null;

function insertIntoNote(text) {
  const box = $('notes');
  const at = box.selectionEnd ?? box.value.length;
  const before = box.value.slice(0, at);
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  box.value = before + sep + text + box.value.slice(at);
  const pos = at + sep.length + text.length;
  box.setSelectionRange(pos, pos);
  box.dispatchEvent(new Event('input')); // saves as usual
}

function toggleDictation() {
  const btn = $('notes-mic');
  const st = $('notes-status');
  if (dictation) { dictation.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || store.get('noWebSpeech', false)) { systemDictation(); return; }
  const rec = new SR();
  rec.lang = navigator.language || 'de-AT';
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) insertIntoNote(ev.results[i][0].transcript.trim());
    }
  };
  rec.onerror = (ev) => {
    // Brave blocks the speech service, iPhone home-screen apps are not allowed to use it:
    // on this device use the system dictation from now on
    if (ev.error === 'no-speech' || ev.error === 'aborted') { st.textContent = ''; return; }
    store.set('noWebSpeech', true);
    systemDictation();
  };
  rec.onend = () => { dictation = null; btn.classList.remove('rec'); btn.setAttribute('aria-pressed', 'false'); };
  try {
    rec.start();
    dictation = rec;
    btn.classList.add('rec');
    btn.setAttribute('aria-pressed', 'true');
    st.textContent = 'Listening…';
  } catch (e) {
    systemDictation();
  }
}

// No speech recognition in this browser: open the note and show how to use the device's own dictation.
function systemDictation() {
  const box = $('notes');
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
  $('notes-status').textContent = '';
  const mac = /Mac/.test(navigator.platform) && !('ontouchend' in document);
  const hint = $('notes-hint');
  hint.textContent = mac
    ? 'Press the fn key twice (or the 🎤 key) and speak. If nothing happens: System Settings → Keyboard → Dictation → On.'
    : 'Tap 🎤 at the bottom right of the keyboard and speak.';
  hint.hidden = false;
  clearTimeout(hint.timer);
  hint.timer = setTimeout(() => { hint.hidden = true; }, 10000);
}

// Clear button: empties the note at once; "Undo" brings it back for 10 seconds.
let notesUndo = null;
function clearNote() {
  const box = $('notes');
  if (!box.value) return;
  const before = box.value;
  box.value = '';
  store.set('notes', '');
  const st = $('notes-status');
  const undo = el('button', { type: 'button', class: 'linkbtn', onclick: () => {
    box.value = before;
    store.set('notes', before);
    st.textContent = 'Restored';
    clearTimeout(notesUndo);
  } }, 'Undo');
  st.replaceChildren('Cleared \u00b7 ', undo);
  clearTimeout(notesUndo);
  notesUndo = setTimeout(() => { if (st.contains(undo)) st.textContent = ''; }, 10000);
}

// Share button: opens the system share sheet (iPhone / Mac: pick "Notes" to save it in Apple Notes).
// Only the selected text is shared if something is selected. Without a share sheet the text is copied.
async function shareNote() {
  const box = $('notes');
  const sel = box.value.slice(box.selectionStart, box.selectionEnd).trim();
  const text = sel || box.value.trim();
  const st = $('notes-status');
  if (!text) { st.textContent = 'Nothing to share'; return; }
  if (navigator.share) {
    try { await navigator.share({ title: 'Note from Fred', text }); st.textContent = 'Shared'; return; }
    catch (e) { if (e && e.name === 'AbortError') return; } // closed without sharing
  }
  try { await navigator.clipboard.writeText(text); st.textContent = 'Copied \u2013 paste it in Notes'; }
  catch { st.textContent = 'Sharing not supported here'; }
}

/* ---------- Settings ---------- */

function openSettings() {
  $('set-geo').checked = useGeo;
  $('set-place-status').textContent = '';
  $('set-key').value = finnhubKey;
  $('set-twelve').value = twelveKey;
  $('set-anthropic').value = anthropicKey;
  nutriFillSettings();
  $('set-gclient').value = googleClientId;
  if (typeof syncNow === 'function') syncNow(); // shows the sync state when Settings opens
  $('g-status').textContent = gHasToken() ? 'Connected.' : '';
  $('bk-status').textContent = '';
  $('dlg-settings').showModal();
}

function saveSettings() {
  if ($('set-geo').checked !== useGeo) { useGeo = $('set-geo').checked; store.set('useGeo', useGeo); geoSwapped = false; geoPlace = null; }
  finnhubKey = $('set-key').value.trim();
  store.set('finnhubKey', finnhubKey);
  twelveKey = $('set-twelve').value.trim();
  store.set('twelveKey', twelveKey);
  nutriSaveSettings();
  anthropicKey = $('set-anthropic').value.trim();
  store.set('anthropicKey', anthropicKey);
  sparkCache = {}; // new key or symbols: draw the charts again
  store.set('spark', sparkCache);

  setGoogleSettings($('set-gclient').value.trim());
  earn.t = 0;
  loadEarnings();
  loadNews(true);

  loadWeather();
  loadQuotes();
}

/* ---------- Backup: download and upload the settings as a file ---------- */
const BACKUP_KEYS = ['place', 'place2', 'tickers', 'shop', 'notes', 'fxDefault', 'food', 'weight', 'waist', 'nutri', 'whoop', 'workouts', 'layout', 'finnhubKey', 'twelveKey', 'googleClientId', 'anthropicKey', 'tips', 'tolerance', 'poker', 'weekly', 'aiUse'];
const SECRET_KEYS = ['finnhubKey', 'twelveKey', 'googleClientId', 'anthropicKey'];
const ARRAY_KEYS = ['tickers', 'shop', 'food', 'weight', 'waist', 'workouts', 'poker'];

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

/* ---------- Day / night mode: follows the device, no button ---------- */
function applyTheme() {
  const light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#f2f2f7' : '#000000');
}

/* ---------- Layout: order and hide cards ---------- */
let layout = store.get('layout', { order: [], hidden: [] });

function cardEls() { return [...document.querySelectorAll('main.grid > .card')]; }
function cardTitle(c) { const t = c.querySelector('h2 .ctitle'); return t ? t.textContent.trim() : c.id; }

function currentOrder() {
  const ids = cardEls().map((c) => c.id);
  const known = layout.order.filter((id) => ids.includes(id));
  return known.concat(ids.filter((id) => !known.includes(id)));
}

/* Cards are grouped into tabs (phone: bottom bar, desktop: row in the header); only the active group shows. */
const TAB_GROUPS = [
  { id: 'today', label: 'Today', cards: ['card-now', 'card-weather', 'card-cal', 'card-shop', 'card-notes'] },
  { id: 'markets', label: 'Markets', cards: ['card-tickers', 'card-heat', 'card-news'] },
  { id: 'nutrition', label: 'Nutrition', cards: ['card-nutsum', 'card-food', 'card-tips', 'card-trends', 'card-weekly', 'card-patterns'] },
  { id: 'body', label: 'Body', cards: ['card-bodysum', 'card-health', 'card-recovery', 'card-sleep', 'card-habits'] },
  { id: 'tools', label: 'Tools', cards: ['card-calc', 'card-poker'] },
];
let activeTab = store.get('tab', 'today'); // per device, not synced
if (!TAB_GROUPS.some((g) => g.id === activeTab)) activeTab = 'today';

function tabOf(id) { const g = TAB_GROUPS.find((x) => x.cards.includes(id)); return g ? g.id : 'tools'; } // new cards land in Tools
function inActiveTab(id) { return tabOf(id) === activeTab; }

function setTab(id) {
  activeTab = id;
  store.set('tab', id);
  applyLayout();
  window.scrollTo(0, 0);
  const grid = document.querySelector('main.grid'); // small fade-in of the new group
  grid.classList.remove('tab-in'); void grid.offsetWidth; grid.classList.add('tab-in');
}

function renderTabbar() {
  const bar = $('tabbar');
  if (!bar) return;
  bar.replaceChildren(...TAB_GROUPS.map((g) => {
    const first = g.cards.map((id) => cardIcon(id)).find(Boolean);
    return el('button', { type: 'button', class: g.id === activeTab ? 'on' : '', 'aria-current': g.id === activeTab ? 'page' : 'false', onclick: () => setTab(g.id) },
      first || '', el('span', {}, g.label));
  }));
}

function applyLayout() {
  document.body.dataset.tab = activeTab; // card height depends on the group (CSS)
  const order = currentOrder();
  layout.order = order;
  order.forEach((id, i) => {
    const c = $(id);
    c.style.order = i;
    c.hidden = layout.hidden.includes(id) || !inActiveTab(id);
  });
  // wide cards: next to each other they share a row (half each), alone they take the full row
  const visible = order.filter((id) => !layout.hidden.includes(id) && inActiveTab(id));
  visible.forEach((id, i) => {
    const c = $(id);
    if (!c.classList.contains('card-wide')) return;
    const next = $(visible[i + 1] || ''), prev = $(visible[i - 1] || '');
    c.classList.toggle('half', !!((next && next.classList.contains('card-wide')) || (prev && prev.classList.contains('card-wide'))));
  });
  renderLayoutBar();
  renderTabbar();
  setHeadHeight();
}

function setHeadHeight() { document.documentElement.style.setProperty('--head-h', document.querySelector('header').offsetHeight + 'px'); }

function jumpTo(card) {
  setHeadHeight();
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1200);
}

function saveLayout() { store.set('layout', layout); applyLayout(); }

function moveCard(id, dir) {
  const order = currentOrder();
  const visible = order.filter((x) => !layout.hidden.includes(x) && inActiveTab(x));
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
  // one-time: Market News directly before Food, so the two half-width cards sit side by side (Food on the right)
  if (!store.get('mig.newsFood', false)) {
    const o = layout.order.filter((id) => id !== 'card-food');
    const n = o.indexOf('card-news');
    if (n >= 0) { o.splice(n + 1, 0, 'card-food'); layout.order = o; store.set('layout', layout); }
    store.set('mig.newsFood', true);
  }
  // one-time: the new Health and Trends cards go right after Food
  if (!store.get('mig.splitFood', false)) {
    const o = layout.order.filter((id) => id !== 'card-health' && id !== 'card-trends');
    const n = o.indexOf('card-food');
    if (n >= 0) { o.splice(n + 1, 0, 'card-health', 'card-trends'); layout.order = o; store.set('layout', layout); }
    store.set('mig.splitFood', true);
  }
  // one-time: the Health & Nutrition Tips card goes right after Health
  if (!store.get('mig.tipsCard', false)) {
    const o = layout.order.filter((id) => id !== 'card-tips');
    const n = o.indexOf('card-health');
    if (n >= 0) { o.splice(n + 1, 0, 'card-tips'); layout.order = o; store.set('layout', layout); }
    store.set('mig.tipsCard', true);
  }
  // one-time: the Sleep card goes right after Recovery
  if (!store.get('mig.splitRecovery', false)) {
    const o = layout.order.filter((id) => id !== 'card-sleep');
    const n = o.indexOf('card-recovery');
    if (n >= 0) { o.splice(n + 1, 0, 'card-sleep'); layout.order = o; store.set('layout', layout); }
    store.set('mig.splitRecovery', true);
  }
  // one-time: the Sleep Habits card goes right after Sleep
  if (!store.get('mig.habits', false)) {
    const o = layout.order.filter((id) => id !== 'card-habits');
    const n = o.indexOf('card-sleep');
    if (n >= 0) { o.splice(n + 1, 0, 'card-habits'); layout.order = o; store.set('layout', layout); }
    store.set('mig.habits', true);
  }
  // one-time: Now goes first, Patterns after Sleep Habits
  if (!store.get('mig.now', false)) {
    const o = layout.order.filter((id) => id !== 'card-now' && id !== 'card-patterns');
    o.unshift('card-now');
    const n = o.indexOf('card-habits');
    if (n >= 0) o.splice(n + 1, 0, 'card-patterns');
    layout.order = o; store.set('layout', layout);
    store.set('mig.now', true);
  }
  // one-time: the Body Summary goes first in the Body group
  if (!store.get('mig.bodysum', false)) {
    const o = layout.order.filter((id) => id !== 'card-bodysum');
    const n = o.indexOf('card-recovery');
    if (n >= 0) { o.splice(n, 0, 'card-bodysum'); layout.order = o; store.set('layout', layout); }
    store.set('mig.bodysum', true);
  }
  // one-time: the Nutrition Summary goes first in the Nutrition group
  if (!store.get('mig.nutsum', false)) {
    const o = layout.order.filter((id) => id !== 'card-nutsum');
    const n = o.indexOf('card-food');
    if (n >= 0) { o.splice(n, 0, 'card-nutsum'); layout.order = o; store.set('layout', layout); }
    store.set('mig.nutsum', true);
  }
  // one-time: the Heatmap card goes right after Tickers
  if (!store.get('mig.heat', false)) {
    const o = layout.order.filter((id) => id !== 'card-heat');
    const n = o.indexOf('card-tickers');
    if (n >= 0) { o.splice(n + 1, 0, 'card-heat'); layout.order = o; store.set('layout', layout); }
    store.set('mig.heat', true);
  }
  // one-time: the Poker card goes right after Sleep Habits
  if (!store.get('mig.poker', false)) {
    const o = layout.order.filter((id) => id !== 'card-poker');
    const n = o.indexOf('card-habits');
    if (n >= 0) { o.splice(n + 1, 0, 'card-poker'); layout.order = o; store.set('layout', layout); }
    store.set('mig.poker', true);
  }
  // one-time: the Weekly Review card goes right after Poker
  if (!store.get('mig.weekly', false)) {
    const o = layout.order.filter((id) => id !== 'card-weekly');
    const n = o.indexOf('card-poker');
    if (n >= 0) { o.splice(n + 1, 0, 'card-weekly'); layout.order = o; store.set('layout', layout); }
    store.set('mig.weekly', true);
  }
  // one-time change of the saved order: Shopping List and Calculator & Currency swap places
  if (!store.get('mig.swapCalcShop', false)) {
    const o = layout.order;
    const i = o.indexOf('card-calc');
    const j = o.indexOf('card-shop');
    if (i >= 0 && j >= 0) { o[i] = 'card-shop'; o[j] = 'card-calc'; store.set('layout', layout); }
    store.set('mig.swapCalcShop', true);
  }
  // one-time: every card in the order of its group (new tab layout)
  if (!store.get('mig.tabOrder2', false)) {
    const flat = TAB_GROUPS.flatMap((g) => g.cards);
    layout.order = flat.concat(layout.order.filter((id) => !flat.includes(id)));
    store.set('layout', layout);
    store.set('mig.tabOrder2', true);
  }
  // one-time: Weight & Goal moved from Nutrition to Body, right after Body Summary
  if (!store.get('mig.healthToBody', false)) {
    const o = layout.order.filter((id) => id !== 'card-health');
    const n = o.indexOf('card-bodysum');
    if (n >= 0) { o.splice(n + 1, 0, 'card-health'); layout.order = o; store.set('layout', layout); }
    store.set('mig.healthToBody', true);
  }
  applyLayout();
}

/* ---------- Wiring ---------- */
// Every card: title stays, the rest sits in a scrolling body.
// Small tinted squircle with a white glyph in front of every card title, like the app icons in iOS Settings.
const CARD_ICONS = {
  'card-cal': ['#007aff', 'M9 6h11M9 12h11M9 18h11M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17'],
  'card-weather': ['#32ade6', 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11.1 3.5 3.5 0 0 0 7 18z'],
  'card-tickers': ['#34c759', 'M3 17l6-6 4 4 8-8M15 7h6v6'],
  'card-heat': ['#ff3b30', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  'card-shop': ['#ff2d55', 'M3 4h2l2.5 11h11L21 7H6.2M9 20h.01M18 20h.01'],
  'card-calc': ['#8e8e93', 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01'],
  'card-notes': ['#ffcc00', 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5'],
  'card-food': ['#30b0c7', 'M7 3v8a3 3 0 0 0 3 3v7M10 3v8M13 3v8a3 3 0 0 1-3 3M17 21V3c2 1.5 3 4 3 8h-3'],
  'card-health': ['#af52de', 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
  'card-tips': ['#ffcc00', 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z'],
  'card-trends': ['#ff9500', 'M5 20V10M10 20V4M15 20v-7M20 20V8'],
  'card-recovery': ['#5e5ce6', 'M3 12h4l2-6 4 12 2-6h6'],
  'card-poker': ['#ff9f0a', 'M12 3c3 4 7 6 7 10a4 4 0 0 1-7 2.6A4 4 0 0 1 5 13c0-4 4-6 7-10zM12 15v5M9.5 20h5'],
  'card-now': ['#0a84ff', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5'],
  'card-patterns': ['#5e5ce6', 'M4 18l5-6 4 3 7-9M4 21h16'],
  'card-bodysum': ['#5e5ce6', 'M4 12h4l2-6 4 12 2-6h4'],
  'card-nutsum': ['#30b0c7', 'M5 4v7a3 3 0 0 0 6 0V4M8 4v16M17 4c-2 2-2 6 0 8v8'],
  'card-weekly': ['#5e5ce6', 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h4'],
  'card-habits': ['#30b0c7', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2'],
  'card-sleep': ['#7d5fff', 'M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z'],
  'card-news': ['#ff3b30', 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 13h7M7 16h4'],
};

function cardIcon(id) {
  const ic = CARD_ICONS[id];
  if (!ic) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', ic[1]);
  svg.append(path);
  const box = el('span', { class: 'cicon', 'aria-hidden': 'true' });
  box.style.background = ic[0];
  box.append(svg);
  return box;
}

// Small round refresh button (arrow), used in card headers.
function refreshIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7');
  svg.append(path);
  return svg;
}

function initCards() {
  for (const card of document.querySelectorAll('main.grid > .card')) {
    const h2 = card.querySelector('h2');
    // title text goes into its own span, so buttons and icons can sit next to it
    const title = el('span', { class: 'ctitle' }, h2.firstChild.textContent.trim());
    h2.firstChild.remove();
    const ic = cardIcon(card.id);
    h2.prepend(el('span', { class: 'chead' }, ic || '', title));
    for (const id of ['btn-refresh', 'news-refresh']) {
      const b = h2.querySelector('#' + id);
      if (b) { b.className = 'hicon'; b.setAttribute('aria-label', 'Refresh'); b.title = 'Refresh'; b.replaceChildren(refreshIcon()); }
    }
    const body = el('div', { class: 'cardbody' });
    while (h2.nextSibling) body.append(h2.nextSibling);
    card.append(body);
  }
}

/* ---------- Chart tooltips: hover (mouse) or tap (touch) a bar or point to see its value at once ---------- */
function initChartTips() {
  const tip = el('div', { class: 'ctip', role: 'tooltip', hidden: '' });
  document.body.append(tip);
  let hideTimer = null, shownAt = 0;
  // the text of the nearest SVG element with a <title>; the title moves to data-tip so the slow browser tooltip does not double it
  const textFor = (t) => {
    if (!t.closest || !t.closest('svg')) return '';
    for (let n = t; n && n.nodeType === 1; n = n.parentNode) {
      const ti = [...n.children].find((c) => c.tagName === 'title');
      if (ti) { n.dataset.tip = ti.textContent; ti.remove(); }
      if (n.dataset && n.dataset.tip) return n.dataset.tip;
      if (n.tagName === 'svg') break;
    }
    return '';
  };
  const show = (ev) => {
    const text = textFor(ev.target);
    if (!text) { tip.hidden = true; return; }
    tip.textContent = text;
    tip.hidden = false;
    shownAt = Date.now();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.min(window.innerWidth - w - 8, Math.max(8, ev.clientX - w / 2));
    const y = ev.clientY - h - 14 < 8 ? ev.clientY + 18 : ev.clientY - h - 14; // above the pointer, below if no room
    tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    clearTimeout(hideTimer);
    if (ev.pointerType === 'touch') hideTimer = setTimeout(() => { tip.hidden = true; }, 3000);
  };
  document.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'touch') show(ev); });
  document.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'touch') show(ev); });
  document.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch') tip.hidden = true; }); // a finger lifting also 'leaves'; the timer hides it then
  document.addEventListener('scroll', () => { if (Date.now() - shownAt > 400) tip.hidden = true; }, true); // scrolling hides it (not the settling right after a tap)
}

function init() {
  initChartTips();
  initCards();
  renderEvents();
  initFx();
  renderShop();
  initNotes();
  // touch: tap a Tasks or Events row to show its edit and delete buttons (tap again to hide)
  for (const id of ['cal-list']) $(id).addEventListener('click', (ev) => {
    const li = ev.target.closest('li.ag, li.evr');
    if (!li || ev.target.closest('button')) return;
    const on = !li.classList.contains('show-act');
    document.querySelectorAll('li.show-act').forEach((x) => x.classList.remove('show-act'));
    li.classList.toggle('show-act', on);
  });
  initFood();
  initTips();
  initHeat();
  initNow();
  if (typeof initNutSum === 'function') initNutSum();
  initArchive();
  initRecovery();
  initPoker();
  initWeekly();
  if (typeof shInit === 'function') shInit();
  if (typeof initQuick === 'function') initQuick();
  renderNews();
  $('news-refresh').addEventListener('click', () => loadNews(true));
  initLayout();
  window.addEventListener('resize', matchWeatherHeight);
  gcalInit();
  syncInit();

  $('shop-form').addEventListener('submit', (e) => {
    e.preventDefault();
    shop.push({ id: uid(), text: $('shop-text').value.trim(), done: false });
    store.set('shop', shop);
    e.target.reset();
    renderShop();
  });
  $('shop-clear').addEventListener('click', () => { shop = shop.filter((x) => !x.done); store.set('shop', shop); renderShop(); });

  try { localStorage.removeItem('fred.theme'); } catch (e) { /* an old saved choice is dropped */ }
  applyTheme();
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  $('btn-refresh').addEventListener('click', loadQuotes);
  $('tk-add').addEventListener('click', () => { tkOpen = !tkOpen; tickerEditor(); });
  $('wx-add').addEventListener('click', () => { wxOpen = !wxOpen; wxEditor(); });
  $('btn-layout').addEventListener('click', toggleLayoutMode);
  $('btn-settings').addEventListener('click', openSettings);
  $('set-cancel').addEventListener('click', () => $('dlg-settings').close());
  $('bk-export').addEventListener('click', exportSettings);
  $('bk-import').addEventListener('click', () => $('bk-file').click());
  $('set-geo').addEventListener('change', () => { if ($('set-geo').checked) geoPosition().catch(() => { $('set-place-status').textContent = 'Location not allowed. iPhone: Settings \u2192 Privacy \u2192 Location Services \u2192 Safari Websites.'; }); });
  $('bk-file').addEventListener('change', (e) => { if (e.target.files[0]) importSettings(e.target.files[0]); });
  $('dlg-settings').addEventListener('close', () => {
    if ($('dlg-settings').returnValue === 'ok') saveSettings();
    $('dlg-settings').returnValue = '';
  });

  tickClocks();
  setInterval(tickClocks, 1000);
  setInterval(tickEvents, 30000);
  poll(loadQuotes, 60000);
  poll(loadWeather, 15 * 60000);
  poll(loadFx, 60 * 60000);

  migrateIndexTickers();
  loadWeather();
  loadQuotes();
  loadFx();
  loadEarnings();
  poll(loadEarnings, 6 * 3600000);
  loadNews();
  poll(loadNews, NEWS_TTL);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init); // after gcal.js has been loaded as well
