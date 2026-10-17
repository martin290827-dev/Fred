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

function nowGo(id) {
  if (tabOf(id) !== activeTab) setTab(tabOf(id));
  requestAnimationFrame(() => jumpTo($(id)));
}

function renderNow() {
  const box = $('now');
  if (!box) return;
  const rows = [['Next', nowNext(), 'card-cal'], ['Food', nowFood(), 'card-food'], ['Recovery', nowBody(), 'card-recovery'], ['Markets', nowMarkets(), 'card-tickers']];
  box.replaceChildren(...rows.map(([label, r, id]) =>
    el('button', { type: 'button', class: 'now-row', onclick: () => nowGo(id) },
      el('div', { class: 'now-l' }, label), el('div', { class: 'now-v ' + (r.cls || '') }, r.value), el('div', { class: 'now-t' }, r.text))));
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

function renderNowCards() { renderNow(); renderPatterns(); }

function initNow() {
  renderNowCards();
  setInterval(() => { if (!document.hidden) renderNowCards(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderNowCards(); });
  setTimeout(renderNowCards, 2500); // after the first data has arrived
}
