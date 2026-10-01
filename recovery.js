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

/* ---------- small charts (plain SVG, no axes - just a shape and a caption) ---------- */

function rcSpark(values, { h, color, bars, target }) {
  const W = 600, H = h || 70, pad = 4;
  const vals = values.map((v) => (v == null ? null : v));
  const shown = vals.filter((v) => v !== null);
  if (!shown.length) return svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rc-spark' });
  const max = Math.max(...shown, target || 0) * 1.1 || 1;
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rc-spark', style: color ? 'color:' + color : '' });
  if (target) svg.append(svgEl('line', { x1: 0, x2: W, y1: y(target), y2: y(target), class: 'rc-target' }));
  if (bars) {
    const bw = W / values.length;
    values.forEach((v, i) => {
      if (v == null) return;
      const w = Math.max(1.5, bw - 3);
      svg.append(svgEl('rect', { x: i * bw + (bw - w) / 2, y: y(v), width: w, height: Math.max(1, H - pad - y(v)), rx: Math.min(2, w / 2), class: 'rc-bar' }));
    });
  } else {
    const step = W / Math.max(1, values.length - 1);
    const pts = values.map((v, i) => (v == null ? null : i * step + ',' + y(v).toFixed(1)));
    // draw continuous runs only, so gaps (missing nights) do not get bridged by a straight line
    let run = [];
    const runs = [];
    pts.forEach((p) => { if (p) run.push(p); else if (run.length) { runs.push(run); run = []; } });
    if (run.length) runs.push(run);
    for (const r of runs) svg.append(svgEl('polyline', { points: r.join(' '), class: 'rc-line' }));
    const lastI = values.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
    if (lastI !== undefined) svg.append(svgEl('circle', { cx: lastI * step, cy: y(values[lastI]), r: 4, class: 'rc-dot' }));
  }
  return svg;
}

/* ---------- card ---------- */

function rcTile(label, value, sub) {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-l' }, label), el('div', { class: 'kpi-v' }, value), el('div', { class: 'kpi-s' }, sub || ''));
}

function rcDelta(v, base, unit, higherIsBetter) {
  if (v == null || base == null) return '';
  const d = Math.round(v - base);
  if (d === 0) return 'wie Ø';
  const good = higherIsBetter ? d > 0 : d < 0;
  return (d > 0 ? '+' : '−') + Math.abs(d) + ' ' + unit + ' vs Ø · ' + (good ? 'gut' : 'niedriger als sonst');
}

function importRow() {
  const input = el('input', { type: 'file', accept: '.csv', id: 'rc-file', class: 'rc-file-input' });
  input.addEventListener('change', () => { if (input.files[0]) importWhoopCsv(input.files[0]); input.value = ''; });
  const btn = el('button', { type: 'button', class: 'ghost small', onclick: () => input.click() }, whoop.length ? 'Neue CSV laden' : 'Whoop-CSV laden');
  return el('div', {},
    el('div', { class: 'row' }, btn, input),
    el('p', { class: 'muted small' }, 'Whoop-App → Export → "Physiologische Zyklen" (CSV). Kein Login, keine laufende Verbindung - du lädst die Datei, wann du willst.'),
    rcImportMsg ? el('p', { class: 'small' }, rcImportMsg) : '',
    rcMirrorMsg ? el('p', { class: 'muted small' }, rcMirrorMsg) : '');
}

function renderRecovery() {
  const box = $('recovery');
  if (!box) return;
  const rows = [...whoop].sort((a, b) => a.d.localeCompare(b.d));
  const scored = computeScores(rows);

  if (!scored.length) {
    box.replaceChildren(el('div', { class: 'food-col' },
      el('section', { class: 'fpanel' }, el('p', { class: 'muted small' }, 'Noch keine Daten. Lade eine Whoop-CSV, um Schlaf und Recovery zu sehen.'), importRow())));
    return;
  }

  const last = scored[scored.length - 1];
  const recent7 = scored.slice(-7).filter((r) => r.score != null);
  const avg7 = recent7.length ? Math.round(rcMean(recent7.map((r) => r.score))) : null;
  const debt7 = scored.slice(-7).filter((r) => r.sleepDebtMin != null);
  const avgDebt7 = debt7.length ? Math.round(rcMean(debt7.map((r) => r.sleepDebtMin))) : null;

  const scoreBlock = el('div', { class: 'rc-hero' },
    last.score == null
      ? el('div', { class: 'muted small' }, 'Noch ' + (RC_BASELINE_MIN - rows.length) + ' Nächte bis zur ersten Basiswert-Berechnung.')
      : el('div', {}, el('div', { class: 'rc-score rc-' + scoreBand(last.score) }, String(last.score)),
          el('div', { class: 'muted small' }, BAND_LABEL[scoreBand(last.score)] + (avg7 != null ? ' · Ø 7 Tage: ' + avg7 : '') + (last.whoopRecovery != null ? ' · Whoop an dem Tag: ' + last.whoopRecovery + '%' : ''))));

  const tiles = el('div', { class: 'kpis' },
    rcTile('HRV', last.hrv != null ? last.hrv + ' ms' : '–', rcDelta(last.hrv, last.baseHrv, 'ms', true)),
    rcTile('Ruhepuls', last.rhr != null ? last.rhr + ' bpm' : '–', rcDelta(last.rhr, last.baseRhr, 'bpm', false)),
    rcTile('Schlafschuld', last.sleepDebtMin != null ? last.sleepDebtMin + ' min' : '–', avgDebt7 != null ? 'Ø 7 Tage: ' + avgDebt7 + ' min' : ''));

  const debtAll = rows.filter((r) => r.sleepDebtMin != null);
  const debtShare = debtAll.length >= 14 ? Math.round((100 * debtAll.filter((r) => r.sleepDebtMin > 60).length) / debtAll.length) : null;
  const sleepDays = rows.slice(-14);
  const sleepPanel = el('section', { class: 'fpanel' },
    el('div', { class: 'food-sub' }, 'Schlafschuld, letzte 14 Nächte'),
    rcSpark(sleepDays.map((r) => r.sleepDebtMin), { bars: true, color: 'var(--warn)' }),
    el('p', { class: 'muted small' }, 'Min. Schlafdefizit pro Nacht' + (debtShare != null ? ' · ' + debtShare + ' % aller geladenen Nächte liegen über 60 min.' : '')));

  const scoreDays = scored.slice(-30);
  const trendPanel = el('section', { class: 'fpanel' },
    el('div', { class: 'food-sub' }, 'Fred-Score, letzte 30 Nächte'),
    rcSpark(scoreDays.map((r) => r.score), { color: 'var(--accent)', target: null }));

  const strainHint = (() => {
    const strains = rows.filter((r) => r.strain != null).map((r) => r.strain);
    if (strains.length < 10 || last.strain == null) return '';
    const sorted = [...strains].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    if (last.strain < p75) return '';
    return el('p', { class: 'small rc-hint' }, 'Gestern überdurchschnittliche Belastung (' + last.strain.toFixed(1) + ') — in deinen Daten folgt darauf im Schnitt eine niedrigere Recovery.');
  })();

  box.replaceChildren(el('div', { class: 'food-col' },
    el('section', { class: 'fpanel' }, el('div', { class: 'food-sub' }, 'Heute'), scoreBlock, tiles, strainHint),
    sleepPanel,
    trendPanel,
    el('section', { class: 'fpanel' }, el('div', { class: 'food-sub' }, 'Daten'), importRow(),
      el('p', { class: 'muted small' }, 'Fred-Score ist eine eigene Näherung (HRV- und Ruhepuls-Abweichung von deiner rollenden Basis, minus Schlafschuld), kein Whoop-Wert. Nach einem Gerätewechsel pendelt sich die Basis innerhalb von ca. 1–2 Wochen neu ein.'))));
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
    const rows = [['date', 'hrv_ms', 'rhr_bpm', 'resp_rate', 'skin_temp_c', 'spo2_pct', 'sleep_min', 'sleep_need_min', 'sleep_debt_min', 'sleep_eff_pct', 'sleep_consistency_pct', 'strain', 'whoop_recovery_pct']]
      .concat([...whoop].sort((a, b) => a.d.localeCompare(b.d)).map((r) => [r.d, r.hrv, r.rhr, r.resp, r.skinTemp, r.spo2, r.sleepMin, r.sleepNeedMin, r.sleepDebtMin, r.sleepEff, r.sleepConsist, r.strain, r.whoopRecovery]));
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
