// Fred: steps from Apple Health.
// Put this into a new Google Sheet: Extensions > Apps Script. Change KEY to your own long random word.
// Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone". Copy the /exec link.
// The iPhone Shortcut calls:  <link>?key=KEY&date=2026-01-31&steps=8523   (saves one day)
// Fred calls:                 <link>?key=KEY&days=120                     (reads the last days)

const KEY = 'CHANGE_ME';
const SHEET_ID = ''; // only for a standalone script: the id from the sheet's link (/d/<id>/edit). Leave empty inside a sheet.

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.key !== KEY) return out({ error: 'wrong key' });
  const sh = (SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet()).getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(['date', 'steps', 'updated']);
  if (p.date && p.steps !== undefined) save(sh, String(p.date).trim(), steps(p.steps));
  const n = Math.min(Number(p.days) || 120, 400);
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  const days = rows.map((r) => ({ date: day(r[0]), steps: r[1] })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out({ days: days.slice(-n) });
}

// One row per day: a later call for the same day replaces the number.
function save(sh, date, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || n === null) return;
  const last = sh.getLastRow();
  const dates = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map((r) => day(r[0])) : [];
  const i = dates.indexOf(date);
  const row = i >= 0 ? i + 2 : last + 1;
  sh.getRange(row, 1).setNumberFormat('@');
  sh.getRange(row, 1, 1, 3).setValues([[date, n, new Date()]]);
}

// Steps are whole numbers: "8.523" and "8523,4" both become 8523.
function steps(v) {
  const s = String(v).trim().replace(/[.,]\d{1,2}$/, '').replace(/\D/g, '');
  return s ? parseInt(s, 10) : null;
}

function day(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v); }

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
