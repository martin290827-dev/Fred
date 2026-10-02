'use strict';
/* History of the raw Whoop exports (cycles, sleep, workouts) for later analysis.
   It is saved in the Google Sheet "Fred Daten" (tabs "Whoop Zyklen", "Schlaf", "Training", see sheets.js).
   It only grows: an import adds or updates rows, it never replaces the whole history.
   Changes wait in a local queue until Google is connected, so nothing is lost offline.
   The old hidden JSON file is read once and copied into the Sheet. */

const ARC_FILE = 'Fred Archiv Daten.json';
const ARC_SHEETS = {
  cycles: 'Fred Archiv Zyklen', sleep: 'Fred Archiv Schlaf', workouts: 'Fred Archiv Training',
  food: 'Fred Archiv Essen', weight: 'Fred Archiv Gewicht', poker: 'Fred Archiv Poker',
};
// Fixed columns for our own data; Whoop sets take their columns from the CSV header.
const ARC_COLS = {
  food: ['date', 'time', 'text', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'source', 'id', 'reaction', 'symptoms'],
  weight: ['date', 'weight_kg'],
  poker: ['date', 'place', 'game', 'result_eur', 'id'],
};

const ARC_OFF = ['food', 'weight', 'poker']; // these live in the Google Sheet now (sheets.js)
let arcQueue = store.get('arcQueue', {});   // { 'set\tkey': row | null (null = delete) }
let arcSeen = store.get('arcSeen', {});     // { 'set\tkey': fingerprint of the row last queued }, to find changes
let arcDirty = store.get('arcDirty', []);   // sets whose Sheet still has to be rewritten
let arcInfo = store.get('arcInfo', null);   // { at, counts } after the last successful save
let arcMsg = '';
let arcNote = ''; // short feedback after pressing the button
let arcBusy = false;
let arcTimer = null;

/* ---------- queue ---------- */

function arcSaveQueue() { store.set('arcQueue', arcQueue); store.set('arcDirty', arcDirty); }

function arcSoon(ms) { clearTimeout(arcTimer); arcTimer = setTimeout(arcFlush, ms === undefined ? 5000 : ms); }

// Short fingerprint of a row, so arcSeen stays small.
function arcHash(row) {
  const t = JSON.stringify(row);
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36) + t.length;
}

function arcPut(set, key, row) {
  if (ARC_OFF.includes(set)) return;
  const k = set + '\t' + key;
  const h = arcHash(row);
  if (arcSeen[k] === h && !(k in arcQueue)) return; // unchanged since last time
  arcQueue[k] = row;
  arcSeen[k] = h;
}

function arcDelete(set, key) {
  if (ARC_OFF.includes(set)) return;
  const k = set + '\t' + key;
  arcQueue[k] = null;
  delete arcSeen[k];
}

function arcCommit() {
  store.set('arcSeen', arcSeen);
  arcSaveQueue();
  arcSoon();
  if (typeof renderRecovery === 'function') renderRecovery();
}

/* ---------- our own data: meals and weight ---------- */

const arcFoodRow = (e) => ({
  date: e.at.slice(0, 10), time: e.at.slice(11, 16), text: e.text, kcal: e.kcal, protein_g: e.p,
  carbs_g: e.c, fat_g: e.f, source: e.src || '', id: e.id,
  reaction: e.bad ? TOL_LEVELS[e.bad.lvl] : '', symptoms: e.bad ? e.bad.sym.join('; ') : '', // flagged meals, for later analysis
});

// Add new and changed meals and weights. Missing entries are NOT treated as deleted:
// a sync that brings an older list must never remove history.
function arcScan() {
  for (const e of food) if (!e.busy && e.at) arcPut('food', e.id, arcFoodRow(e));
  for (const w of weight) arcPut('weight', w.d, { date: w.d, weight_kg: w.kg });
  arcCommit();
}

function arcFoodDeleted(id) { arcDelete('food', id); arcCommit(); }

/* ---------- robust CSV reader (quotes, commas and line breaks inside fields) ---------- */

function arcParseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  if (rows.length < 2) return { header: [], rows: [] };
  const header = rows[0].map((h) => h.trim());
  return { header, rows: rows.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, (cells[i] || '').trim()]))) };
}

/* ---------- save to Google Drive ---------- */

async function arcFindFile() {
  const q = encodeURIComponent("name='" + ARC_FILE + "' and trashed=false");
  const r = await (await driveFetch(DRIVE + '?fields=files(id)&q=' + q)).json();
  return r.files && r.files[0] ? r.files[0].id : null;
}

async function arcReadJson(id) {
  const empty = { v: 1, cols: {}, sets: {} };
  if (!id) return empty;
  const a = await (await driveFetch(DRIVE + '/' + id + '?alt=media')).json();
  return { v: 1, cols: a.cols || {}, sets: a.sets || {} };
}

// One time: copy the Whoop history from the old hidden JSON file into the Sheet.
async function arcMigrate() {
  if (store.get('arcMigrated2', false)) return;
  const id = await arcFindFile();
  if (id) {
    const a = await arcReadJson(id);
    for (const set of ['cycles', 'sleep', 'workouts']) for (const [key, row] of Object.entries(a.sets[set] || {})) { arcQueue[set + '\t' + key] = row; arcSeen[set + '\t' + key] = arcHash(row); } // straight into the queue: arcPut would skip rows it has seen before
    arcCommit();
    // the daily values for the Recovery and Sleep cards come from the cycles, if this device has none
    if (!whoop.length) {
      const byDate = new Map();
      for (const raw of Object.values(a.sets.cycles || {})) {
        const e = rowToEntry((n) => raw[n] || '');
        const old = e && byDate.get(e.d);
        if (e && (!old || (e.sleepMin || 0) >= (old.sleepMin || 0))) byDate.set(e.d, e);
      }
      if (byDate.size) { whoop = [...byDate.values()].sort((x, y) => x.d.localeCompare(y.d)); saveWhoop(); renderRecovery(); }
    }
  }
  store.set('arcMigrated2', true);
}

async function arcFlush() {
  if (arcBusy || (!Object.keys(arcQueue).length && store.get('arcMigrated2', false))) return;
  if (typeof shReady === 'function' && !shReady()) { if (gHasToken()) { arcMsg = 'History needs one more Google permission: press Connect.'; renderRecovery(); } return; } // later, when connected
  arcBusy = true;
  try {
    await arcMigrate();
    const snap = Object.assign({}, arcQueue);
    if (Object.keys(snap).length) await shRawFlush(snap);
    for (const k of Object.keys(snap)) if (JSON.stringify(arcQueue[k]) === JSON.stringify(snap[k])) delete arcQueue[k]; // keep newer changes
    arcSaveQueue();
    arcInfo = { at: Date.now(), counts: await shRawCounts() };
    store.set('arcInfo', arcInfo);
    arcMsg = '';
    if (arcNote) arcNote = 'Gespeichert \u2713';
  } catch (e) {
    arcMsg = 'History: ' + e.message;
  }
  arcBusy = false;
  renderRecovery();
  if (Object.keys(arcQueue).length) arcSoon(); // something changed while we were saving
}

/* ---------- status line for the Recovery card ---------- */

const ARC_LABELS = { cycles: 'cycles', sleep: 'sleep', workouts: 'workouts' };

function arcStatus() {
  if (arcMsg) return arcMsg;
  if (arcBusy) return 'Saving archive \u2026';
  const open = Object.keys(arcQueue).length;
  const parts = [];
  if (arcNote) parts.push(arcNote);
  if (arcInfo) parts.push('History in Google Sheet, last saved ' + new Date(arcInfo.at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }) + ': ' + Object.keys(ARC_LABELS).map((s) => ARC_LABELS[s] + ' ' + (arcInfo.counts[s] || 0)).join(' \u00b7 '));
  else parts.push('History: nothing saved to the Google Sheet yet');
  if (open) parts.push(open + ' change' + (open > 1 ? 's' : '') + ' waiting' + (gHasToken() ? '' : ' \u2013 Google is not connected (press Connect)'));
  return parts.join(' \u00b7 ');
}

// Button: save now instead of waiting for the timer.
function arcNow() {
  arcMsg = '';
  arcScan();
  const nothing = !Object.keys(arcQueue).length;
  arcNote = !gHasToken() ? 'Nicht gespeichert: Google ist nicht verbunden.' : nothing ? 'Nichts Neues: alles ist schon gespeichert.' : 'Speichere \u2026';
  setTimeout(() => { arcNote = ''; renderRecovery(); }, 8000);
  arcFlush();
  renderRecovery();
}

function initArchive() {
  arcScan();
  setTimeout(arcFlush, 4000);
  setInterval(() => { if (!document.hidden) arcFlush(); }, 60000);
}
