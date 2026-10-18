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
  return out;
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
      more.length ? el('ul', { class: 'now-x' }, ...more.map((m) => el('li', { class: m.cls === 'over' ? 'over' : '' }, el('span', {}, m.l), el('b', { class: m.cls === 'up' || m.cls === 'down' ? m.cls : '' }, m.v)))) : '')));
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


/* ---------- Body summary (rules on the Whoop data, no AI, no cost) ---------- */
const bsAvg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const bsSigned = (v, unit) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v) + unit;

// Numbers from the newest night and the 7 nights before it
function bsFacts() {
  const rows = computeScores([...whoop].sort((a, b) => a.d.localeCompare(b.d)));
  const last = [...rows].reverse().find((x) => x.score != null);
  if (!last) return null;
  const week = rows.filter((x) => x.d <= last.d).slice(-7);
  const prev = rows.filter((x) => x.d < last.d).slice(-7); // the 7 nights before, so the newest night is not compared with itself
  const bed = week.map((x) => rcMin(x.bed, true)).filter((v) => v != null);
  const mBed = bsAvg(bed);
  return {
    last, age: -dayDiff(last.d),
    avgScore: Math.round(bsAvg(prev.map((x) => x.score).filter((v) => v != null)) || 0),
    avgSleep: Math.round(bsAvg(prev.map((x) => x.sleepMin).filter((v) => v != null)) || 0),
    spread: bed.length >= 5 ? Math.round(rcStd(bed, mBed)) : null,
    mBed,
    deepPct: last.sleepMin && last.deepMin != null ? Math.round(100 * last.deepMin / last.sleepMin) : null,
  };
}

function bsSummary(f) {
  const r = f.last, out = [];
  const band = { low: 'low', mid: 'medium', high: 'good' }[scoreBand(r.score)];
  const diff = r.score - f.avgScore;
  out.push(['Recovery', r.score + ' / 100 (' + band + '), ' + (Math.abs(diff) < 3 ? 'about the average of the 7 nights before (' + f.avgScore + ').' : Math.abs(diff) + (diff < 0 ? ' below' : ' above') + ' the average of the 7 nights before (' + f.avgScore + ').')]);
  const body = [];
  if (r.hrv != null && r.baseHrv) body.push('HRV ' + r.hrv + ' ms (' + bsSigned(r.hrv - r.baseHrv, ' ms') + ' vs usual)');
  if (r.rhr != null && r.baseRhr) body.push('resting HR ' + r.rhr + ' bpm (' + bsSigned(r.rhr - r.baseRhr, ' bpm') + ')');
  if (body.length) out.push(['Body', body.join(', ') + '.']);
  if (r.sleepMin != null) out.push(['Sleep', rcHmShort(r.sleepMin) + ' last night, the 7 nights before averaged ' + rcHmShort(f.avgSleep) + (r.sleepEff != null ? '. Efficiency ' + Math.round(r.sleepEff) + ' %.' : '.')]);
  if (r.sleepDebtMin != null) out.push(['Sleep debt', r.sleepDebtMin + ' min.']);
  if (f.spread != null) out.push(['Rhythm', 'bedtime around ' + rcClock(f.mBed) + ', spread ±' + f.spread + ' min.']);
  return out;
}

function bsTips(f) {
  const r = f.last, t = [];
  const band = scoreBand(r.score);
  if (band === 'low') t.push('Recovery is low: keep training light today (walk, easy mobility) and avoid hard sessions.');
  else if (band === 'high') t.push('Recovery is good: a fine day for hard training.');
  else t.push('Recovery is medium: a normal day is fine, train at moderate effort.');
  if (r.sleepDebtMin > 90) t.push('Sleep debt is over 90 min: go to bed 30 to 45 min earlier for the next few nights.');
  else if (r.sleepDebtMin > 45) t.push('Sleep debt is building up: aim for bed 20 to 30 min earlier tonight.');
  if (f.avgSleep && f.avgSleep < 420) t.push('Your sleep average of the last 7 nights is under 7 h. A fixed wake time and an earlier bedtime are the simplest fix.');
  if (f.spread != null && f.spread > 60) t.push('Your bedtime varies by more than an hour. A steady bedtime (about ' + rcClock(f.mBed) + ') helps sleep quality more than one long night.');
  if (r.sleepEff != null && r.sleepEff < 85) t.push('Sleep efficiency is under 85 %: less screen time in bed and a cooler, darker room can help.');
  if (f.deepPct != null && f.deepPct < 10) t.push('Deep sleep was low (' + f.deepPct + ' %). Alcohol and late meals often cut it; wrist-based stages are only estimates.');
  if (r.rhr != null && r.baseRhr && r.rhr - r.baseRhr >= 5 && r.hrv != null && r.baseHrv && r.hrv < r.baseHrv) t.push('Resting HR up and HRV down together can mean stress, alcohol, illness or hard training. Watch the next days.');
  if (f.age > 3) t.push('The newest data is ' + f.age + ' days old. Import a new Whoop CSV in the Recovery card.');
  return t.slice(0, 5);
}

function renderBodySum() {
  const box = $('bodysum');
  if (!box) return;
  const f = bsFacts();
  if (!f) { box.replaceChildren(el('p', { class: 'muted' }, whoop.length ? 'Not enough nights for a baseline yet (about 14 are needed).' : 'Import a Whoop CSV in the Recovery card to see a summary and tips.')); return; }
  box.replaceChildren(
    el('div', { class: 'bs-col' }, el('h3', {}, 'Summary · ' + rcShort(f.last.d)), ...bsSummary(f).map(([l, v]) => el('div', { class: 'bs-line' }, el('span', { class: 'bs-l' }, l), el('span', {}, v)))),
    el('div', { class: 'bs-col' }, el('h3', {}, 'Tips'), ...bsTips(f).map((x) => el('p', { class: 'bs-tip' }, x)),
      el('p', { class: 'muted small' }, 'Rules of thumb from your own data, not medical advice.')));
}

function renderNowCards() { renderNow(); renderPatterns(); renderBodySum(); }

function initNow() {
  renderNowCards();
  setInterval(() => { if (!document.hidden) renderNowCards(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderNowCards(); });
  setTimeout(renderNowCards, 2500); // after the first data has arrived
}
