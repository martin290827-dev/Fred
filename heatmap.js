'use strict';
/* Heatmap card: one tile per ticker, coloured by its change over 1D / 1W / 1M / YTD.
   Prices come from loadQuotes (app.js). The base prices (7 and 30 days ago, end of last year) come from daily closes:
   Binance for crypto, Twelve Data for stocks (needs the key; 1D works without it). Only these bases are kept, not the series. */

// scale = the change (in %) that gets the full colour; smaller moves stay darker, like in a market heatmap
const HEAT_INFO = {
  '1D': { title: 'Last 24 Hours', scale: 4 },
  '1W': { title: 'Last 7 Days', scale: 15 },
  '1M': { title: 'Last 30 Days', scale: 30 },
  YTD: { title: 'Year to Date', scale: 60 },
};
const HEAT_TTL = 6 * 3600 * 1000;
const HEAT_PER_MIN = 6; // Twelve Data free plan: 8 per minute (a clash with the sparklines is retried after a minute)
const heatStamps = []; // times of the stock downloads in the last minute
const HEAT_RED = '#c0392b', HEAT_GREEN = '#2f9e5b', HEAT_DARK = '#2b2b2e';
let heat = store.get('heat', { period: '1W', size: 'equal' }); // this device only
let heatBase = store.get('heatBase', {});                      // sym -> { day, t, prev, w1, m1, ytd, last }
const heatFail = {};                                           // sym -> { msg, retryAt }
let heatBusy = false, heatAgain = false;

// Daily closes as [YYYY-MM-DD, close], oldest first, about 400 days.
async function heatSeries(sym) {
  if (sym.startsWith('c:')) {
    const r = await getJSON('https://data-api.binance.vision/api/v3/klines?symbol=' + sym.slice(2).toUpperCase() + 'USDT&interval=1d&limit=400');
    return r.map((k) => [new Date(k[0]).toISOString().slice(0, 10), parseFloat(k[4])]);
  }
  if (!twelveKey) throw new Error('add a Twelve Data key in Settings');
  const r = await getJSON('https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(sym) + '&interval=1day&outputsize=400&apikey=' + encodeURIComponent(twelveKey));
  if (r.status === 'error' || !r.values) throw new Error(r.message || 'no data');
  return r.values.map((v) => [v.datetime.slice(0, 10), parseFloat(v.close)]).reverse();
}

// Last close on or before a date (or null).
function heatCloseOn(rows, d) {
  let c = null;
  for (const [day, v] of rows) { if (day > d) break; c = v; }
  return c;
}

function heatBases(rows) {
  const now = new Date();
  const ago = (n) => heatCloseOn(rows, toDateStr(addDays(now, -n)));
  return { day: toDateStr(now), t: Date.now(), prev: ago(1), w1: ago(7), m1: ago(30), ytd: heatCloseOn(rows, (now.getFullYear() - 1) + '-12-31'), last: rows.length ? rows[rows.length - 1][1] : null };
}

// Download the bases that are missing or old. Stocks: a few per minute, the rest follows.
async function heatLoad() {
  if (heatBusy) { heatAgain = true; return; }
  heatBusy = true;
  try {
    let limited = false;
    for (const sym of [...new Set(tickers)]) {
      const b = heatBase[sym], f = heatFail[sym];
      if (b && b.day === toDateStr(new Date()) && Date.now() - b.t < HEAT_TTL) continue;
      if (f && Date.now() < f.retryAt) continue;
      if (!sym.startsWith('c:')) {
        if (!twelveKey) continue; // 1D still works from the live quote
        while (heatStamps.length && Date.now() - heatStamps[0] > 60000) heatStamps.shift();
        if (heatStamps.length >= HEAT_PER_MIN) { limited = true; continue; }
        heatStamps.push(Date.now());
      }
      try {
        heatBase[sym] = heatBases(await heatSeries(sym));
        delete heatFail[sym];
        store.set('heatBase', heatBase);
        renderHeat(false);
      } catch (e) {
        const limit = /limit|credits|429|too many/i.test(e.message);
        if (limit) limited = true;
        heatFail[sym] = { msg: e.message, retryAt: Date.now() + (limit ? 65000 : 10 * 60000) };
      }
    }
    if (limited) setTimeout(heatLoad, 21000); // the next ones when the minute window has room again
  } finally {
    heatBusy = false;
    if (heatAgain) { heatAgain = false; heatLoad(); }
  }
}

// Change in % over the chosen period, or null when the data is missing.
function heatPct(sym, period) {
  const q = lastQuotes[sym], b = heatBase[sym];
  const price = q ? q.price : b && b.last;
  if (period === '1D') {
    if (q && q.pct != null) return q.pct;
    return b && b.prev && price ? (price / b.prev - 1) * 100 : null;
  }
  const base = b && { '1W': b.w1, '1M': b.m1, YTD: b.ytd }[period];
  return base && price ? (price / base - 1) * 100 : null;
}

const heatPrice = (p) => (p >= 1 ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : p.toPrecision(3));

function heatTile(sym, period) {
  const info = HEAT_INFO[period];
  const q = lastQuotes[sym], b = heatBase[sym];
  const price = q ? q.price : b && b.last;
  const pct = heatPct(sym, period);
  const t = pct === null ? 0 : Math.min(Math.abs(pct) / info.scale, 1);
  const why = pct !== null ? '' : q || b ? 'Not enough history for this period' : heatFail[sym] ? heatFail[sym].msg : !sym.startsWith('c:') && !twelveKey && period !== '1D' ? 'Add a Twelve Data key in Settings for this period' : 'Loading...';
  const tile = el('div', { class: 'heat-tile' + (pct === null ? ' none' : ''), title: tickerLabel(sym) + (pct === null ? ': ' + why : ': ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '% · ' + info.title.toLowerCase()) },
    el('b', { class: 'ht-s' }, tickerLabel(sym)),
    el('span', { class: 'ht-p' }, pct === null ? '–' : (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'),
    el('span', { class: 'ht-v' }, price ? '$' + heatPrice(price) : ''));
  if (pct !== null) tile.style.background = 'color-mix(in srgb, ' + (pct >= 0 ? HEAT_GREEN : HEAT_RED) + ' ' + Math.round(t * 100) + '%, ' + HEAT_DARK + ')';
  tile.style.setProperty('--w', heat.size === 'move' ? (1 + 3 * t).toFixed(2) : '1'); // "Size: Move": bigger movers get wider tiles
  return tile;
}

function renderHeat(load) {
  const box = $('heat');
  if (!box) return;
  if (!tickers.length) { box.replaceChildren(el('p', { class: 'muted small' }, 'Add tickers with the + in the Tickers card first.')); return; }
  const seg = el('div', { class: 'heat-row', role: 'tablist', 'aria-label': 'Period' }, ...Object.keys(HEAT_INFO).map((p) =>
    el('button', { type: 'button', role: 'tab', class: 'heat-btn' + (p === heat.period ? ' on' : ''), 'aria-selected': String(p === heat.period), onclick: () => { heat = Object.assign({}, heat, { period: p }); store.set('heat', heat); renderHeat(false); } }, p)));
  const ctl = el('div', { class: 'heat-row' },
    el('button', { type: 'button', class: 'heat-btn', onclick: () => { for (const k in heatFail) delete heatFail[k]; loadQuotes(); } }, 'Refresh'),
    el('button', { type: 'button', class: 'heat-btn', onclick: () => { heat = Object.assign({}, heat, { size: heat.size === 'move' ? 'equal' : 'move' }); store.set('heat', heat); renderHeat(false); } }, 'Size: ' + (heat.size === 'move' ? 'Move' : 'Equal')));
  const snap = el('div', { class: 'heat-snap small' }, el('span', { class: 'heat-badge' }, 'Snapshot'),
    lastQuotesAt ? ' Snapshot taken ' + new Date(lastQuotesAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ' Loading...');
  box.replaceChildren(el('div', { class: 'heat-title' }, 'Heatmap ' + HEAT_INFO[heat.period].title), seg, ctl, snap,
    el('div', { class: 'heat-grid' + (heat.size === 'move' ? ' move' : '') }, ...tickers.map((s) => heatTile(s, heat.period))));
  if (load) heatLoad();
}

function initHeat() { renderHeat(true); }
