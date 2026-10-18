'use strict';
/* Your data lives in one Google Sheet ("Fred Daten"), one tab per data set.
   This browser only keeps a working copy, so Fred starts fast and works offline.
   The Sheet is the master: you can open it and edit it by hand, too.
   How a sync works, per data set:
   1. read the tab from Google
   2. find what changed HERE since the last sync (new, edited or deleted rows)
   3. apply those changes to the rows from Google, write the result back, show it here
   Rows of other devices are never lost, because only changed rows are applied. */

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SH_TITLE = 'Fred Daten';

// Each set: tab name, columns (first column = key), and how to turn the app data into rows and back.
const SH_SETS = {
  tickers: {
    tab: 'Tickers', cols: ['symbol', 'position'], key: 'symbol',
    get: () => tickers.map((s, i) => ({ symbol: s, position: i })),
    set: (rows) => { tickers = rows.map((r) => r.symbol); },
    order: (a, b) => a.position - b.position,
    save: () => store.set('tickers', tickers),
    show: () => { if (typeof tickerEditor === 'function') tickerEditor(); loadQuotes(); earn.t = 0; loadEarnings(); loadNews(true); },
  },
  food: {
    tab: 'Food', cols: ['id', 'date', 'time', 'meal', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'source', 'reaction', 'symptoms', 'sugar_g'], key: 'id',
    get: () => food.filter((e) => !e.busy && e.at).map((e) => ({
      id: e.id, date: e.at.slice(0, 10), time: e.at.slice(11, 16), meal: e.text, kcal: e.kcal, protein_g: e.p, carbs_g: e.c, fat_g: e.f,
      source: e.src || '', reaction: e.bad ? TOL_LEVELS[e.bad.lvl] : '', symptoms: e.bad ? e.bad.sym.join('; ') : '', sugar_g: e.s == null ? '' : e.s,
    })),
    set: (rows) => {
      food = rows.map((r) => {
        const e = { id: r.id, at: r.date + 'T' + r.time, text: r.meal, kcal: nn(r.kcal), p: nn(r.protein_g), c: nn(r.carbs_g), f: nn(r.fat_g), s: nn(r.sugar_g) }; // empty cell = not known (not 0)
        if (r.source) e.src = r.source;
        const lvl = TOL_LEVELS.indexOf(r.reaction);
        if (lvl > 0) e.bad = { lvl, sym: r.symptoms ? String(r.symptoms).split('; ') : [] };
        return e;
      }).concat(food.filter((e) => e.busy)); // meals still being estimated stay as they are
    },
    order: (a, b) => (a.date + a.time).localeCompare(b.date + b.time),
    save: () => store.set('food', food),
    show: () => renderFood(),
  },
  weight: {
    tab: 'Weight', cols: ['date', 'weight_kg'], key: 'date',
    get: () => weight.map((w) => ({ date: w.d, weight_kg: w.kg })),
    set: (rows) => { weight = rows.map((r) => ({ d: r.date, kg: num(r.weight_kg) })); },
    order: (a, b) => a.date.localeCompare(b.date),
    save: () => store.set('weight', weight),
    show: () => renderFood(),
  },
  waist: {
    tab: 'Waist', cols: ['date', 'waist_cm'], key: 'date',
    get: () => waist.map((w) => ({ date: w.d, waist_cm: w.cm })),
    set: (rows) => { waist = rows.map((r) => ({ d: r.date, cm: num(r.waist_cm) })); },
    order: (a, b) => a.date.localeCompare(b.date),
    save: () => store.set('waist', waist),
    show: () => renderFood(),
  },
  poker: {
    tab: 'Poker', cols: ['id', 'date', 'place', 'game', 'result_eur'], key: 'id',
    get: () => poker.map((e) => ({ id: e.id, date: e.d, place: e.place || '', game: e.game || '', result_eur: e.amt })),
    set: (rows) => { poker = rows.map((r) => ({ id: r.id, d: r.date, place: r.place, game: r.game, amt: num(r.result_eur) })); },
    order: (a, b) => a.date.localeCompare(b.date),
    save: () => store.set('poker', poker),
    show: () => renderPoker(),
  },
  shop: {
    tab: 'Shopping', cols: ['id', 'item', 'done', 'position'], key: 'id',
    get: () => shop.map((x, i) => ({ id: x.id, item: x.text, done: x.done ? 1 : 0, position: i })),
    set: (rows) => { shop = rows.map((r) => ({ id: r.id, text: String(r.item), done: !!Number(r.done) })); },
    order: (a, b) => a.position - b.position,
    save: () => store.set('shop', shop),
    show: () => renderShop(),
  },
  // daily Whoop values that feed the Recovery and Sleep cards
  whoop: {
    tab: 'Whoop Tage', key: 'd',
    cols: ['d', 'hrv', 'rhr', 'resp', 'skinTemp', 'spo2', 'sleepMin', 'sleepNeedMin', 'sleepDebtMin', 'sleepEff', 'sleepConsist', 'lightMin', 'deepMin', 'remMin', 'awakeMin', 'bed', 'wake', 'strain', 'whoopRecovery'],
    get: () => whoop,
    set: (rows) => { whoop = rows.map((r) => Object.fromEntries(SH_SETS.whoop.cols.map((c) => [c, c === 'd' ? r.d : r[c] === '' || r[c] == null ? null : (c === 'bed' || c === 'wake' ? String(r[c]) : Number(r[c]))]))); },
    order: (a, b) => String(a.d).localeCompare(String(b.d)),
    save: () => store.set('whoop', whoop),
    show: () => { if (typeof renderRecovery === 'function') renderRecovery(); if (typeof renderWeekly === 'function') renderWeekly(); },
  },
  // workouts from the Whoop workouts CSV, in neutral columns (the raw file is kept in "Whoop Training")
  workouts: {
    tab: 'Workouts', cols: ['start', 'name', 'min', 'kcal', 'avg_hr', 'max_hr', 'strain'], key: 'start',
    get: () => workouts.map((w) => ({ start: w.id, name: w.name, min: w.min, kcal: w.kcal, avg_hr: w.avgHr, max_hr: w.maxHr, strain: w.strain })),
    set: (rows) => {
      workouts = rows.map((r) => ({ id: String(r.start), d: String(r.start).slice(0, 10), t: String(r.start).slice(11, 16), name: String(r.name || 'Workout'), min: nn(r.min), kcal: nn(r.kcal), avgHr: nn(r.avg_hr), maxHr: nn(r.max_hr), strain: nn(r.strain) }));
    },
    order: (a, b) => String(a.start).localeCompare(String(b.start)),
    save: () => store.set('workouts', workouts),
    show: () => { if (typeof renderBodySum === 'function') renderBodySum(); },
  },
  // the written weekly summaries, one readable row per week
  review: {
    tab: 'Weekly Review', cols: ['week_start', 'week_end', 'summary', 'went_well', 'next_week'], key: 'week_start',
    get: () => Object.entries(weeklyAi).filter(([, v]) => v && v.summary).map(([d, v]) => ({
      week_start: d, week_end: toDateStr(addDays(new Date(d + 'T00:00'), 6)), summary: v.summary, went_well: (v.wins || []).join('\n'), next_week: (v.focus || []).join('\n'),
    })),
    set: (rows) => {
      weeklyAi = Object.fromEntries(rows.map((r) => [String(r.week_start), {
        summary: String(r.summary || ''), wins: String(r.went_well || '').split('\n').filter(Boolean), focus: String(r.next_week || '').split('\n').filter(Boolean), err: '',
      }]));
    },
    order: (a, b) => String(a.week_start).localeCompare(String(b.week_start)),
    save: () => store.set('weekly', weeklyAi),
    show: () => renderWeekly(),
    keys: ['weekly'],
  },
  // one row per setting, the value is JSON text: goals, tips, tolerance, places, default currencies, clocks,
  // and the card layout (one row per kind of device, so Mac and iPhone can differ)
  settings: {
    tab: 'Einstellungen', cols: ['name', 'json'], key: 'name',
    get: () => Object.entries(SH_VALUES).filter(([, v]) => v.get() != null).map(([name, v]) => ({ name, json: JSON.stringify(v.get()) })), // the other device's usage is not written before we have read it
    set: (rows) => {
      shChanged = [];
      for (const r of rows) {
        const v = SH_VALUES[r.name];
        let val; try { val = JSON.parse(r.json); } catch { continue; }
        if (!v || JSON.stringify(v.get()) === JSON.stringify(val)) continue;
        v.put(val);
        shChanged.push(r.name);
      }
    },
    order: (a, b) => String(a.name).localeCompare(String(b.name)),
    owns: (k) => k in SH_VALUES, // rows of other devices (the layout of the other kind of device) are not ours to delete
    save: () => { for (const v of Object.values(SH_VALUES)) store.set(v.key, v.get()); },
    show: () => {
      const has = (n) => shChanged.includes(n);
      if (has('nutri') || has('tips') || has('tolerance')) { renderFood(); if (typeof renderWeekly === 'function') renderWeekly(); }
      if (has('place') || has('place2')) { loadWeather(); if (typeof wxEditor === 'function') wxEditor(); }
      if (has('fxDefault')) { $('fx-from').value = fxDefault.from; $('fx-to').value = fxDefault.to; convert(); }
      if (has(SH_LAYOUT)) applyLayout();
      if (has('aiuse-' + SH_KIND) || has('aiuse-' + SH_OTHER)) renderAiUse();
    },
    keys: ['nutri', 'tips', 'tolerance', 'place', 'place2', 'fxDefault', 'layout', 'aiUse', 'aiUseOther'], // local storage keys that belong to this set
  },
};
// The settings rows. The layout row is named after the kind of device: touch screen = phone, otherwise desktop.
const SH_KIND = matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop';
const SH_OTHER = SH_KIND === 'phone' ? 'desktop' : 'phone';
const SH_LAYOUT = 'layout-' + SH_KIND;
let shChanged = [];
const SH_VALUES = {
  nutri: { key: 'nutri', get: () => nutri, put: (v) => { nutri = v; } },
  tips: { key: 'tips', get: () => tips, put: (v) => { tips = v; } },
  tolerance: { key: 'tolerance', get: () => tol, put: (v) => { tol = v; } },
  place: { key: 'place', get: () => place, put: (v) => { place = v; } },
  place2: { key: 'place2', get: () => place2, put: (v) => { place2 = v; } },
  fxDefault: { key: 'fxDefault', get: () => fxDefault, put: (v) => { fxDefault = v; } },
  [SH_LAYOUT]: { key: 'layout', get: () => layout, put: (v) => { layout = v; } },
  // AI usage: each kind of device writes only its own row and reads the other one (see aiTrack in food.js)
  ['aiuse-' + SH_KIND]: { key: 'aiUse', get: () => aiUse, put: (v) => { aiUse = v; } },
  ['aiuse-' + SH_OTHER]: { key: 'aiUseOther', get: () => aiUseOther, put: (v) => { aiUseOther = v; } },
};
const SH_KEYS = Object.keys(SH_SETS);
// the raw Whoop exports (every column of the CSV files), kept as history only
const SH_RAW = { cycles: 'Whoop Zyklen', sleep: 'Whoop Schlaf', workouts: 'Whoop Training' };
const SH_TABS = SH_KEYS.map((k) => SH_SETS[k].tab).concat(Object.values(SH_RAW));
const shSetOf = (key) => SH_KEYS.find((k) => k === key || (SH_SETS[k].keys || []).includes(key));

const nn = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));

let shId = store.get('shId', null);       // id of the Sheet
let shBase = store.get('shBase', {});     // set -> { key: row as text } as of the last successful sync
let shTabsOk = false;                     // tabs checked in this session
let shBusy = false, shAgain = false, shTimer = null, shApplying = false;
let shMsg = '';

function shReady() { return typeof gHasToken === 'function' && gHasToken() && gScopes.includes('drive.file'); }

/* ---------- Google Sheets API ---------- */

async function shApi(path, opts) {
  const res = await driveFetch(SHEETS_API + path, opts);
  return res.json();
}

const shJson = (body) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Open the Sheet (find or create) and make sure every tab exists.
let shOpening = null;
function shOpen() { return shOpening || (shOpening = shOpen1().finally(() => { shOpening = null; })); }

async function shOpen1() {
  if (shId && shTabsOk) return shId;
  if (!shId) {
    const q = encodeURIComponent("name='" + SH_TITLE + "' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    const r = await (await driveFetch(DRIVE + '?fields=files(id)&q=' + q)).json();
    shId = r.files && r.files[0] ? r.files[0].id : null;
  }
  if (!shId) {
    const r = await shApi('', Object.assign({ method: 'POST' }, shJson({
      properties: { title: SH_TITLE }, sheets: SH_TABS.map((t) => ({ properties: { title: t } })),
    })));
    shId = r.spreadsheetId;
  }
  store.set('shId', shId);
  const meta = await shApi('/' + shId + '?fields=sheets.properties.title');
  const have = (meta.sheets || []).map((s) => s.properties.title);
  const missing = SH_TABS.filter((t) => !have.includes(t));
  if (missing.length) await shApi('/' + shId + ':batchUpdate', Object.assign({ method: 'POST' }, shJson({ requests: missing.map((t) => ({ addSheet: { properties: { title: t } } })) })));
  shTabsOk = true;
  return shId;
}

// Rows of one tab from its cell values (first row = header)
function shRowsOf(set, values) {
  const s = SH_SETS[set];
  const rows = [];
  for (const cells of (values || []).slice(1)) {
    const row = Object.fromEntries(s.cols.map((c, i) => [c, cells[i] === undefined ? '' : cells[i]]));
    if (row[s.key] !== '') rows.push(row);
  }
  return rows;
}

// All tabs of the sets in ONE request (instead of one per tab)
async function shReadAll() {
  const q = SH_KEYS.map((k) => 'ranges=' + encodeURIComponent("'" + SH_SETS[k].tab + "'")).join('&');
  const r = await shApi('/' + shId + '/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&' + q);
  const out = {};
  SH_KEYS.forEach((k, i) => { const v = ((r.valueRanges || [])[i] || {}).values; out[k] = { rows: shRowsOf(k, v), blank: !v || !v.length }; });
  return out;
}

// Write a whole tab. Write FIRST, then clear only the old rows below: if the second step fails,
// the tab still has all rows (an empty tab would look like "everything deleted").
async function shPutTab(tab, values) {
  await shApi('/' + shId + '/values/' + encodeURIComponent("'" + tab + "'!A1") + '?valueInputOption=RAW', Object.assign({ method: 'PUT' }, shJson({ values })));
  await shApi('/' + shId + '/values/' + encodeURIComponent("'" + tab + "'!A" + (values.length + 1) + ':ZZ') + ':clear', { method: 'POST' });
}

async function shWriteRows(set, rows) {
  const s = SH_SETS[set];
  await shPutTab(s.tab, [s.cols].concat(rows.map((r) => s.cols.map((c) => (r[c] === undefined || r[c] === null ? '' : r[c])))));
}

/* ---------- sync of one data set ---------- */

const shLost = (remoteN, baseN, localN) => remoteN === 0 && baseN >= 3 && localN > 0;
let shWarn = []; // tabs that were found empty and written back in this sync
const shText = (row, cols) => JSON.stringify(cols.map((c) => (row[c] === undefined || row[c] === null ? '' : row[c])));
const shMap = (rows, s) => new Map(rows.map((r) => [String(r[s.key]), r]));

async function shSyncSet(set, read) {
  const s = SH_SETS[set];
  const remote = shMap(read.rows, s);
  const local = shMap(s.get(), s);
  const base = shBase[set] || {};
  // Safety: the tab is completely blank (not even the header row), but it had rows at the last sync.
  // Fred always writes the header, so this is a failed write or a cleared tab, not a real delete
  // (deleting everything in Fred leaves the header). Keep this device's rows and write them back.
  if (read.blank && shLost(remote.size, Object.keys(base).length, local.size)) {
    await shWriteRows(set, [...local.values()].sort(s.order));
    shBase[set] = Object.fromEntries([...local].filter(([k]) => !s.owns || s.owns(k)).map(([k, r]) => [k, shText(r, s.cols)]));
    store.set('shBase', shBase);
    shWarn.push(s.tab);
    return;
  }
  const merged = new Map(remote);
  // changes made here since the last sync
  // a row this device never synced before, but Google already has: Google wins (a new device must not overwrite with defaults)
  for (const [k, row] of local) if (base[k] !== shText(row, s.cols) && !(!(k in base) && remote.has(k))) merged.set(k, row);
  for (const k of Object.keys(base)) if (!local.has(k)) merged.delete(k);
  const rows = [...merged.values()].sort(s.order);
  const same = (a, b) => a.length === b.length && a.every((r, i) => shText(r, s.cols) === shText(b[i], s.cols));
  if (!same(rows, [...remote.values()])) await shWriteRows(set, rows);
  shBase[set] = Object.fromEntries(rows.filter((r) => !s.owns || s.owns(String(r[s.key]))).map((r) => [String(r[s.key]), shText(r, s.cols)]));
  store.set('shBase', shBase);
  // show what came from Google, if it differs from what this device has
  if (!same(rows, [...local.values()].sort(s.order)) || rows.length !== local.size) {
    shApplying = true;
    s.set(rows);
    s.save();
    shApplying = false;
    s.show();
  }
}

async function shSync() {
  clearTimeout(shTimer);
  if (!shReady()) { shMsg = gHasToken() ? 'Sheet: Google needs one more permission. Press Connect.' : 'Sheet: waiting for Google (press Connect).'; shStatus(); return; }
  if (shBusy) { shAgain = true; return; }
  shBusy = true;
  try {
    await shOpen();
    const remote = await shReadAll();
    shWarn = [];
    for (const set of SH_KEYS) await shSyncSet(set, remote[set]);
    if (shWarn.length && typeof banner === 'function') banner('Google Sheet: the tab ' + shWarn.join(', ') + ' was empty. Fred kept the data of this device and wrote it back.', true);
    store.set('shOkAt', Date.now());
    shMsg = 'Saved to Google Sheet ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    shMsg = /has not been used|disabled|SERVICE_DISABLED/i.test(e.message)
      ? 'Sheet: turn on the "Google Sheets API" in your Google Cloud project (same project as the Client ID).'
      : 'Sheet: ' + e.message;
  } finally {
    shApplying = false;
    shBusy = false;
    shStatus();
    if (shAgain) { shAgain = false; shSync(); }
  }
}

function shStatus() { const n = $('sheet-status'); if (n) n.textContent = shMsg; syncLineUpdate(); }

// How fresh is this device's copy? { text, stale }. Stale = older than 10 minutes or no Google session.
function syncAge() {
  const at = store.get('shOkAt', 0), min = Math.round((Date.now() - at) / 60000);
  if (!store.get('gConnected', false)) return { text: '', stale: false };
  if (!at) return { text: 'Not synced yet', stale: true };
  const hm = new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (!gHasToken()) return { text: 'Not connected, saved copy from ' + hm, stale: true };
  if (min > 10) return { text: 'Not synced since ' + hm, stale: true };
  return { text: min < 1 ? 'Synced just now' : 'Synced ' + min + ' min ago', stale: false };
}
function syncLineUpdate() {
  const a = syncAge(), n = $('sync-age');
  if (n) { n.textContent = a.text; n.classList.toggle('stale', a.stale); }
}

// Called by store.set: a data set changed here, send it a few seconds later.
function shTouch(key) {
  if (shApplying || !shSetOf(key)) return;
  clearTimeout(shTimer);
  shTimer = setTimeout(shSync, 3000);
}

function shInit() {
  setInterval(() => { if (!document.hidden) shSync(); syncLineUpdate(); }, 60000);
  document.addEventListener('visibilitychange', shSync);
  setTimeout(shSync, 2500);
}

/* ---------- raw Whoop history (all columns of the CSV files) ---------- */

const shEnc = encodeURIComponent;
// numbers stay numbers in the Sheet, so you can calculate with them; the key column stays text
const shCell = (v, isKey) => (!isKey && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

// snap: { 'set\tkey': row | null }. Adds or replaces rows in the tabs; new columns go to the end.
async function shRawFlush(snap) {
  await shOpen();
  const bySet = {};
  for (const k of Object.keys(snap)) { const [set, key] = k.split('\t'); (bySet[set] = bySet[set] || []).push([key, snap[k]]); }
  const counts = {};
  for (const set of Object.keys(bySet)) {
    const tab = SH_RAW[set], keyCol = RC_KEY_COL[set];
    const r = await shApi('/' + shId + '/values/' + shEnc(tab) + '?valueRenderOption=UNFORMATTED_VALUE');
    const vals = r.values || [];
    const header = vals.length ? vals[0].map(String) : [keyCol];
    const rows = new Map();
    for (const cells of vals.slice(1)) {
      const o = Object.fromEntries(header.map((h, i) => [h, cells[i] === undefined ? '' : cells[i]]));
      if (o[keyCol] !== '') rows.set(String(o[keyCol]), o);
    }
    for (const [key, row] of bySet[set]) {
      if (row === null) { rows.delete(key); continue; }
      rows.set(key, row);
      for (const c of Object.keys(row)) if (!header.includes(c)) header.push(c);
    }
    const list = [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1]);
    const values = [header].concat(list.map((o) => header.map((h) => (o[h] === undefined ? '' : shCell(o[h], h === keyCol)))));
    await shPutTab(tab, values);
    counts[set] = list.length;
  }
  return counts;
}

// Number of rows in each raw tab, for the status line.
async function shRawCounts() {
  await shOpen();
  const out = {};
  for (const set of Object.keys(SH_RAW)) {
    const r = await shApi('/' + shId + '/values/' + shEnc(SH_RAW[set]) + '!A:A');
    out[set] = Math.max(0, (r.values || []).length - 1);
  }
  return out;
}
