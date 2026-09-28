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
    const q = 'calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=25' +
      '&timeMin=' + encodeURIComponent(startOfDay(now).toISOString()) +
      '&timeMax=' + encodeURIComponent(addDays(now, 30).toISOString());
    const r = await gApi('GET', q);
    gAgenda = (r.items || [])
      .filter((i) => i.status !== 'cancelled' && i.start)
      .map((i) => ({
        id: i.id,
        title: i.summary || '(no title)',
        allDay: !!i.start.date,
        start: i.start.date ? new Date(i.start.date + 'T00:00') : new Date(i.start.dateTime),
        end: i.end ? (i.end.date ? new Date(i.end.date + 'T00:00') : new Date(i.end.dateTime)) : null,
      }))
      .filter((e) => !e.end || e.end > now);
    gNext = gAgenda.find((e) => e.allDay || e.start >= now) || null;
    gStatus('Updated ' + now.toLocaleTimeString('en-GB'));
  } catch (e) {
    gStatus(e.message);
  }
  renderCalendar();
  updateNextUp();
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
  if (!gAgenda.length) { ul.append(el('li', { class: 'muted' }, 'No events in the next 30 days.')); return; }
  for (const ev of gAgenda.slice(0, 8)) {
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

/* ---- Fred -> Google: events (all day) and task reminders ---- */
const gEvPath = (id) => 'calendars/primary/events/' + encodeURIComponent(id);
const gIsGone = (e) => e && (e.status === 404 || e.status === 410);

async function gcalMirrorEvent(ev) {
  if (!gHasToken()) return;
  const body = { summary: ev.label, description: 'Created by Fred', start: { date: ev.at }, end: { date: toDateStr(addDays(new Date(ev.at + 'T00:00'), 1)) } };
  try {
    if (ev.gid) {
      try { await gApi('PATCH', gEvPath(ev.gid), body); } catch (e) { if (!gIsGone(e)) throw e; ev.gid = null; }
    }
    if (!ev.gid) { const r = await gApi('POST', 'calendars/primary/events', body); ev.gid = r.id; }
    store.set('events', events);
    renderEvents();
    gRefresh();
  } catch (e) { banner('Google Calendar: ' + e.message, true); }
}

async function gcalDeleteEvent(ev) {
  if (!ev.gid || !gHasToken()) return;
  try { await gApi('DELETE', gEvPath(ev.gid)); gRefresh(); } catch (e) { if (!gIsGone(e)) banner('Google Calendar: ' + e.message, true); }
}

// A task with a future due time becomes a calendar event with a popup reminder at that time.
// Google then sends the reminder to your phone or computer, even when Fred is closed.
async function gcalSyncTask(t) {
  const want = gSyncTasks && gHasToken() && !t.done && t.due && new Date(t.due) > new Date();
  try {
    if (want && !t.gid) {
      const start = new Date(t.due);
      const r = await gApi('POST', 'calendars/primary/events', {
        summary: (t.urgent ? 'URGENT: ' : '') + t.text,
        description: 'Reminder created by Fred',
        start: { dateTime: start.toISOString() },
        end: { dateTime: new Date(start.getTime() + 15 * 60000).toISOString() },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
      });
      t.gid = r.id;
      saveTasks();
      renderTasks();
      gRefresh();
    } else if (!want && t.gid) {
      const id = t.gid;
      t.gid = null;
      saveTasks();
      try { await gApi('DELETE', gEvPath(id)); } catch (e) { if (!gIsGone(e)) throw e; }
      gRefresh();
    }
  } catch (e) { banner('Google Calendar: ' + e.message, true); }
}

async function gcalPushLocalEvents() {
  for (const ev of events.filter((x) => !x.gid)) await gcalMirrorEvent(ev);
}

function setGoogleSettings(clientId, syncTasks) {
  const changed = clientId !== googleClientId;
  googleClientId = clientId;
  gSyncTasks = syncTasks;
  store.set('googleClientId', googleClientId);
  store.set('gSync', gSyncTasks);
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
