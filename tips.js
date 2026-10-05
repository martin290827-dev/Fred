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

// DATENBLOCK for the tips prompt: all "verbleibend" values are computed here, the AI does not calculate.
function dayContext() {
  const tg = targets(), t = dayTotals(toDateStr(new Date())), l = leftToday();
  const sLeft = tg.s ? Math.max(0, Math.round(tg.s - t.s)) : null;
  return 'Uhrzeit: ' + new Date().toTimeString().slice(0, 5) + '\n' +
    'Kalorien: ' + Math.round(t.kcal) + ' von ' + tg.kcal + ' kcal gegessen, verbleibend ' + l.kcal + ' kcal' + (l.over ? ' (Ziel schon überschritten)' : '') + '\n' +
    (tg.p ? 'Protein: ' + Math.round(t.p) + ' von ' + tg.p + ' g, verbleibend ' + l.p + ' g\n' : '') +
    (tg.c ? 'Kohlenhydrate: ' + Math.round(t.c) + ' von ' + tg.c + ' g, verbleibend ' + l.c + ' g\n' : '') +
    (tg.f ? 'Fett (Limit): ' + Math.round(t.f) + ' von ' + tg.f + ' g, Fettbudget verbleibend ' + l.f + ' g\n' : '') +
    (sLeft !== null ? 'Zucker (Limit): ' + Math.round(t.s) + ' von ' + tg.s + ' g, verbleibend ' + sLeft + ' g\n' : '') +
    'Gemüse/Obst erfasst: ' + (VEG.test(mealsToday().join(' ')) ? 'ja' : 'nein') + ' (Schlagwortsuche in der Mahlzeitenliste)\n' +
    'Ballaststoffe: nicht erfasst (kein Ziel). Kalzium: nicht erfasst (kein Ziel).\n' +
    (late() ? 'Hinweis: Es ist nach 21 Uhr oder es sind weniger als 250 kcal übrig. Empfiehl keine neue Mahlzeit. Nenne höchstens einen kleinen Snack, nur falls Hunger da ist, sonst nur GOOD.\n' : '') +
    'Mahlzeiten heute:\n' + (mealsToday().join('\n') || '(keine)');
}
const VEG = /gemüse|salat|brokkoli|tomate|paprika|karotte|möhre|gurke|spinat|zucchini|kürbis|kraut|pilz|bohne|erbse|obst|apfel|banane|beere|orange|birne|traube|veg|salad|fruit|berr/i;
const late = () => dayPhase() === 'late evening' || leftToday().kcal < 250;

/* what is missing today */
const GAPS_SYSTEM = `Du bist ein evidenzbasierter Ernährungscoach für kontrolliertes Abnehmen (Kaloriendefizit, Muskelerhalt).

Du bekommst am Ende einen DATENBLOCK. Nutze nur Zahlen aus diesem Block. Erfinde keine Werte und rechne nicht selbst, alle "verbleibend"-Werte sind schon berechnet.

Ziel: Sage, was heute noch fehlt oder verbessert werden kann, passend zu den Mahlzeiten, die noch kommen.

Regeln:
1. Kaloriendefizit hat Vorrang. Schlage nichts vor, das die verbleibenden kcal überschreitet.
2. Protein: Wenn verbleibendes Protein > 15 g, schlage eine konkrete Menge (20–30 g) mit Lebensmittel vor. Ist das Ziel erreicht oder fast erreicht, lobe das. Es gibt höchstens EINEN Protein-Tipp.
3. Fett ist ein LIMIT, kein Ziel. Empfiehl nie, Fett "aufzufüllen". Nur wenn verbleibendes Fettbudget > 10 g, darfst du 10–25 g aus Nüssen, Avocado, Olivenöl oder fettem Fisch erwähnen. Sonst kein Fett-Tipp.
4. Gemüse, Obst und Ballaststoffe: Steht im DATENBLOCK "Gemüse/Obst erfasst: nein", gib einen eigenen Tipp dafür (z. B. Brokkoli, Salat, Beeren). Das gilt auch dann, wenn es morgens ist.
5. Kalzium: Nur wenn es unter Ziel liegt. Nenne fettarme Quellen (Magerquark, Skyr, fettarmer Joghurt, Käse ≤ 20 % Fett).
6. Jeder Tipp: 1–2 Sätze, nennt den aktuellen Stand mit Zahl, schlägt eine kleine konkrete Handlung vor und nennt den Kalorieneffekt mit "ca.".
7. Maximal 1 GOOD und 3 ADD. Jeder ADD behandelt ein anderes Thema (Protein, Gemüse/Obst, Kohlenhydrate als Energie, Trinken); nie zwei Tipps zum selben Thema. Prüfe alle Themen, nicht nur Protein. Kohlenhydrate sind erlaubt, solange Kalorien übrig sind; schlage z. B. Haferflocken, Kartoffeln oder Vollkornbrot vor, wenn Kohlenhydrate stark unter dem Ziel liegen. Wenn nichts fehlt, gib nur GOOD aus. Weniger Tipps sind besser als schwache Tipps.
8. Sprache: Deutsch, direkt, ohne Werbesprache.
9. Fehlen Daten, gib ein leeres Array aus.

Referenzwerte (ca.): 25 g Nüsse 150 kcal; 1 EL Olivenöl 90 kcal; 150 g Magerquark 100 kcal; 150 g Skyr 95 kcal; 200 g Brokkoli 70 kcal; 100 g Hühnerbrust 110 kcal.

Ausgabe: nur gültiges JSON, kein weiterer Text:
[{"type":"GOOD"|"ADD","title":"max 4 Wörter","text":"1–2 Sätze"}]

Beispiel (Daten: 13:00 Uhr, kcal verbleibend 1100, Protein 70/150 g, Kohlenhydrate 90/200 g, Gemüse/Obst erfasst: nein):
[{"type":"GOOD","title":"Kalorien im Plan","text":"900 von 2000 kcal bis mittags passen gut zum Defizit."},
 {"type":"ADD","title":"Gemüse einplanen","text":"Bisher kein Gemüse erfasst. Ergänze am Nachmittag 200 g Brokkoli oder einen Salat (ca. 70 kcal)."},
 {"type":"ADD","title":"Eiweiß abends","text":"Dir fehlen noch 80 g Protein. 150 g Skyr (ca. 95 kcal, ca. 16 g Protein) sind ein kleiner Anfang."}]

Schlechtes Beispiel (nie so): "Du brauchst noch 80 g Fett."

DATENBLOCK steht in der Nachricht des Nutzers.`;

async function loadGaps(force) {
  if (gapsBusy || !anthropicKey) return;
  const today = toDateStr(new Date()), sig = todaySig();
  if (!dayTotals(today).n) return;
  if (!force && gaps.sig === sig && (gaps.list.length || gaps.empty)) return;
  gapsBusy = true;
  renderTips(true);
  try {
    const j = await aiJSON(GAPS_SYSTEM, 'DATENBLOCK:\n' + dayContext(), 700);
    if (!Array.isArray(j)) throw new Error('unexpected answer');
    const arr = j;
    const good = arr.filter((x) => x && x.type === 'GOOD' && x.text).slice(0, 1), add = arr.filter((x) => x && x.type === 'ADD' && x.text).slice(0, 3);
    gaps = { day: today, sig, err: '', empty: !good.length && !add.length, list: good.concat(add).map((x) => ({ kind: x.type === 'GOOD' ? 'good' : 'add', title: String(x.title || ''), text: String(x.text) })) };
  } catch (e) {
    gaps = Object.assign({}, gaps, { err: e.message, empty: false });
  }
  gapsBusy = false;
  store.set('gaps', gaps);
  renderTips(true);
}

const GAP_KINDS = { add: 'Add', good: 'Good' };
const GAP_CLS = { add: 'add', good: 'good' };

function gapsBlock() {
  if (!anthropicKey) return el('p', { class: 'muted small' }, 'Add an Anthropic key in Settings.');
  const today = toDateStr(new Date());
  if (!dayTotals(today).n) return el('p', { class: 'muted small' }, 'Log a meal to see what is still missing today.');
  if (gaps.day === today && gaps.empty && !gapsBusy) return el('p', { class: 'muted small' }, 'Nothing to add right now.');
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
