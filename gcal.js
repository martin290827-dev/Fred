'use strict';
/* Google Calendar for Fred.
   Needs your own OAuth Client ID (Settings). The access token lives in memory only, it is never saved.
   Google hands out tokens for one hour, so after that you press "Connect" again. */

const G_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const G_API = 'https://www.googleapis.com/calendar/v3/';
let gToken = null;
let gExpiry = 0;
let gAgenda = []; // upcoming events from Google Calendar
let gNext = null; // next event, shown in the header

function gHasToken() { return !!gToken && Date.now() < gExpiry - 30000; }

function gStatus(text) {
  for (const id of ['cal-status', 'g-status']) { const n = $(id); if (n) n.textContent = text; }
}

function gLoadScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the Google sign-in script.'));
    document.head.append(s);
  });
}

// prompt: '' = normal (asks only if needed), 'none' = silent renewal without a window
async function gRequestToken(prompt) {
  if (!googleClientId) throw new Error('Enter your Google Client ID in Settings first.');
  await gLoadScript();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Google did not answer. Press Connect.')), 20000);
    const client = google.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope: G_SCOPE,
      callback: (r) => {
        clearTimeout(timer);
        if (r.error) { reject(new Error(r.error_description || r.error)); return; }
        gToken = r.access_token;
        gExpiry = Date.now() + (parseInt(r.expires_in, 10) || 3600) * 1000;
        store.set('gConnected', true);
        resolve();
      },
      error_callback: (err) => { clearTimeout(timer); reject(new Error(err && err.type ? err.type : 'sign-in cancelled')); },
    });
    client.requestAccessToken({ prompt });
  });
}

async function gApi(method, path, body) {
  if (!gHasToken()) await gRequestToken('none');
  const res = await fetch(G_API + path, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + gToken }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { gToken = null; renderCalendar(); throw Object.assign(new Error('Google session ended. Press Connect.'), { status: 401 }); }
  if (res.status === 204) return null;
  const j = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((j && j.error && j.error.message) || 'Google error ' + res.status), { status: res.status });
  return j;
}

async function gRefresh() {
  if (!gHasToken()) { renderCalendar(); return; }
  try {
    const now = new Date();
    const q = 'calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=250' + // a full year ahead, so far-away trips show up under Events
      '&timeMin=' + encodeURIComponent(startOfDay(now).toISOString()) +
      '&timeMax=' + encodeURIComponent(addDays(now, 365).toISOString());
    const r = await gApi('GET', q);
    gAgenda = (r.items || [])
      .filter((i) => i.status !== 'cancelled' && i.start)
      .map((i) => ({
        id: i.id,
        title: i.summary || '(no title)',
        allDay: !!i.start.date,
        recurring: !!i.recurringEventId, // repeating items stay out of Events
        start: i.start.date ? new Date(i.start.date + 'T00:00') : new Date(i.start.dateTime),
        end: i.end ? (i.end.date ? new Date(i.end.date + 'T00:00') : new Date(i.end.dateTime)) : null,
      }))
      .filter((e) => !e.end || e.end > now);
    gAgenda.forEach((e) => { e.multi = !e.allDay && !!e.end && e.end - e.start >= 24 * 3600000 && gLastDay(e) > startOfDay(e.start); }); // timed, but lasts a day or more (an overnight event stays a normal appointment)
    gNext = gAgenda.find((e) => !e.allDay && !e.multi && e.start >= now) || null; // all-day and multi-day items are listed under Events
    gStatus('Updated ' + now.toLocaleTimeString('en-GB'));
  } catch (e) {
    gStatus(e.message);
  }
  renderCalendar();
  renderEvents();
}

// Last day of an item. Google's end is exclusive: all-day ends at midnight after the last day.
function gLastDay(e) {
  if (!e.end) return startOfDay(e.start);
  return startOfDay(new Date(e.end.getTime() - 1));
}

// All-day and multi-day events from Google, shaped for the Events card.
// The end date is kept for counting down, but only the start date is shown.
function gGoogleEvents() {
  return gAgenda.filter((e) => (e.allDay || e.multi) && !e.recurring).map((e) => {
    const last = gLastDay(e);
    const ev = { id: 'g:' + e.id, label: e.title, at: toDateStr(e.start), google: true };
    if (last > startOfDay(e.start)) ev.to = toDateStr(last);
    return ev;
  });
}

function renderCalendar() {
  const ul = $('cal-list');
  const btn = $('cal-btn');
  ul.replaceChildren();
  if (!googleClientId) {
    btn.hidden = true;
    ul.append(el('li', { class: 'muted' }, 'Add your Google Client ID in Settings to see your calendar.'));
    return;
  }
  btn.hidden = false;
  btn.textContent = gHasToken() ? 'Refresh' : 'Connect';
  if (!gHasToken()) { ul.append(el('li', { class: 'muted' }, 'Not connected.')); return; }
  const limit = addDays(new Date(), 30).getTime();
  const list = gAgenda.filter((e) => !e.allDay && !e.multi && e.start.getTime() < limit).slice(0, 25); // one-day items with a time, next 30 days
  if (!list.length) { ul.append(el('li', { class: 'muted' }, 'Nothing coming up in the next 30 days.')); return; }
  for (const ev of list) {
    ul.append(el('li', null,
      el('span', { class: 'grow' }, ev.title),
      el('span', { class: 'muted small' }, fmtDue({ due: toLocalISO(ev.start), allDay: ev.allDay }))));
  }
}

async function gConnect() {
  try {
    gStatus('Waiting for Google...');
    await gRequestToken('');
    await gRefresh();
  } catch (e) {
    gStatus(e.message);
    renderCalendar();
  }
}

function gDisconnect() {
  const t = gToken;
  gToken = null;
  gExpiry = 0;
  gAgenda = [];
  gNext = null;
  store.set('gConnected', false);
  try { if (t && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(t, () => {}); } catch { /* ignore */ }
  gStatus('Disconnected.');
  renderCalendar();
  updateNextUp();
}

function setGoogleSettings(clientId) {
  const changed = clientId !== googleClientId;
  googleClientId = clientId;
  store.set('googleClientId', googleClientId);
  if (changed || !googleClientId) gDisconnect();
  renderCalendar();
}

function gcalInit() {
  $('cal-btn').addEventListener('click', () => (gHasToken() ? gRefresh() : gConnect()));
  $('g-connect').addEventListener('click', () => {
    googleClientId = $('set-gclient').value.trim();
    store.set('googleClientId', googleClientId);
    gConnect();
  });
  $('g-disconnect').addEventListener('click', gDisconnect);
  renderCalendar();
  if (googleClientId && store.get('gConnected', false)) {
    gRequestToken('none').then(gRefresh).catch(() => { gStatus('Session ended. Press Connect.'); renderCalendar(); });
  }
  setInterval(() => { if (gHasToken()) gRefresh(); }, 5 * 60000);
}
