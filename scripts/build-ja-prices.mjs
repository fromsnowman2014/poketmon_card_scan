// Builds public/data/tcgplayer-ja/: TCGplayer prices (USD) for Japanese cards. TCGdex has none for them, so they come
// from tcgcsv.com, a free daily mirror of TCGplayer's catalog (category 85 = Pokémon Japan, updated ~20:00 UTC).
// Run: node scripts/build-ja-prices.mjs   (npm run ja-prices). GitHub Actions runs it once a day (deploy.yml).
// On your own computer, copy the files the site already has instead of asking tcgcsv again:
//   npm run ja-prices -- --prev https://fromsnowman2014.github.io/poketmon_card_scan/data/tcgplayer-ja/all.json --prev-only
//   --from <dir>      read tcgcsv files from a folder instead of the network (tests, offline work):
//                     groups.json, <groupId>.prices.json, <groupId>.products.json (optional), last-updated.txt (optional)
//   --prev <dir|url>  the last published all.json (or its folder). Kept when today's download fails, reused as it is
//                     when tcgcsv has nothing newer, and it saves downloading card numbers again.
//                     Default when reading from the network: the output folder itself, if it has an all.json.
//   --out <dir>       default public/data/tcgplayer-ja (git-ignored; Vite serves it in dev and copies it into dist)
//   --updated <iso>   snapshot time when the --from folder has no last-updated.txt
//   --all-products    download every group's product list again (default: only new or changed groups)
//   --prev-only       copy --prev and never contact tcgcsv
//   --force           build even when tcgcsv's last-updated.txt is the one we already have
//   --strict          exit 1 when today's data could not be built (default: keep the previous files and exit 0)
// Env: TCGCSV_BASE (default https://tcgcsv.com), JA_PRICES_PREV (same as --prev), JA_PRICES_PAUSE_MS (default 150,
//      never less for tcgcsv.com), JA_PRICES_MIN_GROUPS / JA_PRICES_MIN_ROWS (tests with a tiny folder set both to 1),
//      JA_PRICES_LISTS_MS (default 360000: how long product lists may be read before only prices are).
// Output: s/<key>.json (one per set, what the app reads), index.json (date, counts, product id → file routes),
//         all.json (everything in one file, for the next run's --prev).
// tcgcsv's rules (https://tcgcsv.com/docs#usage-guidelines): once a day, own User-Agent, a pause between requests,
// check last-updated.txt first, never call it from the app itself.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATEGORY = 85;
const FORMAT = 1;
const TCGCSV = 'https://tcgcsv.com';
const USER_AGENT = 'CardCheck/1.0.0 (+https://github.com/fromsnowman2014/poketmon_card_scan; daily price sync)';
const TRIES = 4;
const BACKOFF_MS = [2000, 5000, 15000];
const REQUEST_TIMEOUT_MS = 30_000;
const TOTAL_BUDGET_MS = 12 * 60_000;
// Card numbers can wait a day, prices cannot: after this long (a very first run on a slow day) only prices are read,
// and the product lists that are left are asked for by the next run.
const LISTS_BUDGET_MS = Number(process.env.JA_PRICES_LISTS_MS ?? 6 * 60_000);
const MIN_PAUSE_MS = 150;
// "Too little data" guards: a broken or half-finished mirror must not replace yesterday's good files.
const MIN_GROUPS = Number(process.env.JA_PRICES_MIN_GROUPS ?? 200); // 461 groups, 29,185 price rows in November 2026
const MIN_ROWS = Number(process.env.JA_PRICES_MIN_ROWS ?? 10_000);
const MIN_VS_PREVIOUS = 0.9;
const MIN_MARKET_SHARE = 0.5;
const MAX_MISSING_GROUPS = 0.05;

// TCGdex set ids that are not the TCGplayer group's set code (old sets have none; "BW8" is two TCGplayer groups).
// Each one also gets its own file, so the app finds it with one request. Taken from TCGdex's own product ids.
const SET_ALIASES = {
  bw8a: [23904],
  pmcg1: [23721, 23740],
  pmcg2: [23722],
  pmcg3: [23723],
  pmcg4: [23724],
  pmcg5: [23725],
  pmcg6: [23726],
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(option('out') ?? path.join(here, '..', 'public', 'data', 'tcgplayer-ja'));
const FROM = option('from');
const BASE = (process.env.TCGCSV_BASE || TCGCSV).replace(/\/+$/, '');
// Running it twice on one computer must not download everything twice: what is already in the output folder counts
// as "previous". Not with --from: a folder costs nothing to read, and a rebuild from it should be a full one.
const PREV = option('prev') || process.env.JA_PRICES_PREV || (!FROM && existsSync(path.join(OUT, 'all.json')) ? OUT : undefined);
const pauseAsked = Number(process.env.JA_PRICES_PAUSE_MS ?? MIN_PAUSE_MS);
// Only a stand-in host (the tests' local server) may be asked faster than tcgcsv allows.
const PAUSE_MS = !Number.isFinite(pauseAsked) || (BASE === TCGCSV && pauseAsked < MIN_PAUSE_MS) ? MIN_PAUSE_MS : pauseAsked;
const startedAt = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/** GitHub Actions: a yellow annotation on the run, a line in the job summary and step outputs. Plain logs elsewhere. */
function warn(message) {
  console.log(process.env.GITHUB_ACTIONS ? `::warning title=Japanese card prices::${message}` : `WARNING: ${message}`);
}
function output(values) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Japanese card prices: ${JSON.stringify(values)}\n`);
}

// ---------- reading tcgcsv (network or folder) ----------

let requests = 0;
let bytesIn = 0;

/** Text of a tcgcsv file; null when it does not exist (403/404: S3 answers 403 for a missing file). Throws after retries. */
async function fetchText(url) {
  for (let attempt = 0; ; attempt++) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) throw new Error('took too long, giving up');
    let status = 0;
    try {
      requests++;
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      status = res.status;
      if (res.ok) {
        const text = await res.text();
        bytesIn += text.length;
        return text;
      }
      if (status === 403 || status === 404) return null;
      // 429: tcgcsv throttles an IP for 10 minutes. Asking again only makes it worse.
      if (status === 429) throw Object.assign(new Error(`HTTP 429 (throttled) for ${url}`), { fatal: true });
    } catch (e) {
      if (e.fatal || attempt >= TRIES - 1) throw e;
    }
    if (attempt >= TRIES - 1) throw new Error(`HTTP ${status} for ${url}`);
    await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
  }
}

const netSource = {
  text: (kind, id) =>
    fetchText(kind === 'updated' ? `${BASE}/last-updated.txt` : kind === 'groups' ? `${BASE}/tcgplayer/${CATEGORY}/groups` : `${BASE}/tcgplayer/${CATEGORY}/${id}/${kind}`),
  pause: () => sleep(PAUSE_MS),
};

const dirSource = (dir) => ({
  text: async (kind, id) => {
    const file = path.join(dir, kind === 'updated' ? 'last-updated.txt' : kind === 'groups' ? 'groups.json' : `${id}.${kind}.json`);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  },
  pause: async () => {},
});

function results(text, what) {
  const json = JSON.parse(text);
  if (json?.success !== true || !Array.isArray(json.results)) throw new Error(`${what}: not a tcgcsv answer`);
  return json.results;
}

// ---------- the previous snapshot ----------

async function loadPrevious(where) {
  if (!where) return null;
  try {
    let text;
    if (/^https?:\/\//i.test(where)) {
      // Our own site, not tcgcsv. A static host sometimes answers one request with a 5xx: try three times.
      const url = where.endsWith('.json') ? where : `${where.replace(/\/+$/, '')}/all.json`;
      for (let attempt = 0; text === undefined; attempt++) {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch((e) => ({ ok: false, status: 0, error: e }));
        if (res.ok) text = await res.text();
        else if (res.status === 404 || attempt >= 2) throw new Error(res.status ? `HTTP ${res.status}` : String(res.error?.message ?? 'network error'));
        else await sleep(BACKOFF_MS[attempt]);
      }
    } else {
      text = readFileSync(where.endsWith('.json') ? where : path.join(where, 'all.json'), 'utf8');
    }
    const snap = JSON.parse(text);
    if (snap?.v !== FORMAT || !Number.isFinite(Date.parse(snap.d)) || !Array.isArray(snap.groups)) throw new Error('unknown format');
    filesOf(snap); // throws on a damaged file, here rather than halfway through writing it out
    return snap;
  } catch (e) {
    log(`no previous snapshot (${where}): ${e.message}`);
    return null;
  }
}

// ---------- tcgcsv → our records ----------

/** "SV8a" → "sv8a", "SM1+" → "sm1p", "L1: HG" → "l1-hg". The app makes the same key from the TCGdex set id. */
const setKey = (abbreviation) =>
  String(abbreviation ?? '')
    .trim()
    .toLowerCase()
    .replace(/\+/g, 'p')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** "Holofoil" → "holofoil", "1st Edition Holofoil" → "1st-edition-holofoil": the names TCGdex uses for English cards. */
const subtypeKey = (name) => String(name ?? 'Normal').trim().toLowerCase().replace(/\s+/g, '-');

/** Positive finite dollars as cents-exact numbers, else null (0 and null both mean "no data"). */
const money = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1e7 ? Math.round(x * 100) / 100 : null);

/**
 * "Hawlucha (Master Ball Pattern)" → "Master Ball Pattern", "Bulbasaur - 001/165 (Poke Ball Pattern)" → "Poke Ball
 * Pattern"; several brackets are joined with "|". Every bracket is kept as written: the app knows which ones name a
 * printing ("Mirror Foil", "… Pattern") and which belong to the card's name ("Team Plasma", "GYM").
 */
const nameTags = (name) => [...String(name ?? '').matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean).join('|');

/** productId → [number, tags] for single cards (a card has a Number or a Rarity; boxes and packs have neither). */
function catalogOf(products) {
  const cards = new Map();
  const sealed = new Set();
  for (const p of products) {
    const ext = Object.fromEntries((p.extendedData ?? []).map((e) => [e.name, e.value]));
    if (ext.Number === undefined && ext.Rarity === undefined) sealed.add(p.productId);
    // The Number as TCGplayer writes it ("084/187", "069/M-P", "DAR"); the app compares the part before the slash.
    else cards.set(p.productId, [String(ext.Number ?? '').trim(), nameTags(p.name)]);
  }
  return { cards, sealed };
}

/** `previous`: yesterday's group, when its card numbers are used instead of a product list read today. */
function buildGroup(group, priceRows, catalog, previous, numbersKnown) {
  const products = {};
  // Boxes and packs: left out of the files, remembered here so their price rows don't look like new products tomorrow.
  const sealed = new Set(catalog ? [] : (previous?.x ?? []));
  let rows = 0;
  let withMarket = 0;
  for (const r of priceRows) {
    if (!Number.isInteger(r.productId)) continue;
    if (catalog?.sealed.has(r.productId)) sealed.add(r.productId);
    if (sealed.has(r.productId)) continue;
    const prices = [money(r.marketPrice), money(r.lowPrice), money(r.midPrice), money(r.highPrice)];
    if (prices.every((x) => x === null)) continue;
    const known = catalog?.cards.get(r.productId) ?? previous?.p[r.productId]?.slice(0, 2) ?? ['', ''];
    (products[r.productId] ??= [known[0], known[1], {}])[2][subtypeKey(r.subTypeName)] = prices;
    rows++;
    if (prices[0] !== null) withMarket++;
  }
  return {
    stats: { rows, withMarket, dropped: sealed.size },
    group: {
      id: group.groupId,
      a: String(group.abbreviation ?? '').trim(),
      n: String(group.name ?? ''),
      m: String(group.modifiedOn ?? ''),
      // 1 = card numbers and name tags are known for this group (its product list was read). 0 asks again tomorrow.
      c: numbersKnown ? 1 : 0,
      p: products,
      x: [...sealed].sort((a, b) => a - b),
    },
  };
}

async function buildSnapshot(source, previous) {
  if (flag('prev-only')) {
    if (!previous) throw new Error('--prev-only: nothing to copy');
    return { status: 'same', snapshot: previous };
  }
  const updatedText = (await source.text('updated'))?.trim() || (FROM ? option('updated') : undefined);
  const updatedMs = updatedText ? Date.parse(updatedText) : NaN;
  const d = Number.isFinite(updatedMs) ? new Date(updatedMs).toISOString().replace('.000Z', 'Z') : null;
  // Without tcgcsv's own timestamp we can't tell whether there is anything new: don't download 460 files to find out.
  if (!d && !FROM) throw new Error('tcgcsv has no readable last-updated.txt');
  if (previous && d && d === previous.d && !flag('force')) return { status: 'same', snapshot: previous };
  if (previous && d && Date.parse(previous.d) > updatedMs) throw new Error(`tcgcsv is older (${d}) than what we have (${previous.d})`);

  await source.pause();
  const groupsText = await source.text('groups');
  if (groupsText === null) throw new Error('no group list');
  const groups = results(groupsText, 'groups');
  // A shrunken group list is known now: stop before asking for 460 price files.
  if (groups.length < MIN_GROUPS) throw new Error(`only ${groups.length} groups`);
  if (previous && groups.length < previous.groups.length * MIN_VS_PREVIOUS) throw new Error(`only ${groups.length} groups (previous: ${previous.groups.length})`);

  const previousById = new Map((previous?.groups ?? []).map((g) => [g.id, g]));
  const out = [];
  const total = { rows: 0, withMarket: 0, dropped: 0, missing: 0, productLists: 0, listsLeft: 0 };
  for (const group of groups) {
    await source.pause();
    const pricesText = await source.text('prices', group.groupId);
    const priceRows = pricesText === null ? [] : results(pricesText, `prices ${group.groupId}`);
    if (pricesText === null) total.missing++;

    const before = previousById.get(group.groupId);
    // Product lists (card numbers) rarely change: read one again only for a new or changed group, or an unknown product.
    const knownBefore = (r) => before.p[r.productId] || before.x?.includes(r.productId) || [r.marketPrice, r.lowPrice, r.midPrice, r.highPrice].every((x) => money(x) === null);
    const reusable = before?.c === 1 && before.m === String(group.modifiedOn ?? '') && priceRows.every(knownBefore) && !flag('all-products');
    let catalog = null;
    if (!reusable && priceRows.length && Date.now() - startedAt >= LISTS_BUDGET_MS) total.listsLeft++;
    else if (!reusable && priceRows.length) {
      await source.pause();
      const productsText = await source.text('products', group.groupId);
      if (productsText !== null) {
        catalog = catalogOf(results(productsText, `products ${group.groupId}`));
        total.productLists++;
      }
    }
    // A list that was wanted but not read: keep yesterday's numbers for the products we knew, and ask again tomorrow.
    const built = buildGroup(group, priceRows, catalog, catalog ? undefined : before, Boolean(catalog) || reusable);
    total.rows += built.stats.rows;
    total.withMarket += built.stats.withMarket;
    total.dropped += built.stats.dropped;
    out.push(built.group);
  }

  const previousRows = previous ? previous.groups.reduce((n, g) => n + Object.values(g.p).reduce((m, p) => m + Object.keys(p[2]).length, 0), 0) : 0;
  if (total.missing > groups.length * MAX_MISSING_GROUPS) throw new Error(`${total.missing} of ${groups.length} groups have no price file`);
  if (total.rows < Math.max(MIN_ROWS, previousRows * MIN_VS_PREVIOUS)) throw new Error(`only ${total.rows} price rows (previous: ${previousRows})`);
  if (total.withMarket < total.rows * MIN_MARKET_SHARE) throw new Error(`only ${total.withMarket} of ${total.rows} rows have a market price`);

  // No clock time of our own in the files: the same input gives the same bytes, so an unchanged day changes nothing.
  return { status: 'new', snapshot: { v: FORMAT, d: d ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'), groups: out }, total };
}

// ---------- writing ----------

function filesOf(snapshot) {
  const byKey = new Map();
  for (const g of snapshot.groups) {
    if (!Object.keys(g.p).length) continue;
    const key = setKey(g.a) || `g${g.id}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)).push(g);
  }
  const fileBody = (key, groups) => JSON.stringify({ v: FORMAT, d: snapshot.d, k: key, g: groups.map(({ id, n, c, p }) => ({ id, n, c, p })) });
  const files = new Map();
  const keys = [...byKey.keys()].sort();
  const owner = new Map();
  const counts = { groups: snapshot.groups.length, files: keys.length, products: 0, rows: 0, withMarket: 0, withNumber: 0 };
  const sizes = {};
  keys.forEach((key, i) => {
    const groups = byKey.get(key);
    files.set(`s/${key}.json`, fileBody(key, groups));
    let products = 0;
    for (const g of groups)
      for (const [id, p] of Object.entries(g.p)) {
        owner.set(Number(id), i);
        products++;
        if (p[0]) counts.withNumber++;
        for (const row of Object.values(p[2])) {
          counts.rows++;
          if (row[0] !== null) counts.withMarket++;
        }
      }
    counts.products += products;
    sizes[key] = products;
  });
  // Product id → file: ids sorted, one [id step, file number] pair where the file changes (TCGplayer numbers a set's
  // products mostly in a row). The app finds a product whose set file it could not guess (old sets, deck kits).
  const route = [];
  let last = 0;
  let lastFile = -1;
  for (const id of [...owner.keys()].sort((a, b) => a - b)) {
    const file = owner.get(id);
    if (file !== lastFile) {
      route.push(id - last, file);
      last = id;
      lastFile = file;
    }
  }
  const aliases = [];
  for (const [key, ids] of Object.entries(SET_ALIASES)) {
    const groups = snapshot.groups.filter((g) => ids.includes(g.id) && Object.keys(g.p).length);
    if (byKey.has(key) || !groups.length) continue;
    files.set(`s/${key}.json`, fileBody(key, groups));
    aliases.push(key);
  }
  counts.files += aliases.length;
  files.set('index.json', JSON.stringify({ v: FORMAT, d: snapshot.d, source: `tcgcsv.com (TCGplayer category ${CATEGORY})`, counts, keys, sizes: keys.map((k) => sizes[k]), aliases, route }));
  files.set('all.json', JSON.stringify(snapshot));
  return { files, counts };
}

/** The output folder is deleted and replaced as a whole, so it must be ours: a mistyped --out must not cost a folder. */
function removeOut() {
  const strangers = existsSync(OUT) ? readdirSync(OUT).filter((name) => !['all.json', 'index.json', 's'].includes(name)) : [];
  if (strangers.length) throw new Error(`${OUT} has other files (${strangers.slice(0, 3).join(', ')}): not replacing it`);
  rmSync(OUT, { recursive: true, force: true });
}

/** Writes the whole folder next to the target, then swaps: a crash never leaves half of today's files behind. */
function writeOut(snapshot) {
  const { files, counts } = filesOf(snapshot);
  const tmp = `${OUT}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(path.join(tmp, 's'), { recursive: true });
  for (const [name, body] of files) writeFileSync(path.join(tmp, name), body);
  removeOut();
  renameSync(tmp, OUT);
  return { counts, bytes: [...files.values()].reduce((n, b) => n + Buffer.byteLength(b), 0), fileCount: files.size };
}

// ---------- main ----------

const previous = await loadPrevious(PREV);
// Yesterday's files go in first: whatever happens below, the site is never published without them.
if (previous) writeOut(previous);
// --prev-only with nothing to copy (a typo, no internet) changes nothing: the files from last time stay.
else if (!flag('prev-only')) removeOut();

let status;
try {
  const built = await buildSnapshot(FROM ? dirSource(FROM) : netSource, previous);
  status = built.status;
  const written = built.status === 'new' ? writeOut(built.snapshot) : null;
  if (written) log(`wrote ${written.fileCount} files, ${written.bytes} bytes → ${OUT}`, JSON.stringify(written.counts), JSON.stringify(built.total));
  else log(flag('prev-only') ? `copied the previous files (${previous.d}) → ${OUT}` : `tcgcsv has nothing newer than ${previous.d}: kept the previous files`);
  output({ status, date: built.snapshot.d });
} catch (e) {
  status = previous ? 'kept' : 'none';
  warn(
    previous
      ? `Could not build today's TCGplayer prices (${e.message}). Kept the previous ones from ${previous.d}.`
      : `Could not build TCGplayer prices (${e.message}) and there are no previous ones. Japanese cards show Cardmarket prices until the next run.`,
  );
  output({ status, date: previous?.d ?? '' });
  if (flag('strict')) process.exitCode = 1;
}
log(`status ${status}; ${requests} requests, ${bytesIn} bytes downloaded, ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
