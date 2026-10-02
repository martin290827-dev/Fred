'use strict';
/* Poker Piggy Bank: your sessions (date, place, game, win or loss) with a curve, monthly bars and totals.
   Every session is also written to the hidden Drive archive, so the history stays for later analysis. */

let poker = store.get('poker', []); // [{ id, d: 'YYYY-MM-DD', place, game, amt }]  amt in EUR, negative = loss
let pokerEditId = null;
const POKER_GAMES = ['Cash', 'Tournament', 'Other'];

// +€120 / −€45 / €0
function eur(v, plus) {
  const r = Math.round(v * 100) / 100;
  return (r < 0 ? '−' : plus && r > 0 ? '+' : '') + '€' + Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
}
const pkCls = (v) => (v > 0 ? 'pk-up' : v < 0 ? 'pk-down' : '');

// Focus leaves the form first, otherwise the card would not redraw.
function pokerRedraw() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  renderPoker();
}

function pokerSave() {
  store.set('poker', poker);
  pokerArchive();
  pokerRedraw();
}

// Add new and changed sessions to the archive. A session you delete is removed there too.
function pokerArchive() {
  if (typeof arcPut !== 'function') return;
  for (const e of poker) arcPut('poker', e.id, { date: e.d, place: e.place, game: e.game, result_eur: e.amt, id: e.id });
  arcCommit();
}

function pokerStats(list) {
  const n = list.length;
  const total = list.reduce((s, e) => s + e.amt, 0);
  const wins = list.filter((e) => e.amt > 0).length;
  const from = toDateStr(addDays(new Date(), -30));
  return {
    n, total, wins,
    rate: n ? Math.round((100 * wins) / n) : 0,
    avg: n ? total / n : 0,
    best: n ? Math.max(...list.map((e) => e.amt)) : 0,
    worst: n ? Math.min(...list.map((e) => e.amt)) : 0,
    last30: list.filter((e) => e.d >= from).reduce((s, e) => s + e.amt, 0),
  };
}

/* ---------- form ---------- */

function pokerForm() {
  const e = pokerEditId ? poker.find((x) => x.id === pokerEditId) : null;
  const date = el('input', { type: 'date', name: 'd', required: '', 'aria-label': 'Date' }); date.value = e ? e.d : toDateStr(new Date());
  const place = el('input', { type: 'text', name: 'place', placeholder: 'Optional', maxlength: '60', list: 'pk-places', autocomplete: 'off', 'aria-label': 'Place' }); place.value = e ? e.place : '';
  const dl = el('datalist', { id: 'pk-places' }, ...[...new Set(poker.map((x) => x.place).filter(Boolean))].map((p) => el('option', { value: p })));
  const amount = el('input', { type: 'text', inputmode: 'decimal', name: 'amt', placeholder: '0', required: '', autocomplete: 'off', 'aria-label': 'Amount in euro' });
  amount.value = e ? String(Math.abs(e.amt)) : '';
  // segmented controls (like iOS): game and win / loss
  let game = e ? e.game : (poker.length ? poker[poker.length - 1].game : 'Cash'); // same as last time
  const gBtns = POKER_GAMES.map((g) => el('button', { type: 'button', onclick: () => { game = g; gBtns.forEach((x, i) => x.classList.toggle('on', POKER_GAMES[i] === g)); } }, g));
  gBtns.forEach((x, i) => x.classList.toggle('on', POKER_GAMES[i] === game));
  let sign = e && e.amt < 0 ? -1 : 1;
  const win = el('button', { type: 'button' }, 'Win'), loss = el('button', { type: 'button' }, 'Loss');
  const pick = (s) => { sign = s; win.className = s > 0 ? 'on up' : ''; loss.className = s < 0 ? 'on down' : ''; };
  win.addEventListener('click', () => pick(1)); loss.addEventListener('click', () => pick(-1));
  pick(sign);
  const row = (label, ...kids) => el('div', { class: 'pk-r' }, el('span', { class: 'pk-l' }, label), ...kids);
  const msg = el('p', { class: 'muted small pk-msg' });
  const form = el('form', { class: 'pk-form', autocomplete: 'off' },
    el('div', { class: 'pk-group' },
      row('Date', date),
      el('div', { class: 'pk-r pk-r-seg' }, el('div', { class: 'pk-seg pk-seg3', role: 'group', 'aria-label': 'Game' }, ...gBtns)),
      row('Place', place),
      row('Result', el('div', { class: 'pk-seg', role: 'group', 'aria-label': 'Win or loss' }, win, loss)),
      row('Amount (\u20ac)', amount)),
    dl, msg,
    el('div', { class: 'pk-btns' },
      e ? el('button', { type: 'button', class: 'pk-cancel', onclick: () => { pokerEditId = null; pokerRedraw(); } }, 'Cancel') : '',
      el('button', { type: 'submit', class: 'pk-add' }, e ? 'Save session' : 'Add session')));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = parseFloat(String(amount.value).replace(',', '.'));
    if (!date.value || !isFinite(v) || v < 0) { msg.textContent = 'Enter the amount as a number, e.g. 120 or 45.50.'; return; }
    const r = { d: date.value, place: place.value.trim(), game, amt: Math.round(sign * v * 100) / 100 };
    if (e) Object.assign(e, r); else poker.push(Object.assign({ id: uid() }, r));
    pokerEditId = null;
    pokerSave();
  });
  return form;
}

/* ---------- charts ---------- */

// Total result after each session, from the first session on.
function pokerCurve(list) {
  const W = 600, H = 150, L = 58, B = 22, T = 10;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'fchart', role: 'img', 'aria-label': 'Total result over time' });
  if (list.length < 2) { svg.append(svgEl('text', { x: W / 2, y: H / 2, class: 'ax', 'text-anchor': 'middle' }, 'Add at least 2 sessions to see the curve.')); return svg; }
  let run = 0;
  const pts = list.map((e) => { run += e.amt; return { e, run, t: new Date(e.d + 'T00:00').getTime() }; });
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const lo = Math.min(0, ...pts.map((p) => p.run)), hi = Math.max(0, ...pts.map((p) => p.run));
  const x = (p, i) => L + (W - L - 8) * (t1 > t0 ? (p.t - t0) / (t1 - t0) : i / (pts.length - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  for (const v of [lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i)) {
    svg.append(svgEl('line', { x1: L, x2: W, y1: y(v), y2: y(v), class: v === 0 ? 'tgt' : 'grid' }), svgEl('text', { x: L - 6, y: y(v) + 4, class: 'ax', 'text-anchor': 'end' }, eur(v)));
  }
  svg.append(svgEl('text', { x: L, y: H - 4, class: 'ax' }, shortDay(list[0].d)), svgEl('text', { x: W - 8, y: H - 4, class: 'ax', 'text-anchor': 'end' }, shortDay(list[list.length - 1].d)));
  svg.append(svgEl('polyline', { points: pts.map((p, i) => x(p, i).toFixed(1) + ',' + y(p.run).toFixed(1)).join(' '), class: 'wline' }));
  pts.forEach((p, i) => {
    const tip = shortDay(p.e.d) + ' · ' + (p.e.place || 'no place') + ' · ' + p.e.game + ': ' + eur(p.e.amt, true) + ' (total ' + eur(p.run) + ')';
    svg.append(svgEl('circle', { cx: x(p, i).toFixed(1), cy: y(p.run).toFixed(1), r: 3.5, class: 'pk-dot ' + (p.e.amt >= 0 ? 'up' : 'down'), 'pointer-events': 'none' }));
    const hit = svgEl('circle', { cx: x(p, i).toFixed(1), cy: y(p.run).toFixed(1), r: 10, fill: 'transparent' });
    hit.append(svgEl('title', {}, tip));
    svg.append(hit);
  });
  return svg;
}

// Result per month, last 12 months.
function pokerMonths(list) {
  const W = 600, H = 130, L = 58, B = 22, T = 10;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'fchart', role: 'img', 'aria-label': 'Result per month' });
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return toDateStr(d).slice(0, 7); });
  const sums = months.map((m) => list.filter((e) => e.d.slice(0, 7) === m).reduce((s, e) => s + e.amt, 0));
  if (!sums.some((v) => v !== 0)) { svg.append(svgEl('text', { x: W / 2, y: H / 2, class: 'ax', 'text-anchor': 'middle' }, 'No sessions in the last 12 months.')); return svg; }
  const lo = Math.min(0, ...sums), hi = Math.max(0, ...sums);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const slot = (W - L - 8) / 12;
  for (const v of [lo, hi].filter((v) => v !== 0)) svg.append(svgEl('text', { x: L - 6, y: y(v) + 4, class: 'ax', 'text-anchor': 'end' }, eur(v)));
  svg.append(svgEl('line', { x1: L, x2: W, y1: y(0), y2: y(0), class: 'tgt' }));
  months.forEach((m, i) => {
    const v = sums[i], bx = L + slot * i + slot * 0.18, bw = slot * 0.64;
    const label = new Date(m + '-01T00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    if (v !== 0) {
      const r = svgEl('rect', { x: bx.toFixed(1), y: Math.min(y(v), y(0)).toFixed(1), width: bw.toFixed(1), height: Math.max(2, Math.abs(y(v) - y(0))).toFixed(1), rx: 3, class: 'pk-bar ' + (v > 0 ? 'up' : 'down') });
      svg.append(r);
    }
    svg.append(svgEl('text', { x: (bx + bw / 2).toFixed(1), y: H - 6, class: 'ax', 'text-anchor': 'middle' }, new Date(m + '-01T00:00').toLocaleDateString('en-GB', { month: 'narrow' })));
    // whole month column reacts to hover or tap, also months without a bar
    const n = list.filter((e) => e.d.slice(0, 7) === m).length;
    const hit = svgEl('rect', { x: (L + slot * i).toFixed(1), y: T, width: slot.toFixed(1), height: H - T, fill: 'transparent' });
    hit.append(svgEl('title', {}, label + ': ' + (n ? eur(v, true) + ' \u00b7 ' + n + (n === 1 ? ' session' : ' sessions') : 'no sessions')));
    svg.append(hit);
  });
  return svg;
}

/* ---------- card ---------- */

// Total per place or per game, best first.
function pokerBy(list, key, title) {
  const m = new Map();
  for (const e of list) { const k = e[key] || '–'; const o = m.get(k) || { n: 0, sum: 0 }; o.n++; o.sum += e.amt; m.set(k, o); }
  const rows = [...m.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 6);
  return el('div', { class: 'pk-by' }, el('div', { class: 'food-sub' }, title),
    ...rows.map(([k, o]) => el('div', { class: 'pk-line' }, el('span', { class: 'grow' }, k, el('span', { class: 'muted small' }, ' · ' + o.n + (o.n === 1 ? ' session' : ' sessions'))), el('b', { class: pkCls(o.sum) }, eur(o.sum, true)))));
}

function pokerList(list) {
  const ul = el('ul', { class: 'list pk-list' });
  for (const e of [...list].reverse().slice(0, 30)) {
    ul.append(el('li', { class: 'pk-item' },
      el('span', { class: 'muted small pk-d' }, shortDay(e.d)),
      el('span', { class: 'grow meal-t' }, [e.place, e.game].filter(Boolean).join(' · ')),
      el('b', { class: pkCls(e.amt) }, eur(e.amt, true)),
      el('span', { class: 'meal-act' },
        iconButton('edit', 'Edit session', () => { pokerEditId = e.id; pokerRedraw(); }),
        iconButton('trash', 'Delete session', () => { poker = poker.filter((x) => x.id !== e.id); if (typeof arcDelete === 'function') { arcDelete('poker', e.id); arcCommit(); } pokerSave(); }))));
  }
  return ul;
}

function renderPoker() {
  const box = $('poker');
  if (!box) return;
  if (typeof renderWeekly === 'function') renderWeekly();
  if (box.contains(document.activeElement) && document.activeElement.closest('.pk-form')) return; // typing: do not redraw
  const list = [...poker].sort((a, b) => a.d.localeCompare(b.d));
  const s = pokerStats(list);
  const kpi = (l, v, c) => el('div', { class: 'hstat' }, el('div', { class: 'hstat-l' }, l), el('div', { class: 'hstat-v ' + (c || '') }, v));
  const hero = hcard('goal', 'green', 'Performance', s.n ? s.n + (s.n === 1 ? ' session' : ' sessions') : '',
    el('div', { class: 'pk-total ' + pkCls(s.total) }, s.n ? eur(s.total, true) : '–'),
    s.n ? el('div', { class: 'pk-kpis' },
      kpi('30 days', eur(s.last30, true), pkCls(s.last30)), kpi('Per session', eur(s.avg, true), pkCls(s.avg)), kpi('Winning', s.rate + ' %'),
      kpi('Best', eur(s.best, true), pkCls(s.best)), kpi('Worst', eur(s.worst, true), pkCls(s.worst)), kpi('Wins', s.wins + ' of ' + s.n)) : el('p', { class: 'muted small' }, 'Add your first session below.'));
  box.replaceChildren(el('div', { class: 'food-col' },
    hcard('pulse', 'indigo', pokerEditId ? 'Edit session' : 'New session', '', pokerForm()),
    hero,
    hcard('line', 'purple', 'Total over time', s.n ? eur(s.total, true) : '', pokerCurve(list)),
    hcard('bars', 'orange', 'Per month', 'last 12 months', pokerMonths(list)),
    s.n ? hcard('meals', 'teal', 'By place and game', '', pokerBy(list, 'place', 'Place'), pokerBy(list, 'game', 'Game')) : '',
    s.n ? hcard('meals', 'pink', 'Sessions', 'latest first', pokerList(list)) : ''));
}

function initPoker() {
  pokerArchive();
  renderPoker();
}
