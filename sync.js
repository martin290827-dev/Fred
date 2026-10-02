'use strict';
/* Sync between your devices through Google Drive.
   Fred keeps one small file in the hidden "app data" folder of your own Google Drive.
   Only Fred can see that folder; your other Drive files stay invisible to it.
   Every setting carries the time of its last change; the newer value wins. */

const SYNC_KEYS = ['place', 'place2', 'tickers', 'zones', 'shop', 'notes', 'fxDefault', 'layout', 'finnhubKey', 'twelveKey', 'googleClientId', 'food', 'weight', 'nutri', 'whoop', 'tips', 'tolerance', 'poker', 'anthropicKey'];
const SYNC_FILE = 'fred-sync.json';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3/files';

let syncMeta = store.get('syncMeta', {}); // key -> time of the last change on this device
let syncFileId = store.get('syncFileId', null);
let syncApplying = false;
let syncTimer = null;
let syncBusy = false;
let syncAgain = false;

function syncOn() { return store.get('syncOn', true); }
function syncReady() { return syncOn() && typeof gHasToken === 'function' && gHasToken() && gHasDriveScope(); }

function syncStatus(text) { const n = $('sync-status'); if (n) n.textContent = text; }

// Called by store.set: remember when a setting changed here, and send it a few seconds later.
function syncTouch(key) {
  if (syncApplying || !SYNC_KEYS.includes(key)) return;
  syncMeta[key] = Date.now();
  store.set('syncMeta', syncMeta);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 3000);
}

async function driveFetch(url, opts = {}) {
  const res = await fetch(url, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + gToken }, opts.headers || {}),
  }));
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw Object.assign(new Error((j && j.error && j.error.message) || 'Drive error ' + res.status), { status: res.status });
  }
  return res;
}

async function syncFindFile() {
  const q = encodeURIComponent("name='" + SYNC_FILE + "'");
  const r = await (await driveFetch(DRIVE + '?spaces=appDataFolder&fields=files(id)&q=' + q)).json();
  return r.files && r.files[0] ? r.files[0].id : null;
}

async function syncRead() {
  if (!syncFileId) { syncFileId = await syncFindFile(); store.set('syncFileId', syncFileId); }
  if (!syncFileId) return null;
  try {
    return await (await driveFetch(DRIVE + '/' + syncFileId + '?alt=media')).json();
  } catch (e) {
    if (e.status === 404) { syncFileId = null; store.set('syncFileId', null); return null; }
    throw e;
  }
}

async function syncWrite(data) {
  const body = JSON.stringify(data);
  if (syncFileId) {
    await driveFetch(DRIVE_UP + '/' + syncFileId + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    return;
  }
  const b = 'fred' + Date.now();
  const meta = { name: SYNC_FILE, parents: ['appDataFolder'], mimeType: 'application/json' };
  const multi = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
    '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + b + '--';
  const r = await (await driveFetch(DRIVE_UP + '?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: multi,
  })).json();
  syncFileId = r.id;
  store.set('syncFileId', syncFileId);
}

// Read the file, take what is newer there, send what is newer here.
async function syncNow() {
  clearTimeout(syncTimer);
  if (!syncReady()) {
    // say plainly why nothing happens
    if (!syncOn()) syncStatus('Sync is off on this device.');
    else if (!googleClientId) syncStatus('Not synced: enter the Google Client ID above, Save, then Connect.');
    else if (!gHasToken()) syncStatus('Not synced: Google is not connected on this device. Press Connect.');
    else if (!gHasDriveScope()) syncStatus('Not synced: Drive access missing. Press Connect and allow access to app data.');
    return;
  }
  if (syncBusy) { syncAgain = true; return; }
  syncBusy = true;
  try {
    const remote = (await syncRead()) || { v: 1, keys: {} };
    const rk = remote.keys || {};
    const out = { v: 1, keys: {} };
    const applied = [];
    let push = !syncFileId;
    for (const k of SYNC_KEYS) {
      const lt = syncMeta[k] || 0;
      const lv = store.get(k, undefined);
      const r = rk[k];
      if (r && r.t >= lt) {
        if (JSON.stringify(r.v) !== JSON.stringify(lv)) {
          syncApplying = true;
          store.set(k, r.v);
          syncApplying = false;
          applied.push(k);
        }
        syncMeta[k] = r.t;
        out.keys[k] = r;
      } else if (lv !== undefined) {
        out.keys[k] = { t: lt, v: lv };
        push = true;
      }
    }
    store.set('syncMeta', syncMeta);
    if (push) { out.t = Date.now(); await syncWrite(out); }
    if (applied.length) syncApply(applied);
    syncStatus('Synced ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) +
      (applied.length ? ' · updated ' + applied.length : ''));
  } catch (e) {
    syncStatus('Sync: ' + e.message);
  } finally {
    syncApplying = false;
    syncBusy = false;
    if (syncAgain) { syncAgain = false; syncNow(); }
  }
}

// Bring values that came from the other device into the running app.
function syncApply(keys) {
  const has = (k) => keys.includes(k);
  if (has('place') || has('place2')) { place = store.get('place', null); place2 = store.get('place2', null); loadWeather(); }
  if (has('zones')) { zones = store.get('zones', zones); renderClocks(); }
  if (has('shop')) { shop = store.get('shop', []); renderShop(); }
  if (has('notes')) {
    const box = $('notes');
    if (document.activeElement !== box) box.value = store.get('notes', '');
    else {
      // you are typing: show the newer text when you leave the field, unless you changed something meanwhile
      const shown = box.value;
      box.addEventListener('blur', () => { if (box.value === shown) box.value = store.get('notes', ''); }, { once: true });
    }
  }
  if (has('fxDefault')) fxDefault = store.get('fxDefault', fxDefault);
  if (has('layout')) { layout = store.get('layout', layout); applyLayout(); }
  if (has('googleClientId')) googleClientId = store.get('googleClientId', googleClientId);
  if (has('anthropicKey')) anthropicKey = store.get('anthropicKey', '');
  if (has('poker') && typeof renderPoker === 'function') { poker = store.get('poker', []); pokerArchive(); renderPoker(); }
  if (has('food') || has('weight') || has('nutri') || has('tips')) { food = store.get('food', []); weight = store.get('weight', []); nutri = store.get('nutri', nutri); tips = store.get('tips', tips); arcScan(); renderFood(); }
  if (has('finnhubKey')) finnhubKey = store.get('finnhubKey', '');
  if (has('twelveKey')) twelveKey = store.get('twelveKey', '');
  if (has('tickers') || has('finnhubKey') || has('twelveKey')) {
    tickers = store.get('tickers', []);
    loadQuotes();
    earn.t = 0;
    loadEarnings();
    loadNews(true);
  }
}

function syncInit() {
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);
  document.addEventListener('visibilitychange', () => { syncNow(); }); // back to Fred: fetch; leaving: send
  $('sync-now').addEventListener('click', syncNow);
  $('set-sync').checked = syncOn();
  $('set-sync').addEventListener('change', () => { store.set('syncOn', $('set-sync').checked); syncStatus(syncOn() ? '' : 'Sync is off on this device.'); syncNow(); });
}
