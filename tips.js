/* ---------- Card "Health & Nutrition Tips": the 14-day tips, what is missing today, and what to cook ---------- */
// Needs food.js (food data, targets, aiJSON, tips) and an Anthropic key in Settings. Nothing here is sent anywhere else.

let gaps = store.get('gaps', { day: '', sig: '', list: [], err: '' }); // "what is missing today"
let gapsBusy = false;
let cook = store.get('cook', { day: '', input: '', ideas: [], err: '' }); // "what shall I cook"
let cookBusy = false;
let cookText = cook.input || '';

// Part of the day, so advice fits the clock: nobody needs a chicken breast at 22:00.
function dayPhase(d) {
  const h = (d || new Date()).getHours();
  return h < 11 ? 'morning' : h < 14 ? 'midday' : h < 18 ? 'afternoon' : h < 21 ? 'evening' : 'late evening';
}
const todaySig = () => { const t = dayTotals(toDateStr(new Date())); return toDateStr(new Date()) + ':' + t.n + ':' + Math.round(t.kcal) + ':' + dayPhase(); };

// What is left today, never below 0.
function leftToday() {
  const tg = targets(), t = dayTotals(toDateStr(new Date()));
  const l = (k) => (tg[k] ? Math.max(0, Math.round(tg[k] - t[k])) : null);
  return { kcal: l('kcal'), p: l('p'), c: l('c'), f: l('f'), over: t.kcal > tg.kcal };
}

function mealsToday() {
  const today = toDateStr(new Date());
  return food.filter((e) => e.at.slice(0, 10) === today).sort((a, b) => a.at.localeCompare(b.at))
    .map((e) => e.at.slice(11, 16) + ' ' + e.text + (e.kcal != null ? ' (' + e.kcal + ' kcal' + (e.p != null ? ', P' + e.p + ' C' + e.c + ' F' + e.f : '') + ')' : ''));
}

function dayContext() {
  const tg = targets(), t = dayTotals(toDateStr(new Date())), l = leftToday();
  return 'Language of the answer: ' + (navigator.language || 'de-AT') + '\n' +
    'Time now: ' + new Date().toTimeString().slice(0, 5) + ' (' + dayPhase() + ')\n' +
    'Daily targets: ' + tg.kcal + ' kcal' + (tg.p ? ', protein ' + tg.p + ' g, carbs ' + tg.c + ' g, fat ' + tg.f + ' g' : '') + '\n' +
    'Eaten so far today: ' + Math.round(t.kcal) + ' kcal' + (t.m ? '' : ', protein ' + Math.round(t.p) + ' g, carbs ' + Math.round(t.c) + ' g, fat ' + Math.round(t.f) + ' g') + '\n' +
    'Left today: ' + l.kcal + ' kcal' + (l.p !== null ? ', protein ' + l.p + ' g, carbs ' + l.c + ' g, fat ' + l.f + ' g' : '') + (l.over ? ' (already above the calorie target)' : '') + '\n' +
    'Meals today:\n' + (mealsToday().join('\n') || '(none yet)');
}

/* what is missing today */
const GAPS_SYSTEM = 'You are a fair, evidence-based nutrition expert. You get what one adult has eaten so far today, the time now, and his daily targets. ' +
  'Judge the day like an expert would at this time of day. Small gaps are normal and are never worth eating for late at night; a gap can be closed tomorrow. ' +
  'Rules: (1) Never suggest food that is bigger than the calories left today (a tolerance of 50 kcal). (2) Time matters. Morning to afternoon: say what is still missing ' +
  '(protein, vegetables, fibre, fruit, healthy fats, calcium, iron, omega-3, judged only from the foods listed) and name concrete foods that fit the calories left. ' +
  'Evening (18 to 21): suggest at most one practical meal or snack that fits. Late evening (after 21:00), or less than about 250 kcal left: do NOT tell him to eat a meal. ' +
  'Say that the day is essentially done and that it is fine not to eat more; at most name ONE small snack that fits the calories left, only if he is hungry (for example skyr or quark for protein). ' +
  'Put what was missing as a short hint for tomorrow. (3) A target missed or exceeded by a small amount (about 5 percent) is on target; say so. (4) Name one thing that went well. ' +
  'The day may not be over before 21:00, so never blame him for meals not logged yet. 3 to 4 items, no moralizing, no medical advice. ' +
  'kind: add = eat this now, watch = limit or avoid, good = went well, tomorrow = for tomorrow, done = no need to eat more. ' +
  'Reply with JSON only: {"items":[{"kind":"add|watch|good|tomorrow|done","title":"max 5 words","text":"max 24 words"}]}';

async function loadGaps(force) {
  if (gapsBusy || !anthropicKey) return;
  const today = toDateStr(new Date()), sig = todaySig();
  if (!dayTotals(today).n) return;
  if (!force && gaps.sig === sig && gaps.list.length) return;
  gapsBusy = true;
  renderTips(true);
  try {
    const j = await aiJSON(GAPS_SYSTEM, dayContext(), 700);
    gaps = { day: today, sig, err: '', list: (j.items || []).filter((x) => x && x.text).slice(0, 5).map((x) => ({ kind: ['add', 'watch', 'good', 'tomorrow', 'done'].includes(x.kind) ? x.kind : '', title: String(x.title || ''), text: String(x.text) })) };
  } catch (e) {
    gaps = Object.assign({}, gaps, { err: e.message });
  }
  gapsBusy = false;
  store.set('gaps', gaps);
  renderTips(true);
}

const GAP_KINDS = { add: 'Add', watch: 'Watch', good: 'Good', tomorrow: 'Tomorrow', done: 'Enough' };
const GAP_CLS = { add: 'add', watch: 'cut', good: 'good', tomorrow: 'swap', done: 'good' };

function gapsBlock() {
  if (!anthropicKey) return el('p', { class: 'muted small' }, 'Add an Anthropic key in Settings.');
  const today = toDateStr(new Date());
  if (!dayTotals(today).n) return el('p', { class: 'muted small' }, 'Log a meal to see what is still missing today.');
  if (gaps.day !== today || !gaps.list.length) return el('p', { class: 'muted small' }, gapsBusy ? 'Looking at today’s meals…' : gaps.err ? 'Tips: ' + gaps.err : 'Tap ↻ to check today.');
  const old = gaps.sig !== todaySig();
  return el('div', {},
    el('ul', { class: 'tips' }, ...gaps.list.map((t) => el('li', { class: 'tip' },
      el('span', { class: 'tip-k k-' + (GAP_CLS[t.kind] || 'none') }, GAP_KINDS[t.kind] || '•'),
      el('span', { class: 'tip-b' }, t.title ? el('span', { class: 'tip-t' }, t.title) : '', el('span', { class: 'tip-x' }, t.text))))),
    old ? el('p', { class: 'muted small' }, 'Out of date (new meals or a later time of day). Tap ↻ to update.') : '');
}

/* what shall I cook */
const COOK_SYSTEM = 'You are a practical home cook and nutrition coach. The person lists the food he has at home. ' +
  'Suggest 3 different dishes he can cook mainly from it (oil, salt, spices, onion and garlic may be assumed; name anything else he would need in "extra"). ' +
  'Fit the calories and macros he has left today: a dish must not be bigger than what is left, and should help with the protein still missing. ' +
  'If little is left, suggest light dishes or a snack. Choose the kind of meal by the time of day. Give honest estimates for one portion. ' +
  'Late evening (after 21:00) or less than about 250 kcal left: do not suggest full meals. Say in "note" that the day is essentially done and it is fine not to eat more, ' +
  'and give at most one or two light options that fit the calories left, for the case that he is hungry. ' +
  'Reply with JSON only: {"note":"max 25 words or empty","ideas":[{"name":"max 6 words","kcal":number,"p":number,"c":number,"f":number,"how":"max 35 words, how to cook it","extra":"max 8 words or empty"}]}';

async function askCook(text) {
  if (cookBusy || !anthropicKey || !text.trim()) return;
  cookBusy = true;
  cook = Object.assign({}, cook, { input: text.trim(), err: '' });
  renderTips(true);
  try {
    const j = await aiJSON(COOK_SYSTEM, dayContext() + '\nFood at home: ' + text.trim(), 1100);
    const n = (v) => Math.max(0, Math.round(Number(v) || 0));
    cook = { day: toDateStr(new Date()), input: text.trim(), err: '', note: String(j.note || ''), ideas: (j.ideas || []).filter((x) => x && x.name).slice(0, 4).map((x) => ({ name: String(x.name), kcal: n(x.kcal), p: n(x.p), c: n(x.c), f: n(x.f), how: String(x.how || ''), extra: String(x.extra || '') })) };
  } catch (e) {
    cook = Object.assign({}, cook, { err: e.message });
  }
  cookBusy = false;
  store.set('cook', cook);
  renderTips(true);
}

function cookBlock() {
  if (!anthropicKey) return el('p', { class: 'muted small' }, 'Add an Anthropic key in Settings.');
  const l = leftToday();
  const left = 'Left today: ' + fmtN(l.kcal) + ' kcal' + (l.p !== null ? ' · P ' + l.p + ' g · C ' + l.c + ' g · F ' + l.f + ' g' : '') + (l.over ? ' · above target' : '');
  const input = el('textarea', { id: 'cook-text', rows: '4', placeholder: 'What do you have at home? e.g. chicken, rice, broccoli, eggs', maxlength: '600', 'aria-label': 'Food at home' });
  input.value = cookText;
  input.addEventListener('input', () => { cookText = input.value; });
  const form = el('form', { class: 'cook-form' }, input, el('button', cookBusy ? { type: 'submit', disabled: '' } : { type: 'submit' }, cookBusy ? '\u2026' : 'Suggest'));
  form.addEventListener('submit', (ev) => { ev.preventDefault(); askCook(input.value); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); askCook(input.value); } });
  const out = [];
  if (cook.err) out.push(el('p', { class: 'muted small' }, 'Cook: ' + cook.err));
  if (cook.note && cook.day === toDateStr(new Date())) out.push(el('p', { class: 'small cook-note' }, cook.note));
  if (cook.ideas.length && cook.day === toDateStr(new Date())) {
    out.push(el('ul', { class: 'tips cook-ideas' }, ...cook.ideas.map((x) => el('li', { class: 'tip' },
      el('span', { class: 'tip-b' },
        el('span', { class: 'tip-t' }, x.name),
        el('span', { class: 'muted small' }, '~' + x.kcal + ' kcal · P ' + x.p + ' · C ' + x.c + ' · F ' + x.f),
        el('span', { class: 'tip-x' }, x.how),
        x.extra ? el('span', { class: 'tip-x' }, 'Extra: ' + x.extra) : '')))));
  }
  return el('div', {}, el('p', { class: 'muted small cook-left' }, left), form, ...out);
}

/* the card */
function renderTips(force) {
  const box = $('tips');
  if (!box) return;
  if (!force && box.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return; // typing: do not redraw
  const tipRefresh = el('button', { type: 'button', class: 'tip-refresh', title: 'New tips', 'aria-label': 'New tips', onclick: () => loadTips(true) }, tipsBusy ? '…' : '↻');
  const gapRefresh = el('button', { type: 'button', class: 'tip-refresh', title: 'Check today again', 'aria-label': 'Check today again', onclick: () => loadGaps(true) }, gapsBusy ? '…' : '↻');
  const p1 = hcard('bulb', 'yellow', 'Last 14 days', '', tipsBlock(true));
  p1.querySelector('.fh').append(tipRefresh);
  const p2 = hcard('check', 'green', 'Missing today', '', gapsBlock());
  p2.querySelector('.fh').append(gapRefresh);
  const p3 = hcard('meals', 'pink', 'What shall I cook?', '', cookBlock());
  const keep = document.activeElement && document.activeElement.id === 'cook-text' ? [document.activeElement.selectionStart] : null;
  box.replaceChildren(el('div', { class: 'food-col' }, p2, p1, p3)); // missing today, last 14 days, cook
  if (keep) { const i = $('cook-text'); i.focus(); i.setSelectionRange(keep[0], keep[0]); }
}

function initTips() {
  renderTips(true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadGaps(false); }); // back in the app: refresh when meals or the time of day changed
  setTimeout(() => loadGaps(false), 2500);
  setInterval(() => { if (!document.hidden) loadGaps(false); }, 30 * 60000);
}
