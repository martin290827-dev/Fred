'use strict';
/* Weekly Review: the last full week (Monday to Sunday) from your own data, compared with the week before.
   The numbers are computed here. The written summary is optional (Claude, one call per week, saved). */

let weeklyOff = new Date().getDay() === 0 ? -1 : 0; // -1 = this week (so far), 0 = last full week, 1 = the week before ... On Sunday the week is over, so it opens first
let weeklyBusy = false;
let weeklyAi = store.get('weekly', {}); // { 'YYYY-MM-DD' (Monday): { summary, wins: [], focus: [], err } }
const WEEKLY_MAX = 26;

const wkStart = (off) => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return toDateStr(addDays(d, -((d.getDay() + 6) % 7) - 7 * (off + 1))); // Monday of that week
};
const wkDays = (start) => Array.from({ length: 7 }, (_, i) => toDateStr(addDays(new Date(start + 'T00:00'), i)));
const wkMean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// All figures of one week; null where there is no data.
function weekData(start) {
  const days = wkDays(start), end = days[6];
  const tot = days.map(dayTotals).filter((t) => t.n);
  const prot = days.map(dayTotals).map(getProtein).filter((v) => v !== null);
  const w1 = weightOn(end), w0 = weightOn(toDateStr(addDays(new Date(start + 'T00:00'), -1)));
  const nights = (typeof computeScores === 'function' ? computeScores([...whoop].sort((a, b) => a.d.localeCompare(b.d))) : []).filter((r) => r.d >= start && r.d <= end);
  const pk = poker.filter((e) => e.d >= start && e.d <= end);
  const tg = targets();
  return {
    start, end,
    foodDays: tot.length,
    kcal: wkMean(tot.map((t) => t.kcal)),
    over: tg.kcal ? tot.filter((t) => t.kcal > tg.kcal).length : null,
    protein: wkMean(prot),
    weight: w1 && w1.d >= start ? w1.kg : null,
    weightChange: w1 && w0 && w1.d >= start ? w1.kg - w0.kg : null,
    nights: nights.length,
    sleepMin: wkMean(nights.map((r) => r.sleepMin).filter((v) => v != null)),
    score: wkMean(nights.map((r) => r.score).filter((v) => v != null)),
    hrv: wkMean(nights.map((r) => r.hrv).filter((v) => v != null)),
    pokerSessions: pk.length,
    pokerResult: pk.length ? pk.reduce((s, e) => s + e.amt, 0) : null,
    reactions: food.filter((e) => e.bad && e.at.slice(0, 10) >= start && e.at.slice(0, 10) <= end).length,
  };
}

/* ---------- view ---------- */

// One line: label, value, and the change to the week before. good: 1 = higher is better, -1 = lower is better, 0 = neutral.
function wkRow(label, value, delta, unit, good) {
  let d = '';
  if (delta !== null && delta !== undefined && isFinite(delta) && Math.abs(delta) > 1e-9) {
    const cls = !good ? '' : (delta * good > 0 ? 'pk-up' : 'pk-down');
    d = el('span', { class: 'wk-d ' + cls }, (delta > 0 ? '+' : '−') + unit(Math.abs(delta)) + ' vs prev');
  }
  return el('div', { class: 'pk-r' }, el('span', { class: 'pk-l' }, label), el('span', { class: 'wk-v' }, value === null ? '–' : value, d));
}
const dlt = (a, b) => (a === null || b === null ? null : a - b);

function wkGroup(title, ...rows) {
  return el('div', { class: 'wk-sec' }, el('div', { class: 'food-sub' }, title), el('div', { class: 'pk-group' }, ...rows));
}

const wkNone = (title, text) => el('div', { class: 'wk-sec' }, el('div', { class: 'food-sub' }, title), el('p', { class: 'muted small' }, text));

function weeklyAiBlock(start, cur, prev) {
  const r = weeklyAi[start];
  const btn = el('button', { type: 'button', class: 'pk-add', onclick: () => loadWeeklyAi(start, cur, prev) }, weeklyBusy ? 'Writing…' : r && r.summary ? 'Write again' : 'Write summary');
  btn.disabled = weeklyBusy || !anthropicKey;
  const body = r && r.summary ? el('div', { class: 'wk-ai' },
    el('p', {}, r.summary),
    ...(r.wins && r.wins.length ? [el('div', { class: 'food-sub' }, 'Went well'), el('ul', { class: 'wk-ul' }, ...r.wins.map((x) => el('li', {}, x)))] : []),
    ...(r.focus && r.focus.length ? [el('div', { class: 'food-sub' }, 'Next week'), el('ul', { class: 'wk-ul' }, ...r.focus.map((x) => el('li', {}, x)))] : []))
    : r && r.err ? el('p', { class: 'food-err small' }, r.err)
      : el('p', { class: 'muted small' }, anthropicKey ? 'A short written summary of the week. Links between areas are hints, not proof.' : 'Add an Anthropic key in Settings for a written summary.');
  return el('div', { class: 'wk-sec' }, el('div', { class: 'food-sub' }, 'Summary'), body, el('div', { class: 'pk-btns' }, btn));
}

function renderWeekly() {
  const box = $('weekly');
  if (!box) return;
  const start = wkStart(weeklyOff), prevStart = wkStart(weeklyOff + 1);
  const c = weekData(start), p = weekData(prevStart);
  const range = shortDay(start) + ' – ' + shortDay(c.end);
  const older = el('button', { type: 'button', class: 'ghost small', 'aria-label': 'Earlier week', onclick: () => { weeklyOff++; renderWeekly(); } }, '\u2039');
  const newer = el('button', { type: 'button', class: 'ghost small', 'aria-label': 'Later week', onclick: () => { weeklyOff--; renderWeekly(); } }, '\u203a');
  older.disabled = weeklyOff >= WEEKLY_MAX;
  newer.disabled = weeklyOff <= -1;
  const nav = el('div', { class: 'wk-nav' }, older, el('span', { class: 'wk-range' }, range, weeklyOff <= 0 ? el('span', { class: 'wk-cap muted small' }, weeklyOff === 0 ? 'Last week' : new Date().getDay() === 0 ? 'This week' : 'This week so far') : ''), newer);
  const tg = targets();
  const min = (v) => rcHmShort(v);
  const empty = !c.foodDays && !c.nights && !c.pokerSessions && c.weight === null;
  box.replaceChildren(el('div', { class: 'food-col' }, nav,
    empty ? '' : weeklyAiBlock(start, c, p), // summary first
    empty ? el('p', { class: 'muted small' }, 'No data in this week.') : el('div', { class: 'wk-all' },
      !c.foodDays ? wkNone('Food', 'No food logged in this week.') : wkGroup('Food',
        wkRow('Days logged', c.foodDays ? c.foodDays + ' of 7' : null, null, String, 0),
        wkRow('Calories per day', c.kcal === null ? null : fmtN(c.kcal) + ' kcal', dlt(c.kcal, p.kcal), (v) => fmtN(v), 0),
        wkRow('Days above target', c.over === null || !c.foodDays ? null : String(c.over), null, String, 0),
        wkRow('Protein per day', c.protein === null ? null : fmtN(c.protein) + ' g', dlt(c.protein, p.protein), (v) => fmtN(v), tg.p ? 1 : 0)),
      c.weight === null ? wkNone('Body', 'No weigh-in in this week.') : wkGroup('Body',
        wkRow('Weight', c.weight === null ? null : fmtKg(c.weight) + ' kg', c.weightChange, (v) => fmtKg(v), -1)),
      !c.nights ? wkNone('Sleep', 'No Whoop nights in this week. Import the newest Whoop files in Recovery.') : wkGroup('Sleep',
        wkRow('Nights', c.nights ? c.nights + ' of 7' : null, null, String, 0),
        wkRow('Sleep per night', c.sleepMin === null ? null : min(c.sleepMin), dlt(c.sleepMin, p.sleepMin), (v) => Math.round(v) + ' min', 1),
        wkRow('Fred Score', c.score === null ? null : String(Math.round(c.score)), dlt(c.score, p.score), (v) => String(Math.round(v)), 1),
        wkRow('HRV', c.hrv === null ? null : Math.round(c.hrv) + ' ms', dlt(c.hrv, p.hrv), (v) => Math.round(v) + ' ms', 1)),
      wkGroup('Poker',
        wkRow('Sessions', c.pokerSessions ? String(c.pokerSessions) : null, null, String, 0),
        wkRow('Result', c.pokerResult === null ? null : eur(c.pokerResult, true), dlt(c.pokerResult, p.pokerResult), (v) => eur(v), 1)),
      c.reactions || p.reactions ? wkGroup('Reactions', wkRow('Flagged meals', String(c.reactions), c.reactions - p.reactions, String, -1)) : '',
      )));
}

/* ---------- written summary ---------- */

const WEEKLY_SYSTEM = 'You write a short, fair weekly review for one adult from their own figures: food, weight, sleep and recovery, poker result, flagged meals. ' +
  'You get this week and the week before. Judge in proportion, not strict. Name what changed and what it may be linked to (for example less sleep and a lower recovery score), ' +
  'but say clearly that links are hints, never proof. Do not invent numbers and do not mention areas without data. Never give medical diagnoses. ' +
  'Reply with JSON only: {"summary":"2 to 3 plain sentences","wins":["up to 3 short items that went well"],"focus":["up to 2 concrete, small things for next week"]}';

function weekLines(w) {
  const f = (l, v, u) => (v === null || v === undefined || (typeof v === 'number' && !isFinite(v)) ? '' : l + ': ' + (typeof v === 'number' ? Math.round(v * 10) / 10 : v) + (u || '') + '\n');
  return f('Days with food logged', w.foodDays, ' of 7') + f('Average kcal per logged day', w.kcal, '') + f('Days above kcal target', w.over, '') + f('Average protein g', w.protein, '') +
    f('Weight kg at week end', w.weight, '') + f('Weight change kg', w.weightChange, '') + f('Nights with sleep data', w.nights, ' of 7') + f('Average sleep minutes', w.sleepMin, '') +
    f('Average recovery score', w.score, '') + f('Average HRV ms', w.hrv, '') + f('Poker sessions', w.pokerSessions, '') + f('Poker result EUR', w.pokerResult, '') + f('Meals flagged with a bad reaction', w.reactions, '');
}

async function loadWeeklyAi(start, cur, prev) {
  if (weeklyBusy || !anthropicKey) return;
  weeklyBusy = true;
  renderWeekly();
  try {
    const t = tgtLine();
    const j = await aiJSON(WEEKLY_SYSTEM, 'Language of the answer: ' + (navigator.language || 'de-AT') + '\n' + t + 'THIS WEEK (' + cur.start + ' to ' + cur.end + '):\n' + weekLines(cur) + '\nWEEK BEFORE:\n' + weekLines(prev), 700);
    const list = (a) => (Array.isArray(a) ? a.map(String).filter(Boolean).slice(0, 3) : []);
    weeklyAi[start] = { summary: String(j.summary || ''), wins: list(j.wins), focus: list(j.focus).slice(0, 2), err: '' };
  } catch (e) {
    weeklyAi[start] = Object.assign({}, weeklyAi[start], { err: e.message });
  }
  weeklyBusy = false;
  store.set('weekly', weeklyAi);
  renderWeekly();
}

const tgtLine = () => { const tg = targets(); return 'Daily targets: ' + tg.kcal + ' kcal' + (tg.p ? ', protein ' + tg.p + ' g' : '') + '\n'; };

function initWeekly() { renderWeekly(); }
