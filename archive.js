'use strict';
/* Hidden history for later analysis. Nothing here is shown in a card.
   The real archive is one JSON file in your Google Drive ("Fred Archiv Daten.json").
   It only grows: an import or a new meal adds or updates rows, it never replaces the
   whole history. Only an explicit delete in Fred removes a row (meals).
   Google Sheets are generated from that JSON, so you can open and analyse them.
   Changes wait in a local queue until Google is connected, so nothing is lost offline.
   Sheet row order: oldest first. */

const ARC_FILE = 'Fred Archiv Daten.json';
const ARC_SHEETS = {
  cycles: 'Fred Archiv Zyklen', sleep: 'Fred Archiv Schlaf', workouts: 'Fred Archiv Training',
  food: 'Fred Archiv Essen', weight: 'Fred Archiv Gewicht',
};
// Fixed columns for our own data; Whoop sets take their columns from the CSV header.
const ARC_COLS = {
  food: ['date', 'time', 'text', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'source', 'id'],
  weight: ['date', 'weight_kg'],
};

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
  const k = set + '\t' + key;
  const h = arcHash(row);
  if (arcSeen[k] === h && !(k in arcQueue)) return; // unchanged since last time
  arcQueue[k] = row;
  arcSeen[k] = h;
}

function arcDelete(set, key) {
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

async function arcWriteJson(id, a) {
  const body = JSON.stringify(a);
  if (id) {
    await driveFetch(DRIVE_UP + '/' + id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    return;
  }
  const b = 'fredarc' + Date.now();
  const multi = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: ARC_FILE, mimeType: 'application/json' }) +
    '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + b + '--';
  await driveFetch(DRIVE_UP + '?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: multi });
}

function arcRows(a, set) {
  const cols = ARC_COLS[set] || a.cols[set] || [];
  const entries = Object.entries(a.sets[set] || {}).map(([key, row]) => [set === 'food' ? row.date + row.time + key : key, row]);
  entries.sort((x, y) => x[0].localeCompare(y[0]));
  return [cols].concat(entries.map(([, row]) => cols.map((c) => (row[c] === undefined ? '' : row[c]))));
}

async function arcFlush() {
  if (arcBusy || (!Object.keys(arcQueue).length && !arcDirty.length)) return;
  if (!gHasToken()) return; // later, when connected
  if (!gScopes.includes('drive.file')) { arcMsg = 'Archive needs one more Google permission: press Connect.'; renderRecovery(); return; }
  arcBusy = true;
  try {
    const snap = Object.assign({}, arcQueue);
    const keys = Object.keys(snap);
    if (keys.length) {
      const id = await arcFindFile();
      const a = await arcReadJson(id);
      for (const k of keys) {
        const [set, key] = k.split('\t');
        a.sets[set] = a.sets[set] || {};
        if (snap[k] === null) delete a.sets[set][key];
        else {
          a.sets[set][key] = snap[k];
          if (!ARC_COLS[set]) { // new columns are added at the end, old ones keep their place
            a.cols[set] = a.cols[set] || [];
            for (const c of Object.keys(snap[k])) if (!a.cols[set].includes(c)) a.cols[set].push(c);
          }
        }
        if (!arcDirty.includes(set)) arcDirty.push(set);
      }
      await arcWriteJson(id, a);
      for (const k of keys) if (JSON.stringify(arcQueue[k]) === JSON.stringify(snap[k])) delete arcQueue[k]; // keep newer changes
      arcSaveQueue();
      arcInfo = { at: Date.now(), counts: Object.fromEntries(Object.keys(ARC_SHEETS).map((s) => [s, Object.keys(a.sets[s] || {}).length])) };
      store.set('arcInfo', arcInfo);
      arcSheetsFrom = a;
    }
    await arcWriteSheets();
    arcMsg = '';
    if (arcNote) arcNote = 'Gespeichert \u2713';
  } catch (e) {
    arcMsg = 'Archive: ' + e.message;
  }
  arcBusy = false;
  renderRecovery();
  if (Object.keys(arcQueue).length) arcSoon(); // something changed while we were saving
}

let arcSheetsFrom = null; // archive as just written; used to build the Sheets

async function arcWriteSheets() {
  if (!arcDirty.length) return;
  const a = arcSheetsFrom || await arcReadJson(await arcFindFile());
  for (const set of [...arcDirty]) {
    await sheetWrite(ARC_SHEETS[set], csv(arcRows(a, set)));
    arcDirty = arcDirty.filter((s) => s !== set);
    arcSaveQueue();
  }
}

/* ---------- status line for the Recovery card ---------- */

const ARC_LABELS = { cycles: 'cycles', sleep: 'sleep', workouts: 'workouts', food: 'food', weight: 'weight' };

function arcStatus() {
  if (arcMsg) return arcMsg;
  if (arcBusy) return 'Saving archive \u2026';
  const open = Object.keys(arcQueue).length;
  const parts = [];
  if (arcNote) parts.push(arcNote);
  if (arcInfo) parts.push('Archive, last saved ' + new Date(arcInfo.at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }) + ': ' + Object.keys(ARC_LABELS).map((s) => ARC_LABELS[s] + ' ' + (arcInfo.counts[s] || 0)).join(' \u00b7 '));
  else parts.push('Archive: nothing saved to Google Drive yet');
  if (open) parts.push(open + ' change' + (open > 1 ? 's' : '') + ' waiting' + (gHasToken() ? '' : ' \u2013 Google is not connected (press Connect)'));
  return parts.join(' \u00b7 ');
}

// Button: save now instead of waiting for the timer.
function arcNow() {
  arcMsg = '';
  arcScan();
  const nothing = !Object.keys(arcQueue).length && !arcDirty.length;
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
