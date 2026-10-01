// Fred: steps and sleep from Apple Health.
// Put this into a Google Sheet: Extensions > Apps Script. Change KEY to your own long random word.
// Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone". Copy the /exec link.
// The iPhone Shortcut calls (date is optional, default = today):
//   <link>?key=KEY&steps=8523          saves today's steps
//   <link>?key=KEY&sleep=7.4           saves last night's sleep in hours, on today's date (the wake-up day)
// Fred calls: <link>?key=KEY&days=120  and reads the last days.

const KEY = 'CHANGE_ME';
const TAB = 'fred'; // own tab, created by the script

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.key !== KEY) return out({ error: 'wrong key' });
  const sh = tab();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '').trim()) ? String(p.date).trim() : today();
  const st = whole(p.steps);
  const sl = hours(p.sleep);
  if (st !== null || sl !== null) save(sh, date, st, sl);
  const n = Math.min(Number(p.days) || 120, 400);
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];
  const days = rows.map((r) => ({ date: day(r[0]), steps: r[1] === '' ? null : r[1], sleep: r[2] === '' ? null : r[2] }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out({ days: days.slice(-n) });
}

function tab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TAB);
  if (!sh) { sh = ss.insertSheet(TAB); sh.appendRow(['date', 'steps', 'sleep_h', 'updated']); }
  return sh;
}

// One row per day. A call changes only the value it sends (steps or sleep).
function save(sh, date, st, sl) {
  const last = sh.getLastRow();
  const dates = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map((r) => day(r[0])) : [];
  const i = dates.indexOf(date);
  const row = i >= 0 ? i + 2 : last + 1;
  const old = i >= 0 ? sh.getRange(row, 2, 1, 2).getValues()[0] : ['', ''];
  sh.getRange(row, 1).setNumberFormat('@');
  sh.getRange(row, 1, 1, 4).setValues([[date, st !== null ? st : old[0], sl !== null ? sl : old[1], new Date()]]);
}

// Steps are whole numbers: "8.523" and "8523,4" both become 8523.
function whole(v) {
  if (v === undefined) return null;
  const s = String(v).trim().replace(/[.,]\d{1,2}$/, '').replace(/\D/g, '');
  return s ? parseInt(s, 10) : null;
}

// Sleep in hours with one decimal: "7,4" and "7.43" both work. Over 24 hours makes no sense.
function hours(v) {
  if (v === undefined) return null;
  const n = parseFloat(String(v).trim().replace(',', '.'));
  return n > 0 && n < 24 ? Math.round(n * 10) / 10 : null;
}

function today() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function day(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
