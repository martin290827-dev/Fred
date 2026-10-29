'use strict';
/* Card "Now": the few things that matter right now, one sentence each (plain rules, no AI, no cost).
   Card "Patterns": simple comparisons between sleep, food and weight (needs weeks of data).
   Reads data from the other files; nothing is stored here. */

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sign = (v, d) => (v >= 0 ? '+' : '−') + fmtD(Math.abs(v), d);

/* ---------- Now ---------- */
function nowNext() {
  const now = new Date(), today = toDateStr(now);
  for (const it of gAgendaItems()) {
    const e = it.task;
    if (e) {
      if ((e.end || e.start) <= now) continue;
      const st = gState(e, now);
      return { value: e.title, text: st.cls === 'now' ? 'Jetzt' : st.text || agendaDay(it.day) + ', ' + hhmm(e.start) };
    }
    if (it.day >= today) return { value: it.event.label, text: agendaDay(it.day) + ', ganztägig' };
  }
  return { value: 'Nichts geplant', text: gHasToken() || gAgenda.length ? 'Keine Termine in den nächsten 30 Tagen.' : 'Verbinde Google unter Termine & Ereignisse, um Termine zu sehen.' };
}

function nowFood() {
  const t = dayTotals(toDateStr(new Date())), g = targets();
  const left = g.kcal - t.kcal;
  const value = !t.n ? fmtN(g.kcal) + ' kcal übrig' : left >= 0 ? fmtN(left) + ' kcal übrig' : fmtN(-left) + ' kcal drüber';
  let text;
  if (!t.n) text = 'Heute noch nichts eingetragen.';
  else if (!g.p) text = 'Trag dein Gewicht unter Gewicht & Ziel ein, um ein Protein-Ziel zu bekommen.';
  else if (t.m) text = 'Manche Mahlzeiten haben noch keinen Proteinwert.';
  else if (g.p - t.p > 5) text = 'Protein: ' + round5(g.p - t.p) + ' g fehlen noch.';
  else text = 'Protein-Ziel erreicht.';
  return { value, text };
}

function nowBody() {
  const rows = computeScores([...whoop].sort((a, b) => a.d.localeCompare(b.d)));
  const r = [...rows].reverse().find((x) => x.score != null);
  if (!r) return { value: '–', text: whoop.length ? 'Noch zu wenige Nächte für eine Basislinie.' : 'Importiere eine Whoop-CSV in der Erholungs-Kachel.' };
  const age = -dayDiff(r.d);
  const advice = { low: 'Heute ruhig angehen.', mid: 'Ein normaler Tag sollte passen.', high: 'Ein guter Tag für hartes Training.' }[scoreBand(r.score)];
  const debt = r.sleepDebtMin >= 30 ? ' Schlafschuld ' + rcHmShort(r.sleepDebtMin) + '.' : '';
  const old = age > 3 ? 'Letzte Daten sind ' + age + ' Tage alt. ' : '';
  return { value: r.score + ' / 100', text: old + advice + debt };
}

function nowMarkets() {
  const list = tickers.map((s) => ({ s, p: lastQuotes[s] && lastQuotes[s].pct })).filter((x) => typeof x.p === 'number');
  if (!list.length) return { value: '–', text: tickers.length ? 'Lädt Kurse…' : 'Ticker in der Ticker-Kachel hinzufügen.' };
  const big = list.reduce((a, b) => (Math.abs(b.p) > Math.abs(a.p) ? b : a));
  const up = list.filter((x) => x.p > 0).length, down = list.filter((x) => x.p < 0).length;
  return { value: tickerLabel(big.s) + ' ' + sign(big.p, 1) + '%', cls: big.p >= 0 ? 'up' : 'down', text: 'Größte Bewegung heute. ' + up + ' rauf, ' + down + ' runter von ' + list.length + '.' };
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
  add('Protein', t.p, g.p, 'g'); add('Kohlenhydrate', t.c, g.c, 'g'); add('Fett', t.f, g.f, 'g'); add('Zucker', t.s, g.s, 'g');
  const gi = goalInfo();
  if (gi) out.push(nowLine('Gewicht', fmtKg(gi.cur) + ' kg', ''), nowLine('Ziel', fmtKg(gi.goal) + ' kg', ''));
  return nowFits(t, g).concat(out);
}

// From 14:00: your own earlier meals that still fit today, so you decide before you eat (no AI)
function nowFits(t, g) {
  if (new Date().getHours() < 14 || !t.n) return [];
  const left = g.kcal - t.kcal;
  if (left < 150) return [nowLine('Rest des Tages', left < 0 ? 'schon drüber, nichts mehr nötig' : 'nichts mehr nötig', left < 0 ? 'over' : '')];
  const ideas = mealIdeas(left, 3);
  return ideas.length ? [nowLine('Passt heute noch (meistes Protein zuerst)', '', '')].concat(ideas.map((e) => nowLine(e.text, fmtN(e.kcal) + ' kcal · ' + Math.round(e.p) + ' g Protein', 'fit'))) : [];
}

function nowBodyMore() {
  const rows = computeScores([...whoop].sort((a, b) => a.d.localeCompare(b.d)));
  const r = [...rows].reverse().find((x) => x.score != null), out = [];
  if (!r) return out;
  if (r.hrv != null) out.push(nowLine('HRV', r.hrv + ' ms' + (r.baseHrv ? ' (usual ' + r.baseHrv + ')' : '')));
  if (r.rhr != null) out.push(nowLine('Ruhepuls', r.rhr + ' bpm' + (r.baseRhr ? ' (usual ' + r.baseRhr + ')' : '')));
  if (r.sleepMin != null) out.push(nowLine('Schlaf', rcHmShort(r.sleepMin)));
  out.push(nowLine('Daten vom', rcShort(r.d)));
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
  if (lastW && -dayDiff(lastW) >= 7) list.push('Gewicht seit einer Woche nicht eingetragen'), go = 'card-health';
  const lastWa = waist.map((w) => w.d).sort().pop();
  if (lastWa && -dayDiff(lastWa) >= 7) list.push('Bauchumfang seit einer Woche nicht eingetragen'), go = 'card-health';
  const lastC = whoop.map((r) => r.d).sort().pop();
  if (lastC && -dayDiff(lastC) >= 7) list.push('Whoop-Daten älter als eine Woche, neue CSV importieren'), go = 'card-recovery';
  if (now.getHours() >= 14 && !dayTotals(today).n) list.push('keine Mahlzeit eingetragen');
  const a = syncAge();
  if (a.stale) list.push(a.text.toLowerCase()), go = 'card-food';
  return list.length ? { value: list.length === 1 ? '1 Punkt offen' : list.length + ' Punkte offen', text: list.join(' \u00b7 '), go } : null;
}

function renderNow() {
  const box = $('now');
  if (!box) return;
  const rows = [['Als Nächstes', nowNext(), nowNextMore(), 'card-cal'], ['Essen', nowFood(), nowFoodMore(), 'card-food'], ['Erholung', nowBody(), nowBodyMore(), 'card-recovery'], ['Märkte', nowMarkets(), nowMarketsMore(), 'card-tickers']];
  const open = nowOpen();
  if (open) rows.push(['Offen', open, [], open.go]);
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
  if (pairs.length < 2 * PT_MIN_GROUP) return { need: 'Schlaf und Essen: braucht etwa ' + 2 * PT_MIN_GROUP + ' Tage mit beidem (jetzt ' + pairs.length + ').' };
  const med = pairs.map((x) => x.s).sort((a, b) => a - b)[Math.floor(pairs.length / 2)];
  const lo = pairs.filter((x) => x.s < med).map((x) => x.k), hi = pairs.filter((x) => x.s >= med).map((x) => x.k);
  if (lo.length < PT_MIN_GROUP || hi.length < PT_MIN_GROUP) return { need: 'Schlaf und Essen: noch zu wenige unterschiedliche Nächte.' };
  const diff = Math.round(mean(lo) - mean(hi));
  const base = 'Nächte kürzer als ' + rcHmShort(med) + ' (' + lo.length + ' Tage) gegen längere (' + hi.length + ' Tage). ';
  if (Math.abs(diff) < 100) return { head: 'Schlaf und Essen: kein klarer Zusammenhang', text: base + 'Deine Kalorien unterscheiden sich um weniger als 100 kcal.' };
  return { head: 'Schlaf und Essen', text: base + 'Nach einer kurzen Nacht isst du ' + fmtN(Math.abs(diff)) + ' kcal ' + (diff > 0 ? 'more' : 'less') + ' im Schnitt.' };
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
  if (weeks.length < 2 * 3) return { need: 'Protein und Gewicht: braucht etwa 6 Wochen mit Wiegungen und vollständigen Mahlzeiten (jetzt ' + weeks.length + ').' };
  const med = weeks.map((w) => w.p).sort((a, b) => a - b)[Math.floor(weeks.length / 2)];
  const lo = weeks.filter((w) => w.p < med), hi = weeks.filter((w) => w.p >= med);
  if (!lo.length || !hi.length) return { need: 'Protein und Gewicht: noch zu wenige unterschiedliche Wochen.' };
  const dLo = mean(lo.map((w) => w.dw)), dHi = mean(hi.map((w) => w.dw));
  const base = 'Wochen mit mehr Protein (' + Math.round(mean(hi.map((w) => w.p))) + ' g am Tag, ' + hi.length + ' Wochen) gegen weniger (' + Math.round(mean(lo.map((w) => w.p))) + ' g, ' + lo.length + ' Wochen). ';
  if (Math.abs(dHi - dLo) < 0.2) return { head: 'Protein und Gewicht: kein klarer Zusammenhang', text: base + 'Die Gewichtsänderung pro Woche unterscheidet sich um weniger als 0,2 kg.' };
  return { head: 'Protein und Gewicht', text: base + 'Gewichtsänderung pro Woche: ' + sign(dHi, 1) + ' kg gegen ' + sign(dLo, 1) + ' kg.' };
}

function renderPatterns() {
  const box = $('patterns');
  if (!box) return;
  const items = [ptSleepFood(), ptProteinWeight()];
  const blocks = items.map((r) => r.need
    ? el('p', { class: 'muted small pt-need' }, r.need)
    : el('div', { class: 'now-row pt-row' }, el('div', { class: 'now-l' }, r.head), el('div', { class: 'now-t' }, r.text)));
  box.replaceChildren(...blocks, el('p', { class: 'muted small' }, 'Ein Vergleich ist kein Beweis. Wenige Wochen Daten können ein Muster zeigen, das nur Zufall ist.'));
}


/* ---------- Body summary (rules on the Whoop data, AI tips optional) ---------- */
// Range in days (7 / 15 / 30): the last n nights against the n nights before. Per device, like the Recovery card.
let bsRange = store.get('bsRange', 7);
if (![7, 15, 30].includes(bsRange)) bsRange = 7;

// Button group 7 / 15 / 30 days (also used by the Nutrition Summary)
function rangeSeg(cur, pick) {
  return el('div', { class: 'seg bs-seg', role: 'tablist', 'aria-label': 'Zeitraum in Tagen' }, ...[7, 15, 30].map((n) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': String(n === cur), class: n === cur ? 'on' : '', onclick: () => pick(n) }, n + ' Tage')));
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
  const same = rows.filter((x) => rcDev(x) === rcDev(last)); // never compare two different devices
  const weekRows = same.filter((x) => x.d <= last.d).slice(-n);
  const prevRows = same.filter((x) => x.d < weekRows[0].d).slice(-n);
  const week = bsWeek(weekRows), prev = prevRows.length >= 4 ? bsWeek(prevRows) : null; // the earlier period needs at least 4 nights
  // no workouts in either week: probably no workouts file imported, so do not show zeros
  if (!(week.sessions > 0 || (prev && prev.sessions > 0))) for (const w of [week, prev]) if (w) w.sessions = w.trMin = w.trKcal = null;
  return { n, last, age: -dayDiff(last.d), week, prev, weekRows, prevRows };
}

// What is shown per measure: label, value text, how much change counts, and whether higher is better
const BS_ROWS = [
  ['Erholungswert', 'score', (v) => Math.round(v) + ' / 100', 3, true],
  ['HRV', 'hrv', (v) => Math.round(v) + ' ms', 2, true],
  ['Ruhepuls', 'rhr', (v) => Math.round(v) + ' bpm', 1, false],
  ['Schlaf pro Nacht', 'sleep', (v) => rcHmShort(v), 10, true],
  ['Schlafschuld', 'debt', (v) => Math.round(v) + ' min', 10, false],
  ['Effizienz', 'eff', (v) => Math.round(v) + ' %', 1, true],
  ['Tiefschlaf', 'deep', (v) => Math.round(v) + ' %', 1, true],
  ['Streuung Schlafenszeit', 'spread', (v) => '±' + Math.round(v) + ' min', 5, false],
  // training volume is not "better" or "worse" (up = null): only the change is shown
  ['Trainings', 'sessions', (v) => String(Math.round(v)), 1, null],
  ['Trainingszeit', 'trMin', (v) => rcHmShort(v), 20, null],
  ['Trainingsenergie', 'trKcal', (v) => fmtN(v) + ' kcal', 100, null],
];

// Change against last week: { text, cls } cls = better | worse | same
function bsChange(key, cur, old, step, up) {
  if (cur == null || old == null) return { text: '', cls: '' };
  const d = cur - old;
  if (Math.abs(d) < step) return { text: 'gleich', cls: 'same' };
  const unit = { score: '', hrv: ' ms', rhr: ' bpm', sleep: ' min', debt: ' min', eff: ' %', deep: ' pp', spread: ' min', sessions: '', trMin: ' min', trKcal: ' kcal' }[key];
  const text = chArrow(d) + fmtN(Math.abs(d)) + unit;
  if (up === null) return { text, cls: 'same', title: '' };
  return { text, cls: d > 0 === up ? 'better' : 'worse', title: d > 0 === up ? 'besser' : 'schlechter' };
}
// Direction of the change (up / down); green or red says whether that is better or worse.
const chArrow = (d) => (d > 0 ? '\u25b2 ' : '\u25bc ');
// One summary row: label, this period, the period before, change. On the phone the CSS stacks it into two lines.
const bsRow = (r) => el('div', { class: 'bs-line bs-row' }, el('span', { class: 'bs-l' }, r.label), el('b', { class: 'bs-v' }, r.value),
  el('span', { class: 'muted bs-o' }, r.old), el('span', { class: 'bs-ch ' + r.change.cls, title: r.change.title || '' }, r.change.text));

function bsSummary(f) {
  return BS_ROWS.filter(([, k]) => f.week[k] != null).map(([label, k, fmt, step, up]) => ({
    label, value: fmt(f.week[k]), old: f.prev && f.prev[k] != null ? fmt(f.prev[k]) : '', change: f.prev ? bsChange(k, f.week[k], f.prev[k], step, up) : { text: '', cls: '' },
  }));
}

// Fixed rules, used when there is no AI answer
function bsTips(f) {
  const w = f.week, t = [], per = f.n === 7 ? 'diese Woche' : 'letzte ' + f.n + ' Tage';
  const band = scoreBand(Math.round(w.score));
  if (band === 'low') t.push('Deine Erholung war niedrig (' + per + '): ein paar Tage locker trainieren und harte Einheiten meiden.');
  else if (band === 'high') t.push('Deine Erholung war gut (' + per + '): eine gute Zeit für hartes Training.');
  else t.push('Deine Erholung war mittel (' + per + '): mit mittlerer Intensität trainieren.');
  const debt = f.last.sleepDebtMin;
  if (debt > 90) t.push('Schlafschuld über 90 Min.: die nächsten Nächte 30 bis 45 Min. früher ins Bett.');
  else if (debt > 45) t.push('Die Schlafschuld wächst: 20 bis 30 Min. früher ins Bett.');
  if (w.sleep && w.sleep < 420) t.push('Du hast im Schnitt unter 7 Std. pro Nacht geschlafen (' + per + '). Eine feste Aufstehzeit und früher ins Bett helfen am einfachsten.');
  if (w.spread != null && w.spread > 60) t.push('Deine Schlafenszeit schwankt um mehr als eine Stunde. Eine feste Schlafenszeit (etwa ' + rcClock(w.mBed) + ') hilft der Schlafqualität.');
  if (w.eff != null && w.eff < 85) t.push('Schlafeffizienz unter 85 %: weniger Bildschirm im Bett und ein kühleres, dunkleres Zimmer helfen.');
  if (w.deep != null && w.deep < 10) t.push('Tiefschlaf war niedrig (' + Math.round(w.deep) + ' %). Alkohol und späte Mahlzeiten verkürzen ihn oft; Schlafphasen vom Armband sind nur Schätzungen.');
  if (f.prev && f.prev.score != null && w.score - f.prev.score <= -8) t.push('Dein Wert ist gegenüber dem Zeitraum davor klar gefallen. Was hat sich geändert: Stress, Alkohol, späte Nächte, hartes Training?');
  if (f.age > 3) t.push('Die neuesten Daten sind ' + f.age + ' Tage alt. Importiere eine neue Whoop-CSV in der Erholungs-Kachel.');
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
  return 'Language of the answer: ' + 'de-AT (Deutsch)' +
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
    if (!j || typeof j.summary !== 'string' || !Array.isArray(j.tips)) throw new Error('unerwartete Antwort');
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
  return [el('h3', { class: 'bs-wh' }, 'Trainings, letzte ' + f.n + ' Tage')].concat(list.slice(0, 8).map((w) => {
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
  if (!f) { box.replaceChildren(seg, el('p', { class: 'muted' }, whoop.length ? 'Noch zu wenige Nächte für eine Basislinie (etwa 14 nötig).' : 'Importiere eine Whoop-CSV in der Erholungs-Kachel, um Übersicht und Tipps zu sehen.')); return; }
  const cur = bodyAiOf(f.n), ai = anthropicKey && cur.key === bsKey(f) && !cur.err && cur.tips.length ? cur : null;
  let note = '';
  if (!anthropicKey) note = 'Für KI-Tipps einen Anthropic-Key in den Einstellungen eintragen. Das sind feste Regeln.';
  else if (bodyAiBusy) note = 'Schreibt Tipps …';
  else if (cur.err && cur.key === bsKey(f)) note = 'KI-Tipps fehlgeschlagen (' + cur.err + '). Feste Regeln angezeigt, ↻ für neuen Versuch.';
  const tips = ai ? ai.tips.map((t) => el('p', { class: 'bs-tip' }, t.title ? el('b', {}, t.title + ': ') : '', t.text)) : bsTips(f).map((x) => el('p', { class: 'bs-tip' }, x));
  box.replaceChildren(
    seg,
    ai ? el('p', { class: 'bs-sum' }, ai.summary) : '',
    el('div', { class: 'bs-col' }, el('h3', {}, 'Letzte ' + f.n + ' Nächte' + (f.week.from ? ' \u00b7 ' + rcShort(f.week.from) + '\u2013' + rcShort(f.week.to) : '')),
      f.prev ? el('div', { class: 'bs-line bs-head' }, el('span', {}, ''), el('span', {}, 'Letzte ' + f.n), el('span', {}, 'Davor'), el('span', {}, 'Änderung')) : '',
      ...bsSummary(f).map(bsRow),
      ...bsWorkoutList(f)),
    el('div', { class: 'bs-col' }, el('h3', {}, ai ? 'Tipps (KI)' : 'Tipps'), ...tips,
      note ? (anthropicKey ? el('p', { class: 'muted small' }, note) : setupLine('KI-Tipps brauchen deinen Anthropic-Key. Das sind feste Regeln.')) : '',
      f.prev ? '' : el('p', { class: 'muted small' }, 'Kein Vergleich: nur ' + f.prevRows.length + (f.prevRows.length === 1 ? ' Nacht' : ' Nächte') + ' vor diesen ' + f.n + ' Nächten, 4 sind nötig.'),
      el('p', { class: 'muted small' }, 'Keine medizinische Beratung. Armband-Daten sind Schätzungen.')));
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
