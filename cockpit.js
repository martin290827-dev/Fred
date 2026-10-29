'use strict';
/* Cockpit card (Body tab, first): the newest uploaded week against your normal.
   Week = the 7 calendar days ending at the newest night with data (data arrive about once a week).
   Normal = the 30 nights before that week, from the SAME device only (field `dev` per night),
   so a new wearable starts its own normal instead of being compared with Whoop numbers.
   Only provider-neutral values: no Whoop strain or Whoop recovery. Loaded after nsum.js. */

const CK_WEEK = 7, CK_BASE = 30, CK_MIN_BASE = 7;
const CK_NEED_MIN = 480; // sleep need when the device gives none (8 h)
const ckDay = (d, n) => toDateStr(addDays(new Date(d + 'T00:00'), n));
const ckAvg = (list, f) => { const v = list.map(f).filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

// Pure: everything the card shows. rows = nights (any order), wos = workouts.
function ckFacts(rows, wos) {
  const all = computeScores([...rows].sort((a, b) => a.d.localeCompare(b.d)));
  if (!all.length) return null;
  const last = all[all.length - 1], dev = rcDev(last);
  const from = ckDay(last.d, -(CK_WEEK - 1)), baseFrom = ckDay(from, -CK_BASE);
  const same = all.filter((r) => rcDev(r) === dev);
  const week = same.filter((r) => r.d >= from);
  const base = same.filter((r) => r.d >= baseFrom && r.d < from);
  const calib = base.length < CK_MIN_BASE;
  const pct = (r) => (r.sleepMin != null ? (100 * r.sleepMin) / (r.sleepNeedMin || CK_NEED_MIN) : null);
  const stats = (list) => ({
    score: ckAvg(list, (r) => r.score), sleepPct: ckAvg(list, pct), sleep: ckAvg(list, (r) => r.sleepMin),
    hrv: ckAvg(list, (r) => r.hrv), rhr: ckAvg(list, (r) => r.rhr), resp: ckAvg(list, (r) => r.resp),
    deep: ckAvg(list, (r) => r.deepMin), eff: ckAvg(list, (r) => r.sleepEff),
  });
  // training: this week's minutes against the average week of the 28 days before
  const wIn = (a, b) => wos.filter((w) => w.d >= a && w.d <= b);
  const wkW = wIn(from, last.d), prevW = wIn(ckDay(from, -28), ckDay(from, -1));
  const sum = (list, f) => list.reduce((s, w) => s + (w[f] || 0), 0);
  const load = wkW.length || prevW.length ? { min: sum(wkW, 'min'), n: wkW.length, kcal: sum(wkW, 'kcal'), normMin: prevW.length ? sum(prevW, 'min') / 4 : null, normN: prevW.length ? prevW.length / 4 : null } : null;
  return { last, dev, from, to: last.d, week: stats(week), norm: calib ? null : stats(base), nights: week.length, baseN: base.length, calib, load, age: -dayDiff(last.d), needOwn: week.some((r) => r.sleepNeedMin) };
}

/* Look: Material 3 (Google Fit style). One dial with three nested rings, a legend with tonal status chips,
   then tonal tiles with an icon, the value, a chip with the change and the normal value. */

// Small line icons (24 x 24, stroke), one per measure
const CK_ICONS = {
  sleep: 'M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z',
  rec: 'M3 12h4l2-5 4 10 2-5h6',
  load: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8',
  hrv: 'M3 13h3l2-6 3 12 3-9 2 3h5',
  rhr: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  resp: 'M4 9h10a3 3 0 1 0-3-3M4 13h14a3 3 0 1 1-3 3M4 17h6',
  deep: 'M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0',
  eff: 'M5 19L19 5M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
};
const ckIcon = (k) => { const s = svgEl('svg', { viewBox: '0 0 24 24', class: 'ck-ic', 'aria-hidden': 'true' }); s.append(svgEl('path', { d: CK_ICONS[k] })); return s; };

// The dial: rings from outside to inside. ring = { cls, fill (0..1), tick (0..1 or null) }
function ckDial(rings, centre, sub) {
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'ck-svg', 'aria-hidden': 'true' });
  rings.forEach((r, i) => {
    const R = 44 - i * 10, C = 2 * Math.PI * R;
    svg.append(svgEl('circle', { cx: 50, cy: 50, r: R, class: 'ck-track ' + r.cls }));
    if (r.fill > 0) svg.append(svgEl('circle', { cx: 50, cy: 50, r: R, class: 'ck-fill ' + r.cls, 'stroke-dasharray': (C * Math.min(1, r.fill)).toFixed(2) + ' ' + C.toFixed(2), transform: 'rotate(-90 50 50)' }));
    if (r.tick != null) { const a = 2 * Math.PI * r.tick - Math.PI / 2; svg.append(svgEl('line', { x1: 50 + (R - 4) * Math.cos(a), y1: 50 + (R - 4) * Math.sin(a), x2: 50 + (R + 4) * Math.cos(a), y2: 50 + (R + 4) * Math.sin(a), class: 'ck-tick' })); }
  });
  return el('div', { class: 'ck-dial' }, svg, el('div', { class: 'ck-centre' }, el('b', {}, centre), el('span', {}, sub)));
}

// Tonal chip: tone 'good' | 'bad' | 'warn' | 'neutral'
const ckChip = (tone, text, title) => el('span', { class: 'ck-chip ck-' + tone, title: title || '' }, text);
const CK_TONE = { g: 'good', o: 'warn', r: 'bad' };

// One legend line next to the dial
const ckLegend = (cls, icon, label, value, chip, note) => el('div', { class: 'ck-leg' },
  el('span', { class: 'ck-dot ' + cls }, ckIcon(icon)),
  el('div', { class: 'ck-leg-t' }, el('span', { class: 'ck-leg-l' }, label), el('span', { class: 'ck-leg-v' }, value), note ? el('span', { class: 'ck-leg-n' }, note) : ''),
  chip || '');

const CK_SLEEP_BAND = (p) => (p >= 85 ? 'g' : p >= 70 ? 'o' : 'r'); // like the usual sleep-performance bands
const CK_SLEEP_WORD = { g: 'genug', o: 'knapp', r: 'zu wenig' };

function ckHero(f) {
  const w = f.week, n = f.norm, l = f.load;
  const ratio = l && l.normMin ? l.min / l.normMin : null;
  const rings = [
    { cls: 'ck-c-sleep', fill: w.sleepPct != null ? w.sleepPct / 100 : 0 },
    { cls: 'ck-c-rec', fill: w.score != null ? w.score / 100 : 0 },
    { cls: 'ck-c-load', fill: ratio != null ? ratio / 2 : l && l.min ? 1 : 0, tick: ratio != null ? 0.5 : null },
  ];
  const sb = w.sleepPct != null ? CK_SLEEP_BAND(w.sleepPct) : null;
  const rb = w.score != null ? RC_RULES.score(w.score) : null;
  const loadWord = ratio == null ? null : ratio < 0.75 ? 'weniger als normal' : ratio > 1.25 ? 'mehr als normal' : 'wie normal';
  const legend = el('div', { class: 'ck-legend' },
    ckLegend('ck-c-sleep', 'sleep', f.needOwn ? 'Schlaf vom Bedarf' : 'Schlaf von 8 h', w.sleepPct != null ? Math.round(w.sleepPct) + ' %' : '–',
      sb ? ckChip(CK_TONE[sb], CK_SLEEP_WORD[sb]) : '', w.sleep != null ? 'Ø ' + rcHmShort(w.sleep) + ' pro Nacht' : ''),
    ckLegend('ck-c-rec', 'rec', 'Erholung', w.score != null ? String(Math.round(w.score)) : '–',
      rb ? ckChip(CK_TONE[rb], BAND_LABEL[scoreBand(w.score)]) : '', n && n.score != null ? 'Normal ' + Math.round(n.score) : f.calib ? 'Kalibrierung' : 'Fred-Score'),
    ckLegend('ck-c-load', 'load', 'Belastung', l ? rcHmShort(l.min) : '–',
      loadWord ? ckChip('neutral', loadWord) : '', l ? (l.normMin != null ? 'Normal ' + rcHmShort(l.normMin) : 'Trainingszeit') : 'keine Trainings'));
  const dial = ckDial(rings, w.score != null ? String(Math.round(w.score)) : '–', 'Erholung');
  return el('div', { class: 'ck-hero', role: 'img', 'aria-label': 'Schlaf, Erholung und Belastung der Woche' }, dial, legend);
}

/* rows "week vs normal": label, key, format, step (smaller = same), up (true = higher is better, false = lower, null = neutral) */
const CK_ROWS = [
  ['HRV', 'hrv', (v) => Math.round(v) + ' ms', 2, true, 'hrv'],
  ['Ruhepuls', 'rhr', (v) => Math.round(v) + ' bpm', 1, false, 'rhr'],
  ['Atemfrequenz', 'resp', (v) => fmtD(v, 1) + ' /min', 0.5, null, 'resp'],
  ['Schlafdauer', 'sleep', (v) => rcHmShort(v), 10, true, 'sleep'],
  ['Tiefschlaf', 'deep', (v) => Math.round(v) + ' min', 5, true, 'deep'],
  ['Effizienz', 'eff', (v) => Math.round(v) + ' %', 1, true, 'eff'],
];

// Arrow and colour for one row. Breathing rate: a rise of 1 /min or more is marked, otherwise neutral.
function ckJudge(k, v, base, step, up) {
  const d = v - base;
  if (Math.abs(d) < step) return { arrow: '●', cls: 'same', title: 'wie normal' };
  const arrow = d > 0 ? '▲' : '▼';
  if (k === 'resp') return d >= 1 ? { arrow, cls: 'worse', title: 'deutlich erhöht (oft bei Infekt, Alkohol oder Stress)' } : { arrow, cls: 'same', title: 'leicht verändert' };
  if (up == null) return { arrow, cls: 'same', title: '' };
  const good = up ? d > 0 : d < 0;
  return { arrow, cls: good ? 'better' : 'worse', title: good ? 'besser als normal' : 'schlechter als normal' };
}

// value text split into number and unit, so the unit can be smaller ("20" "ms")
const ckSplit = (t) => { const m = /^(.*?)\s([^\d\s]+)$/.exec(t); return m ? [m[1], m[2]] : [t, '']; };
const CK_JTONE = { better: 'good', worse: 'bad', same: 'neutral' };

function ckTile(icon, label, valueText, chip, note, wide) {
  const [num, unit] = ckSplit(valueText);
  return el('div', { class: 'ck-tile' + (wide ? ' ck-wide' : '') },
    el('div', { class: 'ck-tile-h' }, ckIcon(icon), el('span', {}, label)),
    el('div', { class: 'ck-tile-v' }, num, unit ? el('small', {}, ' ' + unit) : ''),
    el('div', { class: 'ck-tile-f' }, chip || '', note ? el('span', { class: 'ck-tile-n' }, note) : ''));
}

function ckList(f) {
  const tiles = CK_ROWS.filter(([, k]) => f.week[k] != null).map(([label, k, fmt, step, up, icon]) => {
    const base = f.norm ? f.norm[k] : null;
    if (base == null) return ckTile(icon, label, fmt(f.week[k]), '', '');
    const j = ckJudge(k, f.week[k], base, step, up);
    const d = f.week[k] - base;
    const text = j.arrow === '●' ? '≈ normal' : j.arrow + ' ' + fmt(Math.abs(d));
    return ckTile(icon, label, fmt(f.week[k]), ckChip(CK_JTONE[j.cls], text, j.title), 'Normal ' + fmt(base));
  });
  if (f.load && f.load.n + (f.load.normN || 0) > 0) {
    tiles.push(ckTile('load', 'Trainings', f.load.n + (f.load.n === 1 ? ' Einheit' : ' Einheiten'),
      f.load.kcal ? ckChip('neutral', fmtN(f.load.kcal) + ' kcal') : '', f.load.normN != null ? 'Normal ' + fmtD(f.load.normN, 1) + ' pro Woche' : '', true));
  }
  return el('div', { class: 'ck-tiles' }, ...tiles);
}

const CK_DEV_NAME = { whoop: 'Whoop' };

function renderCockpit() {
  const box = $('cockpit');
  if (!box) return;
  const f = ckFacts(whoop, workouts);
  if (!f) { box.replaceChildren(el('p', { class: 'muted' }, 'Noch keine Daten. Lade die CSV-Dateien deines Armbands in der Erholungs-Kachel (Daten).')); return; }
  const ageNote = f.age > 1 ? 'Letzte Daten vom ' + rcShort(f.to) + ', vor ' + f.age + ' Tagen.' : '';
  const calibNote = f.calib ? 'Kalibrierung: ' + f.baseN + ' von ' + CK_MIN_BASE + ' Nächten mit diesem Gerät vor dieser Woche. Bis dahin gibt es keinen Normalwert.' : '';
  box.replaceChildren(
    el('div', { class: 'ck-head' }, el('span', { class: 'ck-date' }, ckIcon('cal'), DF_SHORT.format(new Date(f.from + 'T00:00')) + ' – ' + DF_SHORT.format(new Date(f.to + 'T00:00'))),
      el('span', { class: 'ck-head-s' }, f.nights + (f.nights === 1 ? ' Nacht' : ' Nächte') + ' · verglichen mit den 30 Nächten davor')),
    ckHero(f),
    ckList(f),
    el('p', { class: 'ck-foot' }, [ageNote, calibNote, 'Erholung = Fred-Score. Belastung = Trainingszeit der Woche; der Strich am inneren Ring ist deine normale Woche. Gerät: ' + (CK_DEV_NAME[f.dev] || f.dev) + '.'].filter(Boolean).join(' ')));
}
