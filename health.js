'use strict';
/* Activity: steps from Apple Health, strength training days and a weekly review.
   Steps travel like this: an iPhone Shortcut reads today's steps from Apple Health and sends them
   to a small Google Apps Script in your own Google account (see health-script.gs and the README).
   Fred reads them back from that script. Without the link you can type your steps yourself. */

let health = store.get('health', { url: '', stepGoal: 8000, trainGoal: 3 });
let steps = store.get('steps', {}); // date -> steps
let training = store.get('training', []); // dates with strength training
let healthMsg = '';
let healthAt = 0;

const stepGoal = () => health.stepGoal || 8000;
const trainGoal = () => health.trainGoal || 3;

// Steps are whole numbers. "8.523" (German thousands) and "8523,4" both become 8523.
function parseSteps(v) {
  const s = String(v).trim().replace(/[.,]\d{1,2}$/, '').replace(/\D/g, '');
  return s ? parseInt(s, 10) : null;
}

async function loadSteps(force) {
  if (!health.url) { healthMsg = ''; return; }
  if (!force && Date.now() - healthAt < 10 * 60000) return;
  healthAt = Date.now();
  try {
    const url = health.url + (health.url.includes('?') ? '&' : '?') + 'days=120';
    const res = await fetch(url);
    const j = await res.json().catch(() => { throw new Error('the link does not answer with data. Check the deployment (Anyone).'); });
    if (j.error) throw new Error(j.error);
    let changed = false;
    for (const d of j.days || []) {
      const v = parseSteps(d.steps);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d.date) && v !== null && steps[d.date] !== v) { steps[d.date] = v; changed = true; }
    }
    if (changed) store.set('steps', steps);
    healthMsg = (j.days || []).length ? 'Apple Health · ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Link works, no steps sent yet.';
  } catch (e) {
    healthMsg = 'Apple Health link: ' + e.message;
  }
  renderActivity();
}

/* ---------- numbers ---------- */

// Monday of the week that contains d (as a date string).
function weekStart(d) {
  const x = new Date(d + 'T00:00');
  return toDateStr(addDays(x, -((x.getDay() + 6) % 7)));
}

function weekDays(start) { return [0, 1, 2, 3, 4, 5, 6].map((i) => toDateStr(addDays(new Date(start + 'T00:00'), i))); }

function isoWeek(d) {
  const x = new Date(d + 'T00:00');
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7)); // Thursday of this week
  const jan4 = new Date(x.getFullYear(), 0, 4);
  return 1 + Math.round(((x - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

function avgOf(vals) { return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; }

// One week in numbers. Only days up to today count.
function weekSummary(start) {
  const today = toDateStr(new Date());
  const days = weekDays(start).filter((d) => d <= today);
  const tg = targets();
  const st = days.map((d) => steps[d]).filter((v) => v !== undefined);
  const fed = days.map(dayTotals).filter((t) => t.n);
  const withMacros = fed.filter((t) => !t.m);
  const end = weightOn(days[days.length - 1]);
  const before = weightOn(toDateStr(addDays(new Date(start + 'T00:00'), -1)));
  return {
    start, days: days.length,
    steps: avgOf(st), stepDays: st.filter((v) => v >= stepGoal()).length, stepLogged: st.length,
    kcal: avgOf(fed.map((t) => t.kcal)),
    protein: tg.p ? withMacros.filter((t) => t.p >= tg.p * RANGES.p[0]).length : null, proteinOf: withMacros.length,
    train: training.filter((d) => days.includes(d)).length,
    kg: end && before && end.d > before.d ? end.kg - before.kg : null,
  };
}

/* ---------- pieces ---------- */

function stepsChart(days) {
  const W = 600, H = 130, L = 46, B = 18, T = 8;
  const goal = stepGoal();
  const max = Math.max(goal, ...days.map((d) => steps[d] || 0)) * 1.12;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const bw = (W - L) / days.length;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'fchart schart', role: 'img', 'aria-label': 'Steps per day, last ' + days.length + ' days' });
  const mid = Math.round(goal / 2 / 1000) * 1000;
  svg.append(svgEl('line', { x1: L, x2: W, y1: y(mid), y2: y(mid), class: 'grid' }), svgEl('text', { x: L - 6, y: y(mid) + 4, class: 'ax', 'text-anchor': 'end' }, fmtN(mid)));
  days.forEach((d, i) => {
    const v = steps[d];
    const x = L + i * bw + 2;
    const w = Math.max(2, bw - 4);
    const g = svgEl('g', { class: 'bar' + (i === days.length - 1 ? ' today' : '') + (v >= goal ? ' hit' : '') });
    g.append(svgEl('title', {}, shortDay(d) + ': ' + (v !== undefined ? fmtN(v) + ' steps' : 'no data')));
    g.append(svgEl('rect', { x: L + i * bw, y: T, width: bw, height: H - T - B, class: 'hit' }));
    if (v) g.append(svgEl('rect', { x, y: y(v), width: w, height: Math.max(1, y(0) - y(v)), rx: Math.min(4, w / 2) }));
    svg.append(g);
    if ((days.length - 1 - i) % 7 === 0) {
      const last = i === days.length - 1;
      svg.append(svgEl('text', { x: last ? x + w : x + w / 2, y: H - 4, class: 'ax', 'text-anchor': last ? 'end' : 'middle' }, last ? 'today' : shortDay(d)));
    }
  });
  svg.append(svgEl('line', { x1: L, x2: W, y1: y(goal), y2: y(goal), class: 'tgt' }), svgEl('text', { x: L - 6, y: y(goal) + 4, class: 'ax tgtlbl', 'text-anchor': 'end' }, fmtN(goal)));
  return svg;
}

function stepsBlock() {
  const today = toDateStr(new Date());
  const v = steps[today];
  const last7 = lastDays(7);
  const avg7 = avgOf(last7.map((d) => steps[d]).filter((x) => x !== undefined));
  const hit7 = last7.filter((d) => steps[d] >= stepGoal()).length;
  const hero = el('div', { class: 'food-hero' },
    el('div', { class: 'ring-wrap' }, ring(v || 0, stepGoal(), 'r-steps', 128, 14),
      el('div', { class: 'ring-mid' }, el('div', { class: 'ring-num steps-num' }, v !== undefined ? fmtN(v) : '–'), el('div', { class: 'ring-cap' }, 'steps'))),
    el('div', { class: 'hero-stats' },
      hstat('Goal', fmtN(stepGoal()) + ' steps'),
      hstat('7-day average', avg7 !== null ? fmtN(avg7) : '–'),
      hstat('Goal reached', hit7 + ' of 7 days', hit7 >= 5 ? 'good' : '')));
  const extra = [];
  if (!health.url) {
    const inp = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'Steps', 'aria-label': 'Steps today', class: 'food-kg steps-in' });
    const f = el('form', { class: 'food-weight act-manual' }, el('span', { class: 'grow muted small' }, 'Link Apple Health in Settings to fill this in by itself, or type it:'), inp, el('button', { type: 'submit', class: 'small' }, 'Save'));
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const n = parseSteps(inp.value);
      if (n === null || n > 200000) return;
      steps[today] = n;
      store.set('steps', steps);
      renderActivity();
    });
    extra.push(f);
  }
  return [hero, panel('Steps · last 14 days', stepsChart(lastDays(14)), ...extra)];
}

function trainingBlock() {
  const today = toDateStr(new Date());
  const days = weekDays(weekStart(today));
  const done = training.filter((d) => days.includes(d)).length;
  const row = el('div', { class: 'train-week' }, ...days.map((d) => {
    const on = training.includes(d);
    const future = d > today;
    const b = el('button', {
      type: 'button', class: 'train-day' + (on ? ' on' : '') + (d === today ? ' is-today' : ''),
      'aria-pressed': on ? 'true' : 'false', 'aria-label': 'Strength training on ' + shortDay(d),
      onclick: () => {
        training = on ? training.filter((x) => x !== d) : training.concat(d).sort();
        store.set('training', training);
        renderActivity();
      },
    }, el('span', { class: 'train-dot' }, on ? '✓' : ''), el('span', { class: 'train-l' }, new Date(d + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)));
    if (future) b.disabled = true;
    return b;
  }));
  const status = done >= trainGoal() ? 'Weekly goal reached.' : (trainGoal() - done) + ' to go.';
  return panel('Strength training',
    el('div', { class: 'train-head' }, el('span', { class: 'goal-num' }, String(done)), el('span', { class: 'goal-of' }, ' of ' + trainGoal() + ' this week · ' + status)),
    row,
    el('p', { class: 'muted small goal-line' }, 'Tap a day to mark it. Training keeps your muscles while you lose weight.'));
}

function chip(text, st) { return el('span', { class: 'wchip ' + (st || '') }, text); }

function reviewBlock() {
  const today = toDateStr(new Date());
  const tg = targets();
  const weeks = [0, 1, 2, 3].map((i) => weekSummary(toDateStr(addDays(new Date(weekStart(today) + 'T00:00'), -7 * i))));
  const rows = weeks.map((w, i) => {
    const chips = [];
    if (w.kg !== null) chips.push(chip((w.kg > 0.05 ? '+' : w.kg < -0.05 ? '−' : '±') + fmtKg(Math.abs(w.kg)) + ' kg', w.kg < -0.05 ? 'ok' : w.kg > 0.05 ? 'high' : ''));
    if (w.steps !== null) chips.push(chip('Ø ' + fmtN(w.steps) + ' steps', w.steps >= stepGoal() ? 'ok' : 'low'));
    if (w.kcal !== null) chips.push(chip('Ø ' + fmtN(w.kcal) + ' kcal', macroStatus('kcal', w.kcal, tg.kcal)));
    if (w.protein !== null && w.proteinOf) chips.push(chip('Protein ' + w.protein + '/' + w.proteinOf + ' days', w.protein >= w.proteinOf * 0.7 ? 'ok' : 'low'));
    chips.push(chip(w.train + '× training', w.train >= trainGoal() ? 'ok' : i === 0 && w.days < 7 ? '' : 'low'));
    const label = i === 0 ? 'This week' : i === 1 ? 'Last week' : 'Week ' + isoWeek(w.start);
    return el('div', { class: 'wrow' },
      el('div', { class: 'wrow-h' }, el('span', { class: 'nbar-l' }, label), el('span', { class: 'muted small' }, shortDay(w.start) + ' – ' + shortDay(toDateStr(addDays(new Date(w.start + 'T00:00'), 6))))),
      el('div', { class: 'wchips' }, ...chips));
  });
  return panel('Weekly review', ...rows, el('div', { class: 'muted small mg-key' }, 'Green = on track · orange = below goal · red = too high'));
}

/* ---------- card ---------- */

function renderActivity() {
  const box = $('activity');
  if (!box) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // typing
  const [hero, stepsPanel] = stepsBlock();
  box.replaceChildren(
    el('div', { class: 'food-col' }, hero, stepsPanel),
    el('div', { class: 'food-col' }, trainingBlock(), reviewBlock()));
  $('act-status').textContent = healthMsg;
}

/* ---------- Settings ---------- */
function healthFillSettings() {
  $('set-health-url').value = health.url || '';
  $('set-stepgoal').value = health.stepGoal || '';
  $('set-traingoal').value = health.trainGoal || '';
}

function healthSaveSettings() {
  const url = $('set-health-url').value.trim();
  const next = {
    url: /^https:\/\//.test(url) ? url : '',
    stepGoal: parseSteps($('set-stepgoal').value) || 8000,
    trainGoal: Math.min(14, parseInt($('set-traingoal').value, 10) || 3),
  };
  if (JSON.stringify(next) !== JSON.stringify(health)) {
    const linkChanged = next.url !== health.url;
    health = next;
    store.set('health', health);
    renderActivity();
    if (linkChanged) loadSteps(true);
  }
}

function initActivity() {
  renderActivity();
  loadSteps(true);
  setInterval(() => { if (!document.hidden) { loadSteps(false); renderActivity(); } }, 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadSteps(false); });
}
