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
    get: () => Object.entries(SH_VALUES).map(([name, v]) => ({ name, json: JSON.stringify(v.get()) })),
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
      if (has('zones')) { renderClocks(); if (typeof tzEditor === 'function') tzEditor(); }
      if (has('fxDefault')) { $('fx-from').value = fxDefault.from; $('fx-to').value = fxDefault.to; convert(); }
      if (has(SH_LAYOUT)) applyLayout();
    },
    keys: ['nutri', 'tips', 'tolerance', 'place', 'place2', 'fxDefault', 'zones', 'layout'], // local storage keys that belong to this set
  },
};
// The settings rows. The layout row is named after the kind of device: touch screen = phone, otherwise desktop.
const SH_LAYOUT = 'layout-' + (matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop');
let shChanged = [];
const SH_VALUES = {
  nutri: { key: 'nutri', get: () => nutri, put: (v) => { nutri = v; } },
  tips: { key: 'tips', get: () => tips, put: (v) => { tips = v; } },
  tolerance: { key: 'tolerance', get: () => tol, put: (v) => { tol = v; } },
  place: { key: 'place', get: () => place, put: (v) => { place = v; } },
  place2: { key: 'place2', get: () => place2, put: (v) => { place2 = v; } },
  fxDefault: { key: 'fxDefault', get: () => fxDefault, put: (v) => { fxDefault = v; } },
  zones: { key: 'zones', get: () => zones, put: (v) => { zones = v; } },
  [SH_LAYOUT]: { key: 'layout', get: () => layout, put: (v) => { layout = v; } },
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

async function shReadRows(set) {
  const s = SH_SETS[set];
  const r = await shApi('/' + shId + '/values/' + encodeURIComponent(s.tab) + '?valueRenderOption=UNFORMATTED_VALUE');
  const rows = [];
  for (const cells of (r.values || []).slice(1)) {
    const row = Object.fromEntries(s.cols.map((c, i) => [c, cells[i] === undefined ? '' : cells[i]]));
    if (row[s.key] !== '') rows.push(row);
  }
  return rows;
}

async function shWriteRows(set, rows) {
  const s = SH_SETS[set];
  const range = encodeURIComponent(s.tab);
  await shApi('/' + shId + '/values/' + range + ':clear', { method: 'POST' });
  const values = [s.cols].concat(rows.map((r) => s.cols.map((c) => (r[c] === undefined || r[c] === null ? '' : r[c]))));
  await shApi('/' + shId + '/values/' + range + '!A1?valueInputOption=RAW', Object.assign({ method: 'PUT' }, shJson({ values })));
}

/* ---------- sync of one data set ---------- */

const shText = (row, cols) => JSON.stringify(cols.map((c) => (row[c] === undefined || row[c] === null ? '' : row[c])));
const shMap = (rows, s) => new Map(rows.map((r) => [String(r[s.key]), r]));

async function shSyncSet(set) {
  const s = SH_SETS[set];
  const remote = shMap(await shReadRows(set), s);
  const local = shMap(s.get(), s);
  const base = shBase[set] || {};
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
    for (const set of SH_KEYS) await shSyncSet(set);
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

function shStatus() { const n = $('sheet-status'); if (n) n.textContent = shMsg; }

// Called by store.set: a data set changed here, send it a few seconds later.
function shTouch(key) {
  if (shApplying || !shSetOf(key)) return;
  clearTimeout(shTimer);
  shTimer = setTimeout(shSync, 3000);
}

function shInit() {
  setInterval(() => { if (!document.hidden) shSync(); }, 60000);
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
    await shApi('/' + shId + '/values/' + shEnc(tab) + ':clear', { method: 'POST' });
    await shApi('/' + shId + '/values/' + shEnc(tab) + '!A1?valueInputOption=RAW', Object.assign({ method: 'PUT' }, shJson({ values })));
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
