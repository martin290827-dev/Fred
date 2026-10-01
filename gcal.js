'use strict';
/* Google Calendar for Fred.
   Needs your own OAuth Client ID (Settings). The access token lives in memory only, it is never saved.
   Google hands out tokens for one hour, so after that you press "Connect" again. */

// calendar.events: read and write your events. drive.appdata: only Fred's own hidden sync file in your Drive.
// drive.file: only files Fred creates itself (the food and weight sheets), nothing else in your Drive.
const G_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file';
const G_API = 'https://www.googleapis.com/calendar/v3/';
const G_BIRTHDAYS = 'addressbook#contacts@group.v.calendar.google.com'; // Google's contact birthdays
let gToken = null;
let gExpiry = 0;
let gScopes = '';
function gHasDriveScope() { return gScopes.includes('drive.appdata'); }
let gAgenda = []; // upcoming events from Google Calendar

function gHasToken() { return !!gToken && Date.now() < gExpiry - 30000; }
let gEndTimer = null;

// Was connected before, but the one-hour Google session is over.
function gSessionEnded() { return !!googleClientId && !gHasToken() && store.get('gConnected', false); }

function gReconnectRow() {
  return el('li', { class: 'reconnect' },
    el('span', { class: 'grow' }, el('b', null, 'Google session ended'), el('br'), el('span', { class: 'muted small' }, 'Google allows one hour at a time.')),
    el('button', { type: 'button', class: 'small', onclick: gConnect }, 'Reconnect'));
}

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
        gScopes = r.scope || '';
        gExpiry = Date.now() + (parseInt(r.expires_in, 10) || 3600) * 1000;
        store.set('gConnected', true);
        clearTimeout(gEndTimer); // show the Reconnect button the moment the hour is over
        gEndTimer = setTimeout(() => { gStatus('Session ended.'); renderCalendar(); renderEvents(); }, gExpiry - Date.now() - 25000);
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
    // Google's own "Birthdays" calendar (from Google Contacts). Read only; ignored if it does not exist.
    let bdays = [];
    try {
      const b = await gApi('GET', q.replace('calendars/primary/', 'calendars/' + encodeURIComponent(G_BIRTHDAYS) + '/'));
      bdays = (b.items || []).map((i) => Object.assign({}, i, { eventType: 'birthday' }));
    } catch { /* no birthday calendar: fine */ }
    const seenBd = new Set((r.items || []).filter((i) => i.start && i.start.date).map((i) => (i.summary || '') + '|' + i.start.date));
    bdays = bdays.filter((i) => i.start && !seenBd.has((i.summary || '') + '|' + i.start.date)); // no double entries
    gAgenda = (r.items || []).concat(bdays)
      .filter((i) => i.status !== 'cancelled' && i.start)
      .map((i) => ({
        id: i.id,
        title: i.summary || '(no title)',
        allDay: !!i.start.date,
        series: i.recurringEventId || null, // repeating items (birthdays, ...) share this id
        // birthdays from contacts and events of other people cannot be changed here
        birthday: i.eventType === 'birthday',
        readOnly: i.eventType === 'birthday' || i.eventType === 'fromGmail' || (i.organizer && i.organizer.self === false && !i.guestsCanModify),
        start: i.start.date ? new Date(i.start.date + 'T00:00') : new Date(i.start.dateTime),
        end: i.end ? (i.end.date ? new Date(i.end.date + 'T00:00') : new Date(i.end.dateTime)) : null,
      }))
      .filter((e) => !e.end || e.end > now)
      .sort((x, y) => x.start - y.start);
    gAgenda.forEach((e) => { e.multi = !e.allDay && !!e.end && e.end - e.start >= 24 * 3600000 && gLastDay(e) > startOfDay(e.start); }); // timed, but lasts a day or more (an overnight event stays a normal appointment)
    gStatus('Updated ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    gStatus(e.message);
  }
  if (!gUiBusy()) { renderCalendar(); renderEvents(); }
}

// Last day of an item. Google's end is exclusive: all-day ends at midnight after the last day.
function gLastDay(e) {
  if (!e.end) return startOfDay(e.start);
  return startOfDay(new Date(e.end.getTime() - 1));
}

// All-day and multi-day events from Google, shaped for the Events card.
// The end date is kept for counting down, but only the start date is shown.
function gGoogleEvents() {
  const seen = new Set(); // repeating items: only the next date of each series
  return gAgenda.filter((e) => {
    if (!(e.allDay || e.multi)) return false;
    if (!e.series) return true;
    if (seen.has(e.series)) return false;
    seen.add(e.series);
    return true;
  }).map((e) => {
    const last = gLastDay(e);
    const ev = { id: 'g:' + e.id, label: e.title, at: toDateStr(e.start), google: true, src: e };
    if (last > startOfDay(e.start)) ev.to = toDateStr(last);
    return ev;
  });
}

function renderCalendar() {
  const ul = $('cal-list');
  const btn = $('cal-btn');
  const keepScroll = ul.scrollTop;
  ul.replaceChildren();
  if (!googleClientId) {
    btn.hidden = true;
    $('cal-add').hidden = true;
    $('ev-add').hidden = true;
    ul.append(el('li', { class: 'muted' }, 'Add your Google Client ID in Settings to see your calendar.'));
    return;
  }
  btn.hidden = gSessionEnded(); // the Reconnect row below does the job then
  $('cal-add').hidden = !gHasToken();
  $('ev-add').hidden = !gHasToken();
  if (gHasToken()) { btn.className = 'hicon'; btn.setAttribute('aria-label', 'Refresh'); btn.title = 'Refresh'; btn.replaceChildren(refreshIcon()); }
  else { btn.className = 'ghost small'; btn.removeAttribute('aria-label'); btn.title = ''; btn.textContent = 'Connect'; }
  if (!gHasToken()) {
    if (!gSessionEnded()) { ul.append(el('li', { class: 'muted' }, 'Not connected.')); return; }
    ul.append(gReconnectRow()); // the older list stays visible below
    if (!gAgenda.length) return;
  }
  const limit = addDays(new Date(), 30).getTime();
  const now = new Date();
  const list = gAgenda.filter((e) => !e.allDay && !e.multi && e.start.getTime() < limit && (!e.end || e.end > now)).slice(0, 25); // one-day items with a time, next 30 days
  if (!list.length) { ul.append(el('li', { class: 'muted' }, 'Nothing coming up in the next 30 days.')); return; }
  // like the Up Next widget of Apple Calendar: a small header per day, then the items with their times
  let day = '';
  for (const ev of list) {
    const d = toDateStr(ev.start);
    if (d !== day) { day = d; ul.append(el('li', { class: 'dayh' + (dayDiff(d) === 0 ? ' is-today' : '') }, agendaDay(d))); }
    const state = gState(ev, now);
    const li = el('li', { class: 'ag ' + state.cls },
      el('span', { class: 'ag-bar', 'aria-hidden': 'true' }),
      el('span', { class: 'grow ag-main' },
        el('span', { class: 'ag-t' }, ev.title),
        el('span', { class: 'ag-s' }, hhmm(ev.start) + (ev.end ? ' \u2013 ' + hhmm(ev.end) : ''), ev.series ? el('span', { class: 'rep', title: 'Repeats' }, ' \u00b7 \u21bb') : '')),
      state.text ? el('span', { class: 'pill ' + state.cls }, state.text) : '');
    gRowActions(li, ev, 'task');
    ul.append(li);
  }
  ul.scrollTop = keepScroll;
  matchWeatherHeight();
}

function agendaDay(d) {
  const n = dayDiff(d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return new Date(d + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

// 'now' while it runs, 'soon' in the last hour before it starts. Words carry the meaning, colour only helps.
function gState(ev, now) {
  const mins = Math.round((ev.start - now) / 60000);
  if (mins <= 0) return { cls: 'now', text: 'Now' };
  if (mins <= 60) return { cls: 'soon', text: 'in ' + mins + ' min' };
  return { cls: '', text: '' };
}

async function gConnect() {
  try {
    gStatus('Waiting for Google...');
    await gRequestToken('');
    await gRefresh();
    if (typeof syncNow === 'function') syncNow();
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
  store.set('gConnected', false);
  try { if (t && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(t, () => {}); } catch { /* ignore */ }
  gStatus('Disconnected.');
  renderCalendar();
  renderEvents();
}

const gEvPath = (id) => 'calendars/primary/events/' + encodeURIComponent(id);
const gIsGone = (e) => e && (e.status === 404 || e.status === 410);

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
    gRequestToken('none').then(gRefresh).then(() => { if (typeof syncNow === 'function') syncNow(); }).catch(() => { gStatus('Session ended. Press Connect.'); renderCalendar(); });
  }
  setInterval(() => { if (gHasToken()) gRefresh(); }, 5 * 60000);
  setInterval(() => { if (!gUiBusy()) renderCalendar(); }, 60000); // keeps now / soon current between refreshes
  $('cal-add').addEventListener('click', () => gOpenEditor('task', null));
  $('ev-add').addEventListener('click', () => gOpenEditor('event', null));
}

/* ---- Add, edit and delete in Google Calendar (Google is the only copy, Fred keeps none) ----
   'task'  = appointment with a time (Tasks & Reminders card)
   'event' = all-day, optionally several days (Events card)
   Repeating items: change or delete only this one, or the whole series. */
let gEditing = null;   // { kind, item } while the form is open
let gAsking = null;    // id of the row that asks "Delete?"

function gUiBusy() { return !!gEditing || !!gAsking; }

function gEditable(ev) { return gHasToken() && ev && !ev.readOnly; }

function gRowActions(li, ev, kind) {
  if (!gEditable(ev)) return;
  li.append(
    iconButton('edit', 'Edit ' + ev.title, () => gOpenEditor(ev.multi ? 'titleonly' : kind, ev)),
    iconButton('trash', 'Delete ' + ev.title, () => gAskDelete(li, ev)));
}

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
const myZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function gOpenEditor(kind, item) {
  gCloseEditor(false);
  gEditing = { kind, item };
  const box = $(kind === 'event' || (kind === 'titleonly' && item && (item.allDay || item.multi)) ? 'ev-edit' : 'cal-edit');
  const f = el('form', { class: 'gform', autocomplete: 'off' });
  const title = el('input', { type: 'text', name: 'title', placeholder: kind === 'event' ? 'Event' : 'Task or appointment', required: '', maxlength: '120', 'aria-label': 'Title' });
  title.value = item ? item.title : '';
  f.append(title);
  const now = new Date();
  if (kind === 'task') {
    const start = item ? item.start : new Date(Math.ceil(now.getTime() / 3600000) * 3600000); // next full hour
    const end = item && item.end ? item.end : new Date(start.getTime() + 3600000);
    const date = el('input', { type: 'date', name: 'date', required: '', 'aria-label': 'Date' }); date.value = toDateStr(start);
    const from = el('input', { type: 'time', name: 'from', required: '', 'aria-label': 'From' }); from.value = hhmm(start);
    const to = el('input', { type: 'time', name: 'to', 'aria-label': 'Until' }); to.value = hhmm(end);
    const rem = el('select', { name: 'rem', 'aria-label': 'Reminder' });
    for (const [v, t] of (item ? [['keep', 'Reminder: keep']] : []).concat([['default', 'Reminder: calendar default'], ['0', 'Reminder: at start'], ['10', 'Reminder: 10 min before'], ['60', 'Reminder: 1 hour before'], ['none', 'No reminder']])) rem.append(el('option', { value: v }, t));
    f.append(date, el('div', { class: 'time-row' }, from, el('span', { class: 'muted' }, '–'), to), rem);
  } else if (kind === 'event') {
    const first = item ? item.start : now;
    const last = item ? gLastDay(item) : null;
    const date = el('input', { type: 'date', name: 'date', required: '', 'aria-label': 'Date' }); date.value = toDateStr(first);
    const to = el('input', { type: 'date', name: 'to', 'aria-label': 'Until (optional)' });
    if (last && last > startOfDay(first)) to.value = toDateStr(last);
    date.addEventListener('change', () => { to.min = date.value; });
    f.append(el('div', { class: 'grow-row' }, el('label', { class: 'mini' }, 'From', date), el('label', { class: 'mini' }, 'Until (optional)', to)));
  }
  if (!item || !item.series) {
    // new or single items can become repeating (Google keeps the rule)
    const rep = el('select', { name: 'repeat', 'aria-label': 'Repeat' });
    for (const [v, t] of [['', 'Repeat: never'], ['DAILY', 'Repeat: every day'], ['WEEKLY', 'Repeat: every week'], ['MONTHLY', 'Repeat: every month'], ['YEARLY', 'Repeat: every year']]) rep.append(el('option', { value: v }, t));
    f.append(rep);
  }
  if (item && item.series) {
    const one = el('input', { type: 'radio', name: 'scope', value: 'one' }); one.checked = true;
    const all = el('input', { type: 'radio', name: 'scope', value: 'all' });
    const hint = el('span', { class: 'muted small scope-hint' });
    const upd = () => { hint.textContent = all.checked && kind !== 'task' ? 'For the whole series only the title changes.' : all.checked ? 'Title and time change for every date; the dates stay.' : ''; };
    one.addEventListener('change', upd); all.addEventListener('change', upd);
    f.append(el('div', { class: 'scope' }, el('span', { class: 'muted small' }, 'Repeats:'),
      el('label', { class: 'seg' }, one, ' Only this'), el('label', { class: 'seg' }, all, ' All in series')), hint);
  }
  const msg = el('p', { class: 'muted small gform-msg' });
  const save = el('button', { type: 'submit' }, item ? 'Save' : 'Add');
  f.append(el('div', { class: 'row end gform-btns' }, el('button', { type: 'button', class: 'ghost', onclick: () => gCloseEditor(true) }, 'Cancel'), save), msg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    msg.textContent = 'Saving...';
    try {
      await gSave(kind, item, new FormData(f));
      gCloseEditor(true);
      gStatus('Saved.');
      await gRefresh();
    } catch (err) { msg.textContent = err.message; save.disabled = false; }
  });
  f.addEventListener('keydown', (e) => { if (e.key === 'Escape') gCloseEditor(true); });
  box.replaceChildren(f);
  box.hidden = false;
  title.focus();
}

function gCloseEditor(redraw) {
  gEditing = null;
  for (const id of ['cal-edit', 'ev-edit']) { const b = $(id); if (b) { b.replaceChildren(); b.hidden = true; } }
  if (redraw) { renderCalendar(); renderEvents(); }
}

function gReminders(v) {
  if (v === 'keep' || !v) return undefined;
  if (v === 'default') return { useDefault: true };
  if (v === 'none') return { useDefault: false, overrides: [] };
  return { useDefault: false, overrides: [{ method: 'popup', minutes: parseInt(v, 10) }] };
}

async function gSave(kind, item, fd) {
  const summary = String(fd.get('title') || '').trim();
  if (!summary) throw new Error('Please enter a title.');
  const whole = item && item.series && fd.get('scope') === 'all';
  const target = whole ? item.series : item && item.id; // the series master or this one date
  const body = { summary };
  if (kind === 'task') {
    const date = fd.get('date');
    const from = fd.get('from');
    let start = new Date(date + 'T' + from);
    let end = fd.get('to') ? new Date(date + 'T' + fd.get('to')) : null;
    if (end && end <= start) end = new Date(end.getTime() + 86400000); // ends after midnight
    if (!end) end = new Date(start.getTime() + 30 * 60000);
    if (whole) {
      // keep the first date of the series, change only the time of day
      const m = await gApi('GET', gEvPath(item.series));
      const firstDay = m.start.dateTime ? toDateStr(new Date(m.start.dateTime)) : m.start.date;
      const len = end - start;
      start = new Date(firstDay + 'T' + from);
      end = new Date(start.getTime() + len);
    }
    body.start = { dateTime: start.toISOString(), timeZone: myZone() };
    body.end = { dateTime: end.toISOString(), timeZone: myZone() };
    const r = gReminders(fd.get('rem'));
    if (r) body.reminders = r;
  } else if (kind === 'event' && !whole) {
    const at = fd.get('date');
    const to = fd.get('to') && fd.get('to') > at ? fd.get('to') : at;
    body.start = { date: at };
    body.end = { date: toDateStr(addDays(new Date(to + 'T00:00'), 1)) }; // Google's end date is exclusive
  }
  const rule = fd.get('repeat');
  if (rule) body.recurrence = ['RRULE:FREQ=' + rule]; // only offered for new or single items
  if (item) await gApi('PATCH', gEvPath(target), body);
  else await gApi('POST', 'calendars/primary/events', body);
}

// Ask in the row itself (no pop-up). Repeating items: this date or the whole series.
function gAskDelete(li, ev) {
  gAsking = ev.id;
  const done = () => { gAsking = null; renderCalendar(); renderEvents(); };
  const del = async (id, what) => {
    li.replaceChildren(el('span', { class: 'grow muted small' }, 'Deleting ' + what + '...'));
    try {
      await gApi('DELETE', gEvPath(id));
      gStatus('Deleted.');
    } catch (e) { if (!gIsGone(e)) gStatus('Could not delete: ' + e.message); }
    gAsking = null;
    await gRefresh();
    renderCalendar(); renderEvents();
  };
  const btns = ev.series
    ? [el('button', { type: 'button', class: 'small danger', onclick: () => del(ev.id, 'this date') }, 'Only this'),
      el('button', { type: 'button', class: 'small danger', onclick: () => del(ev.series, 'the series') }, 'All')]
    : [el('button', { type: 'button', class: 'small danger', onclick: () => del(ev.id, 'it') }, 'Delete')];
  li.className = 'asking';
  li.replaceChildren(el('span', { class: 'grow' }, 'Delete “' + ev.title + '”?'), ...btns,
    el('button', { type: 'button', class: 'ghost small', onclick: done }, 'Cancel'));
}
