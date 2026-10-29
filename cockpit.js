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

// One ring: fill 0..1, colour class, big text in the middle, label and a small line below. tick = mark on the ring (0..1).
function ckRing(label, fill, cls, big, small, tick) {
  const R = 42, C = 2 * Math.PI * R;
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'ck-svg', 'aria-hidden': 'true' });
  svg.append(svgEl('circle', { cx: 50, cy: 50, r: R, class: 'ck-track' }));
  if (fill > 0) svg.append(svgEl('circle', { cx: 50, cy: 50, r: R, class: 'ck-fill ' + cls, 'stroke-dasharray': (C * Math.min(1, fill)).toFixed(1) + ' ' + C.toFixed(1), transform: 'rotate(-90 50 50)' }));
  if (tick != null) { const a = 2 * Math.PI * tick - Math.PI / 2; svg.append(svgEl('line', { x1: 50 + 36 * Math.cos(a), y1: 50 + 36 * Math.sin(a), x2: 50 + 48 * Math.cos(a), y2: 50 + 48 * Math.sin(a), class: 'ck-tick' })); }
  return el('div', { class: 'ck-ring', role: 'img', 'aria-label': label + ': ' + big + (small ? ', ' + small : '') },
    el('div', { class: 'ck-dial' }, svg, el('b', { class: 'ck-big ' + cls }, big)),
    el('div', { class: 'ck-lab' }, label), el('div', { class: 'ck-sm' }, small || ' '));
}

const CK_SLEEP_BAND = (p) => (p >= 85 ? 'g' : p >= 70 ? 'o' : 'r'); // like the usual sleep-performance bands

function ckRings(f) {
  const w = f.week, n = f.norm, out = [];
  // Sleep: hours against need
  out.push(w.sleepPct != null
    ? ckRing(f.needOwn ? 'Schlaf' : 'Schlaf (8 h)', w.sleepPct / 100, 'ck-' + CK_SLEEP_BAND(w.sleepPct), Math.round(w.sleepPct) + ' %', 'Ø ' + rcHmShort(w.sleep))
    : ckRing('Schlaf', 0, '', '–', 'keine Schlafdaten'));
  // Recovery: Fred score
  out.push(w.score != null
    ? ckRing('Erholung', w.score / 100, 'ck-' + RC_RULES.score(w.score), String(Math.round(w.score)), n && n.score != null ? 'Normal ' + Math.round(n.score) : 'Fred-Score')
    : ckRing('Erholung', 0, '', '–', f.calib ? 'Kalibrierung' : 'kein Score'));
  // Load: training time this week; the tick marks your normal week, a full ring is twice your normal
  const l = f.load;
  if (!l) out.push(ckRing('Belastung', 0, '', '–', 'keine Trainings'));
  else {
    const ratio = l.normMin ? l.min / l.normMin : null;
    out.push(ckRing('Belastung', ratio != null ? ratio / 2 : l.min ? 1 : 0, 'ck-load', rcHmShort(l.min), l.normMin != null ? 'Normal ' + rcHmShort(l.normMin) : 'Training', ratio != null ? 0.5 : null));
  }
  return el('div', { class: 'ck-rings' }, ...out);
}

/* rows "week vs normal": label, key, format, step (smaller = same), up (true = higher is better, false = lower, null = neutral) */
const CK_ROWS = [
  ['HRV', 'hrv', (v) => Math.round(v) + ' ms', 2, true],
  ['Ruhepuls', 'rhr', (v) => Math.round(v) + ' bpm', 1, false],
  ['Atemfrequenz', 'resp', (v) => fmtD(v, 1) + ' /min', 0.5, null],
  ['Schlafdauer', 'sleep', (v) => rcHmShort(v), 10, true],
  ['Tiefschlaf', 'deep', (v) => Math.round(v) + ' min', 5, true],
  ['Effizienz', 'eff', (v) => Math.round(v) + ' %', 1, true],
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

function ckList(f) {
  const rows = CK_ROWS.filter(([, k]) => f.week[k] != null).map(([label, k, fmt, step, up]) => {
    const base = f.norm ? f.norm[k] : null;
    const j = base != null ? ckJudge(k, f.week[k], base, step, up) : null;
    return el('div', { class: 'ck-row' },
      el('span', { class: 'ck-l' }, label),
      el('span', { class: 'ck-v' }, el('b', {}, fmt(f.week[k])), el('small', {}, base != null ? 'normal ' + fmt(base) : '')),
      el('span', { class: 'ck-a ' + (j ? j.cls : 'same'), title: j ? j.title : '' }, j ? j.arrow : ''));
  });
  if (f.load && f.load.n + (f.load.normN || 0) > 0) {
    rows.push(el('div', { class: 'ck-row' }, el('span', { class: 'ck-l' }, 'Trainings'),
      el('span', { class: 'ck-v' }, el('b', {}, String(f.load.n) + (f.load.kcal ? ' · ' + fmtN(f.load.kcal) + ' kcal' : '')), el('small', {}, f.load.normN != null ? 'normal ' + fmtD(f.load.normN, 1) + ' pro Woche' : '')),
      el('span', { class: 'ck-a same' }, '')));
  }
  return el('div', { class: 'ck-list' }, ...rows);
}

const CK_DEV_NAME = { whoop: 'Whoop' };

function renderCockpit() {
  const box = $('cockpit');
  if (!box) return;
  const f = ckFacts(whoop, workouts);
  if (!f) { box.replaceChildren(el('p', { class: 'muted' }, 'Noch keine Daten. Lade die CSV-Dateien deines Armbands in der Erholungs-Kachel (Daten).')); return; }
  const head = 'Woche ' + rcShort(f.from) + '–' + rcShort(f.to) + ' · ' + f.nights + (f.nights === 1 ? ' Nacht' : ' Nächte');
  const ageNote = f.age > 1 ? 'Letzte Daten vom ' + rcShort(f.to) + ', vor ' + f.age + ' Tagen.' : '';
  const calibNote = f.calib ? 'Kalibrierung: ' + f.baseN + ' von ' + CK_MIN_BASE + ' Nächten mit diesem Gerät vor dieser Woche. Bis dahin gibt es keinen Normalwert.' : '';
  box.replaceChildren(
    el('p', { class: 'ck-head' }, el('b', {}, head), el('span', { class: 'muted' }, ' · Normal = 30 Nächte davor')),
    ckRings(f),
    ckList(f),
    el('p', { class: 'muted small ck-foot' }, [ageNote, calibNote, 'Schlaf = Stunden im Verhältnis zum Schlafbedarf. Erholung = Fred-Score. Belastung = Trainingszeit der Woche; der Strich am Ring ist deine normale Woche. Gerät: ' + (CK_DEV_NAME[f.dev] || f.dev) + '.'].filter(Boolean).join(' ')));
}
