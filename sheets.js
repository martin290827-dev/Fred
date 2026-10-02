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
    show: () => { if (typeof tickerEditor === 'function') tickerEditor(); loadQuotes(); earn.t = 0; loadEarnings(); loadNews(true); },
  },
  food: {
    tab: 'Food', cols: ['id', 'date', 'time', 'meal', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'source', 'reaction', 'symptoms'], key: 'id',
    get: () => food.filter((e) => !e.busy && e.at).map((e) => ({
      id: e.id, date: e.at.slice(0, 10), time: e.at.slice(11, 16), meal: e.text, kcal: e.kcal, protein_g: e.p, carbs_g: e.c, fat_g: e.f,
      source: e.src || '', reaction: e.bad ? TOL_LEVELS[e.bad.lvl] : '', symptoms: e.bad ? e.bad.sym.join('; ') : '',
    })),
    set: (rows) => {
      food = rows.map((r) => {
        const e = { id: r.id, at: r.date + 'T' + r.time, text: r.meal, kcal: num(r.kcal), p: num(r.protein_g), c: num(r.carbs_g), f: num(r.fat_g) };
        if (r.source) e.src = r.source;
        const lvl = TOL_LEVELS.indexOf(r.reaction);
        if (lvl > 0) e.bad = { lvl, sym: r.symptoms ? String(r.symptoms).split('; ') : [] };
        return e;
      }).concat(food.filter((e) => e.busy)); // meals still being estimated stay as they are
    },
    order: (a, b) => (a.date + a.time).localeCompare(b.date + b.time),
    show: () => renderFood(),
  },
  weight: {
    tab: 'Weight', cols: ['date', 'weight_kg'], key: 'date',
    get: () => weight.map((w) => ({ date: w.d, weight_kg: w.kg })),
    set: (rows) => { weight = rows.map((r) => ({ d: r.date, kg: num(r.weight_kg) })); },
    order: (a, b) => a.date.localeCompare(b.date),
    show: () => renderFood(),
  },
  poker: {
    tab: 'Poker', cols: ['id', 'date', 'place', 'game', 'result_eur'], key: 'id',
    get: () => poker.map((e) => ({ id: e.id, date: e.d, place: e.place || '', game: e.game || '', result_eur: e.amt })),
    set: (rows) => { poker = rows.map((r) => ({ id: r.id, d: r.date, place: r.place, game: r.game, amt: num(r.result_eur) })); },
    order: (a, b) => a.date.localeCompare(b.date),
    show: () => renderPoker(),
  },
};
const SH_KEYS = Object.keys(SH_SETS); // data set name = name of the local storage key

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
async function shOpen() {
  if (shId && shTabsOk) return shId;
  if (!shId) {
    const q = encodeURIComponent("name='" + SH_TITLE + "' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    const r = await (await driveFetch(DRIVE + '?fields=files(id)&q=' + q)).json();
    shId = r.files && r.files[0] ? r.files[0].id : null;
  }
  if (!shId) {
    const r = await shApi('', Object.assign({ method: 'POST' }, shJson({
      properties: { title: SH_TITLE }, sheets: SH_KEYS.map((k) => ({ properties: { title: SH_SETS[k].tab } })),
    })));
    shId = r.spreadsheetId;
  }
  store.set('shId', shId);
  const meta = await shApi('/' + shId + '?fields=sheets.properties.title');
  const have = (meta.sheets || []).map((s) => s.properties.title);
  const missing = SH_KEYS.filter((k) => !have.includes(SH_SETS[k].tab));
  if (missing.length) await shApi('/' + shId + ':batchUpdate', Object.assign({ method: 'POST' }, shJson({ requests: missing.map((k) => ({ addSheet: { properties: { title: SH_SETS[k].tab } } })) })));
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
  const values = [s.cols].concat(rows.map((r) => s.cols.map((c) => (r[c] === undefined ? '' : r[c]))));
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
  for (const [k, row] of local) if (base[k] !== shText(row, s.cols)) merged.set(k, row);
  for (const k of Object.keys(base)) if (!local.has(k)) merged.delete(k);
  const rows = [...merged.values()].sort(s.order);
  const same = (a, b) => a.length === b.length && a.every((r, i) => shText(r, s.cols) === shText(b[i], s.cols));
  if (!same(rows, [...remote.values()])) await shWriteRows(set, rows);
  shBase[set] = Object.fromEntries(rows.map((r) => [String(r[s.key]), shText(r, s.cols)]));
  store.set('shBase', shBase);
  // show what came from Google, if it differs from what this device has
  if (!same(rows, [...local.values()].sort(s.order)) || rows.length !== local.size) {
    shApplying = true;
    s.set(rows);
    store.set(set, shValue(set));
    shApplying = false;
    s.show();
  }
}

// The current value of a data set, as it is saved in the browser.
function shValue(set) {
  return { tickers: () => tickers, food: () => food, weight: () => weight, poker: () => poker }[set]();
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
  if (shApplying || !SH_SETS[key]) return;
  clearTimeout(shTimer);
  shTimer = setTimeout(shSync, 3000);
}

function shInit() {
  setInterval(() => { if (!document.hidden) shSync(); }, 60000);
  document.addEventListener('visibilitychange', shSync);
  setTimeout(shSync, 2500);
}
