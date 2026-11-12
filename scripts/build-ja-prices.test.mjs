// Tests scripts/build-ja-prices.mjs with a tiny copy of tcgcsv's files (scripts/fixtures/tcgcsv, cut from the real
// ones) and a stand-in server on 127.0.0.1. Nothing here touches the internet. Run: node scripts/build-ja-prices.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'build-ja-prices.mjs');
const fixtures = process.env.FIXTURES ?? path.join(here, 'fixtures', 'tcgcsv');
const tmp = mkdtempSync(path.join(tmpdir(), 'ja-prices-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const at = (...p) => path.join(tmp, ...p);
// The fixture has 13 groups and 33 price rows: the real "too little data" limits are switched off unless a test wants them.
const env = { ...process.env, JA_PRICES_MIN_GROUPS: '1', JA_PRICES_MIN_ROWS: '1', JA_PRICES_PAUSE_MS: '0', JA_PRICES_PREV: '', TCGCSV_BASE: 'http://127.0.0.1:9', GITHUB_ACTIONS: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' };

/** Runs the script; resolves with its exit code and everything it printed. */
const run = (args, extraEnv = {}, nodeArgs = []) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [...nodeArgs, script, ...args], { env: { ...env, ...extraEnv } });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('close', (code) => resolve({ code, log }));
  });
const json = (...p) => JSON.parse(readFileSync(at(...p), 'utf8'));
/** Every file of an output folder: relative path → bytes. Two folders are "the same" when these are equal. */
const tree = (dir, base = dir) =>
  Object.fromEntries(
    readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((e) => (e.isDirectory() ? Object.entries(tree(path.join(dir, e.name), base)) : [[path.relative(base, path.join(dir, e.name)), readFileSync(path.join(dir, e.name), 'utf8')]])),
  );
/** A copy of the fixture folder as tcgcsv might look the next day, changed by `edit(file → parsed JSON)`. */
function variant(name, { updated = '2026-11-12T20:03:11+0000', edit = {}, remove = [] } = {}) {
  const dir = at(name);
  cpSync(fixtures, dir, { recursive: true });
  writeFileSync(path.join(dir, 'last-updated.txt'), updated);
  for (const [file, change] of Object.entries(edit)) {
    const value = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    writeFileSync(path.join(dir, file), typeof change === 'string' ? change : JSON.stringify(change(value) ?? value));
  }
  for (const file of remove) rmSync(path.join(dir, file));
  return dir;
}

// ---------- 1. A first build from the folder: the file format the app reads ----------

let r = await run(['--from', fixtures, '--out', at('a')]);
assert.equal(r.code, 0);
assert.match(r.log, /status new/);

const sv8a = json('a', 's', 'sv8a.json');
assert.deepEqual(sv8a, {
  v: 1,
  d: '2026-11-11T20:05:27Z',
  k: 'sv8a',
  g: [
    {
      id: 23909,
      n: 'SV8a: Terastal Fest ex',
      c: 1,
      p: {
        602319: ['001/187', '', { normal: [0.13, 0.01, 0.15, 1.99] }],
        // A card without a price today keeps its number: the app must see that 001/187 is two products.
        602320: ['001/187', 'Mirror Foil', {}],
        // The user's card, Hawlucha 084/187: normal, the plain mirror and the Master Ball mirror are three products.
        602464: ['084/187', '', { normal: [0.18, 0.01, 0.17, 1], holofoil: [0.17, 0.01, 0.2, 0.99] }],
        602465: ['084/187', 'Mirror Foil', { holofoil: [0.6, 0.34, 0.63, 1.84] }],
        604564: ['084/187', 'Master Ball Pattern', { holofoil: [2.27, 2.27, 3.15, 7] }],
      },
    },
  ],
});
assert.deepEqual(Object.keys(sv8a), ['v', 'd', 'k', 'g']);
assert.ok(!('603428' in sv8a.g[0].p), 'the booster box (no Number, no Rarity) is left out');
assert.deepEqual(json('a', 'all.json').groups.find((g) => g.id === 23909).x, [603428], 'and remembered, so tomorrow it is not a new product');

// Row keys in TCGdex spelling; a missing market price is null.
assert.deepEqual(json('a', 's', 'g23731.json').g[0].p, {
  576257: ['', '', { '1st-edition-holofoil': [81.49, 74.99, 81.32, 81.49], 'unlimited-holofoil': [null, 50, 50, 50] }],
  576258: ['', '', { '1st-edition': [null, 12, 14, 15.75], unlimited: [null, 14, 15.88, 20] }],
});

// Key rule: set code lower-cased, "+" → "p", other punctuation → "-", no code → g<groupId>; plus the alias files.
assert.deepEqual(readdirSync(at('a', 's')).sort(), ['bw8', 'bw8a', 'g23721', 'g23731', 'g23740', 'g24567', 'l1-hg', 'm-p', 'm2a', 'pmcg1', 'sm1p', 'sv2a', 'sv4a', 'sv8a'].map((k) => `${k}.json`));
const groupsOf = (key) => json('a', 's', `${key}.json`).g.map((g) => [g.id, g.c]);
assert.deepEqual(groupsOf('sm1p'), [[23880, 0]], '"sm1+"');
assert.deepEqual(groupsOf('l1-hg'), [[24025, 0]], '"L1: HG"');
assert.deepEqual(groupsOf('bw8'), [[23904, 1], [23905, 0]], 'two groups share the code BW8 and stay apart inside the file');
assert.deepEqual(groupsOf('bw8a'), [[23904, 1]], 'alias: TCGdex BW8a is only Spiral Force');
assert.deepEqual(groupsOf('pmcg1'), [[23721, 1], [23740, 0]], 'alias: a set without a TCGplayer set code');
assert.equal(json('a', 's', 'pmcg1.json').k, 'pmcg1');
assert.deepEqual(json('a', 's', 'pmcg1.json').g[0], json('a', 's', 'g23721.json').g[0]);

// Card number as TCGplayer writes it, and every bracket of the product name as a tag.
const products = Object.assign({}, ...readdirSync(at('a', 's')).flatMap((f) => json('a', 's', f).g.map((g) => g.p)));
const numberAndTag = (id) => products[id].slice(0, 2);
assert.deepEqual(numberAndTag(566553), ['001/165', 'Poke Ball Pattern'], 'name "Bulbasaur - 001/165 (Poke Ball Pattern)"');
assert.deepEqual(numberAndTag(566706), ['001/165', 'Master Ball Pattern']);
assert.deepEqual(numberAndTag(577294), ['001/190', 'Mirror Holofoil']);
assert.deepEqual(numberAndTag(691618), ['069/M-P', 'Mirror Holo']);
assert.deepEqual(numberAndTag(665924), ['004/193', 'Love Ball Pattern']);
assert.deepEqual(numberAndTag(665931), ['011/193', 'Friend Ball Pattern']);
assert.deepEqual(numberAndTag(665935), ['015/193', 'Team Rocket Pattern']);
assert.deepEqual(numberAndTag(666088), ['001/193', 'Energy Symbol Pattern']);
assert.deepEqual(numberAndTag(602227), ['033/051', 'Team Plasma'], 'a bracket of the card name is kept too: the app tells them apart');
assert.deepEqual(numberAndTag(575569), ['', ''], 'a 1996 card: TCGplayer has no Number for it');
assert.deepEqual(numberAndTag(602262), ['', ''], 'no product list for this group');

const index = json('a', 'index.json');
assert.deepEqual(Object.keys(index), ['v', 'd', 'source', 'counts', 'keys', 'sizes', 'aliases', 'route']);
assert.deepEqual(index.counts, { groups: 13, files: 14, products: 29, rows: 33, withMarket: 25, withNumber: 16, unpriced: 1 });
assert.equal(json('a', 'all.json').unpriced, 1, 'marks a snapshot that lists cards without a price');
assert.deepEqual(index.keys, ['bw8', 'g23721', 'g23731', 'g23740', 'g24567', 'l1-hg', 'm-p', 'm2a', 'sm1p', 'sv2a', 'sv4a', 'sv8a']);
assert.deepEqual(index.sizes, [6, 2, 2, 1, 3, 1, 1, 4, 2, 2, 1, 4]);
assert.deepEqual(index.aliases, ['bw8a', 'pmcg1']);
assert.equal(index.d, '2026-11-11T20:05:27Z');
// route = [product id step, key number, …]: every product must be routed to the file it is in.
const routed = (productId) => {
  let from = 0;
  let key;
  for (let i = 0; i < index.route.length; i += 2) {
    from += index.route[i];
    if (from > productId) break;
    key = index.keys[index.route[i + 1]];
  }
  return key;
};
for (const key of index.keys) for (const g of json('a', 's', `${key}.json`).g) for (const id of Object.keys(g.p)) assert.equal(routed(Number(id)), key, `route of ${id}`);

// ---------- 2. Same input, same bytes ----------

r = await run(['--from', fixtures, '--out', at('a2')]);
assert.deepEqual(tree(at('a2')), tree(at('a')));

// The step outputs the workflow reads.
r = await run(['--from', fixtures, '--out', at('a3')], { GITHUB_OUTPUT: at('gh-output.txt') });
assert.equal(readFileSync(at('gh-output.txt'), 'utf8'), 'status=new\ndate=2026-11-11T20:05:27Z\n');

// ---------- 3. Same day again, with the first build as "previous": nothing is read or rebuilt ----------

r = await run(['--from', fixtures, '--prev', at('a'), '--out', at('b')]);
assert.match(r.log, /status same/);
assert.deepEqual(tree(at('b')), tree(at('a')));
// --prev-only never looks at tcgcsv at all (here: a folder that does not exist).
r = await run(['--from', at('nothing-here'), '--prev', at('a', 'all.json'), '--prev-only', '--out', at('b2')]);
assert.match(r.log, /status same/);
assert.deepEqual(tree(at('b2')), tree(at('a')));
// …and with nothing to copy (a typo, no internet) it leaves the files from last time alone.
r = await run(['--prev', at('nothing-here'), '--prev-only', '--out', at('b2')]);
assert.match(r.log, /nothing to copy/);
assert.match(r.log, /status none; 0 requests/);
assert.deepEqual(tree(at('b2')), tree(at('a')));

// A previous snapshot from before cards without a price were kept reads every product list once more; a marked one doesn't.
const unmarked = json('a', 'all.json');
delete unmarked.unpriced;
for (const g of unmarked.groups) for (const [id, p] of Object.entries(g.p)) if (!Object.keys(p[2]).length) delete g.p[id];
mkdirSync(at('old'));
writeFileSync(at('old', 'all.json'), JSON.stringify(unmarked));
r = await run(['--from', variant('next-day'), '--prev', at('old'), '--out', at('b3')]);
assert.match(r.log, /status new/);
assert.match(r.log, /"productLists":7/, "every group with a product list");
assert.deepEqual(json('b3', 's', 'sv8a.json').g[0].p[602320], ['001/187', 'Mirror Foil', {}]);
r = await run(['--from', variant('next-day-2'), '--prev', at('a'), '--out', at('b4')]);
assert.match(r.log, /"productLists":0/);
assert.deepEqual(json('b4', 's', 'sv8a.json').g[0].p[602320], ['001/187', 'Mirror Foil', {}], 'kept from the previous snapshot');

// ---------- 4. tcgcsv is broken: yesterday's files are restored from --prev, and the script still exits 0 ----------

r = await run(['--from', at('nothing-here'), '--prev', at('a'), '--out', at('c')], { GITHUB_OUTPUT: at('gh-kept.txt') });
assert.equal(r.code, 0);
assert.match(r.log, /status kept/);
assert.deepEqual(tree(at('c')), tree(at('a')));
assert.equal(readFileSync(at('gh-kept.txt'), 'utf8'), 'status=kept\ndate=2026-11-11T20:05:27Z\n');

// A --prev that is not ours (a host's "page not found" HTML, another format, a damaged file) is no previous at
// all: the build goes on without it instead of crashing halfway.
const notOurs = { html: '<!doctype html><title>CardCheck</title>', format: '{"v":2,"d":"2026-11-11T20:05:27Z","groups":[]}', damaged: '{"v":1,"d":"2026-11-11T20:05:27Z","groups":[{"id":23909}]}' };
for (const [name, body] of Object.entries(notOurs)) {
  writeFileSync(at(`prev-${name}.json`), body);
  r = await run(['--from', fixtures, '--prev', at(`prev-${name}.json`), '--out', at('c2')]);
  assert.equal(r.code, 0, name);
  assert.match(r.log, /no previous snapshot/, name);
  assert.deepEqual(tree(at('c2')), tree(at('a')), name);
}

// Broken and nothing from before: no folder at all (the app then shows Cardmarket prices); --strict exits 1.
r = await run(['--from', at('nothing-here'), '--out', at('d')]);
assert.equal(r.code, 0);
assert.match(r.log, /status none/);
assert.ok(!existsSync(at('d')));
r = await run(['--from', at('nothing-here'), '--out', at('d'), '--strict']);
assert.equal(r.code, 1);

// ---------- 5. Guards: data that looks broken never replaces yesterday's files ----------

const nullMarket = (file) => void file.results.forEach((row) => (row.marketPrice = null));
const allPriceFiles = readdirSync(fixtures).filter((f) => f.endsWith('.prices.json'));
const guards = [
  ['too few groups (the real limit: 200)', fixtures, ['--force'], { JA_PRICES_MIN_GROUPS: '200' }, /only 13 groups/],
  ['too few price rows (the real limit: 10,000)', fixtures, ['--force'], { JA_PRICES_MIN_ROWS: '10000' }, /only 33 price rows/],
  ['the group list shrank by more than a tenth', variant('g-groups', { edit: { 'groups.json': (f) => void f.results.splice(0, 2) } }), [], {}, /only 11 groups \(previous: 13\)/],
  ['the price rows shrank by more than a tenth', variant('g-rows', { edit: { '23909.prices.json': (f) => void (f.results = []) } }), [], {}, /only 28 price rows \(previous: 33\)/],
  ['hardly any market prices', variant('g-market', { edit: Object.fromEntries(allPriceFiles.map((f) => [f, nullMarket])) }), [], {}, /only 0 of 33 rows have a market price/],
  ['price files are missing', variant('g-missing', { remove: ['23909.prices.json'] }), [], {}, /1 of 13 groups have no price file/],
  ['a file cut off halfway', variant('g-cut', { edit: { '23909.prices.json': '{"success":true,"errors":[],"results":[{"productId":602319,"lowPri' } }), [], {}, /Could not build/],
  ['an error answer instead of data', variant('g-error', { edit: { '23909.prices.json': '{"success":false,"errors":["boom"],"results":[]}' } }), [], {}, /not a tcgcsv answer/],
  ['a snapshot older than ours', variant('g-old', { updated: '2026-11-10T20:01:00+0000' }), [], {}, /tcgcsv is older/],
];
for (const [name, from, args, extraEnv, message] of guards) {
  r = await run(['--from', from, '--prev', at('a'), '--out', at('guard'), ...args], extraEnv);
  assert.equal(r.code, 0, name);
  assert.match(r.log, message, name);
  assert.match(r.log, /status kept/, name);
  assert.deepEqual(tree(at('guard')), tree(at('a')), name);
}

// ---------- 6. The next day ----------

// New prices, and no product lists in the folder: card numbers, tags and the left-out box come from yesterday's files.
const cheaper = (file) => void (file.results.find((row) => row.productId === 602464 && row.subTypeName === 'Normal').marketPrice = 0.2);
const noLists = readdirSync(fixtures).filter((f) => f.endsWith('.products.json'));
r = await run(['--from', variant('day2', { edit: { '23909.prices.json': cheaper }, remove: noLists }), '--prev', at('a'), '--out', at('e')]);
assert.match(r.log, /status new/);
assert.match(r.log, /"productLists":0/);
const day2 = json('e', 's', 'sv8a.json');
assert.equal(day2.d, '2026-11-12T20:03:11Z');
assert.deepEqual(day2.g[0].p[602464], ['084/187', '', { normal: [0.2, 0.01, 0.17, 1], holofoil: [0.17, 0.01, 0.2, 0.99] }]);
assert.deepEqual({ ...day2.g[0], p: { ...day2.g[0].p, 602464: sv8a.g[0].p[602464] } }, sv8a.g[0], 'nothing else changed');
assert.deepEqual(json('e', 's', 'm2a.json').g, json('a', 's', 'm2a.json').g);

// A product we have not seen: that group's product list is read again (one list, not all seven).
const newCard = { productId: 700001, lowPrice: 1, midPrice: 2, highPrice: 3, marketPrice: 1.5, directLowPrice: null, subTypeName: 'Holofoil' };
const addRow = (file) => void file.results.push(newCard);
const addProduct = (file) => void file.results.push({ productId: 700001, name: 'Hawlucha (Energy Symbol Pattern)', groupId: 23909, extendedData: [{ name: 'Number', value: '084/187' }] });
r = await run(['--from', variant('day3', { updated: '2026-11-13T20:02:00+0000', edit: { '23909.prices.json': addRow, '23909.products.json': addProduct } }), '--prev', at('e'), '--out', at('f')]);
assert.match(r.log, /"productLists":1/);
assert.deepEqual(json('f', 's', 'sv8a.json').g[0].p[700001], ['084/187', 'Energy Symbol Pattern', { holofoil: [1.5, 1, 2, 3] }]);
// …and when that list cannot be had today: the price is published without a number, and c:0 asks again tomorrow.
r = await run(['--from', variant('day3b', { updated: '2026-11-13T20:02:00+0000', edit: { '23909.prices.json': addRow }, remove: ['23909.products.json'] }), '--prev', at('e'), '--out', at('f2')]);
const waiting = json('f2', 's', 'sv8a.json').g[0];
assert.equal(waiting.c, 0);
assert.deepEqual(waiting.p[700001], ['', '', { holofoil: [1.5, 1, 2, 3] }]);
assert.deepEqual(waiting.p[604564].slice(0, 2), ['084/187', 'Master Ball Pattern'], "yesterday's numbers stay");
assert.ok(!('603428' in waiting.p));

// A first run that takes too long stops reading product lists (here: at once) but still publishes every price;
// the next run, with newer prices, picks the lists up.
r = await run(['--from', fixtures, '--out', at('s1')], { JA_PRICES_LISTS_MS: '0' });
assert.match(r.log, /status new/);
assert.match(r.log, /"productLists":0,"listsLeft":13/);
assert.deepEqual(json('s1', 'index.json').counts, { ...index.counts, products: 30, rows: 34, withMarket: 26, withNumber: 0, unpriced: 0 }, 'with no list read, the booster box counts as a product');
assert.deepEqual(json('s1', 's', 'sv8a.json').g[0].p[604564], ['', '', { holofoil: [2.27, 2.27, 3.15, 7] }]);
r = await run(['--from', variant('day2-lists', { edit: { '23909.prices.json': cheaper } }), '--prev', at('s1'), '--out', at('s2')]);
assert.match(r.log, /"productLists":7,"listsLeft":0/);
assert.deepEqual(tree(at('s2')), tree(at('e')), 'the same files as if the first run had read them');

// ---------- 7. Over HTTP, against a stand-in for tcgcsv.com: its house rules ----------

/** Serves a fixture folder the way tcgcsv does (403 for a file it does not have) and notes every request. */
async function standIn(dir, { throttleFrom = Infinity, updated = true } = {}) {
  const seen = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname === '/site/data/tcgplayer-ja/all.json') return res.end(readFileSync(at('a', 'all.json')));
    seen.push({ path: pathname, agent: req.headers['user-agent'] ?? '' });
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    const send = (status, body) => {
      res.statusCode = status;
      // Answer a little late, so two requests at once would be noticed.
      setTimeout(() => (inFlight--, res.end(body)), 3);
    };
    if (seen.length >= throttleFrom) return send(429, 'slow down');
    const m = /^\/tcgplayer\/85\/(?:(\d+)\/)?(groups|prices|products)$/.exec(pathname);
    const file = pathname === '/last-updated.txt' ? (updated ? 'last-updated.txt' : 'gone') : m ? (m[1] ? `${m[1]}.${m[2]}.json` : 'groups.json') : 'gone';
    existsSync(path.join(dir, file)) ? send(200, readFileSync(path.join(dir, file))) : send(403, 'AccessDenied');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, seen, maxInFlight: () => maxInFlight, close: () => new Promise((resolve) => server.close(resolve)) };
}

// A first run: last-updated.txt first, then the group list, 13 price files and 13 product lists, one at a time.
let web = await standIn(fixtures);
r = await run(['--out', at('n1')], { TCGCSV_BASE: web.base });
await web.close();
assert.match(r.log, /status new; 28 requests/);
assert.equal(web.seen[0].path, '/last-updated.txt');
assert.equal(web.seen[1].path, '/tcgplayer/85/groups');
assert.equal(web.seen.filter((q) => q.path.endsWith('/prices')).length, 13);
assert.equal(web.maxInFlight(), 1, 'never two requests at once');
assert.ok(web.seen.every((q) => /^CardCheck\/\S+ \(\+https:\/\/github\.com\/\S+; daily price sync\)$/.test(q.agent)), 'our own User-Agent on every request');
assert.deepEqual(tree(at('n1')), tree(at('a')), 'the same files as from the folder');

// Nothing newer than what the site has (its all.json, fetched by URL as in CI): one small request, then stop.
web = await standIn(fixtures);
r = await run(['--out', at('n2')], { TCGCSV_BASE: web.base, JA_PRICES_PREV: `${web.base}/site/data/tcgplayer-ja/all.json` });
await web.close();
assert.match(r.log, /status same; 1 requests/);
assert.deepEqual(web.seen.map((q) => q.path), ['/last-updated.txt']);
assert.deepEqual(tree(at('n2')), tree(at('a')));

// Run twice on one computer without --prev: the output folder itself is "previous", so the second run asks once.
web = await standIn(fixtures);
r = await run(['--out', at('n1')], { TCGCSV_BASE: web.base });
await web.close();
assert.match(r.log, /status same; 1 requests/);

// The next day costs the price files plus the product lists we still lack (6 groups here), not all of them again.
web = await standIn(variant('day2-web', { edit: { '23909.prices.json': cheaper } }));
r = await run(['--prev', at('a'), '--out', at('n3')], { TCGCSV_BASE: web.base });
await web.close();
assert.match(r.log, /status new; 21 requests/);
assert.equal(web.seen.filter((q) => q.path.endsWith('/products')).length, 6);
assert.deepEqual(tree(at('n3')), tree(at('e')));

// HTTP 429 (throttled): stop at once, no second try, keep yesterday's files.
web = await standIn(variant('day2-429'), { throttleFrom: 5 });
r = await run(['--prev', at('a'), '--out', at('n4')], { TCGCSV_BASE: web.base });
await web.close();
assert.equal(r.code, 0);
assert.match(r.log, /HTTP 429/);
assert.match(r.log, /status kept; 5 requests/);
assert.equal(web.seen.length, 5);
assert.deepEqual(tree(at('n4')), tree(at('a')));

// No last-updated.txt: we cannot tell whether anything is new, so nothing else is downloaded.
web = await standIn(fixtures, { updated: false });
r = await run(['--prev', at('a'), '--out', at('n5')], { TCGCSV_BASE: web.base });
await web.close();
assert.match(r.log, /status kept; 1 requests/);

// The real address at the real pace, with fetch() answered from a folder (fixtures/fake-tcgcsv.mjs). Even when asked
// to hurry (JA_PRICES_PAUSE_MS=0), the script leaves 150 ms between two requests to tcgcsv.com.
const twoGroups = variant('two-groups', { edit: { 'groups.json': (f) => void (f.results = f.results.filter((g) => [23601, 24423].includes(g.groupId))) } });
r = await run(['--out', at('n6')], { TCGCSV_BASE: '', FAKE_TCGCSV_DIR: twoGroups, FAKE_TCGCSV_LOG: at('fetch.log') }, ['--import', pathToFileURL(path.join(here, 'fixtures', 'fake-tcgcsv.mjs')).href]);
assert.match(r.log, /status new; 6 requests/);
const asked = readFileSync(at('fetch.log'), 'utf8').trim().split('\n').map((line) => line.split(' '));
assert.deepEqual(
  asked.map(([, url]) => url),
  ['last-updated.txt', 'tcgplayer/85/groups', 'tcgplayer/85/23601/prices', 'tcgplayer/85/23601/products', 'tcgplayer/85/24423/prices', 'tcgplayer/85/24423/products'].map((p) => `https://tcgcsv.com/${p}`),
);
const gaps = asked.slice(1).map(([time], i) => time - asked[i][0]);
assert.ok(gaps.every((ms) => ms >= 145), `a pause before every request (a timer may fire a few ms early): ${gaps}`);

// ---------- 8. A mistyped --out must not delete somebody's folder ----------

mkdirSync(at('precious'));
writeFileSync(at('precious', 'homework.txt'), 'do not delete');
r = await run(['--from', fixtures, '--out', at('precious')]);
assert.notEqual(r.code, 0);
assert.match(r.log, /not replacing it/);
assert.deepEqual(readdirSync(at('precious')), ['homework.txt']);

console.log('build-ja-prices: all tests passed');
