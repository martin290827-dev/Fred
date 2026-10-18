// Nutrition Summary card: the last 7 full days against the 7 days before, plus an AI summary and tips.
// Needs food.js (food data, targets, dayTotals, aiTips, weight). Loaded after now.js; initNutSum() runs from app.js init.

/* ---------- numbers ---------- */
const nsAvg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// Averages of a list of days. Macros only count days where every meal has them.
function nsWeek(days) {
  const t = days.map((d) => ({ d, t: dayTotals(d) })).filter((x) => x.t.n);
  const av = (f, ok) => { const v = t.filter((x) => (ok ? ok(x.t) : true)).map((x) => f(x.t)); return v.length ? nsAvg(v) : null; };
  const w0 = weightOn(addDaysStr(days[0], -1)), w1 = weightOn(days[days.length - 1]);
  return {
    from: days[0], to: days[days.length - 1], logged: t.length,
    kcal: av((x) => x.kcal), p: av((x) => x.p, (x) => !x.m), c: av((x) => x.c, (x) => !x.m), f: av((x) => x.f, (x) => !x.m), s: av((x) => x.s, (x) => !x.ms),
    kg: w1 ? w1.kg : null, kgBefore: w0 ? w0.kg : null,
    cheat: days.filter(isCheatDay).length,
  };
}
const addDaysStr = (d, n) => toDateStr(addDays(new Date(d + 'T00:00'), n));

function nsFacts() {
  const days = lastDays(15).slice(0, 14); // today is not finished, so it does not count
  const week = nsWeek(days.slice(7)), prev = nsWeek(days.slice(0, 7));
  if (week.logged < 2) return null;
  return { week, prev: prev.logged >= 3 ? prev : null, days, tg: targets(), g: goalInfo() };
}

// How far a value is from what is wanted: lower is better. null = no target to judge by.
function nsBad(key, v, f) {
  const t = f.tg[key];
  if (v == null) return null;
  if (key === 'kcal' || key === 'c' || key === 'f') return t ? Math.abs(v - t) : null;
  if (key === 'p') return t ? Math.max(0, t - v) : null; // more protein than the target is fine
  if (key === 's') return Math.max(0, v - (t || 0)) + v * 0.001; // sugar: less is better
  return null;
}

const NS_ROWS = [
  ['Days logged', 'logged', (v) => Math.round(v) + ' of 7', 1],
  ['Calories per day', 'kcal', (v) => Math.round(v) + ' kcal', 50],
  ['Protein per day', 'p', (v) => Math.round(v) + ' g', 5],
  ['Carbs per day', 'c', (v) => Math.round(v) + ' g', 8],
  ['Fat per day', 'f', (v) => Math.round(v) + ' g', 4],
  ['Sugar per day', 's', (v) => Math.round(v) + ' g', 3],
  ['Weight', 'kg', (v) => v.toFixed(1) + ' kg', 0.2],
];

function nsChange(key, cur, old, step, f) {
  if (cur == null || old == null) return { text: '', cls: '' };
  const d = cur - old;
  if (Math.abs(d) < step) return { text: 'same', cls: 'same' };
  const unit = { logged: ' days', kcal: ' kcal', p: ' g', c: ' g', f: ' g', s: ' g', kg: ' kg' }[key];
  const num = (d > 0 ? '+' : '−') + (key === 'kg' ? Math.abs(d).toFixed(1) : Math.round(Math.abs(d))) + unit;
  let better = null;
  if (key === 'logged') better = d > 0;
  else if (key === 'kg') better = f.g ? (f.g.goal < f.g.start ? d < 0 : d > 0) : null;
  else { const a = nsBad(key, cur, f), b = nsBad(key, old, f); better = a == null || b == null ? null : a < b; }
  return { text: num + (better == null ? '' : better ? ' better' : ' worse'), cls: better == null ? 'same' : better ? 'better' : 'worse' };
}

function nsSummary(f) {
  return NS_ROWS.filter(([, k]) => f.week[k] != null).map(([label, k, fmt, step]) => ({
    label, value: fmt(f.week[k]), old: f.prev && f.prev[k] != null ? fmt(f.prev[k]) : '', change: f.prev ? nsChange(k, f.week[k], f.prev[k], step, f) : { text: '', cls: '' },
  }));
}

// Fixed rules, used when there is no AI answer
function nsTips(f) {
  const w = f.week, tg = f.tg, t = [];
  if (w.logged < 5) t.push('Only ' + w.logged + ' of 7 days are logged. Log every day, otherwise the averages say little.');
  if (w.kcal != null && tg.kcal) {
    const d = Math.round(w.kcal - tg.kcal);
    if (d > 150) t.push('You averaged ' + d + ' kcal over your target. Smaller portions of the biggest meal are the easiest fix.');
    else if (d < -300) t.push('You averaged ' + Math.abs(d) + ' kcal under your target. Eating too little makes the protein target harder.');
    else t.push('Calories were close to your target. Keep it up.');
  }
  if (w.p != null && tg.p && w.p < tg.p - 10) t.push('Protein averaged ' + Math.round(w.p) + ' g, target ' + tg.p + ' g. Add a protein source to breakfast.');
  if (w.s != null && tg.s && w.s > tg.s) t.push('Sugar averaged ' + Math.round(w.s) + ' g, limit ' + tg.s + ' g. Drinks and sweets are the usual source.');
  if (f.prev && w.kg != null && f.prev.kg != null && f.g) {
    const d = w.kg - f.prev.kg, lose = f.g.goal < f.g.start;
    if (Math.abs(d) < 0.2) t.push('Your weight did not move this week.');
    else if (lose !== d < 0) t.push('Your weight moved away from your goal this week (' + (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1) + ' kg).');
  }
  return t.slice(0, 5);
}

/* ---------- AI part: one request per day (or on the refresh button). Kept in this browser only. ---------- */
let nutAi = store.get('nutAi', { key: '', summary: '', tips: [], prev: [], err: '' });
let nutAiBusy = false;
const nsKey = (f) => 'week:' + f.week.to;

const NS_SYSTEM = 'You are a careful nutrition coach. The user logs meals daily; calories and macros are estimates. ' +
  'Write about the WEEK: the 7 newest full days ("THIS WEEK") against the 7 days before ("LAST WEEK"). ' +
  'The summary (2 to 3 sentences) says how the week went against the targets and what got better or worse against last week, with the real numbers. ' +
  'A cheat day is a planned day off: do not criticise it, but note how it moved the average. ' +
  'The tips are for the coming days: concrete, based on what changed and on the foods in the diary, no generic filler, no medical claims. ' +
  'Do not repeat the earlier tips (their titles are given). Language of the answer: the language given in the message. ' +
  'Reply with one JSON object only, no other text: {"summary":"2 to 3 sentences","tips":[{"title":"max 4 words","text":"max 25 words"}]} with 3 to 5 tips.';

function nsInput(f) {
  const tg = f.tg;
  const line = (d) => {
    const t = dayTotals(d), meals = food.filter((e) => e.at.slice(0, 10) === d).sort((a, b) => a.at.localeCompare(b.at)).map((e) => e.text.slice(0, 60)).join('; ');
    return d + (isCheatDay(d) ? ' (cheat day)' : '') + ' | ' + (t.n ? Math.round(t.kcal) + ' kcal, P' + Math.round(t.p) + ' C' + Math.round(t.c) + ' F' + Math.round(t.f) + ' S' + Math.round(t.s) + (t.m ? ' (some macros missing)' : '') + ' | ' + meals : 'nothing logged');
  };
  const avg = (w) => NS_ROWS.filter(([, k]) => w[k] != null).map(([label, k, fmt]) => label + ' ' + fmt(w[k])).join(', ');
  return 'Language of the answer: ' + (navigator.language || 'de-AT') +
    '\nTargets per day: ' + tg.kcal + ' kcal' + (tg.p ? ', protein ' + tg.p + ' g, carbs ' + tg.c + ' g, fat ' + tg.f + ' g' : '') + ', sugar max ' + tg.s + ' g.' + (f.g ? ' Goal: ' + (f.g.goal < f.g.start ? 'lose weight' : 'gain weight') + '.' : '') +
    '\n\nTHIS WEEK averages: ' + avg(f.week) + '\n' + f.days.slice(7).map(line).join('\n') +
    '\n\nLAST WEEK' + (f.prev ? ' averages: ' + avg(f.prev) + '\n' + f.days.slice(0, 7).map(line).join('\n') : ': not enough data') +
    '\n\nEarlier tip titles: ' + ((nutAi.prev || []).join('; ') || 'none');
}

async function nsLoadAi(force) {
  const f = nsFacts();
  if (!f || !anthropicKey || nutAiBusy) return;
  if (!force && nutAi.key === nsKey(f)) return; // this week is done (also after an error: retry only with the button)
  nutAiBusy = true; renderNutSum();
  try {
    const j = await aiTips(NS_SYSTEM, nsInput(f), 700);
    if (!j || typeof j.summary !== 'string' || !Array.isArray(j.tips)) throw new Error('unexpected answer');
    const list = j.tips.filter((t) => t && t.text).slice(0, 5).map((t) => ({ title: String(t.title || ''), text: String(t.text) }));
    nutAi = { key: nsKey(f), summary: j.summary, tips: list, prev: list.map((t) => t.title).filter(Boolean).slice(0, 8), err: '' };
  } catch (e) {
    nutAi = Object.assign({}, nutAi, { key: nsKey(f), err: e.message });
  }
  nutAiBusy = false;
  store.set('nutAi', nutAi);
  renderNutSum();
}

function renderNutSum() {
  const box = $('nutsum');
  if (!box) return;
  const btn = $('ns-refresh');
  if (btn) { btn.hidden = !anthropicKey; btn.disabled = nutAiBusy; btn.classList.toggle('busy', nutAiBusy); }
  const f = nsFacts();
  if (!f) { box.replaceChildren(el('p', { class: 'muted' }, 'Log meals on at least 2 days to see a weekly summary and tips.')); return; }
  const ai = anthropicKey && nutAi.key === nsKey(f) && !nutAi.err && nutAi.tips.length ? nutAi : null;
  let note = '';
  if (!anthropicKey) note = 'Add an Anthropic key in Settings for AI tips. These are fixed rules.';
  else if (nutAiBusy) note = 'Writing tips …';
  else if (nutAi.err && nutAi.key === nsKey(f)) note = 'AI tips failed (' + nutAi.err + '). Fixed rules shown, press ↻ to try again.';
  const tips = ai ? ai.tips.map((t) => el('p', { class: 'bs-tip' }, t.title ? el('b', {}, t.title + ': ') : '', t.text)) : nsTips(f).map((x) => el('p', { class: 'bs-tip' }, x));
  box.replaceChildren(
    ai ? el('p', { class: 'bs-sum' }, ai.summary) : '',
    el('div', { class: 'bs-col' }, el('h3', {}, 'Last 7 days · ' + rcShort(f.week.from) + '–' + rcShort(f.week.to) + (f.week.cheat ? ' · ' + f.week.cheat + ' cheat day' + (f.week.cheat > 1 ? 's' : '') : '')),
      f.prev ? el('div', { class: 'bs-line bs-head' }, el('span', {}, ''), el('span', {}, 'This week'), el('span', {}, 'Last week'), el('span', {}, 'Change')) : '',
      ...nsSummary(f).map((r) => el('div', { class: 'bs-line' }, el('span', { class: 'bs-l' }, r.label), el('b', {}, r.value), el('span', { class: 'muted' }, r.old), el('span', { class: 'bs-ch ' + r.change.cls }, r.change.text)))),
    el('div', { class: 'bs-col' }, el('h3', {}, ai ? 'Tips (AI)' : 'Tips'), ...tips,
      note ? el('p', { class: 'muted small' }, note) : '',
      el('p', { class: 'muted small' }, 'Averages count only days with entries. Calories and macros are estimates.')));
  nsLoadAi(false);
}

function initNutSum() {
  renderNutSum();
  const rb = $('ns-refresh');
  if (rb) rb.addEventListener('click', () => nsLoadAi(true));
  setInterval(() => { if (!document.hidden) renderNutSum(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderNutSum(); });
  setTimeout(renderNutSum, 2500); // after the first data has arrived
}
