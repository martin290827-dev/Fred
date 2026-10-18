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
for (const f of ['app.js', 'sync.js', 'food.js', 'recovery.js', 'now.js', 'nsum.js', 'heatmap.js', 'sheets.js']) load(f);
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

  await test('write first, then clear only the rows below', async () => {
    calls.length = 0;
    await ctx.shWriteRows('shop', [{ id: 'a', item: 'x', done: 0, position: 0 }]);
    assert.ok(calls[0].startsWith('PUT') && calls[1].startsWith('POST') && /!A3:ZZ:clear/.test(calls[1]), calls.join(' | '));
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

  /* ---- before you eat ---- */
  run("food = []; nutri = { kcal: 2200 };");
  ctx.food.push({ id: '1', at: day(1) + 'T12:00', text: 'Pizza', kcal: 900, p: 35 }, { id: '2', at: day(2) + 'T12:00', text: 'Skyr', kcal: 200, p: 25 }, { id: '3', at: day(0) + 'T08:00', text: 'Brot', kcal: 1500, p: 20 });
  await test('known meal: same text or own kcal in the text', () => {
    assert.strictEqual(ctx.knownMeal(' pizza ').kcal, 900);
    assert.strictEqual(ctx.knownMeal('Salat 350 kcal').kcal, 350);
    assert.strictEqual(ctx.knownMeal('etwas Neues'), null);
  });
  await test('meal ideas fit the calories left, most protein per kcal first', () => {
    const ideas = ctx.mealIdeas(700, 3).map((e) => e.text);
    assert.strictEqual(JSON.stringify(ideas), '["Skyr"]'); // the pizza and the bread are too big
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

  console.log(process.exitCode ? 'Some tests failed.' : 'OK: ' + ok + ' logic tests passed.');
})();
