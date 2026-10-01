'use strict';
/* Steps and sleep from Apple Health.
   An iPhone Shortcut sends today's steps and last night's sleep to a small Google Apps Script in your own
   Google account (health-script.gs, see the README). Fred reads them back from that script.
   Without the link you can type the numbers yourself. */

let act = store.get('act', { url: '', stepGoal: 8000, sleepGoal: 7.5 });
let steps = store.get('steps', {}); // date -> steps
let sleepH = store.get('sleep', {}); // date (wake-up day) -> hours
let actMsg = '';
let actAt = 0;

const stepGoal = () => act.stepGoal || 8000;
const sleepGoal = () => act.sleepGoal || 7.5;

// Steps are whole numbers: "8.523" (German thousands) and "8523,4" both become 8523.
function parseSteps(v) {
  const s = String(v).trim().replace(/[.,]\d{1,2}$/, '').replace(/\D/g, '');
  return s ? parseInt(s, 10) : null;
}
// Sleep in hours: "7,5" or "7.5" or "7:30".
function parseSleep(v) {
  const s = String(v).trim().replace(',', '.');
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  const n = m ? parseInt(m[1], 10) + parseInt(m[2], 10) / 60 : parseFloat(s);
  return n > 0 && n < 24 ? Math.round(n * 10) / 10 : null;
}
const fmtHM = (h) => Math.floor(h) + 'h ' + String(Math.round((h % 1) * 60)).padStart(2, '0') + 'm';
const avgVals = (days, map) => { const v = days.map((d) => map[d]).filter((x) => x !== undefined && x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

async function loadActivity(force) {
  if (!act.url) { actMsg = ''; return; }
  if (!force && Date.now() - actAt < 10 * 60000) return;
  actAt = Date.now();
  try {
    const url = act.url + (act.url.includes('?') ? '&' : '?') + 'days=120';
    const res = await fetch(url);
    const j = await res.json().catch(() => { throw new Error('the link does not answer with data. Check the deployment (Anyone).'); });
    if (j.error) throw new Error(j.error);
    let changed = false;
    for (const d of j.days || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
      const st = d.steps === null || d.steps === undefined ? null : parseSteps(d.steps);
      const sl = d.sleep === null || d.sleep === undefined ? null : parseSleep(d.sleep);
      if (st !== null && steps[d.date] !== st) { steps[d.date] = st; changed = true; }
      if (sl !== null && sleepH[d.date] !== sl) { sleepH[d.date] = sl; changed = true; }
    }
    if (changed) { store.set('steps', steps); store.set('sleep', sleepH); }
    actMsg = (j.days || []).length ? 'Apple Health · ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Link works, nothing sent yet.';
  } catch (e) {
    actMsg = 'Apple Health link: ' + e.message;
  }
  if (typeof renderFood === 'function') renderFood();
}

/* ---------- the Health card panel ---------- */

function activityPanel() {
  const today = toDateStr(new Date());
  const last7 = lastDays(7);
  const st = steps[today], sl = sleepH[today];
  const a7s = avgVals(last7, steps), a7l = avgVals(last7, sleepH);
  const tile = (label, value, sub, cls) => el('div', { class: 'kpi ' + (cls || '') }, el('div', { class: 'kpi-l' }, label), el('div', { class: 'kpi-v' }, value), el('div', { class: 'kpi-s' }, sub));
  const kids = [el('div', { class: 'kpis kpis2' },
    tile('Steps today', st !== undefined ? fmtN(st) : '–', 'goal ' + fmtN(stepGoal()), st >= stepGoal() ? 'k-green' : ''),
    tile('Sleep', sl !== undefined ? fmtHM(sl) : '–', 'goal ' + fmtHM(sleepGoal()), sl >= sleepGoal() ? 'k-green' : ''),
    tile('Steps Ø 7d', a7s !== null ? fmtN(a7s) : '–', last7.filter((d) => steps[d] >= stepGoal()).length + ' of 7 at goal'),
    tile('Sleep Ø 7d', a7l !== null ? fmtHM(a7l) : '–', last7.filter((d) => sleepH[d] >= sleepGoal()).length + ' of 7 at goal'))];
  if (!act.url) {
    const s = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'Steps', 'aria-label': 'Steps today', class: 'food-kg act-in' });
    const h = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Sleep h', 'aria-label': 'Sleep last night in hours', class: 'food-kg act-in' });
    const f = el('form', { class: 'food-weight act-manual' }, s, h, el('button', { type: 'submit', class: 'small' }, 'Save'));
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const n = parseSteps(s.value), z = parseSleep(h.value);
      if (n !== null && n < 200000) steps[today] = n;
      if (z !== null) sleepH[today] = z;
      store.set('steps', steps); store.set('sleep', sleepH);
      renderFood();
    });
    kids.push(f, el('p', { class: 'muted small' }, 'Add the Apple Health link in Settings to fill this in by itself.'));
  } else if (actMsg) kids.push(el('p', { class: 'muted small' }, actMsg));
  return hcard('steps', 'green', 'Activity', 'steps and sleep', ...kids);
}

const stepsChart = (days, h) => barChart(days, { raw: (d) => steps[d] || null, target: stepGoal(), unit: 'steps', h, cls: 'b-steps', name: 'Steps', reach: true });
const sleepChart = (days, h) => barChart(days, { raw: (d) => sleepH[d] || null, target: sleepGoal(), unit: 'h', h, cls: 'b-sleep', name: 'Sleep', reach: true, fmt: (v) => fmtHM(v) });

/* ---------- Settings ---------- */
function actFillSettings() {
  $('set-health-url').value = act.url || '';
  $('set-stepgoal').value = act.stepGoal || '';
  $('set-sleepgoal').value = act.sleepGoal || '';
}

function actSaveSettings() {
  const url = $('set-health-url').value.trim();
  const next = { url: /^https:\/\//.test(url) ? url : '', stepGoal: parseSteps($('set-stepgoal').value) || 8000, sleepGoal: parseSleep($('set-sleepgoal').value) || 7.5 };
  if (JSON.stringify(next) === JSON.stringify(act)) return;
  const linkChanged = next.url !== act.url;
  act = next;
  store.set('act', act);
  renderFood();
  if (linkChanged) loadActivity(true);
}

function initActivity() {
  loadActivity(true);
  setInterval(() => { if (!document.hidden) loadActivity(false); }, 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadActivity(false); });
}
