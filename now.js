'use strict';
/* Card "Now": the few things that matter right now, one sentence each (plain rules, no AI, no cost).
   Card "Patterns": simple comparisons between sleep, food and weight (needs weeks of data).
   Reads data from the other files; nothing is stored here. */

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sign = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);

/* ---------- Now ---------- */
function nowNext() {
  const now = new Date(), today = toDateStr(now);
  for (const it of gAgendaItems()) {
    const e = it.task;
    if (e) {
      if ((e.end || e.start) <= now) continue;
      const st = gState(e, now);
      return { value: e.title, text: st.cls === 'now' ? 'Now' : st.text || agendaDay(it.day) + ', ' + hhmm(e.start) };
    }
    if (it.day >= today) return { value: it.event.label, text: agendaDay(it.day) + ', all day' };
  }
  return { value: 'Nothing planned', text: gHasToken() || gAgenda.length ? 'No appointments in the next 30 days.' : 'Connect Google in Tasks & Events to see appointments.' };
}

function nowFood() {
  const t = dayTotals(toDateStr(new Date())), g = targets();
  const left = g.kcal - t.kcal;
  const value = !t.n ? fmtN(g.kcal) + ' kcal left' : left >= 0 ? fmtN(left) + ' kcal left' : fmtN(-left) + ' kcal over';
  let text;
  if (!t.n) text = 'Nothing logged yet today.';
  else if (!g.p) text = 'Enter your weight in Weight & Goal to get a protein target.';
  else if (t.m) text = 'Some meals have no protein value yet.';
  else if (g.p - t.p > 5) text = 'Protein: ' + round5(g.p - t.p) + ' g still to go.';
  else text = 'Protein target reached.';
  return { value, text };
}

function nowBody() {
  const rows = computeScores([...whoop].sort((a, b) => a.d.localeCompare(b.d)));
  const r = [...rows].reverse().find((x) => x.score != null);
  if (!r) return { value: '–', text: whoop.length ? 'Not enough nights for a baseline yet.' : 'Import a Whoop CSV in the Recovery card.' };
  const age = -dayDiff(r.d);
  const advice = { low: 'Take it easy today.', mid: 'A normal day should be fine.', high: 'A good day for hard training.' }[scoreBand(r.score)];
  const debt = r.sleepDebtMin >= 30 ? ' Sleep debt ' + rcHmShort(r.sleepDebtMin) + '.' : '';
  const old = age > 3 ? 'Last data is ' + age + ' days old. ' : '';
  return { value: r.score + ' / 100', text: old + advice + debt };
}

function nowMarkets() {
  const list = tickers.map((s) => ({ s, p: lastQuotes[s] && lastQuotes[s].pct })).filter((x) => typeof x.p === 'number');
  if (!list.length) return { value: '–', text: tickers.length ? 'Loading prices...' : 'Add tickers in the Tickers card.' };
  const big = list.reduce((a, b) => (Math.abs(b.p) > Math.abs(a.p) ? b : a));
  const up = list.filter((x) => x.p > 0).length, down = list.filter((x) => x.p < 0).length;
  return { value: tickerLabel(big.s) + ' ' + sign(big.p, 1) + '%', cls: big.p >= 0 ? 'up' : 'down', text: 'Biggest move today. ' + up + ' up, ' + down + ' down of ' + list.length + '.' };
}

/* Extra lines (shown on the desktop only): [label, value, class] */
const nowLine = (l, v, cls) => ({ l, v, cls: cls || '' });

function nowNextMore() {
  const now = new Date(), out = [];
  for (const it of gAgendaItems()) {
    const e = it.task;
    if (e && (e.end || e.start) <= now) continue;
    if (!e && it.day < toDateStr(now)) continue;
    out.push(e ? nowLine(e.title, agendaDay(it.day) + ' ' + hhmm(e.start)) : nowLine(it.event.label, agendaDay(it.day)));
    if (out.length === 4) break;
  }
  return out.slice(1); // the first one is the headline
}

function nowFoodMore() {
  const t = dayTotals(toDateStr(new Date())), g = targets(), out = [];
  const add = (name, v, goal, unit) => { if (goal) out.push(nowLine(name, Math.round(v) + ' / ' + goal + ' ' + unit, v > goal ? 'over' : '')); };
  add('Protein', t.p, g.p, 'g'); add('Carbs', t.c, g.c, 'g'); add('Fat', t.f, g.f, 'g'); add('Sugar', t.s, g.s, 'g');
  const gi = goalInfo();
  if (gi) out.push(nowLine('Weight', fmtKg(gi.cur) + ' kg', ''), nowLine('Goal', fmtKg(gi.goal) + ' kg', ''));
  return nowFits(t, g).concat(out);
}

// From 14:00: your own earlier meals that still fit today, so you decide before you eat (no AI)
function nowFits(t, g) {
  if (new Date().getHours() < 14 || !t.n) return [];
  const left = g.kcal - t.kcal;
  if (left < 150) return [nowLine('Rest of today', left < 0 ? 'already over, nothing more needed' : 'nothing more needed', left < 0 ? 'over' : '')];
  const ideas = mealIdeas(left, 3);
  return ideas.length ? [nowLine('Still fits today (most protein first)', '', '')].concat(ideas.map((e) => nowLine(e.text, fmtN(e.kcal) + ' kcal · ' + Math.round(e.p) + ' g P', 'fit'))) : [];
}

function nowBodyMore() {
  const rows = computeScores([...whoop].sort((a, b) => a.d.localeCompare(b.d)));
  const r = [...rows].reverse().find((x) => x.score != null), out = [];
  if (!r) return out;
  if (r.hrv != null) out.push(nowLine('HRV', r.hrv + ' ms' + (r.baseHrv ? ' (usual ' + r.baseHrv + ')' : '')));
  if (r.rhr != null) out.push(nowLine('Resting HR', r.rhr + ' bpm' + (r.baseRhr ? ' (usual ' + r.baseRhr + ')' : '')));
  if (r.sleepMin != null) out.push(nowLine('Sleep', rcHmShort(r.sleepMin)));
  out.push(nowLine('Data from', rcShort(r.d)));
  return out;
}

function nowMarketsMore() {
  const list = tickers.map((s) => ({ s, p: lastQuotes[s] && lastQuotes[s].pct })).filter((x) => typeof x.p === 'number');
  list.sort((a, b) => Math.abs(b.p) - Math.abs(a.p));
  return list.slice(1, 5).map((x) => nowLine(tickerLabel(x.s), sign(x.p, 1) + '%', x.p >= 0 ? 'up' : 'down'));
}

function nowGo(id) {
  if (tabOf(id) !== activeTab) setTab(tabOf(id));
  requestAnimationFrame(() => jumpTo($(id)));
}

// What is still open today (only shown when there is something)
function nowOpen() {
  const now = new Date(), today = toDateStr(now), list = [];
  let go = 'card-food'; // the card the row opens (the last open item wins)
  // once a week is enough for both
  const lastW = weight.map((w) => w.d).sort().pop();
  if (lastW && -dayDiff(lastW) >= 7) list.push('weight not entered for a week'), go = 'card-health';
  const lastWa = waist.map((w) => w.d).sort().pop();
  if (lastWa && -dayDiff(lastWa) >= 7) list.push('waist not entered for a week'), go = 'card-health';
  const lastC = whoop.map((r) => r.d).sort().pop();
  if (lastC && -dayDiff(lastC) >= 7) list.push('Whoop data older than a week, import a new CSV'), go = 'card-recovery';
  if (now.getHours() >= 14 && !dayTotals(today).n) list.push('no meal logged');
  const a = syncAge();
  if (a.stale) list.push(a.text.toLowerCase()), go = 'card-food';
  return list.length ? { value: list.length === 1 ? '1 thing open' : list.length + ' things open', text: list.join(' \u00b7 '), go } : null;
}

function renderNow() {
  const box = $('now');
  if (!box) return;
  const rows = [['Next', nowNext(), nowNextMore(), 'card-cal'], ['Food', nowFood(), nowFoodMore(), 'card-food'], ['Recovery', nowBody(), nowBodyMore(), 'card-recovery'], ['Markets', nowMarkets(), nowMarketsMore(), 'card-tickers']];
  const open = nowOpen();
  if (open) rows.push(['Open', open, [], open.go]);
  box.replaceChildren(...rows.map(([label, r, more, id]) =>
    el('button', { type: 'button', class: 'now-row', onclick: () => nowGo(id) },
      el('div', { class: 'now-l' }, label), el('div', { class: 'now-v ' + (r.cls || '') }, r.value), el('div', { class: 'now-t' }, r.text),
      more.length ? el('ul', { class: 'now-x' }, ...more.map((m) => el('li', { class: m.cls === 'over' || m.cls === 'fit' ? m.cls : '' }, el('span', {}, m.l), el('b', { class: m.cls === 'up' || m.cls === 'down' ? m.cls : '' }, m.v)))) : '')));
}

/* ---------- Patterns ---------- */
const PT_MIN_GROUP = 8; // days (or weeks) needed in each half before a difference is shown
const ptDay = (n) => toDateStr(addDays(new Date(), -n));
const ptUsable = (d) => !isCheatDay(d); // cheat days would only distort the averages

// Short nights versus long nights: what do you eat the same day?
function ptSleepFood() {
  const today = toDateStr(new Date());
  const pairs = whoop.filter((r) => r.sleepMin != null && r.d < today && ptUsable(r.d))
    .map((r) => ({ s: r.sleepMin, t: dayTotals(r.d) })).filter((x) => x.t.n > 0).map((x) => ({ s: x.s, k: x.t.kcal }));
  if (pairs.length < 2 * PT_MIN_GROUP) return { need: 'Sleep and food: needs about ' + 2 * PT_MIN_GROUP + ' days with both (now ' + pairs.length + ').' };
  const med = pairs.map((x) => x.s).sort((a, b) => a - b)[Math.floor(pairs.length / 2)];
  const lo = pairs.filter((x) => x.s < med).map((x) => x.k), hi = pairs.filter((x) => x.s >= med).map((x) => x.k);
  if (lo.length < PT_MIN_GROUP || hi.length < PT_MIN_GROUP) return { need: 'Sleep and food: not enough different nights yet.' };
  const diff = Math.round(mean(lo) - mean(hi));
  const base = 'Nights shorter than ' + rcHmShort(med) + ' (' + lo.length + ' days) against longer ones (' + hi.length + ' days). ';
  if (Math.abs(diff) < 100) return { head: 'Sleep and food: no clear link', text: base + 'Your calories differ by less than 100 kcal.' };
  return { head: 'Sleep and food', text: base + 'After a short night you eat ' + fmtN(Math.abs(diff)) + ' kcal ' + (diff > 0 ? 'more' : 'less') + ' on average.' };
}

// Weeks with more protein versus weeks with less: how did the weight change?
function ptProteinWeight() {
  const weeks = [];
  for (let k = 0; k < 12; k++) {
    const end = ptDay(7 * k), start = ptDay(7 * k + 7);
    const w0 = weightOn(start), w1 = weightOn(end);
    if (!w0 || !w1 || w0.d === w1.d || w1.d < ptDay(7 * k + 3) || w0.d < ptDay(7 * k + 10)) continue;
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => ptDay(7 * k + i)).filter(ptUsable).map(dayTotals).filter((t) => t.n && !t.m);
    if (days.length < 4) continue;
    weeks.push({ p: mean(days.map((t) => t.p)), dw: w1.kg - w0.kg });
  }
  if (weeks.length < 2 * 3) return { need: 'Protein and weight: needs about 6 weeks with weigh-ins and complete meals (now ' + weeks.length + ').' };
  const med = weeks.map((w) => w.p).sort((a, b) => a - b)[Math.floor(weeks.length / 2)];
  const lo = weeks.filter((w) => w.p < med), hi = weeks.filter((w) => w.p >= med);
  if (!lo.length || !hi.length) return { need: 'Protein and weight: not enough different weeks yet.' };
  const dLo = mean(lo.map((w) => w.dw)), dHi = mean(hi.map((w) => w.dw));
  const base = 'Weeks with more protein (' + Math.round(mean(hi.map((w) => w.p))) + ' g a day, ' + hi.length + ' weeks) against fewer (' + Math.round(mean(lo.map((w) => w.p))) + ' g, ' + lo.length + ' weeks). ';
  if (Math.abs(dHi - dLo) < 0.2) return { head: 'Protein and weight: no clear link', text: base + 'Weight change per week differs by less than 0.2 kg.' };
  return { head: 'Protein and weight', text: base + 'Weight change per week: ' + sign(dHi, 1) + ' kg against ' + sign(dLo, 1) + ' kg.' };
}

function renderPatterns() {
  const box = $('patterns');
  if (!box) return;
  const items = [ptSleepFood(), ptProteinWeight()];
  const blocks = items.map((r) => r.need
    ? el('p', { class: 'muted small pt-need' }, r.need)
    : el('div', { class: 'now-row pt-row' }, el('div', { class: 'now-l' }, r.head), el('div', { class: 'now-t' }, r.text)));
  box.replaceChildren(...blocks, el('p', { class: 'muted small' }, 'A comparison is not proof. Few weeks of data can show a pattern that is only chance.'));
}


/* ---------- Body summary (rules on the Whoop data, AI tips optional) ---------- */
// Range in days (7 / 15 / 30): the last n nights against the n nights before. Per device, like the Recovery card.
let bsRange = store.get('bsRange', 7);
if (![7, 15, 30].includes(bsRange)) bsRange = 7;

// Button group 7 / 15 / 30 days (also used by the Nutrition Summary)
function rangeSeg(cur, pick) {
  return el('div', { class: 'seg bs-seg', role: 'tablist', 'aria-label': 'Range in days' }, ...[7, 15, 30].map((n) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': String(n === cur), class: n === cur ? 'on' : '', onclick: () => pick(n) }, n + ' days')));
}
const bsAvg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// Averages of a list of nights (null where a value is missing)
function bsWeek(rows) {
  const av = (f) => { const v = rows.map(f).filter((x) => x != null && !Number.isNaN(x)); return v.length ? bsAvg(v) : null; };
  const bed = rows.map((r) => rcMin(r.bed, true)).filter((v) => v != null);
  const mBed = bed.length ? bsAvg(bed) : null;
  // workouts on the days of these nights (from the Whoop workouts CSV)
  const tr = rows.length ? workouts.filter((w) => w.d >= rows[0].d && w.d <= rows[rows.length - 1].d) : [];
  const trSum = (f) => tr.reduce((s, w) => s + (w[f] || 0), 0);
  return {
    sessions: tr.length, trMin: trSum('min'), trKcal: trSum('kcal'), workoutList: tr,
    n: rows.length, from: rows[0] && rows[0].d, to: rows.length && rows[rows.length - 1].d,
    score: av((r) => r.score), hrv: av((r) => r.hrv), rhr: av((r) => r.rhr), sleep: av((r) => r.sleepMin),
    debt: av((r) => r.sleepDebtMin), eff: av((r) => r.sleepEff),
    deep: av((r) => (r.sleepMin && r.deepMin != null ? 100 * r.deepMin / r.sleepMin : null)),
    spread: bed.length >= 4 ? rcStd(bed, mBed) : null, mBed,
  };
}

// The newest n nights against the n nights before them (data comes in once a week)
function bsFacts() {
  const n = bsRange;
  const rows = computeScores([...whoop].sort((a, b) => a.d.localeCompare(b.d)));
  const last = [...rows].reverse().find((x) => x.score != null);
  if (!last) return null;
  const weekRows = rows.filter((x) => x.d <= last.d).slice(-n);
  const prevRows = rows.filter((x) => x.d < weekRows[0].d).slice(-n);
  const week = bsWeek(weekRows), prev = prevRows.length >= 4 ? bsWeek(prevRows) : null; // the earlier period needs at least 4 nights
  // no workouts in either week: probably no workouts file imported, so do not show zeros
  if (!(week.sessions > 0 || (prev && prev.sessions > 0))) for (const w of [week, prev]) if (w) w.sessions = w.trMin = w.trKcal = null;
  return { n, last, age: -dayDiff(last.d), week, prev, weekRows, prevRows };
}

// What is shown per measure: label, value text, how much change counts, and whether higher is better
const BS_ROWS = [
  ['Recovery score', 'score', (v) => Math.round(v) + ' / 100', 3, true],
  ['HRV', 'hrv', (v) => Math.round(v) + ' ms', 2, true],
  ['Resting HR', 'rhr', (v) => Math.round(v) + ' bpm', 1, false],
  ['Sleep per night', 'sleep', (v) => rcHmShort(v), 10, true],
  ['Sleep debt', 'debt', (v) => Math.round(v) + ' min', 10, false],
  ['Efficiency', 'eff', (v) => Math.round(v) + ' %', 1, true],
  ['Deep sleep', 'deep', (v) => Math.round(v) + ' %', 1, true],
  ['Bedtime spread', 'spread', (v) => '±' + Math.round(v) + ' min', 5, false],
  // training volume is not "better" or "worse" (up = null): only the change is shown
  ['Workouts', 'sessions', (v) => String(Math.round(v)), 1, null],
  ['Training time', 'trMin', (v) => rcHmShort(v), 20, null],
  ['Training energy', 'trKcal', (v) => Math.round(v) + ' kcal', 100, null],
];

// Change against last week: { text, cls } cls = better | worse | same
function bsChange(key, cur, old, step, up) {
  if (cur == null || old == null) return { text: '', cls: '' };
  const d = cur - old;
  if (Math.abs(d) < step) return { text: 'same', cls: 'same' };
  const unit = { score: '', hrv: ' ms', rhr: ' bpm', sleep: ' min', debt: ' min', eff: ' %', deep: ' pp', spread: ' min', sessions: '', trMin: ' min', trKcal: ' kcal' }[key];
  const text = (d > 0 ? '+' : '−') + Math.round(Math.abs(d)) + unit;
  if (up === null) return { text, cls: 'same' };
  return { text: text + (d > 0 === up ? ' better' : ' worse'), cls: d > 0 === up ? 'better' : 'worse' };
}

function bsSummary(f) {
  return BS_ROWS.filter(([, k]) => f.week[k] != null).map(([label, k, fmt, step, up]) => ({
    label, value: fmt(f.week[k]), old: f.prev && f.prev[k] != null ? fmt(f.prev[k]) : '', change: f.prev ? bsChange(k, f.week[k], f.prev[k], step, up) : { text: '', cls: '' },
  }));
}

// Fixed rules, used when there is no AI answer
function bsTips(f) {
  const w = f.week, t = [], per = f.n === 7 ? 'this week' : 'last ' + f.n + ' days';
  const band = scoreBand(Math.round(w.score));
  if (band === 'low') t.push('Your recovery was low (' + per + '): keep training light for a few days and avoid hard sessions.');
  else if (band === 'high') t.push('Your recovery was good (' + per + '): a fine time for hard training.');
  else t.push('Your recovery was medium (' + per + '): train at moderate effort.');
  const debt = f.last.sleepDebtMin;
  if (debt > 90) t.push('Sleep debt is over 90 min: go to bed 30 to 45 min earlier for the next few nights.');
  else if (debt > 45) t.push('Sleep debt is building up: aim for bed 20 to 30 min earlier.');
  if (w.sleep && w.sleep < 420) t.push('You slept under 7 h per night on average (' + per + '). A fixed wake time and an earlier bedtime are the simplest fix.');
  if (w.spread != null && w.spread > 60) t.push('Your bedtime varies by more than an hour. A steady bedtime (about ' + rcClock(w.mBed) + ') helps sleep quality.');
  if (w.eff != null && w.eff < 85) t.push('Sleep efficiency is under 85 %: less screen time in bed and a cooler, darker room can help.');
  if (w.deep != null && w.deep < 10) t.push('Deep sleep was low (' + Math.round(w.deep) + ' %). Alcohol and late meals often cut it; wrist-based stages are only estimates.');
  if (f.prev && f.prev.score != null && w.score - f.prev.score <= -8) t.push('Your score fell clearly against the period before. Look at what changed: stress, alcohol, late nights, hard training.');
  if (f.age > 3) t.push('The newest data is ' + f.age + ' days old. Import a new Whoop CSV in the Recovery card.');
  return t.slice(0, 5);
}

/* AI part: one short request per new night (or on the refresh button). Kept in this browser only. Without a key or on an error the fixed rules show instead. */
const BS_EMPTY = { key: '', summary: '', tips: [], prev: [], err: '' };
let bodyAiAll = store.get('bodyAi2', {}); // one answer per range (7 / 15 / 30), this browser only
let bodyAiBusy = false;
const bodyAiOf = (n) => bodyAiAll[n] || BS_EMPTY;
const bsKey = (f) => 'n' + f.n + ':' + f.last.d + (f.week.sessions != null ? ':w' + f.week.sessions + '/' + (f.prev ? f.prev.sessions : '') : ''); // one answer per range and newest night (and once more when workouts arrive)

const BS_SYSTEM = 'You are a careful sleep and recovery coach. The data comes from a wrist band: sleep stages and scores are estimates. ' +
  'The user uploads the data once a week. The message gives a period of N days: the N newest nights ("THIS PERIOD") against the N nights before ("PREVIOUS PERIOD"). ' +
  'The summary (2 to 3 sentences) says how the period was and what got better or worse against the previous one, with the real numbers. ' +
  'The tips are for the coming days: concrete, based on what changed, no generic filler, no diagnoses, no medical claims; ' +
  'only if values are strongly off for many days, say once that a doctor can check it. Do not repeat the earlier tips (their titles are given). ' +
  'If workouts are listed they come from the same band: relate the training load to recovery and sleep, and do not judge more or less training as good or bad by itself. ' +
  'Language of the answer: the language given in the message. Reply with one JSON object only, no other text: ' +
  '{"summary":"2 to 3 sentences","tips":[{"title":"max 4 words","text":"max 25 words"}]} with 3 to 5 tips.';

function bsInput(f) {
  const line = (r) => [r.d, 'score ' + (r.score ?? '?'), 'HRV ' + (r.hrv ?? '?') + ' (usual ' + (r.baseHrv ?? '?') + ')', 'RHR ' + (r.rhr ?? '?') + ' (usual ' + (r.baseRhr ?? '?') + ')',
    'sleep ' + (r.sleepMin ?? '?') + ' min', 'debt ' + (r.sleepDebtMin ?? '?') + ' min', 'eff ' + (r.sleepEff ?? '?') + ' %',
    'deep ' + (r.deepMin ?? '?') + ' min', 'REM ' + (r.remMin ?? '?') + ' min', 'bed ' + (r.bed || '?'), 'wake ' + (r.wake || '?')].join(' | ');
  const avg = (w) => BS_ROWS.filter(([, k]) => w[k] != null).map(([label, k, fmt]) => label + ' ' + fmt(w[k])).join(', ');
  const wline = (w) => w.d + ' ' + w.name + ' | ' + (w.min ?? '?') + ' min | ' + (w.kcal ?? '?') + ' kcal | avg HR ' + (w.avgHr ?? '?') + ' | max HR ' + (w.maxHr ?? '?') + ' | strain ' + (w.strain ?? '?');
  const wlist = (w) => (w && w.sessions != null ? '\nWorkouts' + (w.workoutList.length > 40 ? ' (40 newest of ' + w.workoutList.length + ')' : '') + ':\n' + (w.workoutList.slice(-40).map(wline).join('\n') || 'none') : '');
  return 'Language of the answer: ' + (navigator.language || 'de-AT') +
    '\n\nPeriod length N = ' + f.n + ' days.' +
    '\n\nTHIS PERIOD (oldest first), averages: ' + avg(f.week) + '\n' + f.weekRows.map(line).join('\n') + wlist(f.week) +
    // the earlier period: nightly lines only for the short range, otherwise the averages are enough
    '\n\nPREVIOUS PERIOD' + (f.prev ? ', averages: ' + avg(f.prev) + (f.n <= 7 ? '\n' + f.prevRows.map(line).join('\n') + wlist(f.prev) : '') : ': no data') +
    '\n\nEarlier tip titles: ' + ((bodyAiOf(f.n).prev || []).join('; ') || 'none');
}

async function bsLoadAi(force) {
  const f = bsFacts();
  if (!f || !anthropicKey || bodyAiBusy) return;
  if (!force && bodyAiOf(f.n).key === bsKey(f)) return; // this range and night is done (also after an error: retry only with the button)
  bodyAiBusy = true; renderBodySum();
  try {
    const j = await aiTips(BS_SYSTEM, bsInput(f), 700);
    if (!j || typeof j.summary !== 'string' || !Array.isArray(j.tips)) throw new Error('unexpected answer');
    const list = j.tips.filter((t) => t && t.text).slice(0, 5).map((t) => ({ title: String(t.title || ''), text: String(t.text) }));
    bodyAiAll[f.n] = { key: bsKey(f), summary: j.summary, tips: list, prev: list.map((t) => t.title).filter(Boolean).slice(0, 8), err: '' };
  } catch (e) {
    bodyAiAll[f.n] = Object.assign({}, bodyAiOf(f.n), { key: bsKey(f), err: e.message });
  }
  bodyAiBusy = false;
  store.set('bodyAi2', bodyAiAll);
  renderBodySum();
}

// The workouts of this week, newest first: day, name, duration, energy and heart rate
function bsWorkoutList(f) {
  const list = f.week.sessions != null ? f.week.workoutList.slice().reverse() : [];
  if (!list.length) return [];
  return [el('h3', { class: 'bs-wh' }, 'Workouts, last ' + f.n + ' days')].concat(list.slice(0, 8).map((w) => {
    const det = [w.kcal != null ? Math.round(w.kcal) + ' kcal' : '', w.avgHr != null ? 'Ø ' + Math.round(w.avgHr) + ' bpm' : ''].filter(Boolean).join(' · ');
    return el('div', { class: 'bs-line' }, el('span', { class: 'bs-l' }, rcShort(w.d)), el('span', {}, w.name), el('b', {}, w.min != null ? rcHmShort(w.min) : ''), el('span', { class: 'muted' }, det));
  }));
}

function renderBodySum() {
  const box = $('bodysum');
  if (!box) return;
  const btn = $('bs-refresh');
  if (btn) { btn.hidden = !anthropicKey; btn.disabled = bodyAiBusy; btn.classList.toggle('busy', bodyAiBusy); }
  const seg = rangeSeg(bsRange, (n) => { bsRange = n; store.set('bsRange', n); renderBodySum(); });
  const f = bsFacts();
  if (!f) { box.replaceChildren(seg, el('p', { class: 'muted' }, whoop.length ? 'Not enough nights for a baseline yet (about 14 are needed).' : 'Import a Whoop CSV in the Recovery card to see a summary and tips.')); return; }
  const cur = bodyAiOf(f.n), ai = anthropicKey && cur.key === bsKey(f) && !cur.err && cur.tips.length ? cur : null;
  let note = '';
  if (!anthropicKey) note = 'Add an Anthropic key in Settings for AI tips. These are fixed rules.';
  else if (bodyAiBusy) note = 'Writing tips …';
  else if (cur.err && cur.key === bsKey(f)) note = 'AI tips failed (' + cur.err + '). Fixed rules shown, press ↻ to try again.';
  const tips = ai ? ai.tips.map((t) => el('p', { class: 'bs-tip' }, t.title ? el('b', {}, t.title + ': ') : '', t.text)) : bsTips(f).map((x) => el('p', { class: 'bs-tip' }, x));
  box.replaceChildren(
    seg,
    ai ? el('p', { class: 'bs-sum' }, ai.summary) : '',
    el('div', { class: 'bs-col' }, el('h3', {}, 'Last ' + f.n + ' nights' + (f.week.from ? ' \u00b7 ' + rcShort(f.week.from) + '\u2013' + rcShort(f.week.to) : '')),
      f.prev ? el('div', { class: 'bs-line bs-head' }, el('span', {}, ''), el('span', {}, 'Last ' + f.n), el('span', {}, 'Before'), el('span', {}, 'Change')) : '',
      ...bsSummary(f).map((r) => el('div', { class: 'bs-line' }, el('span', { class: 'bs-l' }, r.label), el('b', {}, r.value), el('span', { class: 'muted' }, r.old), el('span', { class: 'bs-ch ' + r.change.cls }, r.change.text))),
      ...bsWorkoutList(f)),
    el('div', { class: 'bs-col' }, el('h3', {}, ai ? 'Tips (AI)' : 'Tips'), ...tips,
      note ? el('p', { class: 'muted small' }, note) : '',
      f.prev ? '' : el('p', { class: 'muted small' }, 'No comparison: only ' + f.prevRows.length + ' night' + (f.prevRows.length === 1 ? '' : 's') + ' before these ' + f.n + ' nights, 4 are needed.'),
      el('p', { class: 'muted small' }, 'Not medical advice. Wrist-band data is an estimate.')));
  bsLoadAi(false);
}

function renderNowCards() { renderNow(); renderPatterns(); renderBodySum(); }

function initNow() {
  renderNowCards();
  setInterval(() => { if (!document.hidden) renderNowCards(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderNowCards(); });
  setTimeout(renderNowCards, 2500); // after the first data has arrived
  const rb = $('bs-refresh');
  if (rb) rb.addEventListener('click', () => bsLoadAi(true));
}
