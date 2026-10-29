// Logic tests without a browser. Run: node tools/test.js   (no install needed, not part of the app)
// Loads the app files into a sandbox with small stand-ins for the browser, then checks the rules that can lose or misreport data.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const mem = {};
const noop = () => {};
const ctx = {
  console, Date, Math, JSON, Promise, setTimeout: noop, setInterval: noop, clearTimeout: noop,
  localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
  document: { getElementById: () => null, addEventListener: noop, hidden: false, activeElement: null, querySelectorAll: () => [] },
  window: {}, navigator: { language: 'en' }, matchMedia: () => ({ matches: false, addEventListener: noop }), location: { hostname: 'localhost' },
};
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
// top-level const / let become sandbox properties, so the tests can read and replace them
const load = (f) => vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^'use strict';/, '').replace(/^(const|let) /gm, 'var '), ctx, { filename: f });
for (const f of ['app.js', 'sync.js', 'food.js', 'recovery.js', 'now.js', 'nsum.js', 'cockpit.js', 'heatmap.js', 'sheets.js']) load(f);
const run = (code) => vm.runInContext(code, ctx);
let ok = 0;
const test = async (name, fn) => { try { await fn(); ok++; } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } };

(async () => {
  // a day n days before today, as YYYY-MM-DD
  const day = (n) => run('toDateStr(addDays(new Date(), ' + -n + '))');

  /* ---- Google Sheet sync ---- */
  const calls = [];
  ctx.shId = 'X';
  ctx.shApi = async (path, opts) => { calls.push((opts && opts.method || 'GET') + ' ' + decodeURIComponent(path)); return {}; };
  ctx.renderShop = noop; ctx.banner = noop;
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: 'a' + i, text: 'item ' + i, done: false }));
  const baseOf = (list) => { run('shBase = {}'); ctx.shop = list; return list; };

  await test('a tab is written in ONE request, old rows overwritten with empty cells', async () => {
    calls.length = 0; let body = null;
    const api = ctx.shApi;
    ctx.shApi = async (path, opts) => { body = JSON.parse(opts.body); return api(path, opts); };
    await ctx.shWriteRows('shop', [{ id: 'a', item: 'x', done: 0, position: 0 }], { n: 4, w: 5 });
    ctx.shApi = api;
    assert.strictEqual(calls.length, 1, calls.join(' | '));
    assert.ok(calls[0].startsWith('PUT'));
    assert.strictEqual(body.values.length, 4); // header + 1 row + 2 empty rows over the old ones
    assert.ok(body.values.every((r) => r.length === 5) && body.values[3].every((c) => c === ''));
  });

  await test('a blank tab (failed write) does not delete local rows', async () => {
    ctx.shop = rows(5);
    run("shBase = { shop: Object.fromEntries(SH_SETS.shop.get().map((r) => [r.id, shText(r, SH_SETS.shop.cols)])) }");
    calls.length = 0;
    await ctx.shSyncSet('shop', { rows: [], blank: true });
    assert.strictEqual(ctx.shop.length, 5);
    assert.ok(calls.some((c) => c.startsWith('PUT')), 'rows are written back');
  });

  await test('a tab with only the header (everything deleted elsewhere) is a real delete', async () => {
    ctx.shop = rows(5);
    run("shBase = { shop: Object.fromEntries(SH_SETS.shop.get().map((r) => [r.id, shText(r, SH_SETS.shop.cols)])) }");
    await ctx.shSyncSet('shop', { rows: [], blank: false });
    assert.strictEqual(ctx.shop.length, 0);
  });

  await test('a new row on this device is kept and written', async () => {
    baseOf(rows(2));
    run("shBase = { shop: { a0: shText(SH_SETS.shop.get()[0], SH_SETS.shop.cols) } }");
    calls.length = 0;
    await ctx.shSyncSet('shop', { rows: [run('SH_SETS.shop.get()[0]')], blank: false });
    assert.strictEqual(ctx.shop.length, 2);
    assert.ok(calls.some((c) => c.startsWith('PUT')));
  });

  await test('the minute check skips the full download when nothing changed', async () => {
    const keep = { shReady: ctx.shReady, shOpen: ctx.shOpen, shModTime: ctx.shModTime, shReadAll: ctx.shReadAll, shStatus: ctx.shStatus };
    let reads = 0;
    Object.assign(ctx, { shReady: () => true, shOpen: async () => 'X', shModTime: async () => 'm1', shReadAll: async () => { reads++; throw new Error('stop after the read'); }, shStatus: noop });
    run("shMod = 'm1'; shDirty = false; shFullAt = Date.now();");
    await ctx.shSync(); assert.strictEqual(reads, 0, 'unchanged: no download');
    run("shDirty = true;"); await ctx.shSync(); assert.strictEqual(reads, 1, 'changed here: full sync');
    run("shDirty = false; shFullAt = Date.now();"); ctx.shModTime = async () => 'm2';
    await ctx.shSync(); assert.strictEqual(reads, 2, 'changed elsewhere: full sync');
    run("shDirty = false; shFullAt = Date.now() - 11 * 60000;"); ctx.shModTime = async () => 'm1'; run("shMod = 'm1'");
    await ctx.shSync(); assert.strictEqual(reads, 3, 'older than 10 min: full sync');
    run("shDirty = false; shFullAt = Date.now();"); await ctx.shSync(true); assert.strictEqual(reads, 4, 'back in the app: full sync');
    Object.assign(ctx, keep);
  });

  /* ---- before you eat ---- */
  run("food = []; nutri = { kcal: 2200 };");
  ctx.food.push({ id: '1', at: day(1) + 'T12:00', text: 'Pizza', kcal: 900, p: 35 }, { id: '2', at: day(2) + 'T12:00', text: 'Skyr', kcal: 200, p: 25 }, { id: '3', at: day(0) + 'T08:00', text: 'Brot', kcal: 1500, p: 20 });
  await test('known meal: same text or own kcal in the text', () => {
    assert.strictEqual(ctx.knownMeal(' pizza ').kcal, 900);
    assert.strictEqual(ctx.knownMeal('Salat 350 kcal').kcal, 350);
    assert.strictEqual(ctx.knownMeal('etwas Neues'), null);
  });
  await test('meals grouped by day see new and changed meals', () => {
    const n0 = ctx.dayTotals(day(2)).n;
    ctx.food.push({ id: 'x', at: day(2) + 'T20:00', text: 'Nuss', kcal: 100, p: 3 });
    assert.strictEqual(ctx.dayTotals(day(2)).n, n0 + 1); // the list got longer: grouping is rebuilt
    ctx.food[ctx.food.length - 1].kcal = 150;
    assert.ok(ctx.dayTotals(day(2)).kcal >= 150); // an edit in place is seen
    ctx.food.pop(); run('saveFood = saveFood'); // keep the list as it was
  });
  await test('meal ideas fit the calories left, most protein per kcal first', () => {
    const ideas = ctx.mealIdeas(700, 3).map((e) => e.text);
    assert.strictEqual(JSON.stringify(ideas), '["Skyr"]'); // the pizza and the bread are too big
    ctx.food.push({ id: '4', at: day(0) + 'T07:00', text: 'skyr', kcal: 200, p: 25 });
    assert.strictEqual(ctx.mealIdeas(700, 3).length, 0); // eaten today already: not suggested again
  });

  /* ---- AI requests ---- */
  await test('Haiku 5.5: thinking off, low effort; Sonnet 5.5: medium effort with room to think', () => {
    const h = ctx.aiBody('s', 't', 700, null, 'claude-haiku-5-5');
    assert.strictEqual(h.thinking.type, 'disabled'); assert.strictEqual(h.output_config.effort, 'low'); assert.strictEqual(h.max_tokens, 1400);
    const so = ctx.aiBody('s', 't', 700, null, 'claude-sonnet-5-5');
    assert.strictEqual(so.thinking, undefined); assert.strictEqual(so.output_config.effort, 'medium'); assert.strictEqual(so.max_tokens, 2800);
  });
  await test('no Haiku 4.5: a failed call is retried with Haiku 5.5', async () => {
    const used = []; let n = 0;
    ctx.anthropicKey = 'k'; ctx.renderAiUse = noop;
    ctx.fetch = async (url, o) => { const b = JSON.parse(o.body); used.push(b.model); n++;
      if (n === 1) return { ok: false, status: 529, json: async () => ({ error: { message: 'Overloaded' } }) };
      return { ok: true, json: async () => ({ model: b.model, usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn', content: [{ type: 'text', text: '{"kcal":500}' }] }) }; };
    const saved = ctx.setTimeout; ctx.setTimeout = (f, ms) => (ms === 1500 ? f() : 0); // the retry runs at once, other timers do not run
    const j = await ctx.aiJSON('s', 'pizza', 700);
    ctx.setTimeout = saved;
    assert.strictEqual(j.kcal, 500);
    assert.strictEqual(JSON.stringify(used), '["claude-haiku-5-5","claude-haiku-5-5"]');
  });

  /* ---- Nutrition Summary periods ---- */
  await test('nutrition summary: 7 / 15 / 30 days against the same length before', () => {
    run('food = []');
    for (let i = 1; i <= 60; i++) ctx.food.push({ id: 'n' + i, at: day(i) + 'T12:00', text: 'x', kcal: 2000, p: 100, c: 200, f: 60, s: 20 });
    for (const n of [7, 15, 30]) {
      ctx.nsRange = n;
      const f = run('nsFacts()');
      assert.strictEqual(f.week.logged, n);
      assert.ok(f.prev && f.prev.logged === n, 'previous period for ' + n);
      assert.strictEqual(f.week.to, day(1)); // today does not count
    }
  });

  /* ---- Heatmap bases ---- */
  await test('heatmap bases for 3M / 6M / 1Y', () => {
    const series = []; for (let i = 400; i >= 0; i--) series.push([day(i), 1000 - i]);
    const b = ctx.heatBases(series);
    assert.strictEqual(b.m3, 1000 - 91); assert.strictEqual(b.m6, 1000 - 182); assert.strictEqual(b.y1, 1000 - 365);
  });

  /* ---- Cockpit and device switch ---- */
  // n nights ending d0 days ago, with values from f(i)
  const nights = (n, d0, f) => Array.from({ length: n }, (_, i) => Object.assign({ d: day(d0 + n - 1 - i), hrv: 50, rhr: 55, sleepMin: 420, sleepNeedMin: 480, sleepDebtMin: 0 }, f(i)));

  await test('device switch: the baseline only uses nights of the same device', () => {
    const rows = nights(20, 3, () => ({})).concat(nights(3, 0, () => ({ dev: 'other', hrv: 25 })));
    const sc = ctx.computeScores(rows);
    assert.ok(sc[19].score != null, 'old device scored');
    assert.ok(sc.slice(20).every((r) => r.score == null), 'new device: no score until 7 own nights');
    const f = ctx.ckFacts(rows, []);
    assert.strictEqual(f.dev, 'other'); assert.strictEqual(f.calib, true); assert.strictEqual(f.norm, null);
    assert.strictEqual(f.nights, 3);
  });

  await test('cockpit: newest week against the 30 nights before, training against the average week', () => {
    const rows = nights(30, 7, () => ({ hrv: 40 })).concat(nights(7, 0, () => ({ hrv: 50, sleepMin: 432 })));
    const wos = [{ d: day(1), min: 60, kcal: 400 }, { d: day(3), min: 30, kcal: 200 }, // this week: 90 min
      { d: day(10), min: 60 }, { d: day(20), min: 60 }, { d: day(30), min: 60 }, { d: day(40), min: 60 }]; // day 40 is outside the 28 days before
    const f = ctx.ckFacts(rows, wos);
    assert.strictEqual(f.calib, false);
    assert.strictEqual(f.week.hrv, 50); assert.strictEqual(f.norm.hrv, 40);
    assert.strictEqual(Math.round(f.week.sleepPct), 90);
    assert.strictEqual(f.load.min, 90); assert.strictEqual(f.load.n, 2); assert.strictEqual(f.load.normMin, 45);
    assert.strictEqual(ctx.ckJudge('rhr', 58, 55, 1, false).cls, 'worse');
    assert.strictEqual(ctx.ckJudge('resp', 15.2, 14.6, 0.5, null).cls, 'same');
    assert.strictEqual(ctx.ckJudge('resp', 15.8, 14.6, 0.5, null).cls, 'worse');
  });

  await test('Sheet: the device column is read as text, an empty cell means the old device', () => {
    ctx.SH_SETS.whoop.set([{ d: '2026-01-01', hrv: '50', dev: '' }, { d: '2026-01-02', hrv: '48', dev: 'other' }]);
    assert.strictEqual(ctx.whoop[0].dev, null); assert.strictEqual(ctx.rcDev(ctx.whoop[0]), 'whoop');
    assert.strictEqual(ctx.whoop[1].dev, 'other'); assert.strictEqual(ctx.whoop[1].hrv, 48);
  });

  console.log(process.exitCode ? 'Some tests failed.' : 'OK: ' + ok + ' logic tests passed.');
})();
