'use strict';
/* Food diary with weight.
   - Type or dictate (microphone on the iPhone keyboard) what you ate.
   - Calories and macros are estimated by Claude (Anthropic API, your own key in Settings).
     Say "... 600 kcal" to set the calories yourself; then nothing is sent anywhere.
   - Entries sync between your devices (sync.js) and are mirrored to two Google Sheets
     in your Drive ("Fred Food Log", "Fred Weight Log") for your own analysis.
   Estimates are rough (often +/- 20-30 %). */

let food = store.get('food', []);     // [{ id, at: 'YYYY-MM-DDTHH:MM', text, kcal, p, c, f, src: 'ai'|'manual', err }]
let weight = store.get('weight', []); // [{ d: 'YYYY-MM-DD', kg }]
let anthropicKey = store.get('anthropicKey', '');
let foodEditId = null;
// Your goal (Settings). Personal values live only in your browser and your Drive sync, never in the code.
let trendRange = store.get('trendRange', 30); // Trends: 7, 30 or 90 days (per device)
let nutri = store.get('nutri', { kcal: 2500, goalPct: 10, startKg: null, height: null, birthYear: null, sex: '', activity: 1.45 });

const AI_MODEL = 'claude-haiku-4-5-20251001';
const AI_SYSTEM = 'You estimate nutrition for a personal food diary. The input is a short, often dictated description ' +
  '(German or English) of what one adult ate. When no amount is given, assume a normal single portion as served in Austria. ' +
  'Reply with JSON only, no other text: {"items":[{"name":"","amount":"","kcal":0,"protein":0,"carbs":0,"fat":0}],' +
  '"kcal":0,"protein":0,"carbs":0,"fat":0}. protein, carbs and fat in grams. Whole numbers. ' +
  'If the text is not about food or drink, reply with kcal 0 and an empty items list.';

function saveFood() { store.set('food', food); foodMirrorSoon(); }
function saveWeight() { store.set('weight', weight); foodMirrorSoon(); }

/* ---------- estimating ---------- */

// "... 650 kcal" in the text: the user's own number wins, no AI call.
function manualKcal(text) {
  const m = text.match(/(\d{2,5})\s*(kcal|kalorien|calories|cal)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

// One call to Claude; returns the JSON object in the reply.
async function aiJSON(system, text, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true', // the key is yours and stays in this browser
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: maxTokens || 700, system, messages: [{ role: 'user', content: text }] }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j && j.error && j.error.message) || 'AI error ' + res.status);
  const out = (j.content || []).map((x) => x.text || '').join('');
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
}

async function aiEstimate(text) {
  const json = await aiJSON(AI_SYSTEM, text, 700);
  const n = (v) => Math.max(0, Math.round(Number(v) || 0));
  return { kcal: n(json.kcal), p: n(json.protein), c: n(json.carbs), f: n(json.fat) };
}

async function estimateEntry(e) {
  const own = manualKcal(e.text);
  if (own !== null) { Object.assign(e, { kcal: own, p: null, c: null, f: null, src: 'manual', err: null }); saveFood(); renderFood(); return; }
  if (!anthropicKey) { Object.assign(e, { kcal: null, src: null, err: 'Add an Anthropic key in Settings, or say "... 500 kcal"' }); saveFood(); renderFood(); return; }
  e.busy = true;
  renderFood();
  try {
    Object.assign(e, await aiEstimate(e.text), { src: 'ai', err: null });
  } catch (err) {
    e.err = err.message;
  }
  delete e.busy;
  saveFood();
  renderFood();
}

/* ---------- nutrition tips: once a day from your last 7 days (Claude, your own key) ---------- */
let tips = store.get('tips', { day: '', list: [], err: '' });
let tipsBusy = false;

const TIPS_SYSTEM = 'You are a friendly, evidence-based nutrition coach. You get one adult\'s food diary for the last days, ' +
  'the daily targets and the goal (lose weight while keeping muscle). Give 5 short, practical tips based on what this person ' +
  'actually eats: name the real foods and drinks from the diary, suggest concrete swaps or additions with rough numbers ' +
  '(kcal or grams of protein). Start with the tip that has the biggest effect. No medical advice, no moralizing. ' +
  'Reply with JSON only: {"tips":[{"title":"max 5 words","text":"max 22 words"}]}';

function tipsInput() {
  const tg = targets();
  const days = lastDays(8).slice(0, 7).filter((d) => dayTotals(d).n);
  const lines = days.map((d) => {
    const t = dayTotals(d);
    const meals = food.filter((e) => e.at.slice(0, 10) === d).sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => e.at.slice(11, 16) + ' ' + e.text + (e.kcal != null ? ' (' + e.kcal + ' kcal' + (e.p != null ? ', P' + e.p + ' C' + e.c + ' F' + e.f : '') + ')' : ''));
    return d + ': total ' + Math.round(t.kcal) + ' kcal, protein ' + Math.round(t.p) + ' g, carbs ' + Math.round(t.c) + ' g, fat ' + Math.round(t.f) + ' g\n  ' + meals.join('\n  ');
  });
  return 'Language of the answer: ' + (navigator.language || 'de-AT') + '\n' +
    'Daily targets: ' + tg.kcal + ' kcal' + (tg.p ? ', protein ' + tg.p + ' g, carbs ' + tg.c + ' g, fat ' + tg.f + ' g' : '') + '\n' +
    'Diary:\n' + lines.join('\n');
}

async function loadTips(force) {
  const today = toDateStr(new Date());
  if (tipsBusy || !anthropicKey) return;
  if (!force && tips.day === today && tips.list.length) return;
  const logged = lastDays(8).slice(0, 7).filter((d) => dayTotals(d).n).length;
  if (logged < 2) return; // too little to say something useful
  tipsBusy = true;
  renderFood();
  try {
    const j = await aiJSON(TIPS_SYSTEM, tipsInput(), 900);
    tips = { day: today, list: (j.tips || []).filter((t) => t && t.text).slice(0, 6).map((t) => ({ title: String(t.title || ''), text: String(t.text) })), err: '' };
  } catch (e) {
    tips = Object.assign({}, tips, { err: e.message });
  }
  tipsBusy = false;
  store.set('tips', tips);
  renderFood();
}

function tipsBlock() {
  if (!anthropicKey) return el('p', { class: 'muted small' }, 'Add an Anthropic key in Settings to get tips from your diary.');
  const logged = lastDays(8).slice(0, 7).filter((d) => dayTotals(d).n).length;
  if (!tips.list.length) {
    return el('p', { class: 'muted small' }, tipsBusy ? 'Looking at your last days…' : logged < 2 ? 'Log food on at least 2 days to get tips.' : tips.err ? 'Tips: ' + tips.err : '');
  }
  const ul = el('ul', { class: 'tips' }, ...tips.list.map((t, i) => el('li', { class: 'tip' },
    el('span', { class: 'tip-n' }, String(i + 1)),
    el('span', { class: 'tip-b' }, t.title ? el('span', { class: 'tip-t' }, t.title) : '', el('span', { class: 'tip-x' }, t.text)))));
  fitRows(ul, 2); // two tips; the rest scrolls
  return ul;
}

/* ---------- numbers ---------- */

function dayTotals(d) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, n: 0, m: 0 };
  for (const e of food) {
    if (e.at.slice(0, 10) !== d) continue;
    t.n++;
    if (e.p == null) t.m++; // no protein/carbs/fat known for this entry
    t.kcal += e.kcal || 0; t.p += e.p || 0; t.c += e.c || 0; t.f += e.f || 0;
  }
  return t;
}

function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(toDateStr(addDays(new Date(), -i)));
  return out;
}

// Average kcal of the days that have entries (days without entries do not count as 0).
function avgKcal(days) {
  const vals = days.map((d) => dayTotals(d)).filter((t) => t.n).map((t) => t.kcal);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

function weightOn(d) {
  const w = weight.filter((x) => x.d <= d).sort((a, b) => a.d.localeCompare(b.d));
  return w.length ? w[w.length - 1] : null;
}

const fmtN = (v) => Math.round(v).toLocaleString('en-US');
const fmtKg = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const shortDay = (d) => new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/* ---------- goal and targets ----------
   Protein 1.8 g per kg of goal weight (keeps muscle while losing fat), fat 28 % of calories
   but at least 0.8 g per kg, carbs the rest. Maintenance: Mifflin-St Jeor x activity,
   and later measured from your own intake and weight trend (7,700 kcal per kg of body fat). */
const round5 = (v) => Math.round(v / 5) * 5;

function goalInfo() {
  const cur = weightOn(toDateStr(new Date()));
  const first = [...weight].sort((x, y) => x.d.localeCompare(y.d))[0];
  const start = nutri.startKg || (first ? first.kg : null);
  if (!start) return null;
  const goal = Math.round(start * (1 - (nutri.goalPct || 10) / 100) * 10) / 10;
  return { start, goal, cur: cur ? cur.kg : start };
}

function targets() {
  const g = goalInfo();
  const kcal = nutri.kcal || 2500;
  if (!g) return { kcal, p: null, f: null, c: null };
  const p = round5(1.8 * g.goal);
  const f = Math.max(round5((kcal * 0.28) / 9), round5(0.8 * g.cur));
  const c = Math.max(0, round5((kcal - p * 4 - f * 9) / 4));
  return { kcal, p, f, c };
}

// Estimated from height, age, sex and activity (Settings).
function formulaMaintenance() {
  const g = goalInfo();
  if (!g || !nutri.height || !nutri.birthYear || !nutri.sex) return null;
  const age = new Date().getFullYear() - nutri.birthYear;
  const bmr = 10 * g.cur + 6.25 * nutri.height - 5 * age + (nutri.sex === 'm' ? 5 : -161);
  return Math.round((bmr * (nutri.activity || 1.45)) / 10) * 10;
}

// Measured from your own data: average intake plus what the weight trend says (needs 2+ weeks).
function weightTrendPerDay(days) {
  const pts = weight.filter((w) => w.d >= days[0]).sort((a, b) => a.d.localeCompare(b.d))
    .map((w) => [(new Date(w.d + 'T00:00') - new Date(days[0] + 'T00:00')) / 86400000, w.kg]);
  if (pts.length < 3 || pts[pts.length - 1][0] - pts[0][0] < 14) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const num = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const den = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  return den ? num / den : null;
}

// Weighing once a week gives few points: then look back 6 weeks instead of 4, so one odd value counts less.
function trendWindow() {
  const d28 = lastDays(28);
  return weight.filter((w) => w.d >= d28[0]).length >= 5 ? d28 : lastDays(42);
}

function measuredMaintenance() {
  const days = trendWindow();
  const logged = days.filter((d) => dayTotals(d).n).length;
  const slope = weightTrendPerDay(days);
  const avg = avgKcal(days);
  if (logged < days.length / 2 || slope === null || !avg) return null;
  return { kcal: Math.round((avg - slope * 7700) / 10) * 10, perWeek: slope * 7 };
}

// What is still missing before Pace and Maintenance come from your own data.
function dataStatus() {
  const days = trendWindow();
  const pts = weight.filter((w) => w.d >= days[0]).sort((a, b) => a.d.localeCompare(b.d));
  const span = pts.length > 1 ? (new Date(pts[pts.length - 1].d) - new Date(pts[0].d)) / 86400000 : 0;
  const logged14 = lastDays(14).filter((d) => dayTotals(d).n).length;
  const loggedW = days.filter((d) => dayTotals(d).n).length;
  const last = [...weight].sort((a, b) => b.d.localeCompare(a.d))[0];
  const needW = pts.length < 3 ? 3 - pts.length : span < 14 ? Math.ceil((14 - span) / 7) : 0;
  const needF = Math.max(0, Math.ceil(days.length / 2) - loggedW);
  return { last, logged14, needW, needF, ok: needW === 0 && needF === 0 };
}

/* In range = share of the target. Protein is a minimum (more is fine),
   calories, carbs and fat are upper limits with some room below. */
const RANGES = { kcal: [0.9, 1.1], p: [0.9, 1.5], c: [0.7, 1.15], f: [0.75, 1.15] };
const NUTRI = [['kcal', 'Calories', 'kcal'], ['p', 'Protein', 'g'], ['c', 'Carbs', 'g'], ['f', 'Fat', 'g']];

function macroStatus(key, val, target) {
  if (!target) return 'none';
  const r = val / target;
  return r < RANGES[key][0] ? 'low' : r > RANGES[key][1] ? 'high' : 'ok';
}

// Plain words for today: how much is left, or how much too much.
function macroHint(key, val, target, unit) {
  const st = macroStatus(key, val, target);
  if (key === 'p') {
    if (st === 'high') return { hint: fmtN(val - target) + ' ' + unit + ' over', cls: 'over' };
    if (st === 'ok') return { hint: 'Reached', cls: 'done' };
    return { hint: fmtN(target - val) + ' ' + unit + ' to go', cls: '' };
  }
  if (val > target) return { hint: fmtN(val - target) + ' ' + unit + ' over', cls: st === 'high' ? 'high' : 'over' };
  return { hint: fmtN(target - val) + ' ' + unit + ' left', cls: '' };
}

// Activity-style ring. Past 100 % a second, darker lap starts, like on the Apple Watch.
function ring(val, target, cls, size, stroke) {
  const c = size / 2, r = (size - stroke) / 2, C = 2 * Math.PI * r;
  const frac = target ? val / target : 0;
  const svg = svgEl('svg', { viewBox: '0 0 ' + size + ' ' + size, width: size, height: size, class: 'ring ' + cls, 'aria-hidden': 'true' });
  const arc = (f, extra) => svgEl('circle', { cx: c, cy: c, r, 'stroke-width': stroke, class: 'ring-arc' + extra,
    'stroke-dasharray': (Math.min(f, 1) * C).toFixed(2) + ' ' + C.toFixed(2), transform: 'rotate(-90 ' + c + ' ' + c + ')' });
  svg.append(svgEl('circle', { cx: c, cy: c, r, 'stroke-width': stroke, class: 'ring-track' }));
  if (frac > 0.005) svg.append(arc(frac, ''));
  if (frac > 1) svg.append(arc(frac - 1, ' ring-lap'));
  return svg;
}

// Apple-Watch-style stacked rings: calories outside, then protein, carbs, fat. Past 100 % a darker lap starts.
function stackRings(parts, size) {
  const stroke = Math.round(size * 0.1), gap = 3, c = size / 2;
  const svg = svgEl('svg', { viewBox: '0 0 ' + size + ' ' + size, width: size, height: size, class: 'srings', 'aria-hidden': 'true' });
  parts.forEach(([k, val, target], i) => {
    const r = c - stroke / 2 - i * (stroke + gap), C = 2 * Math.PI * r, frac = target ? val / target : 0;
    const g = svgEl('g', { class: 'r-' + k });
    const arc = (f, extra) => svgEl('circle', { cx: c, cy: c, r, 'stroke-width': stroke, class: 'ring-arc' + extra,
      'stroke-dasharray': (Math.min(f, 1) * C).toFixed(2) + ' ' + C.toFixed(2), transform: 'rotate(-90 ' + c + ' ' + c + ')' });
    g.append(svgEl('circle', { cx: c, cy: c, r, 'stroke-width': stroke, class: 'ring-track' }));
    if (frac > 0.005) g.append(arc(frac, ''));
    if (frac > 1) g.append(arc(frac - 1, ' ring-lap'));
    svg.append(g);
  });
  return svg;
}

// Small line icons for the section titles (24x24, stroke).
const FICONS = {
  meals: 'M7 3v8a3 3 0 0 0 3 3v7M10 3v8M13 3v8a3 3 0 0 1-3 3M17 21V3c2 1.5 3 4 3 8h-3',
  weight: 'M5 7h14l2 13H3zM9 7a3 3 0 0 1 6 0M12 11l2 3',
  goal: 'M5 21V4M5 4h11l-2 4 2 4H5',
  check: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  bars: 'M5 20V10M10 20V4M15 20v-7M20 20V8',
  line: 'M3 17l6-6 4 4 8-8M3 21h18',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
};

// Health-style card: colored icon and title, optional caption on the right.
function hcard(icon, tone, title, caption, ...kids) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'fh-i' });
  svg.append(svgEl('path', { d: FICONS[icon] }));
  return el('section', { class: 'fpanel' },
    el('div', { class: 'fh fh-' + tone }, svg, el('span', { class: 'fh-t' }, title), caption ? el('span', { class: 'fh-c' }, caption) : ''),
    ...kids);
}

const hstat = (label, value, cls) => el('div', { class: 'hstat' }, el('div', { class: 'hstat-l' }, label), el('div', { class: 'hstat-v ' + (cls || '') }, value));
const panel = (title, ...kids) => el('section', { class: 'fpanel' }, el('div', { class: 'food-sub' }, title), ...kids);

// Last 7 full days: one row per nutrient, one cell per day, marked too low / in range / too high.
function weekCheck() {
  const tg = targets();
  const days = lastDays(8).slice(0, 7); // today is not finished, so it does not count yet
  const tot = days.map(dayTotals);
  if (!tot.some((t) => t.n)) return el('p', { class: 'muted small' }, 'Log a few days to see how you did against your targets.');
  const MARK = { low: '↓', high: '↑', ok: '', none: '', unk: '' };
  const grid = el('div', { class: 'mgrid', role: 'table', 'aria-label': 'Last 7 days against targets' });
  grid.append(el('span', {}), ...days.map((d) => el('span', { class: 'mg-d' }, new Date(d + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2))));
  const notes = [];
  for (const [key, label, unit] of NUTRI) {
    if (!tg[key]) continue;
    grid.append(el('span', { class: 'mg-l' }, label));
    const count = { low: 0, high: 0 };
    const vals = [];
    tot.forEach((t, i) => {
      let st = 'none', txt = '–';
      if (t.n) {
        const val = t[key];
        st = key !== 'kcal' && t.m ? 'unk' : macroStatus(key, val, tg[key]);
        txt = key === 'kcal' ? (val / 1000).toFixed(1) + 'k' : fmtN(val);
        if (st === 'low' || st === 'high') count[st]++;
        if (st !== 'unk') vals.push(val);
      }
      const why = { low: 'too low', high: 'too high', ok: 'in range', unk: 'some entries without protein/carbs/fat', none: 'nothing logged' }[st];
      grid.append(el('span', { class: 'mg-c ' + st, title: shortDay(days[i]) + ' · ' + label + ': ' + (t.n ? fmtN(t[key]) + ' ' + unit + ' of ' + fmtN(tg[key]) + ' · ' : '') + why }, txt + MARK[st]));
    });
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const n = vals.length;
    if (count.low && count.low >= count.high) notes.push(label + ': too low on ' + count.low + ' of ' + n + ' days (Ø ' + fmtN(avg) + ' of ' + fmtN(tg[key]) + ' ' + unit + ')');
    else if (count.high) notes.push(label + ': too high on ' + count.high + ' of ' + n + ' days (Ø ' + fmtN(avg) + ' of ' + fmtN(tg[key]) + ' ' + unit + ')');
  }
  return el('div', {}, grid,
    el('div', { class: 'muted small mg-key' }, '↓ too low · ↑ too high · green = in range'),
    ...(notes.length ? notes : ['All within range. Well done.']).map((l) => el('p', { class: 'small goal-line' }, l)));
}

// Where you stand: progress to the goal and four key numbers, like the tiles in Apple Health.
function goalBlock() {
  const g = goalInfo();
  if (!g) return el('p', { class: 'muted small' }, 'Enter your weight in Settings to see your goal and targets.');
  const done = Math.max(0, g.start - g.cur);
  const need = g.start - g.goal;
  const left = Math.max(0, g.cur - g.goal);
  const pct = need > 0 ? Math.min(100, (done / need) * 100) : 0;
  const kcal = nutri.kcal || 2500;
  const mm = measuredMaintenance();
  const maint = mm ? mm.kcal : formulaMaintenance();
  // pace: measured from your weights (4 weeks) if possible, else expected from calories
  const slope = weightTrendPerDay(trendWindow());
  const measured = slope !== null ? -slope * 7 : null; // kg lost per week
  const expected = maint ? ((maint - kcal) * 7) / 7700 : null;
  const pace = measured !== null ? measured : expected;
  let when = '–';
  if (left <= 0) when = 'Reached';
  else if (pace > 0.05) {
    const weeks = left / pace;
    when = weeks > 104 ? '> 2 years' : addDays(new Date(), weeks * 7).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  const tile = (label, value, sub, cls) => el('div', { class: 'kpi ' + (cls || '') }, el('div', { class: 'kpi-l' }, label), el('div', { class: 'kpi-v' }, value), el('div', { class: 'kpi-s' }, sub));
  const kpis = el('div', { class: 'kpis' },
    tile('Pace', pace !== null ? (pace >= 0 ? '\u2212' : '+') + Math.abs(pace).toFixed(2) : '\u2013', measured !== null ? 'kg/wk \u00b7 ' + trendWindow().length / 7 + ' wks' : expected !== null ? 'kg/week, expected' : 'needs Settings'),
    tile('Goal', when, left > 0 ? fmtKg(left) + ' kg to go' : 'well done'),
    tile('For \u22120.5/wk', maint ? fmtN(Math.round((maint - 550) / 50) * 50) : '\u2013', maint ? 'kcal/day' : 'Settings', 'k-pink'));
  const ds = dataStatus();
  const missing = [ds.needW ? ds.needW + ' more weigh-in' + (ds.needW > 1 ? 's' : '') : '', ds.needF ? ds.needF + ' more logged day' + (ds.needF > 1 ? 's' : '') : ''].filter(Boolean).join(' and ');
  const data = el('div', { class: 'data-line', title: 'Food logged ' + ds.logged14 + ' of the last 14 days' + (maint ? ' \u00b7 maintenance \u2248 ' + fmtN(maint) + ' kcal' : '') },
    ds.ok ? '' : el('span', { class: 'dl-state' }, 'Estimated \u00b7 needs ' + missing));
  return el('div', { class: 'goal' },
    el('div', { class: 'nbar-track' }, el('div', { class: 'nbar-fill done', style: 'width:' + pct.toFixed(1) + '%' })),
    el('div', { class: 'goal-ends muted small' }, el('span', {}, 'Start ' + fmtKg(g.start)), el('span', { class: 'lost' }, '\u2212' + fmtKg(done) + ' kg'), el('span', {}, 'Goal ' + fmtKg(g.goal))),
    kpis,
    data);
}

/* ---------- Settings: nutrition goal ---------- */
function nutriFillSettings() {
  const w = weightOn(toDateStr(new Date()));
  $('set-weight').value = '';
  $('set-weight').placeholder = w ? 'last: ' + fmtKg(w.kg) + ' kg (' + shortDay(w.d) + ')' : 'e.g. 93.5';
  $('set-kcal').value = nutri.kcal || '';
  $('set-goalpct').value = nutri.goalPct || '';
  $('set-startkg').value = nutri.startKg || '';
  $('set-height').value = nutri.height || '';
  $('set-birth').value = nutri.birthYear || '';
  $('set-sex').value = nutri.sex || '';
  $('set-activity').value = String(nutri.activity || 1.45);
}

function nutriSaveSettings() {
  const num = (id) => { const v = parseFloat(String($(id).value).replace(',', '.')); return v > 0 ? v : null; };
  const kg = num('set-weight'); // today's weight: one entry per day, a new value replaces it
  if (kg && kg > 20 && kg < 400) {
    const today = toDateStr(new Date());
    weight = weight.filter((x) => x.d !== today).concat({ d: today, kg: Math.round(kg * 10) / 10 });
    saveWeight();
    renderFood();
  }
  const next = {
    kcal: Math.round(num('set-kcal') || 2500), goalPct: num('set-goalpct') || 10, startKg: num('set-startkg'),
    height: num('set-height'), birthYear: num('set-birth'), sex: $('set-sex').value, activity: parseFloat($('set-activity').value) || 1.45,
  };
  if (JSON.stringify(next) !== JSON.stringify(nutri)) { nutri = next; store.set('nutri', nutri); renderFood(); }
}

/* ---------- charts (plain SVG, one series each, hover shows the value) ---------- */

function svgEl(tag, attrs, text) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text !== undefined) n.textContent = text;
  return n;
}

// Bars per day with a dashed target line and the average. get(dayTotals) returns the value or null.
function barChart(days, { get, target, unit, h, cls, name }) {
  const W = 600, H = h || 130, L = 46, B = 18, T = 8;
  const vals = days.map((d) => get(dayTotals(d)));
  const shown = vals.filter((v) => v !== null);
  const max = Math.max(target || 0, ...shown, unit === 'kcal' ? 500 : 50) * 1.12;
  const step = unit === 'kcal' ? 100 : 10;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const bw = (W - L) / days.length;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'fchart ' + (cls || ''), role: 'img', 'aria-label': name + ' per day, last ' + days.length + ' days' });
  for (const g of [0.5, 1]) {
    const v = Math.round(((max / 1.12) * g) / step) * step;
    svg.append(svgEl('line', { x1: L, x2: W, y1: y(v), y2: y(v), class: 'grid' }), svgEl('text', { x: L - 6, y: y(v) + 4, class: 'ax', 'text-anchor': 'end' }, fmtN(v)));
  }
  const every = days.length <= 7 ? 1 : days.length <= 31 ? 7 : 14;
  days.forEach((d, i) => {
    const v = vals[i];
    const w = Math.max(1.5, bw - (days.length > 40 ? 1.5 : 3));
    const x = L + i * bw + (bw - w) / 2;
    const g = svgEl('g', { class: 'bar' + (i === days.length - 1 ? ' today' : '') });
    g.append(svgEl('title', {}, shortDay(d) + ': ' + (v !== null ? fmtN(v) + ' ' + unit : 'no data')));
    g.append(svgEl('rect', { x: L + i * bw, y: T, width: bw, height: H - T - B, class: 'hit' }));
    if (v) g.append(svgEl('rect', { x, y: y(v), width: w, height: Math.max(1, y(0) - y(v)), rx: Math.min(3, w / 2) }));
    svg.append(g);
    const last = i === days.length - 1;
    if ((days.length - 1 - i) % every === 0) {
      const lbl = last ? 'today' : days.length <= 7 ? new Date(d + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2) : shortDay(d);
      svg.append(svgEl('text', { x: last ? x + w : x + w / 2, y: H - 4, class: 'ax', 'text-anchor': last ? 'end' : 'middle' }, lbl));
    }
  });
  if (target) svg.append(svgEl('line', { x1: L, x2: W, y1: y(target), y2: y(target), class: 'tgt' }), svgEl('text', { x: L + 4, y: y(target) - 4, class: 'ax tgtlbl' }, 'target ' + fmtN(target)));
  return svg;
}

const avgOfDays = (days, get) => { const v = days.map((d) => get(dayTotals(d))).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const getKcal = (t) => (t.n ? t.kcal : null);
const getProtein = (t) => (t.n && !t.m ? t.p : null);

function kcalChart(days, h) { return barChart(days, { get: getKcal, target: nutri.kcal, unit: 'kcal', h, cls: 'b-kcal', name: 'Calories' }); }
function proteinChart(days, h) { return barChart(days, { get: getProtein, target: targets().p, unit: 'g', h, cls: 'b-p', name: 'Protein' }); }

function weightChart(all, h) {
  const pts = weight.filter((w) => w.d >= all[0]).sort((a, b) => a.d.localeCompare(b.d));
  // start the axis at the first weight (at least 14 days shown), so a new diary does not look empty
  const days = pts.length ? all.slice(Math.min(Math.max(0, all.indexOf(pts[0].d)), all.length - Math.min(14, all.length))) : all;
  const W = 600, H = h || 120, L = 46, B = 18, T = 10;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'fchart', role: 'img', 'aria-label': 'Weight since ' + days[0] });
  if (pts.length < 2) { svg.append(svgEl('text', { x: W / 2, y: H / 2, class: 'ax', 'text-anchor': 'middle' }, pts.length ? 'Enter your weight on more days to see a line.' : 'No weight entered yet.')); return svg; }
  const lo = Math.min(...pts.map((p) => p.kg)) - 0.5;
  const hi = Math.max(...pts.map((p) => p.kg)) + 0.5;
  const x = (d) => L + (W - L - 6) * (days.indexOf(d) / (days.length - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  for (const v of [lo + 0.5, hi - 0.5]) svg.append(svgEl('line', { x1: L, x2: W, y1: y(v), y2: y(v), class: 'grid' }), svgEl('text', { x: L - 6, y: y(v) + 4, class: 'ax', 'text-anchor': 'end' }, fmtKg(v)));
  // 7-day average: the real trend without the daily water swings
  const avgPts = days.map((d) => {
    const from = toDateStr(addDays(new Date(d + 'T00:00'), -6));
    const w = weight.filter((p) => p.d >= from && p.d <= d);
    return w.length ? [d, w.reduce((a, p) => a + p.kg, 0) / w.length] : null;
  }).filter(Boolean);
  // weighed often (every ~2 days): 7-day average line; weighed rarely (e.g. weekly): join the points and add a straight trend line
  const gap = pts.length > 1 ? (new Date(pts[pts.length - 1].d) - new Date(pts[0].d)) / 86400000 / (pts.length - 1) : 0;
  const dense = gap <= 2.5;
  svg.dataset.mode = dense ? 'avg' : 'sparse';
  svg.append(svgEl('polyline', { points: pts.map((p) => x(p.d).toFixed(1) + ',' + y(p.kg).toFixed(1)).join(' '), class: dense ? 'wline raw' : 'wline' }));
  if (dense && avgPts.length > 1) svg.append(svgEl('polyline', { points: avgPts.map(([d, v]) => x(d).toFixed(1) + ',' + y(Math.min(hi, Math.max(lo, v))).toFixed(1)).join(' '), class: 'wavg' }));
  if (!dense && pts.length >= 3) { // least-squares line over the points in view
    const t = pts.map((p) => days.indexOf(p.d)), n = pts.length;
    const mt = t.reduce((a, b) => a + b, 0) / n, mk = pts.reduce((a, p) => a + p.kg, 0) / n;
    const k = t.reduce((a, ti, i) => a + (ti - mt) * (pts[i].kg - mk), 0) / (t.reduce((a, ti) => a + (ti - mt) ** 2, 0) || 1);
    const at = (ti) => Math.min(hi, Math.max(lo, mk + k * (ti - mt)));
    svg.append(svgEl('line', { x1: x(days[t[0]]), y1: y(at(t[0])), x2: x(days[t[n - 1]]), y2: y(at(t[n - 1])), class: 'wtrend' }));
  }
  pts.forEach((p, i) => {
    const g = svgEl('g', { class: 'wdot' });
    g.append(svgEl('title', {}, shortDay(p.d) + ': ' + fmtKg(p.kg) + ' kg'));
    g.append(svgEl('circle', { cx: x(p.d), cy: y(p.kg), r: 9, class: 'hit' }));
    g.append(svgEl('circle', { cx: x(p.d), cy: y(p.kg), r: i === pts.length - 1 ? 4 : 3 }));
    svg.append(g);
  });
  svg.append(svgEl('text', { x: L, y: H - 4, class: 'ax' }, shortDay(days[0])), svgEl('text', { x: W - 2, y: H - 4, class: 'ax', 'text-anchor': 'end' }, 'today'));
  return svg;
}

/* When a card is taller than its content (cards in a row share one height),
   the last chart grows so the card has no empty space at the bottom. */
function growChart(box, draw) {
  const svg = box && box.querySelector('.fpanel:last-child svg.fchart');
  if (!svg) return;
  const panel = svg.closest('.fpanel');
  const used = [...panel.children].reduce((s, n) => s + n.getBoundingClientRect().height, 0) + 24 + 8 * (panel.children.length - 1);
  const free = panel.clientHeight - used;
  if (free < 12 || !svg.clientWidth) return;
  const vb = svg.viewBox.baseVal;
  const h = Math.min(420, Math.round(vb.height + free * (vb.width / svg.clientWidth)));
  svg.replaceWith(draw(h));
}

/* ---------- card ---------- */

function renderFood() {
  const box = $('food');
  if (!box) return;
  if (box.contains(document.activeElement) && document.activeElement.closest('.food-edit')) return; // editing: do not redraw
  const typing = document.activeElement && document.activeElement.id === 'food-text' ? document.activeElement.value : null;
  const today = toDateStr(new Date());
  const t = dayTotals(today);
  const avg7 = avgKcal(lastDays(7));
  const list = food.filter((e) => e.at.slice(0, 10) === today).sort((a, b) => b.at.localeCompare(a.at));

  const input = el('input', { type: 'text', id: 'food-text', placeholder: 'What did you eat?', title: 'Tip: tap the microphone on the iPhone keyboard to dictate', maxlength: '300', autocomplete: 'off', 'aria-label': 'What did you eat' });
  const form = el('form', { class: 'row food-add' }, input, el('button', { type: 'submit' }, 'Add'));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const e = { id: uid(), at: toLocalISO(new Date()), text, kcal: null, p: null, c: null, f: null, src: null, err: null };
    food.push(e);
    saveFood();
    input.value = '';
    estimateEntry(e);
  });

  const tg = targets();
  const left = tg.kcal - t.kcal;
  const parts = NUTRI.filter(([k]) => tg[k]).map(([k]) => [k, t[k], tg[k]]);
  const legend = el('div', { class: 'lgd' }, ...NUTRI.filter(([k]) => tg[k]).map(([k, label, unit]) => {
    const h = macroHint(k, t[k], tg[k], unit);
    return el('div', { class: 'lg lg-' + k },
      el('div', { class: 'lg-l' }, label),
      el('div', { class: 'lg-v' }, fmtN(t[k]), el('span', { class: 'lg-t' }, '/' + fmtN(tg[k])), el('span', { class: 'lg-u' }, unit.toUpperCase())),
      el('div', { class: 'lg-h ' + h.cls }, h.hint));
  }));
  const hero = el('div', { class: 'fsum' }, el('div', { class: 'fsum-rings' }, stackRings(parts, 150)), legend);
  const macros = tg.p ? '' : el('p', { class: 'muted small fsum-foot' }, 'Enter your weight in Settings to get protein, carb and fat targets.');
  const head = el('div', { class: 'food-today' }, hero, macros);

  const ul = el('ul', { class: 'list food-list' });
  if (!list.length) ul.append(el('li', { class: 'muted small meal-empty' }, 'Nothing logged yet. Type or dictate what you ate.'));
  for (const e of list) ul.append(foodEditId === e.id ? foodEditRow(e) : foodRow(e));

  const w = weightOn(today);
  const w7 = weightOn(toDateStr(addDays(new Date(), -7)));
  const dw = w && w7 && w7.d !== w.d ? w.kg - w7.kg : null;
  const wForm = el('div', { class: 'food-weight' },
    el('div', { class: 'grow' },
      el('div', { class: 'wt-v' }, w ? fmtKg(w.kg) : '\u2013', el('span', { class: 'wt-u' }, ' kg')),
      el('div', { class: 'muted small' }, w ? (w.d === today ? 'Today' : shortDay(w.d)) + (dw !== null ? ' \u00b7 ' : '') : 'Enter your weight in Settings',
        dw !== null ? el('span', { class: 'wt-d ' + (dw < -0.05 ? 'good' : dw > 0.05 ? 'bad' : '') }, Math.abs(dw) < 0.05 ? 'same as last week' : (dw > 0 ? '+' : '\u2212') + fmtKg(Math.abs(dw)) + ' kg vs last week') : '')));

  const goalCard = hcard('goal', 'green', 'Goal', '−' + (nutri.goalPct || 10) + ' %' + (dataStatus().ok ? ' \u00b7 \u2713 measured' : ''), goalBlock());
  // Trends: one range for all charts, like Apple Health (W / M / 3M)
  const n = trendRange;
  const daysN = lastDays(n);
  const seg = el('div', { class: 'seg', role: 'tablist', 'aria-label': 'Time range' }, ...[[7, 'W'], [30, 'M'], [90, '3M']].map(([v, l]) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': String(v === n), class: v === n ? 'on' : '', onclick: () => { trendRange = v; store.set('trendRange', v); renderFood(); } }, l)));
  const avgK = avgOfDays(daysN, getKcal), avgP = avgOfDays(daysN, getProtein);
  const rangeTxt = n === 7 ? '7 days' : n === 30 ? '30 days' : '3 months';
  const wRange = weight.filter((p) => p.d >= daysN[0]).sort((a, b) => a.d.localeCompare(b.d));
  const wChange = wRange.length > 1 ? wRange[wRange.length - 1].kg - wRange[0].kg : null;
  const trendCards = [
    n === 7 ? hcard('check', 'orange', 'Targets', 'last 7 days', weekCheck()) : '',
    hcard('bars', 'pink', 'Calories', avgK ? 'Ø ' + fmtN(avgK) + ' kcal' : rangeTxt, kcalChart(daysN, 120)),
    tg.p ? hcard('bars', 'indigo', 'Protein', avgP ? 'Ø ' + fmtN(avgP) + ' g' : rangeTxt, proteinChart(daysN, 100)) : '',
    hcard('line', 'purple', 'Weight', wChange !== null ? (wChange > 0 ? '+' : '−') + fmtKg(Math.abs(wChange)) + ' kg' : rangeTxt, weightChart(daysN, 110),
      el('div', { class: 'muted small food-stats w-cap' }, '')),
  ];

  // three cards: Food (today), Health (weight and goal), Trends (last days)
  box.replaceChildren(el('div', { class: 'food-col' }, form, head,
    hcard('meals', 'pink', 'Meals', list.length ? list.length + (list.length === 1 ? ' entry' : ' entries') : 'today', ul)));
  const wsvg = trendCards[3] && trendCards[3].querySelector && trendCards[3].querySelector('svg.fchart');
  const wcap = trendCards[3] && trendCards[3].querySelector && trendCards[3].querySelector('.w-cap');
  if (wcap) wcap.textContent = wsvg && wsvg.dataset.mode === 'avg' ? 'Dots: each weigh-in \u00b7 line: 7-day average' : wsvg && wsvg.dataset.mode === 'sparse' ? 'Dots: each weigh-in \u00b7 dashed: trend' : '';
  const refresh = el('button', { type: 'button', class: 'tip-refresh', title: 'New tips', 'aria-label': 'New tips', onclick: () => loadTips(true) }, tipsBusy ? '\u2026' : '\u21bb');
  const tipsCard = hcard('bulb', 'yellow', 'Tips', '', tipsBlock());
  tipsCard.querySelector('.fh').append(refresh);
  goalCard.querySelector('.fh').after(wForm); // current weight sits at the top of the goal
  $('health').replaceChildren(el('div', { class: 'food-col' }, goalCard, tipsCard));
  $('trends').replaceChildren(el('div', { class: 'food-col' }, seg, ...trendCards));
  fitRows(ul, 3); // the last three meals; the rest scrolls
  requestAnimationFrame(() => {
    // Food sets the height; Health and Trends take the same height (not on the phone, where cards stack)
    const wide = window.matchMedia('(min-width: 700px)').matches;
    const fh = $('card-food').offsetHeight;
    for (const id of ['card-health', 'card-trends']) $(id).style.height = wide ? fh + 'px' : '';
    requestAnimationFrame(() => {
      growChart($('trends'), (h) => weightChart(daysN, h));
    });
  });
  if (typing !== null) { input.value = typing; input.focus(); }
  $('food-status').textContent = foodMirrorMsg;
}

// One line per meal: time, what, kcal. Protein/carbs/fat show on hover.
function foodRow(e) {
  const kc = e.busy ? el('span', { class: 'muted small' }, 'Estimating…')
    : e.kcal !== null && e.kcal !== undefined ? el('span', { class: 'food-kc' }, fmtN(e.kcal), el('span', { class: 'food-kcu' }, ' kcal'))
      : el('button', { type: 'button', class: 'ghost small', title: e.err || '', onclick: () => estimateEntry(e) }, 'Estimate');
  const macro = e.p != null ? 'Protein ' + fmtN(e.p) + ' g · Carbs ' + fmtN(e.c) + ' g · Fat ' + fmtN(e.f) + ' g' : e.src === 'manual' ? 'Own value' : '';
  return el('li', { class: 'meal', title: macro },
    el('span', { class: 'food-time muted small' }, e.at.slice(11, 16)),
    el('span', { class: 'grow meal-t' }, e.text, e.err && !e.busy ? el('span', { class: 'food-err small' }, e.err) : ''),
    kc,
    el('span', { class: 'meal-act' },
      iconButton('edit', 'Edit ' + e.text, () => { foodEditId = e.id; renderFood(); }),
      iconButton('trash', 'Delete ' + e.text, () => { food = food.filter((x) => x.id !== e.id); saveFood(); renderFood(); })));
}

// Change text, time or calories. A changed text is estimated again (unless you typed the calories).
function foodEditRow(e) {
  const text = el('input', { type: 'text', 'aria-label': 'Food' }); text.value = e.text;
  const time = el('input', { type: 'time', 'aria-label': 'Time' }); time.value = e.at.slice(11, 16);
  const kcal = el('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'kcal', placeholder: 'kcal' }); kcal.value = e.kcal ?? '';
  const done = () => { foodEditId = null; renderFood(); };
  const save = () => {
    const newText = text.value.trim() || e.text;
    const newKcal = kcal.value === '' ? null : parseInt(kcal.value, 10);
    const textChanged = newText !== e.text;
    const kcalChanged = newKcal !== (e.kcal ?? null);
    e.text = newText;
    e.at = e.at.slice(0, 11) + (time.value || e.at.slice(11, 16));
    foodEditId = null;
    if (kcalChanged && newKcal !== null) Object.assign(e, { kcal: newKcal, p: null, c: null, f: null, src: 'manual', err: null });
    saveFood();
    if (textChanged && !kcalChanged) estimateEntry(e); else renderFood();
  };
  for (const n of [text, time, kcal]) n.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } if (ev.key === 'Escape') done(); });
  requestAnimationFrame(() => text.focus());
  return el('li', { class: 'food-edit' }, el('span', { class: 'grow food-edit-fields' }, text, el('span', { class: 'row' }, time, kcal)),
    el('button', { type: 'button', class: 'small', onclick: save }, 'Save'),
    el('button', { type: 'button', class: 'ghost small', onclick: done }, 'Cancel'));
}

/* ---------- mirror to two Google Sheets in your Drive (for your own analysis) ---------- */

let foodMirrorTimer = null;
let foodMirrorMsg = '';

function foodMirrorSoon() {
  clearTimeout(foodMirrorTimer);
  foodMirrorTimer = setTimeout(foodMirror, 8000);
}

function csv(rows) {
  return rows.map((r) => r.map((v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n') + '\n';
}

async function sheetFind(name) {
  const q = encodeURIComponent("name='" + name + "' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const r = await (await driveFetch(DRIVE + '?fields=files(id)&q=' + q)).json();
  return r.files && r.files[0] ? r.files[0].id : null;
}

// Create the sheet from CSV the first time; afterwards replace its content with the new CSV.
async function sheetWrite(name, content) {
  const id = await sheetFind(name);
  if (id) {
    await driveFetch(DRIVE_UP + '/' + id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'text/csv' }, body: content });
    return;
  }
  const b = 'fredsheet' + Date.now();
  const meta = { name, mimeType: 'application/vnd.google-apps.spreadsheet' };
  const body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
    '\r\n--' + b + '\r\nContent-Type: text/csv\r\n\r\n' + content + '\r\n--' + b + '--';
  await driveFetch(DRIVE_UP + '?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body });
}

async function foodMirror() {
  if (typeof gHasToken !== 'function' || !gHasToken()) return; // next time you are connected
  if (!gScopes.includes('drive.file')) { foodMirrorMsg = 'Sheets in Drive need one more Google permission: press Connect.'; $('food-status').textContent = foodMirrorMsg; return; }
  try {
    const rows = [['date', 'time', 'food', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'source']].concat(
      [...food].sort((a, b) => a.at.localeCompare(b.at)).map((e) => [e.at.slice(0, 10), e.at.slice(11, 16), e.text, e.kcal, e.p, e.c, e.f, e.src || '']));
    await sheetWrite('Fred Food Log', csv(rows));
    await sheetWrite('Fred Weight Log', csv([['date', 'weight_kg']].concat([...weight].sort((a, b) => a.d.localeCompare(b.d)).map((w) => [w.d, w.kg]))));
    foodMirrorMsg = 'Saved to Google Sheets ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    foodMirrorMsg = 'Sheets: ' + e.message;
  }
  $('food-status').textContent = foodMirrorMsg;
}

function initFood() {
  renderFood();
  setTimeout(() => loadTips(false), 1500); // once a day
  setInterval(() => { if (!document.hidden) loadTips(false); }, 30 * 60000);
  let rt = null; // new size of the window: draw again, so the charts fill the cards
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderFood, 250); });
  // new day at midnight, and keep "today" current
  setInterval(() => { if (!document.hidden) renderFood(); }, 5 * 60000);
}
