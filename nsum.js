// Nutrition Summary card: the last n full days (7 / 15 / 30) against the n days before, plus an AI summary and tips.
// Needs food.js (food data, targets, dayTotals, aiTips, weight). Loaded after now.js; initNutSum() runs from app.js init.

/* ---------- numbers ---------- */
let nsRange = store.get('nsRange', 7); // days per period, per device
if (![7, 15, 30].includes(nsRange)) nsRange = 7;
const nsAvg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// Averages of a list of days. Macros only count days where every meal has them.
function nsWeek(days) {
  const t = days.map((d) => ({ d, t: dayTotals(d) })).filter((x) => x.t.n);
  const av = (f, ok) => { const v = t.filter((x) => (ok ? ok(x.t) : true)).map((x) => f(x.t)); return v.length ? nsAvg(v) : null; };
  const w0 = weightOn(addDaysStr(days[0], -1)), w1 = weightOn(days[days.length - 1]);
  const wa = waistOn(days[days.length - 1]); // the waist is entered about once a week: the latest entry up to the end of the week
  return {
    from: days[0], to: days[days.length - 1], logged: t.length,
    kcal: av((x) => x.kcal), p: av((x) => x.p, (x) => !x.m), c: av((x) => x.c, (x) => !x.m), f: av((x) => x.f, (x) => !x.m), s: av((x) => x.s, (x) => !x.ms),
    kg: w1 ? w1.kg : null, kgBefore: w0 ? w0.kg : null,
    bmi: w1 ? bmiOf(w1.kg) : null, waist: wa ? wa.cm : null,
    cheat: days.filter(isCheatDay).length,
  };
}
const addDaysStr = (d, n) => toDateStr(addDays(new Date(d + 'T00:00'), n));

function nsFacts() {
  const n = nsRange;
  const days = lastDays(2 * n + 1).slice(0, 2 * n); // today is not finished, so it does not count
  const week = nsWeek(days.slice(n)), prev = nsWeek(days.slice(0, n));
  if (week.logged < Math.ceil(n * 2 / 7)) return null; // 2 of 7, 5 of 15, 9 of 30
  return { n, week, prev: prev.logged >= 3 ? prev : null, prevAll: prev, days, tg: targets(), g: goalInfo() };
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
  ['Tage eingetragen', 'logged', (v) => Math.round(v) + ' von ' + nsRange, 1],
  ['Kalorien pro Tag', 'kcal', (v) => fmtN(v) + ' kcal', 50],
  ['Protein pro Tag', 'p', (v) => Math.round(v) + ' g', 5],
  ['Kohlenhydrate pro Tag', 'c', (v) => Math.round(v) + ' g', 8],
  ['Fett pro Tag', 'f', (v) => Math.round(v) + ' g', 4],
  ['Zucker pro Tag', 's', (v) => Math.round(v) + ' g', 3],
  ['Gewicht', 'kg', (v) => fmtD(v, 1) + ' kg', 0.2],
  ['BMI', 'bmi', (v) => fmtD(v, 1), 0.1], // needs the height in Settings
  ['Bauchumfang', 'waist', (v) => fmtD(v, 1) + ' cm', 0.5],
];

function nsChange(key, cur, old, step, f) {
  if (cur == null || old == null) return { text: '', cls: '' };
  const d = cur - old;
  if (Math.abs(d) < step) return { text: 'gleich', cls: 'same' };
  const unit = { logged: ' Tage', kcal: ' kcal', p: ' g', c: ' g', f: ' g', s: ' g', kg: ' kg', bmi: '', waist: ' cm' }[key];
  const decimal = key === 'kg' || key === 'bmi' || key === 'waist'; // one decimal for body values
  const num = chArrow(d) + (decimal ? fmtD(Math.abs(d), 1) : fmtN(Math.abs(d))) + unit;
  let better = null;
  if (key === 'logged') better = d > 0;
  else if (key === 'kg' || key === 'bmi') better = f.g ? (f.g.goal < f.g.start ? d < 0 : d > 0) : null; // BMI follows the weight goal
  else if (key === 'waist') better = d < 0; // a smaller waist is better
  else { const a = nsBad(key, cur, f), b = nsBad(key, old, f); better = a == null || b == null ? null : a < b; }
  return { text: num, cls: better == null ? 'same' : better ? 'better' : 'worse', title: better == null ? '' : better ? 'besser' : 'schlechter' };
}

function nsSummary(f) {
  return NS_ROWS.filter(([, k]) => f.week[k] != null).map(([label, k, fmt, step]) => ({
    label, value: fmt(f.week[k]), old: f.prev && f.prev[k] != null ? fmt(f.prev[k]) : '', change: f.prev ? nsChange(k, f.week[k], f.prev[k], step, f) : { text: '', cls: '' },
  }));
}

// Fixed rules, used when there is no AI answer
function nsTips(f) {
  const w = f.week, tg = f.tg, t = [], per = f.n === 7 ? 'diese Woche' : 'in den letzten ' + f.n + ' Tage';
  if (w.logged < f.n * 0.7) t.push('Nur ' + w.logged + ' von ' + f.n + ' Tage eingetragen. Trag jeden Tag ein, sonst sagen die Schnitte wenig.');
  if (w.kcal != null && tg.kcal) {
    const d = Math.round(w.kcal - tg.kcal);
    if (d > 150) t.push('Du lagst im Schnitt ' + d + ' kcal über deinem Ziel. Kleinere Portionen bei der größten Mahlzeit helfen am einfachsten.');
    else if (d < -300) t.push('Du lagst im Schnitt ' + Math.abs(d) + ' kcal unter deinem Ziel. Zu wenig essen macht das Protein-Ziel schwerer.');
    else t.push('Die Kalorien waren nah am Ziel. Weiter so.');
  }
  if (w.p != null && tg.p && w.p < tg.p - 10) t.push('Protein im Schnitt ' + Math.round(w.p) + ' g, Ziel ' + tg.p + ' g. Ergänze eine Proteinquelle zum Frühstück.');
  if (w.s != null && tg.s && w.s > tg.s) t.push('Zucker im Schnitt ' + Math.round(w.s) + ' g, Limit ' + tg.s + ' g. Getränke und Süßes sind die übliche Quelle.');
  if (f.prev && w.kg != null && f.prev.kg != null && f.g) {
    const d = w.kg - f.prev.kg, lose = f.g.goal < f.g.start;
    if (Math.abs(d) < 0.2) t.push('Dein Gewicht hat sich nicht bewegt (' + per + ').');
    else if (lose !== d < 0) t.push('Dein Gewicht hat sich vom Ziel entfernt (' + per + ', ' + (d > 0 ? '+' : '−') + fmtD(Math.abs(d), 1) + ' kg).');
  }
  return t.slice(0, 5);
}

/* ---------- AI part: one request per day (or on the refresh button). Kept in this browser only. ---------- */
const NS_EMPTY = { key: '', summary: '', tips: [], prev: [], err: '' };
let nutAiAll = store.get('nutAi2', {}); // one answer per range (7 / 15 / 30), this browser only
let nutAiBusy = false;
const nutAiOf = (n) => nutAiAll[n] || NS_EMPTY;
const nsKey = (f) => 'n' + f.n + ':' + f.week.to;

const NS_SYSTEM = 'You are a careful nutrition coach. The user logs meals daily; calories and macros are estimates. ' +
  'The message gives a period of N days: the N newest full days ("THIS PERIOD") against the N days before ("PREVIOUS PERIOD"). ' +
  'The summary (2 to 3 sentences) says how the period went against the targets and what got better or worse against the previous one, with the real numbers. ' +
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
  return 'Language of the answer: ' + 'de-AT (Deutsch)' +
    '\nTargets per day: ' + tg.kcal + ' kcal' + (tg.p ? ', protein ' + tg.p + ' g, carbs ' + tg.c + ' g, fat ' + tg.f + ' g' : '') + ', sugar max ' + tg.s + ' g.' + (f.g ? ' Goal: ' + (f.g.goal < f.g.start ? 'lose weight' : 'gain weight') + '.' : '') +
    '\n\nPeriod length N = ' + f.n + ' days.' +
    '\n\nTHIS PERIOD averages: ' + avg(f.week) + '\n' + f.days.slice(f.n).map(line).join('\n') +
    // the earlier period: day lines only for the short range, otherwise the averages are enough
    '\n\nPREVIOUS PERIOD' + (f.prev ? ' averages: ' + avg(f.prev) + (f.n <= 7 ? '\n' + f.days.slice(0, f.n).map(line).join('\n') : '') : ': not enough data') +
    '\n\nEarlier tip titles: ' + ((nutAiOf(f.n).prev || []).join('; ') || 'none');
}

async function nsLoadAi(force) {
  const f = nsFacts();
  if (!f || !anthropicKey || nutAiBusy) return;
  if (!force && nutAiOf(f.n).key === nsKey(f)) return; // this range and day is done (also after an error: retry only with the button)
  nutAiBusy = true; renderNutSum();
  try {
    const j = await aiTips(NS_SYSTEM, nsInput(f), 700);
    if (!j || typeof j.summary !== 'string' || !Array.isArray(j.tips)) throw new Error('unerwartete Antwort');
    const list = j.tips.filter((t) => t && t.text).slice(0, 5).map((t) => ({ title: String(t.title || ''), text: String(t.text) }));
    nutAiAll[f.n] = { key: nsKey(f), summary: j.summary, tips: list, prev: list.map((t) => t.title).filter(Boolean).slice(0, 8), err: '' };
  } catch (e) {
    nutAiAll[f.n] = Object.assign({}, nutAiOf(f.n), { key: nsKey(f), err: e.message });
  }
  nutAiBusy = false;
  store.set('nutAi2', nutAiAll);
  renderNutSum();
}

function renderNutSum() {
  const box = $('nutsum');
  if (!box) return;
  const btn = $('ns-refresh');
  if (btn) { btn.hidden = !anthropicKey; btn.disabled = nutAiBusy; btn.classList.toggle('busy', nutAiBusy); }
  const seg = rangeSeg(nsRange, (n) => { nsRange = n; store.set('nsRange', n); renderNutSum(); });
  const f = nsFacts();
  if (!f) { box.replaceChildren(seg, el('p', { class: 'muted' }, 'Trag an mindestens ' + Math.ceil(nsRange * 2 / 7) + ' Tagen Mahlzeiten ein (letzte ' + nsRange + ' Tage), um Übersicht und Tipps zu sehen.')); return; }
  const cur = nutAiOf(f.n), ai = anthropicKey && cur.key === nsKey(f) && !cur.err && cur.tips.length ? cur : null;
  let note = '';
  if (!anthropicKey) note = 'Für KI-Tipps einen Anthropic-Key in den Einstellungen eintragen. Das sind feste Regeln.';
  else if (nutAiBusy) note = 'Schreibt Tipps …';
  else if (cur.err && cur.key === nsKey(f)) note = 'KI-Tipps fehlgeschlagen (' + cur.err + '). Feste Regeln angezeigt, ↻ für neuen Versuch.';
  const tips = ai ? ai.tips.map((t) => el('p', { class: 'bs-tip' }, t.title ? el('b', {}, t.title + ': ') : '', t.text)) : nsTips(f).map((x) => el('p', { class: 'bs-tip' }, x));
  box.replaceChildren(
    seg,
    ai ? el('p', { class: 'bs-sum' }, ai.summary) : '',
    el('div', { class: 'bs-col' }, el('h3', {}, 'Letzte ' + f.n + ' Tage · ' + rcShort(f.week.from) + '–' + rcShort(f.week.to) + (f.week.cheat ? ' · ' + f.week.cheat + ' Cheat-Day' + (f.week.cheat > 1 ? 's' : '') : '')),
      f.prev ? el('div', { class: 'bs-line bs-head' }, el('span', {}, ''), el('span', {}, 'Letzte ' + f.n), el('span', {}, 'Davor'), el('span', {}, 'Änderung')) : '',
      ...nsSummary(f).map(bsRow)),
    el('div', { class: 'bs-col' }, el('h3', {}, ai ? 'Tipps (KI)' : 'Tipps'), ...tips,
      note ? (anthropicKey ? el('p', { class: 'muted small' }, note) : setupLine('KI-Tipps brauchen deinen Anthropic-Key. Das sind feste Regeln.')) : '',
      f.prev ? '' : el('p', { class: 'muted small' }, 'Kein Vergleich: Die ' + f.n + ' Tage davor (' + rcShort(f.prevAll.from) + '–' + rcShort(f.prevAll.to) + ') haben nur ' + f.prevAll.logged + ' eingetragene' + (f.prevAll.logged === 1 ? 'n Tag' : ' Tage') + ', 3 sind nötig.'),
      el('p', { class: 'muted small' }, 'Schnitte zählen nur Tage mit Einträgen. Kalorien und Makros sind Schätzungen.')));
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
