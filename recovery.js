'use strict';
/* Sleep & Recovery, built from a Whoop CSV export ("Physiologische Zyklen").
   Why not show Whoop's own "Erholungswert %": that score is Whoop's proprietary
   model and does not carry over to a different wearable. Fred computes its own
   score from raw, provider-neutral fields (HRV, resting HR, sleep debt) so the
   same logic keeps working after a provider switch - only the CSV parser below
   needs to change, not this score or the card.
   One row per night, keyed by the wake-up date. Mirrored (raw fields only) to a
   Google Sheet for your own analysis, same pattern as the food/weight log. */

let whoop = store.get('whoop', []); // [{d:'YYYY-MM-DD', hrv, rhr, resp, skinTemp, spo2, sleepMin, sleepNeedMin, sleepDebtMin, sleepEff, sleepConsist, strain, whoopRecovery}]
let rcImportMsg = '';
let rcMirrorMsg = '';

function saveWhoop() { store.set('whoop', whoop); rcMirrorSoon(); }

/* ---------- CSV import (Whoop export: "Physiologische Zyklen") ---------- */

// Whoop's own app dates a recovery by the day you WOKE UP, not the night it started.
// "Beginn des Aufwachens" gives that date; fall back to the cycle start if missing.
function rcRowDate(get) {
  const wake = get('Beginn des Aufwachens');
  const start = get('Startzeit des Zyklus');
  return (wake || start || '').slice(0, 10) || null;
}

function rcParseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(','); // plain numeric/date fields in this export, no quoting needed
    const get = (name) => { const i = header.indexOf(name); const v = i >= 0 ? cells[i] : ''; return v === undefined ? '' : v.trim(); };
    return { get };
  });
}

const rcNum = (s) => (s === '' || s === undefined ? null : Number(s));

function rowToEntry(get) {
  const d = rcRowDate(get);
  const recovery = rcNum(get('Erholungswert %'));
  if (!d || recovery === null) return null; // skip partial/ongoing cycles (no recovery yet)
  return {
    d,
    hrv: rcNum(get('Herzfrequenzvariabilität (ms)')),
    rhr: rcNum(get('Ruheherzfrequenz (Schläge pro Minute)')),
    resp: rcNum(get('Atemfrequenz (Atemzüge/Min.)')),
    skinTemp: rcNum(get('Hauttemperatur (Celsius)')),
    spo2: rcNum(get('Blutsauerstoff %')),
    sleepMin: rcNum(get('Schlafdauer (Min.)')),
    sleepNeedMin: rcNum(get('Schlafbedarf (Min.)')),
    sleepDebtMin: rcNum(get('Schlafdefizit (Min.)')),
    sleepEff: rcNum(get('Schlafeffizienz %')),
    sleepConsist: rcNum(get('Schlafbeständigkeit %')),
    lightMin: rcNum(get('Dauer des Leichtschlafs (Min.)')),
    deepMin: rcNum(get('Dauer des Tiefschlafs (Min.)')),
    remMin: rcNum(get('Dauer des REM-Schlafs (Min.)')),
    awakeMin: rcNum(get('Dauer des Aufwachens (Min.)')),
    bed: get('Beginn des Schlafs').slice(11, 16) || null,   // local clock time, 'HH:MM'
    wake: get('Beginn des Aufwachens').slice(11, 16) || null,
    strain: rcNum(get('Tagesbelastung')),
    whoopRecovery: recovery,
  };
}

function importWhoopCsv(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const rows = rcParseCsv(String(reader.result)).map(({ get }) => rowToEntry(get)).filter(Boolean);
      if (!rows.length) { rcImportMsg = 'Keine verwertbaren Zeilen in der Datei gefunden.'; renderRecovery(); return; }
      const byDate = new Map(whoop.map((r) => [r.d, r]));
      let added = 0, updated = 0;
      for (const r of rows) {
        const existing = byDate.get(r.d);
        // two rows can share a wake-up date (e.g. a short extra nap cycle); keep the one with the longer main sleep
        if (!existing) { byDate.set(r.d, r); added++; }
        else if ((r.sleepMin || 0) >= (existing.sleepMin || 0)) { byDate.set(r.d, r); updated++; }
      }
      whoop = [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d));
      saveWhoop();
      rcImportMsg = added + ' neu, ' + updated + ' aktualisiert \u00b7 ' + whoop.length + ' N\u00e4chte insgesamt.';
    } catch (e) {
      rcImportMsg = 'Import fehlgeschlagen: ' + e.message;
    }
    renderRecovery();
  };
  reader.onerror = () => { rcImportMsg = 'Datei konnte nicht gelesen werden.'; renderRecovery(); };
  reader.readAsText(file);
}

/* ---------- Fred-Score: provider-neutral, from HRV/RHF-Abweichung und Schlafschuld ----------
   Heuristik, kein validiertes Modell wie Whoops eigenes. Baseline = rollende Historie der
   vorherigen (max. 30) Naechte, kausal (nur Daten vor dem jeweiligen Tag), damit der Score
   nach einem Geraetewechsel von selbst neu einpendelt statt an alte Rohwerte gekoppelt zu sein.
   score = 74 + 16*z(HRV) - 10*z(RHF) - min(25, Schlafdefizit/6), geclippt auf 0-100.
   Gewichte per Abgleich mit dem eigenen Whoop-Verlauf gewaehlt (Mittelwert ~56 wie bei Whoop); das ist
   eine Anpassung an dieselben Daten, kein unabhaengiger Beweis, dass der Score 'richtig' ist. */
const RC_BASELINE_MIN = 7;
const RC_BASELINE_WINDOW = 30;

function rcMean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function rcStd(a, m) { return a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) : 0; }

function computeScores(rows) {
  return rows.map((r, i) => {
    const win = rows.slice(Math.max(0, i - RC_BASELINE_WINDOW), i).filter((p) => p.hrv != null && p.rhr != null);
    if (win.length < RC_BASELINE_MIN || r.hrv == null || r.rhr == null) return { ...r, score: null, baseHrv: null, baseRhr: null };
    const hrvs = win.map((p) => p.hrv), rhrs = win.map((p) => p.rhr);
    const mHrv = rcMean(hrvs), sHrv = rcStd(hrvs, mHrv) || 1;
    const mRhr = rcMean(rhrs), sRhr = rcStd(rhrs, mRhr) || 1;
    const zHrv = (r.hrv - mHrv) / sHrv;
    const zRhr = (r.rhr - mRhr) / sRhr;
    const debtPenalty = Math.min(25, Math.max(0, (r.sleepDebtMin || 0) / 6));
    const raw = 74 + 16 * zHrv - 10 * zRhr - debtPenalty;
    return { ...r, score: Math.round(Math.max(0, Math.min(100, raw))), baseHrv: Math.round(mHrv), baseRhr: Math.round(mRhr) };
  });
}

function scoreBand(s) { return s < 34 ? 'low' : s < 67 ? 'mid' : 'high'; }
const BAND_LABEL = { low: 'niedrig', mid: 'mittel', high: 'gut' };

/* ---------- traffic-light rules (g = good, o = watch, r = poor) ----------
   Orientation values, not medical advice. Sleep duration: 7 h or more is the usual adult recommendation.
   Debt, rhythm and stage thresholds are rough rules of thumb; wrist-based sleep stages are estimates. */
const RC_RULES = {
  sleep: (v) => (v >= 420 ? 'g' : v >= 360 ? 'o' : 'r'),            // minutes slept
  debt: (v) => (v <= 45 ? 'g' : v <= 90 ? 'o' : 'r'),               // minutes of sleep debt
  eff: (v) => (v >= 90 ? 'g' : v >= 85 ? 'o' : 'r'),                // sleep efficiency %
  score: (v) => (v >= 67 ? 'g' : v >= 34 ? 'o' : 'r'),              // Fred score
  deep: (v) => (v >= 15 ? 'g' : v >= 10 ? 'o' : 'r'),               // deep sleep, % of sleep
  rem: (v) => (v >= 20 ? 'g' : v >= 15 ? 'o' : 'r'),                // REM sleep, % of sleep
  spread: (v) => (v <= 30 ? 'g' : v <= 60 ? 'o' : 'r'),             // bedtime spread, minutes
  shift: (v) => (v <= 30 ? 'g' : v <= 60 ? 'o' : 'r'),              // one bedtime vs the median, minutes
};
const RC_NAME = { g: 'gut', o: 'beobachten', r: 'schwach' };

const rcShort = (d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.';
const rcHm = (min) => Math.floor(min / 60) + ' h ' + String(Math.round(min % 60)).padStart(2, '0') + ' min';
const rcHmShort = (min) => Math.floor(min / 60) + 'h ' + String(Math.round(min % 60)).padStart(2, '0') + 'm';
const rcClock = (min) => { const m = Math.round(((min % 1440) + 1440) % 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
// minutes after midnight; bedtimes before noon belong to the night after (00:30 -> 24:30), so 23:50 and 00:20 are close
const rcMin = (hhmm, night) => { if (!hhmm) return null; const m = parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3, 5), 10); return night && m < 720 ? m + 1440 : m; };

/* ---------- charts: plain SVG, bars coloured by the rules above ---------- */

// items: [{d, v}]. judge(v) -> 'g'|'o'|'r'. guides: [{v, label}] dashed reference lines.
function rcBars(items, { judge, fmt, max, guides, h }) {
  const W = 600, H = h || 96, T = 6, B = 16;
  const shown = items.map((x) => x.v).filter((v) => v != null);
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rc-chart', role: 'img', 'aria-label': 'Verlauf der letzten ' + items.length + ' Nächte' });
  if (!shown.length) return svg;
  const top = (max || Math.max(...shown)) * 1.08 || 1;
  const y = (v) => T + (H - T - B) * (1 - Math.min(v, top) / top);
  for (const g of guides || []) {
    svg.append(svgEl('line', { x1: 0, x2: W, y1: y(g.v), y2: y(g.v), class: 'rc-guide' }),
      svgEl('text', { x: W - 2, y: y(g.v) - 3, class: 'rc-ax', 'text-anchor': 'end' }, g.label));
  }
  const bw = W / items.length;
  items.forEach((it, i) => {
    if (it.v == null) return;
    const w = Math.max(2, bw - 4);
    const r = svgEl('rect', { x: i * bw + (bw - w) / 2, y: y(it.v), width: w, height: Math.max(2, H - B - y(it.v)), rx: Math.min(3, w / 2), class: 'rc-bar rc-' + judge(it.v) });
    r.append(svgEl('title', {}, rcShort(it.d) + ': ' + fmt(it.v) + ' · ' + RC_NAME[judge(it.v)]));
    svg.append(r);
  });
  svg.append(svgEl('text', { x: 0, y: H - 3, class: 'rc-ax' }, rcShort(items[0].d)), svgEl('text', { x: W, y: H - 3, class: 'rc-ax', 'text-anchor': 'end' }, 'heute'));
  return svg;
}

// Bedtime per night as dots, colour = distance to the median bedtime of the shown nights.
function rcDots(items) {
  const W = 600, H = 120, L = 44, T = 8, B = 16;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rc-chart', role: 'img', 'aria-label': 'Einschlafzeit der letzten Nächte' });
  const vals = items.map((x) => x.v).filter((v) => v != null);
  if (vals.length < 3) return svg;
  const sorted = [...vals].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const lo = Math.floor((sorted[0] - 20) / 60) * 60, hi = Math.ceil((sorted[sorted.length - 1] + 20) / 60) * 60;
  const y = (v) => T + (H - T - B) * ((v - lo) / (hi - lo)); // earlier at the top
  const step = hi - lo > 360 ? 120 : 60;
  for (let v = lo; v <= hi; v += step) {
    svg.append(svgEl('line', { x1: L, x2: W, y1: y(v), y2: y(v), class: 'rc-grid' }), svgEl('text', { x: L - 6, y: y(v) + 4, class: 'rc-ax', 'text-anchor': 'end' }, rcClock(v)));
  }
  svg.append(svgEl('line', { x1: L, x2: W, y1: y(med), y2: y(med), class: 'rc-guide' }), svgEl('text', { x: W - 2, y: y(med) - 3, class: 'rc-ax', 'text-anchor': 'end' }, 'Median ' + rcClock(med)));
  const bw = (W - L) / items.length;
  items.forEach((it, i) => {
    if (it.v == null) return;
    const cls = RC_RULES.shift(Math.abs(it.v - med));
    const c = svgEl('circle', { cx: L + i * bw + bw / 2, cy: y(it.v), r: 5.5, class: 'rc-dotc rc-' + cls });
    c.append(svgEl('title', {}, rcShort(it.d) + ': ins Bett um ' + rcClock(it.v) + ' · ' + Math.round(Math.abs(it.v - med)) + ' min vom Median · ' + RC_NAME[cls]));
    svg.append(c);
  });
  svg.append(svgEl('text', { x: L, y: H - 3, class: 'rc-ax' }, rcShort(items[0].d)), svgEl('text', { x: W, y: H - 3, class: 'rc-ax', 'text-anchor': 'end' }, 'heute'));
  return svg;
}

// One bar split into deep / REM / light / awake.
function rcStages(r) {
  const parts = [['deep', r.deepMin], ['rem', r.remMin], ['light', r.lightMin], ['awake', r.awakeMin]];
  const total = parts.reduce((s, p) => s + (p[1] || 0), 0);
  const bar = el('div', { class: 'rc-stages', role: 'img', 'aria-label': 'Schlafphasen letzte Nacht' });
  for (const [k, v] of parts) if (v) bar.append(el('span', { class: 'rc-st rc-st-' + k, style: 'width:' + ((100 * v) / total).toFixed(1) + '%', title: k + ': ' + v + ' min' }));
  return bar;
}

/* ---------- card ---------- */

function rcTile(label, value, sub, cls) {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-l' }, label), el('div', { class: 'kpi-v' + (cls ? ' rc-t-' + cls : '') }, value), sub ? el('div', { class: 'kpi-s' }, sub) : '');
}

function rcDelta(v, base, unit, higherIsBetter) {
  if (v == null || base == null) return '';
  const d = Math.round(v - base);
  if (d === 0) return el('span', { class: 'rc-t-o' }, 'wie Ø');
  const good = higherIsBetter ? d > 0 : d < 0;
  return el('span', { class: good ? 'rc-t-g' : 'rc-t-r' }, (d > 0 ? '+' : '−') + Math.abs(d) + ' ' + unit + ' vs Ø');
}

// A coloured dot + text: how to read the colours of the chart above.
const rcLegend = (...bits) => el('p', { class: 'muted small rc-legend' }, ...bits.flatMap(([c, t]) => [el('span', { class: 'rc-key rc-' + c }), t + ' ']));

const rcPanel = (title, ...kids) => el('section', { class: 'fpanel' }, el('div', { class: 'food-sub' }, title), ...kids);

function importRow() {
  const input = el('input', { type: 'file', accept: '.csv', id: 'rc-file', class: 'rc-file-input' });
  input.addEventListener('change', () => { if (input.files[0]) importWhoopCsv(input.files[0]); input.value = ''; });
  const btn = el('button', { type: 'button', class: 'ghost small', onclick: () => input.click() }, whoop.length ? 'Neue CSV laden' : 'Whoop-CSV laden');
  return el('div', {},
    el('div', { class: 'row' }, btn, input),
    el('p', { class: 'muted small' }, 'Whoop-App → Export → "Physiologische Zyklen" (CSV).'),
    rcImportMsg ? el('p', { class: 'small' }, rcImportMsg) : '',
    rcMirrorMsg ? el('p', { class: 'muted small' }, rcMirrorMsg) : '');
}

// Two cards: Recovery (score, HRV, resting HR, data import) and Sleep (duration, stages, debt, rhythm).
function renderRecovery() {
  const box = $('recovery'), sbox = $('sleep');
  if (!box || !sbox) return;
  const rows = [...whoop].sort((a, b) => a.d.localeCompare(b.d));
  const scored = computeScores(rows);

  if (!scored.length) {
    box.replaceChildren(el('div', { class: 'food-col' }, rcPanel('Recovery', el('p', { class: 'muted small' }, 'Noch keine Daten. Lade eine Whoop-CSV, um Recovery und Schlaf zu sehen.'), importRow())));
    sbox.replaceChildren(el('div', { class: 'food-col' }, rcPanel('Schlaf', el('p', { class: 'muted small' }, 'Noch keine Daten. Die Whoop-CSV lädst du in der Karte Recovery.'))));
    return;
  }

  const last = scored[scored.length - 1];
  const avgOf = (list, key) => { const v = list.map((r) => r[key]).filter((x) => x != null); return v.length ? rcMean(v) : null; };
  const avgDebt7 = avgOf(rows.slice(-7), 'sleepDebtMin');

  /* Heute */
  // average score over the last n nights (only nights that have a score)
  const avgScore = (n) => { const v = scored.slice(-n).filter((r) => r.score != null).map((r) => r.score); return v.length ? Math.round(rcMean(v)) : null; };
  const avgChip = (label, v) => el('span', { class: 'rc-avg' }, label + ' ', el('b', { class: v != null ? 'rc-t-' + RC_RULES.score(v) : '' }, v != null ? String(v) : '–'));
  const scoreBlock = last.score == null
    ? el('div', { class: 'muted small' }, 'Noch ' + Math.max(1, RC_BASELINE_MIN - rows.length + 1) + ' Nächte bis zur ersten Basiswert-Berechnung.')
    : el('div', {},
      el('div', { class: 'rc-hero' },
        el('div', { class: 'rc-score rc-t-' + RC_RULES.score(last.score) }, String(last.score)),
        el('div', { class: 'muted small' }, BAND_LABEL[scoreBand(last.score)])),
      el('div', { class: 'rc-avgs' }, avgChip('Ø 7 Tage', avgScore(7)), avgChip('Ø 15 Tage', avgScore(15)), avgChip('Ø 30 Tage', avgScore(30))));
  const tiles = el('div', { class: 'kpis' },
    rcTile('HRV', last.hrv != null ? last.hrv + ' ms' : '–', rcDelta(last.hrv, last.baseHrv, 'ms', true)),
    rcTile('Ruhepuls', last.rhr != null ? last.rhr + ' bpm' : '–', rcDelta(last.rhr, last.baseRhr, 'bpm', false)),
    rcTile('Schlafschuld', last.sleepDebtMin != null ? last.sleepDebtMin + ' min' : '–', avgDebt7 != null ? 'Ø 7 Tage: ' + Math.round(avgDebt7) + ' min' : '', last.sleepDebtMin != null ? RC_RULES.debt(last.sleepDebtMin) : ''));
  const strainHint = (() => {
    const strains = rows.filter((r) => r.strain != null).map((r) => r.strain);
    if (strains.length < 10 || last.strain == null) return '';
    const p75 = [...strains].sort((a, b) => a - b)[Math.floor(strains.length * 0.75)];
    return last.strain < p75 ? '' : el('p', { class: 'small rc-hint' }, 'Gestern überdurchschnittliche Belastung (' + last.strain.toFixed(1) + ') — in deinen Daten folgt darauf im Schnitt eine niedrigere Recovery.');
  })();

  /* Schlafdauer und Phasen */
  const hasStages = last.deepMin != null && last.remMin != null && last.lightMin != null;
  const avgSleep7 = avgOf(rows.slice(-7), 'sleepMin');
  const sleepTiles = el('div', { class: 'kpis' },
    rcTile('Letzte Nacht', last.sleepMin != null ? rcHmShort(last.sleepMin) : '–', '', last.sleepMin != null ? RC_RULES.sleep(last.sleepMin) : ''),
    rcTile('Ø 7 Tage', avgSleep7 != null ? rcHmShort(avgSleep7) : '–', '', avgSleep7 != null ? RC_RULES.sleep(avgSleep7) : ''),
    rcTile('Effizienz', last.sleepEff != null ? last.sleepEff + ' %' : '–', 'im Bett schlafend', last.sleepEff != null ? RC_RULES.eff(last.sleepEff) : ''));
  let stageBlock = '';
  if (hasStages && last.sleepMin) {
    const dShare = Math.round((100 * last.deepMin) / last.sleepMin), rShare = Math.round((100 * last.remMin) / last.sleepMin);
    const chip = (name, min, share, cls) => el('div', { class: 'rc-chip' }, el('span', { class: 'rc-key rc-st-' + name }), el('span', {}, ({ deep: 'Tief', rem: 'REM', light: 'Leicht', awake: 'Wach' })[name] + ' '),
      el('b', { class: cls ? 'rc-t-' + cls : '' }, min + ' min' + (share != null ? ' · ' + share + ' %' : '')));
    stageBlock = el('div', {}, rcStages(last),
      el('div', { class: 'rc-chips' }, chip('deep', last.deepMin, dShare, RC_RULES.deep(dShare)), chip('rem', last.remMin, rShare, RC_RULES.rem(rShare)), chip('light', last.lightMin, null, ''), chip('awake', last.awakeMin || 0, null, '')),
      el('p', { class: 'muted small' }, 'Tief grün ab 15 %, REM grün ab 20 % des Schlafs. Phasen sind Schätzungen des Armbands.'));
  }
  const sleepPanel = rcPanel('Schlafdauer', sleepTiles,
    rcBars(rows.slice(-14).map((r) => ({ d: r.d, v: r.sleepMin })), { judge: RC_RULES.sleep, fmt: rcHm, max: 600, guides: [{ v: 420, label: '7 h' }] }),
    rcLegend(['g', '7 h oder mehr'], ['o', '6–7 h'], ['r', 'unter 6 h']), stageBlock);

  /* Schlafschuld */
  const debtAll = rows.filter((r) => r.sleepDebtMin != null);
  const debtShare = debtAll.length >= 14 ? Math.round((100 * debtAll.filter((r) => r.sleepDebtMin > 60).length) / debtAll.length) : null;
  const capped = debtAll.length >= 14 && debtAll.filter((r) => r.sleepDebtMin >= 127).length >= 5;
  const debtPanel = rcPanel('Schlafschuld, letzte 14 Nächte',
    rcBars(rows.slice(-14).map((r) => ({ d: r.d, v: r.sleepDebtMin })), { judge: RC_RULES.debt, fmt: (v) => v + ' min', max: 130 }),
    rcLegend(['g', 'bis 45 min'], ['o', '46–90 min'], ['r', 'über 90 min']),
    el('p', { class: 'muted small' }, 'Min. Schlafdefizit pro Nacht' + (debtShare != null ? ' · ' + debtShare + ' % aller geladenen Nächte liegen über 60 min.' : '') + (capped ? ' Whoop scheint das Defizit bei 127 min zu deckeln: 127 heißt "127 oder mehr".' : '')));

  /* Schlafrhythmus */
  const rh14 = rows.slice(-14).map((r) => ({ d: r.d, v: rcMin(r.bed, true) }));
  const bed7 = rows.slice(-7).map((r) => rcMin(r.bed, true)).filter((v) => v != null);
  const wake7 = rows.slice(-7).map((r) => rcMin(r.wake, false)).filter((v) => v != null);
  const bed14 = rh14.map((x) => x.v).filter((v) => v != null);
  let rhythmPanel;
  if (bed14.length >= 5) {
    const m14 = rcMean(bed14), spread = Math.round(rcStd(bed14, m14));
    rhythmPanel = rcPanel('Schlafrhythmus, letzte 14 Nächte',
      el('div', { class: 'kpis' },
        rcTile('Ins Bett', bed7.length ? rcClock(rcMean(bed7)) : '–', 'Ø 7 Tage'),
        rcTile('Aufstehen', wake7.length ? rcClock(rcMean(wake7)) : '–', 'Ø 7 Tage'),
        rcTile('Streuung', '±' + spread + ' min', 'Einschlafzeit', RC_RULES.spread(spread))),
      rcDots(rh14),
      rcLegend(['g', 'bis 30 min vom Median'], ['o', '31–60 min'], ['r', 'über 60 min']),
      el('p', { class: 'muted small' }, 'Je gleichmäßiger die Einschlafzeit, desto besser; Streuung bis 30 min gilt als gut.'));
  } else {
    rhythmPanel = ''; // no bedtimes in the loaded data: no rhythm panel
  }

  /* Fred-Score */
  const scoreDays = scored.slice(-30);
  const trendPanel = rcPanel('Fred-Score, letzte 30 Nächte',
    rcBars(scoreDays.map((r) => ({ d: r.d, v: r.score })), { judge: RC_RULES.score, fmt: (v) => String(v), max: 100, guides: [{ v: 67, label: '67' }, { v: 34, label: '34' }], h: 100 }),
    rcLegend(['g', '67 und mehr'], ['o', '34–66'], ['r', 'unter 34']));

  box.replaceChildren(el('div', { class: 'food-col' },
    rcPanel('Heute', scoreBlock, tiles, strainHint),
    trendPanel,
    rcPanel('Daten', importRow(),
      el('p', { class: 'muted small' }, 'Fred-Score ist eine eigene Näherung (HRV- und Ruhepuls-Abweichung von deiner rollenden Basis, minus Schlafschuld), kein Whoop-Wert. Nach einem Gerätewechsel pendelt sich die Basis innerhalb von ca. 1–2 Wochen neu ein.'))));
  sbox.replaceChildren(el('div', { class: 'food-col' }, sleepPanel, debtPanel, rhythmPanel));
}

/* ---------- mirror raw fields to a Google Sheet in your Drive (for your own analysis) ---------- */

let rcMirrorTimer = null;

function rcMirrorSoon() {
  clearTimeout(rcMirrorTimer);
  rcMirrorTimer = setTimeout(rcMirror, 8000);
}

async function rcMirror() {
  if (typeof gHasToken !== 'function' || !gHasToken()) return;
  if (!gScopes.includes('drive.file')) { rcMirrorMsg = 'Sheet in Drive braucht eine weitere Google-Berechtigung: Connect drücken.'; renderRecovery(); return; }
  try {
    const rows = [['date', 'hrv_ms', 'rhr_bpm', 'resp_rate', 'skin_temp_c', 'spo2_pct', 'sleep_min', 'sleep_need_min', 'sleep_debt_min', 'sleep_eff_pct', 'sleep_consistency_pct', 'strain', 'whoop_recovery_pct', 'bed_time', 'wake_time', 'light_min', 'deep_min', 'rem_min', 'awake_min']]
      .concat([...whoop].sort((a, b) => a.d.localeCompare(b.d)).map((r) => [r.d, r.hrv, r.rhr, r.resp, r.skinTemp, r.spo2, r.sleepMin, r.sleepNeedMin, r.sleepDebtMin, r.sleepEff, r.sleepConsist, r.strain, r.whoopRecovery, r.bed, r.wake, r.lightMin, r.deepMin, r.remMin, r.awakeMin]));
    await sheetWrite('Fred Recovery Log', csv(rows)); // sheetWrite/csv: shared helpers from food.js
    rcMirrorMsg = 'In Google Sheets gesichert ' + new Date().toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    rcMirrorMsg = 'Sheet: ' + e.message;
  }
  renderRecovery();
}

function initRecovery() {
  renderRecovery();
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderRecovery, 250); });
}
