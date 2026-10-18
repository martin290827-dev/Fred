'use strict';
/* Markets: tickers (Binance, Finnhub), ticker editor, news, sparklines, earnings dates.
   Loaded right after weather.js; uses the helpers in app.js. */

/* ---------- 4) Tickers (Binance public data for crypto, Finnhub for stocks) ---------- */
let lastQuotes = {};
let lastQuotesAt = 0; // when the quotes were last loaded (Heatmap snapshot time)

// Indices: the free data sources have no index levels, so an index is followed through its ETF (same direction, price in USD, not index points).
const INDEX_ETF = { SPY: 'S&P 500', QQQ: 'Nasdaq 100', DIA: 'Dow Jones', IWM: 'Russell 2000' };
const INDEX_ALIAS = { SPX: 'SPY', GSPC: 'SPY', SP500: 'SPY', 'S&P500': 'SPY', 'S&P': 'SPY', NDX: 'QQQ', NASDAQ: 'QQQ', NASDAQ100: 'QQQ', DJI: 'DIA', DOW: 'DIA', DOWJONES: 'DIA', RUT: 'IWM', RUSSELL2000: 'IWM' };
const normSym = (raw) => { const k = String(raw).trim().toUpperCase().replace(/^\^/, '').replace(/\s+/g, ''); return INDEX_ALIAS[k] || k; };
const isStock = (s) => !s.startsWith('c:') && !INDEX_ETF[s]; // stocks only: these have company news and earnings

// Old index symbols (SPX, ^GSPC ...) become their ETF once.
function migrateIndexTickers() {
  const next = [...new Set(tickers.map((t) => (t.startsWith('c:') ? t : normSym(t))))];
  if (next.join() !== tickers.join()) { tickers = next; store.set('tickers', tickers); }
}

async function fetchQuote(sym) {
  if (sym.startsWith('c:')) {
    const pair = sym.slice(2).toUpperCase() + 'USDT';
    const r = await getJSON('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=' + pair);
    return { price: parseFloat(r.lastPrice), pct: parseFloat(r.priceChangePercent), cur: 'USD' };
  }
  if (!finnhubKey) throw new Error('no Finnhub key');
  const r = await getJSON('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(sym) + '&token=' + encodeURIComponent(finnhubKey));
  if (!r || !r.c) throw new Error('unknown symbol');
  return { price: r.c, pct: r.dp, cur: 'USD' };
}

function fmtPrice(p) {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return p.toPrecision(3);
}

/* ---------- add and remove tickers right in the card (saved in this browser and synced) ---------- */
let tkOpen = false;

function tickerSaved() {
  store.set('tickers', tickers);
  earn.t = 0;
  loadEarnings();
  loadNews(true);
  loadQuotes();
}

// Move a ticker one place up or down; the order is saved in the Sheet.
function tickerMove(i, d) {
  const j = i + d;
  if (j < 0 || j >= tickers.length) return;
  [tickers[i], tickers[j]] = [tickers[j], tickers[i]];
  tickerSaved();
  tickerEditor();
}

function tickerEditor() {
  const box = $('tk-edit');
  if (!tkOpen) { box.replaceChildren(); box.hidden = true; return; }
  const sym = el('input', { type: 'text', placeholder: 'AAPL or BTC', maxlength: '20', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Symbol' });
  let kind = 'stock'; // stock | crypto | index
  const idx = el('select', { 'aria-label': 'Index', hidden: '' }, ...Object.entries(INDEX_ETF).map(([k, n]) => el('option', { value: k }, n + ' (' + k + ')')));
  const hint = el('p', { class: 'muted small', hidden: '' }, 'An index is followed through its ETF: the price is in USD, not index points. The daily change is almost the same.');
  const stock = el('button', { type: 'button', class: 'on' }, 'Stock'), coin = el('button', { type: 'button' }, 'Crypto'), ix = el('button', { type: 'button' }, 'Index');
  const pick = (k) => {
    kind = k;
    stock.classList.toggle('on', k === 'stock'); coin.classList.toggle('on', k === 'crypto'); ix.classList.toggle('on', k === 'index');
    sym.hidden = k === 'index'; idx.hidden = k !== 'index'; hint.hidden = k !== 'index';
    sym.placeholder = k === 'crypto' ? 'BTC' : 'AAPL';
    (k === 'index' ? idx : sym).focus();
  };
  stock.addEventListener('click', () => pick('stock')); coin.addEventListener('click', () => pick('crypto')); ix.addEventListener('click', () => pick('index'));
  const msg = el('p', { class: 'muted small gform-msg' });
  const chips = el('div', { class: 'tk-order' }, ...tickers.map((s, i) => el('div', { class: 'tk-o' },
    el('span', { class: 'tk-name' }, tickerLabel(s)),
    el('button', { type: 'button', class: 'tk-mv', 'aria-label': 'Move ' + tickerLabel(s) + ' up', title: 'Up', onclick: () => tickerMove(i, -1) }, '\u25b2'),
    el('button', { type: 'button', class: 'tk-mv', 'aria-label': 'Move ' + tickerLabel(s) + ' down', title: 'Down', onclick: () => tickerMove(i, 1) }, '\u25bc'),
    el('button', { type: 'button', class: 'tk-mv tk-rm', 'aria-label': 'Remove ' + tickerLabel(s), title: 'Remove', onclick: () => { tickers = tickers.filter((x) => x !== s); tickerSaved(); tickerEditor(); } }, '\u00d7'))));
  const f = el('form', { class: 'gform', autocomplete: 'off' },
    el('div', { class: 'row' }, sym, idx, el('div', { class: 'tk-seg', role: 'group', 'aria-label': 'Type' }, stock, coin, ix)),
    hint, tickers.length ? chips : '', msg,
    el('div', { class: 'row end gform-btns' }, el('button', { type: 'button', class: 'ghost', onclick: () => { tkOpen = false; tickerEditor(); } }, 'Done'), el('button', { type: 'submit' }, 'Add')));
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    let s = kind === 'index' ? idx.value : sym.value.trim().toUpperCase().replace(/^C:/, '');
    if (kind === 'crypto') s = s.replace(/(USDT|-USD|USD)$/, '');
    if (kind !== 'crypto') s = normSym(s); // SPX, ^GSPC, S&P 500 ... become the ETF
    if (!/^[A-Z0-9.\-]{1,15}$/.test(s)) { msg.textContent = 'Use the ticker symbol only, e.g. AAPL or BTC.'; return; }
    const id = kind === 'crypto' ? 'c:' + s : s;
    if (tickers.includes(id)) { msg.textContent = s + ' is already in the list.'; return; }
    tickers.push(id);
    tickerSaved();
    tickerEditor();
    $('tk-edit').querySelector('input').focus();
  });
  f.addEventListener('keydown', (e) => { if (e.key === 'Escape') { tkOpen = false; tickerEditor(); } });
  box.replaceChildren(f);
  box.hidden = false;
  sym.focus();
}

function tickerLabel(s) { return s.startsWith('c:') ? s.slice(2).toUpperCase() : s.toUpperCase(); }
const tickerSym = (s) => el('span', { class: 'tsym' }, tickerLabel(s), INDEX_ETF[s] ? el('small', { class: 'tidx' }, INDEX_ETF[s]) : '');

async function loadQuotes() {
  const syms = [...new Set(tickers)];
  const results = await Promise.allSettled(syms.map(fetchQuote));
  const errors = {};
  syms.forEach((s, i) => {
    if (results[i].status === 'fulfilled') lastQuotes[s] = results[i].value;
    else errors[s] = results[i].reason.message;
  });

  const box = $('tickers');
  box.replaceChildren();
  if (!tickers.length) box.append(el('p', { class: 'empty' }, 'No tickers yet. Tap + to add one.'));
  for (const s of tickers) {
    const q = lastQuotes[s];
    const slot = el('span', { class: 'sparkslot', 'data-sym': s });
    if (errors[s] && !q) {
      box.append(el('div', { class: 'tick' }, tickerSym(s), slot, el('span', { class: 'muted tprice terr' }, errors[s])));
      continue;
    }
    const cls = q.pct >= 0 ? 'up' : 'down';
    box.append(el('div', { class: 'tick' },
      tickerSym(s),
      slot,
      el('span', { class: 'tprice' }, '$' + fmtPrice(q.price)),
      el('span', { class: 'pct ' + cls }, (q.pct >= 0 ? '+' : '') + (q.pct ?? 0).toFixed(2) + '%')));
  }
  $('tickers-status').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' \u00b7 stocks may be delayed';
  lastQuotesAt = Date.now();
  paintSparks();
  if (typeof renderHeat === 'function') renderHeat(true); // the Heatmap card uses the same quotes
  if (news.t) renderNews(); // keeps the movers order current
}

/* ---------- Market news for the tickers (Finnhub, free with the same key) ----------
   Stocks: company news of the last 2 days. Crypto: Finnhub's crypto feed, matched to each coin by name.
   Only headlines with source and time; Fred does not guess why a price moved. */
try { localStorage.removeItem('fred.holdings'); localStorage.removeItem('fred.pfHidden'); } catch { /* data of an old version */ }

const NEWS_TTL = 15 * 60000;
const COIN_WORDS = {
  BTC: 'bitcoin|btc', ETH: 'ethereum|ether\\b|eth\\b', SOL: 'solana|\\bsol\\b', XRP: 'xrp|ripple', DOGE: 'dogecoin|doge',
  ADA: 'cardano|\\bada\\b', BNB: 'bnb|binance coin', AVAX: 'avalanche|avax', DOT: 'polkadot', LINK: 'chainlink', LTC: 'litecoin',
};
let news = { t: 0, key: '', groups: {} };
let newsBusy = false;

function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : null; }

function agoText(unixSec) {
  const m = Math.max(1, Math.round((Date.now() / 1000 - unixSec) / 60));
  return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
}

function pickNews(list) {
  const seen = new Set();
  return list.filter((n) => n.headline && safeUrl(n.url) && !seen.has(n.headline) && seen.add(n.headline))
    .sort((x, y) => y.datetime - x.datetime).slice(0, 3)
    .map((n) => ({ title: n.headline, url: n.url, source: n.source || '', at: n.datetime }));
}

async function loadNews(force) {
  const key = tickers.join(',');
  if (!finnhubKey || !tickers.length) { renderNews(); return; }
  if (!force && news.key === key && Date.now() - news.t < NEWS_TTL) { renderNews(); return; }
  if (newsBusy) return;
  newsBusy = true;
  const groups = {};
  const from = toDateStr(addDays(new Date(), -2));
  const to = toDateStr(new Date());
  const tok = '&token=' + encodeURIComponent(finnhubKey);
  try {
    for (const s of tickers.filter(isStock)) {
      try {
        const r = await getJSON('https://finnhub.io/api/v1/company-news?symbol=' + encodeURIComponent(s) + '&from=' + from + '&to=' + to + tok);
        groups[s] = pickNews(Array.isArray(r) ? r : []);
      } catch { groups[s] = null; }
    }
    const coins = tickers.filter((x) => x.startsWith('c:'));
    if (coins.length) {
      let feed = [];
      try { const r = await getJSON('https://finnhub.io/api/v1/news?category=crypto' + tok); feed = Array.isArray(r) ? r : []; } catch { feed = null; }
      for (const s of coins) {
        const code = tickerLabel(s);
        const re = new RegExp(COIN_WORDS[code] || '\\b' + code.toLowerCase() + '\\b', 'i');
        groups[s] = feed === null ? null : pickNews(feed.filter((n) => re.test((n.headline || '') + ' ' + (n.summary || ''))));
      }
      groups['crypto'] = feed === null ? null : pickNews(feed);
    }
    news = { t: Date.now(), key, groups };
  } finally { newsBusy = false; }
  renderNews();
}

function renderNews() {
  const box = $('news');
  if (!finnhubKey) { box.replaceChildren(el('p', { class: 'muted' }, 'Add a Finnhub key in Settings to see news for your tickers.')); return; }
  if (!tickers.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Add tickers with the + in the Tickers card first.')); return; }
  if (!news.t) { box.replaceChildren(el('p', { class: 'muted' }, 'Loading news...')); return; }
  // biggest movers of the day first
  const move = (s) => (lastQuotes[s] ? Math.abs(lastQuotes[s].pct || 0) : -1);
  const order = tickers.filter((s) => !INDEX_ETF[s]).sort((x, y) => move(y) - move(x)); // indices have no company news
  if (news.groups.crypto) order.push('crypto');
  const quiet = order.filter((s) => s !== 'crypto' && (news.groups[s] === null || (news.groups[s] && !news.groups[s].length)));
  const shown = order.filter((s) => !quiet.includes(s));
  box.replaceChildren(...shown.map((s) => {
    const q = lastQuotes[s];
    const items = news.groups[s];
    const head = el('div', { class: 'news-head' },
      el('span', { class: 'tsym' }, s === 'crypto' ? 'Crypto market' : tickerLabel(s)),
      q ? el('span', { class: 'pct ' + (q.pct >= 0 ? 'up' : 'down') }, (q.pct >= 0 ? '+' : '') + (q.pct ?? 0).toFixed(2) + '%') : '');
    const body = items === null ? [el('p', { class: 'muted small' }, 'News not available right now.')]
      : !items || !items.length ? [el('p', { class: 'muted small' }, 'No headlines in the last 2 days.')]
        : items.map((n) => el('a', { class: 'news-item', href: n.url, target: '_blank', rel: 'noopener noreferrer' },
          el('span', { class: 'news-title' }, n.title),
          el('span', { class: 'muted small' }, (n.source ? n.source + ' · ' : '') + agoText(n.at))));
    if (items && items.length > 1) {
      // only the top headline is visible; the others are one scroll (or swipe) away inside the box
      head.append(el('span', { class: 'news-more muted small', title: 'Scroll inside the box for more' }, '+' + (items.length - 1) + ' \u2193'));
      return el('div', { class: 'news-group' }, head, el('div', { class: 'news-scroll' }, ...body));
    }
    return el('div', { class: 'news-group' }, head, ...body);
  }), quiet.length ? el('p', { class: 'muted small news-quiet' }, 'No headlines in the last 2 days: ' + quiet.map(tickerLabel).join(', ')) : '');
  $('news-status').textContent = 'Updated ' + new Date(news.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · Finnhub';
}

/* ---------- Sparklines: 30 daily closes, cached for 6 hours ---------- */
const SPARK_TTL = 6 * 3600 * 1000;
const SPARK_RETRY = 10 * 60 * 1000;
let sparkCache = store.get('spark', {});
const sparkFail = {}; // sym -> { msg, retryAt }
let sparkBusy = false;
let sparkAgain = false;

async function fetchSeries(sym) {
  if (sym.startsWith('c:')) {
    const pair = sym.slice(2).toUpperCase() + 'USDT';
    const r = await getJSON('https://data-api.binance.vision/api/v3/klines?symbol=' + pair + '&interval=1d&limit=30');
    return r.map((k) => parseFloat(k[4]));
  }
  if (twelveKey) {
    const r = await getJSON('https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(sym) +
      '&interval=1day&outputsize=30&apikey=' + encodeURIComponent(twelveKey));
    if (r.status === 'error' || !r.values) throw new Error(r.message || 'no data');
    return r.values.map((v) => parseFloat(v.close)).reverse();
  }
  // Finnhub stock candles are a paid feature on most accounts. Try once, remember a refusal.
  if (finnhubKey && !store.get('candleBlocked', false)) {
    const now = Math.floor(Date.now() / 1000);
    try {
      const r = await getJSON('https://finnhub.io/api/v1/stock/candle?symbol=' + encodeURIComponent(sym) +
        '&resolution=D&from=' + (now - 45 * 86400) + '&to=' + now + '&token=' + encodeURIComponent(finnhubKey));
      if (r.s === 'ok' && r.c && r.c.length > 1) return r.c.slice(-30);
    } catch (e) {
      if (/^(401|403)/.test(e.message)) store.set('candleBlocked', true);
    }
  }
  throw new Error('no chart source for stocks (add a Twelve Data key in Settings)');
}

// Calm line in the muted ink, one accent dot on the latest value. Colour is never the only carrier:
// the price and percent next to it say the same, and the title names first, last and range.
function sparkSVG(values, name) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 90;
  const H = 28;
  const P = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = (max - min) || 1;
  const pts = values.map((v, i) => [P + (i * (W - 2 * P)) / Math.max(values.length - 1, 1), H - P - ((v - min) / span) * (H - 2 * P)]);
  const first = values[0];
  const last = values[values.length - 1];
  const pct = ((last - first) / first) * 100;
  const text = name + ': ' + values.length + '-day trend, ' + fmtPrice(first) + ' to ' + fmtPrice(last) +
    ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%), range ' + fmtPrice(min) + ' to ' + fmtPrice(max);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', text);
  const title = document.createElementNS(NS, 'title');
  title.textContent = text;
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '));
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', pts[pts.length - 1][0].toFixed(1));
  dot.setAttribute('cy', pts[pts.length - 1][1].toFixed(1));
  dot.setAttribute('r', '3.5');
  svg.append(title, line, dot);
  return svg;
}

// Draw one slot: a chart, or a quiet dash whose tooltip says why there is no chart.
function paintSlot(slot, sym, series, why) {
  if (series && series.length > 1) slot.replaceChildren(sparkSVG(series, tickerLabel(sym)));
  else if (why) { slot.replaceChildren(); slot.title = why; } // no chart: leave the space empty, the reason is in the tooltip
}

function slotsFor(sym) {
  return [...document.querySelectorAll('#tickers .sparkslot')].filter((s) => s.getAttribute('data-sym') === sym);
}

async function paintSparks() {
  if (sparkBusy) { sparkAgain = true; return; } // the slots were rebuilt meanwhile: run once more
  sparkBusy = true;
  try {
    const syms = [...new Set([...document.querySelectorAll('#tickers .sparkslot')].map((s) => s.getAttribute('data-sym')))];
    // 1) Instantly draw everything we already know (cache, or the reason it is missing).
    for (const sym of syms) {
      const c = sparkCache[sym];
      const why = sparkFail[sym] && sparkFail[sym].msg;
      slotsFor(sym).forEach((s) => paintSlot(s, sym, c && c.v, why));
    }
    // 2) Download what is missing or old. Stocks: max 5 per pass (Twelve Data free plan: 8 per minute).
    let stockBudget = 5;
    let rateLimited = false;
    for (const sym of syms) {
      const c = sparkCache[sym];
      const f = sparkFail[sym];
      if (c && Date.now() - c.t < SPARK_TTL) continue;
      if (f && Date.now() < f.retryAt) continue;
      if (!sym.startsWith('c:')) { if (stockBudget <= 0) { rateLimited = true; continue; } stockBudget--; }
      try {
        const v = await fetchSeries(sym);
        sparkCache[sym] = { t: Date.now(), v };
        delete sparkFail[sym];
        store.set('spark', sparkCache);
        slotsFor(sym).forEach((s) => paintSlot(s, sym, v, ''));
      } catch (e) {
        const limit = /limit|credits|429|too many/i.test(e.message);
        if (limit) rateLimited = true;
        sparkFail[sym] = { msg: e.message, retryAt: Date.now() + (limit ? 65 * 1000 : SPARK_RETRY) };
        slotsFor(sym).forEach((s) => paintSlot(s, sym, c && c.v, e.message));
      }
    }
    if (rateLimited) setTimeout(paintSparks, 66 * 1000); // try the rest after the per-minute limit resets
  } finally {
    sparkBusy = false;
    if (sparkAgain) { sparkAgain = false; paintSparks(); }
  }
}

/* ---------- Earnings dates of the stock tickers (Finnhub, free), shown under Events ---------- */
let earn = store.get('earn', { t: 0, key: '', list: [] });

async function loadEarnings() {
  const stocks = tickers.filter(isStock);
  const key = stocks.join(',');
  if (!finnhubKey || !stocks.length) { earn = { t: 0, key: '', list: [] }; renderEvents(); return; }
  if (earn.key === key && Date.now() - earn.t < 12 * 3600000) { renderEvents(); return; } // cached for 12 hours
  const from = toDateStr(new Date());
  const to = toDateStr(addDays(new Date(), 100));
  const list = [];
  for (const s of stocks) {
    try {
      const r = await getJSON('https://finnhub.io/api/v1/calendar/earnings?from=' + from + '&to=' + to +
        '&symbol=' + encodeURIComponent(s) + '&token=' + encodeURIComponent(finnhubKey));
      const next = (r.earningsCalendar || []).filter((x) => x.date >= from).sort((x, y) => x.date.localeCompare(y.date))[0];
      if (next) {
        const when = next.hour === 'bmo' ? ' (before open)' : next.hour === 'amc' ? ' (after close)' : '';
        list.push({ id: 'earn:' + s, label: tickerLabel(s) + ' earnings' + when, at: next.date, earnings: true });
      }
    } catch { /* no data for this symbol: skip it */ }
  }
  earn = { t: Date.now(), key, list };
  store.set('earn', earn);
  renderEvents();
}

// Highlight an event that is today or already running.
function isEventNow(e) { return dayDiff(e.at) <= 0 && dayDiff(e.to || e.at) >= 0; }

// One row for an event (whole days, birthday, earnings): a small calendar leaf, the title and a countdown pill.
function eventRow(e) {
  const kind = e.earnings ? 'Earnings' : e.src && e.src.birthday ? 'Birthday' : '';
  const wd = new Date(e.at + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long' });
  const li = el('li', { class: 'evr' + (isEventNow(e) ? ' now' : '') + (e.earnings ? ' earn' : '') },
    dateLeaf(e.at),
    el('span', { class: 'grow ev-main' },
      el('span', { class: 'ev-t' }, e.label, e.src && e.src.series && !e.src.birthday ? el('span', { class: 'rep', title: 'Repeats' }, ' \u21bb') : ''),
      el('span', { class: 'ev-s' }, [wd, kind].filter(Boolean).join(' \u00b7 '))),
    el('span', { class: 'ev-when', 'data-id': e.id }));
  if (e.src && typeof gRowActions === 'function') gRowActions(li, e.src, 'event');
  return li;
}

function renderEvents() { if (typeof renderCalendar === 'function') renderCalendar(); } // events share the list with the tasks

function dateLeaf(dateStr) {
  const d = new Date(dateStr + 'T00:00');
  return el('span', { class: 'dleaf', 'aria-hidden': 'true' },
    el('span', { class: 'dl-m' }, d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()),
    el('span', { class: 'dl-d' }, String(d.getDate())));
}

// Show at most n rows; the rest scrolls inside the list.
// Repeat fn every ms, but only while the tab is visible; coming back after a longer pause refreshes at once.
function poll(fn, ms) {
  let last = Date.now();
  const run = () => { last = Date.now(); fn(); };
  setInterval(() => { if (!document.hidden) run(); }, ms);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - last > ms) run(); });
}

function fitRows(ul, n) {
  requestAnimationFrame(() => {
    const rows = [...ul.children];
    if (rows.length <= n) { ul.style.maxHeight = ''; return; }
    const top = rows[0].offsetTop;
    const end = rows[n - 1].offsetTop + rows[n - 1].offsetHeight;
    ul.style.maxHeight = Math.ceil(end - top + 2) + 'px';
  });
}

// Phone: Tasks & Reminders and Events get the height of the Weather card; their lists scroll inside.
function matchWeatherHeight() {
  requestAnimationFrame(() => {
    const phone = window.matchMedia('(max-width: 699px)').matches;
    const h = $('card-weather').offsetHeight;
    $('card-cal').style.height = ''; // every card has the same height (--card-h)
  });
}

function tickEvents() {
  document.querySelectorAll('#cal-list [data-id]').forEach((n) => {
    const e = eventList().find((x) => x.id === n.getAttribute('data-id'));
    n.textContent = e ? fmtEventWhen(e) : '';
    if (n.parentElement) n.parentElement.classList.toggle('now', !!e && isEventNow(e)); // also right after midnight
  });
}
