// TCGplayer prices (USD) for Japanese cards. TCGdex has none, so they come from our own daily files
// (data/tcgplayer-ja/, built by scripts/build-ja-prices.mjs from tcgcsv.com): loading a set's file, and which
// TCGplayer product and price row each printing of a card gets. Turning that into a PriceSummary stays in pricing.ts.
import { cached, fetchJson, HttpError } from './cache';
import type { TcgplayerPrice } from './types';

/** USD; null = no data. */
export type JaRow = [market: number | null, low: number | null, mid: number | null, high: number | null];
/**
 * `number`: the card number as TCGplayer writes it ("084/187", "057/SV-P"), "" when unknown. `tags`: the bracketed
 * parts of the product name joined by "|" ("Mirror Foil", "Master Ball Pattern", "Team Plasma"), "" for none.
 * `rows`: prices by sub-type in TCGdex spelling ("normal", "holofoil", "1st-edition", "1st-edition-holofoil",
 * "unlimited", "unlimited-holofoil").
 */
export type JaProduct = [number: string, tags: string, rows: Record<string, JaRow>];
export interface JaGroup {
  /** TCGplayer group id. */
  id: number;
  /** "SV8a: Terastal Fest ex". */
  n: string;
  /** 1 = card numbers and name tags are filled in for this group. */
  c: 0 | 1;
  /** TCGplayer product id → product. Only products with a price row. */
  p: Record<string, JaProduct>;
}
export interface JaSetFile {
  v: 1;
  /** When the prices were taken from TCGplayer (ISO). */
  d: string;
  k: string;
  g: JaGroup[];
}

const HOUR = 3_600_000;
/** Prices change once a day. Memory only: the service worker keeps the files for offline use. */
const TTL_MS = 6 * HOUR;
/** An older file is ignored: the card shows its Cardmarket price again rather than a stale TCGplayer one. */
const MAX_AGE_MS = 7 * 24 * HOUR;
/** A small file on our own host; a slow answer must not hold up the card (scans wait for it too). No retries. */
const TIMEOUT_MS = 4000;

/** "SV8a" → "sv8a", "SM1+" / TCGdex "SM1p" → "sm1p", "SV-P" → "sv-p". Same rule as scripts/build-ja-prices.mjs. */
export function setKey(setId: string): string {
  return setId
    .trim()
    .toLowerCase()
    .replace(/\+/g, 'p')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function isSetFile(x: unknown): x is JaSetFile {
  return isObj(x) && x.v === 1 && typeof x.d === 'string' && Array.isArray(x.g) && x.g.every((g) => isObj(g) && isObj(g.p));
}

function isFresh(d: string): boolean {
  const at = Date.parse(d);
  return Number.isFinite(at) && Date.now() - at <= MAX_AGE_MS;
}

/**
 * null = there is no such file, which is an answer worth remembering: a 404 (GitHub Pages), the app's own HTML page
 * with status 200 (hosts with an SPA fallback, `npm run dev`), or JSON in another format. Network trouble throws and
 * is tried again next time.
 */
async function load(key: string): Promise<JaSetFile | null> {
  try {
    const url = `${import.meta.env.BASE_URL}data/tcgplayer-ja/s/${key}.json`;
    const file = await fetchJson<unknown>(url, { timeoutMs: TIMEOUT_MS, retries: 0 });
    return isSetFile(file) ? file : null;
  } catch (e) {
    if ((e instanceof HttpError && e.status === 404) || e instanceof SyntaxError) return null;
    throw e;
  }
}

/**
 * The set's price file, or null: no file for this set, not JSON, another format, older than 7 days, a network error
 * or a slow answer (4 s), or no page address to load it from (node tests). Never rejects.
 */
export function getJaSetPrices(setId: string): Promise<JaSetFile | null> {
  const key = setKey(setId);
  if (!key || typeof globalThis.location === 'undefined') return Promise.resolve(null);
  return cached(`tcgja:${key}`, TTL_MS, () => load(key), { persist: false }).then(
    (file) => (file && isFresh(file.d) ? file : null),
    () => null,
  );
}

/** What pricing.ts tells the matcher about one printing (same order as its raw variants). */
export interface JaVariantRef {
  /** 'normal' | 'holo' | 'reverse' | … */
  type: string;
  /** 'masterball' | 'pokeball' | 'energy' | … */
  foil?: string;
  firstEdition: boolean;
  /** TCGdex's thirdParty.tcgplayer. */
  tcgplayerId?: number;
  /** The variant has its OWN Cardmarket price (not the card-level block a plain mirror borrows). */
  ownCardmarket: boolean;
  /** That price in dollars, when it has one. */
  cardmarketUsd?: number;
}

export interface JaMatch {
  productId: number;
  price: TcgplayerPrice;
  /** The file's `d`. */
  updated: string;
  /** The printing the product is, from its name: 'base', 'reverse' (plain mirror), 'masterball', 'team-rocket'… */
  kind: string;
}

const BASE = 'base';
const REVERSE = 'reverse';

/**
 * The printing a product is, from its name tags, spelled like TCGdex's foil: "Mirror Foil" → reverse (the plain
 * mirror), "Master Ball Pattern" → masterball, "Love Ball Pattern" → loveball, "Energy Symbol Pattern" → energy,
 * "Team Rocket Pattern" → team-rocket; no such tag → base (the normal / holo / stamped card). Other brackets belong
 * to the card's name ("Team Plasma", "GYM").
 */
function tagKind(tags: string): string {
  for (const raw of tags.split('|')) {
    const tag = raw.trim().normalize('NFD').toLowerCase();
    if (/^mirror (foil|holofoil|holo)$/.test(tag)) return REVERSE;
    if (tag === 'energy symbol pattern') return 'energy';
    if (tag === 'team rocket pattern') return 'team-rocket';
    const ball = /^(.+) ball pattern$/.exec(tag);
    if (ball) return `${ball[1].replace(/[^a-z]/g, '')}ball`;
  }
  return BASE;
}

const variantKind = (v: JaVariantRef) => v.foil ?? (v.type === REVERSE ? REVERSE : BASE);

/** "084/187" → "84", "057/SV-P" → "57", "tg05" → "TG05": numbers compare without leading zeros or case. */
const normNumber = (s: string) => s.split('/')[0].trim().replace(/^0+(?=\d)/, '').toUpperCase();

interface Found {
  id: number;
  kind: string;
  rows: Record<string, JaRow>;
}

function toFound(id: string, product: unknown): (Found & { number: string }) | undefined {
  if (!Array.isArray(product) || !isObj(product[2]) || !Number.isInteger(Number(id))) return undefined;
  const [number, tags, rows] = product as JaProduct;
  return { id: Number(id), number: typeof number === 'string' ? number : '', kind: tagKind(typeof tags === 'string' ? tags : ''), rows };
}

function byId(file: JaSetFile, id: number): Found | undefined {
  for (const g of file.g) {
    const hit = Object.prototype.hasOwnProperty.call(g.p, id) ? toFound(String(id), g.p[id]) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

function byNumber(file: JaSetFile, number: string): Found[] {
  const out: Found[] = [];
  for (const g of file.g) {
    for (const [id, product] of Object.entries(g.p)) {
      const found = toFound(id, product);
      if (found?.number && normNumber(found.number) === number) out.push(found);
    }
  }
  return out;
}

// Every Japanese product is one printing, so any of its rows is the right card: the order only prefers the likelier
// one. The real split is 1st Edition against Unlimited (old sets), which differ by more than 2× on a third of cards.
const ROWS_FIRST_HOLO = ['1st-edition-holofoil', '1st-edition', 'unlimited-holofoil', 'unlimited', 'holofoil', 'normal'];
const ROWS_FIRST = ['1st-edition', '1st-edition-holofoil', 'unlimited', 'unlimited-holofoil', 'normal', 'holofoil'];
const ROWS_HOLO = ['holofoil', 'unlimited-holofoil', 'normal', 'unlimited', '1st-edition-holofoil', '1st-edition'];
const ROWS_PLAIN = ['normal', 'unlimited', 'holofoil', 'unlimited-holofoil', '1st-edition', '1st-edition-holofoil'];

const usd = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
const toRow = (x: unknown): JaRow | undefined => (Array.isArray(x) ? [usd(x[0]), usd(x[1]), usd(x[2]), usd(x[3])] : undefined);

function chooseRow(v: JaVariantRef, rows: Record<string, JaRow>): JaRow | undefined {
  const holoish = v.type === 'holo' || v.type === REVERSE || !!v.foil;
  const order = v.firstEdition ? (holoish ? ROWS_FIRST_HOLO : ROWS_FIRST) : holoish ? ROWS_HOLO : ROWS_PLAIN;
  // A sub-type TCGplayer adds later still beats no price at all.
  const key = order.find((k) => toRow(rows[k])) ?? Object.keys(rows).sort().find((k) => toRow(rows[k]));
  const row = key === undefined ? undefined : toRow(rows[key]);
  if (!row || row[0] !== null) return row;
  // The base product of some sets has a Normal and a Holofoil row for the same card: take the one that sold.
  const twin = toRow(rows[key === 'normal' ? 'holofoil' : key === 'holofoil' ? 'normal' : '']);
  return twin && twin[0] !== null ? twin : row;
}

/** A lone asking price from this much up is too often a wish price (31% are over 3× what the card sells for). */
const LONE_LISTING_MAX_USD = 100;
/** Listings this far apart: the middle one is pulled up by wish prices… */
const WIDE_RATIO = 3;
/** …but only a cheapest listing from this much up is a real offer and not a cent listing. */
const WIDE_MIN_LOW_USD = 5;
/** Float noise must not decide a 3× test. */
const EPS = 1e-9;
/** A market price this many times off every listing and the card's own Cardmarket price is an old or odd sale. */
const STALE_RATIO = 3;

/** a is more than STALE_RATIO times b. */
const far = (a: number, b: number) => a > STALE_RATIO * b * (1 + EPS);

/**
 * TCGplayer's market price is what the card last sold for. Now and then that is a sale that says nothing about today
 * ($4.99 for a Secret Rare that is listed from $275 and sells for €94 on Cardmarket). Only when both other signals
 * agree, every listing and the Cardmarket price on the same side, is it ignored: the card keeps its Cardmarket price.
 */
function staleSale(market: number, low: number | null, high: number | null, cardmarketUsd: number | undefined): boolean {
  if (!cardmarketUsd) return false;
  return (low !== null && far(low, market) && far(cardmarketUsd, market)) || (high !== null && far(market, high) && far(market, cardmarketUsd));
}

function toPrice(row: JaRow, v: JaVariantRef): TcgplayerPrice | null {
  const [market, low, mid, high] = row;
  if (market !== null) return staleSale(market, low, high, v.cardmarketUsd) ? null : { low, mid, high, market, directLow: null };
  // Listings but no recent sales. What the card really sold for on Cardmarket beats what sellers ask.
  if (v.ownCardmarket || mid === null) return null;
  const lone = low === mid && high === mid;
  if (lone && mid >= LONE_LISTING_MAX_USD) return null;
  const wide = !lone && low !== null && low >= WIDE_MIN_LOW_USD && mid > WIDE_RATIO * low * (1 + EPS);
  return { low, mid: wide ? low : mid, high, market: null, directLow: null, asking: true };
}

/**
 * One entry per variant: the TCGplayer product and the price to use, or null (the variant keeps what it has today).
 * Pure. A product is found by, in this order:
 *  a. TCGdex's own product id. An id that is not in the file is a product without prices: nothing else is tried,
 *     because any other product with that number is another card or another printing.
 *  b. card number + printing (name tag), when exactly one product fits and the card has one variant of that kind.
 *  c. for a plain mirror only: the one product with that number that is not the base card and still unclaimed
 *     (M2a: TCGdex lists a "reverse" where TCGplayer sells a "Poke Ball Pattern").
 * A product is never given to two variants. null also when the product only has asking prices and the variant has
 * its own Cardmarket price, the only asking price is a lone listing of $100 or more, or the market price is an old
 * sale (staleSale). Products without a price are in the file too (number only), so a number two cards share is seen.
 */
export function matchJaVariants(localId: string, variants: readonly JaVariantRef[], file: JaSetFile): (JaMatch | null)[] {
  const found: (Found | undefined)[] = variants.map(() => undefined);
  const claimed = new Set<number>();
  const claim = (i: number, product: Found) => {
    found[i] = product;
    claimed.add(product.id);
  };

  variants.forEach((v, i) => {
    const product = v.tcgplayerId ? byId(file, v.tcgplayerId) : undefined;
    if (product && !claimed.has(product.id)) claim(i, product);
  });

  const number = normNumber(localId);
  const open = variants.map((v, i) => (v.tcgplayerId ? -1 : i)).filter((i) => i >= 0);
  if (number && open.length) {
    const sameNumber = byNumber(file, number);
    for (const i of open) {
      const kind = variantKind(variants[i]);
      const fits = sameNumber.filter((p) => p.kind === kind);
      const onlyOne = variants.filter((x) => variantKind(x) === kind).length === 1;
      if (fits.length === 1 && onlyOne && !claimed.has(fits[0].id)) claim(i, fits[0]);
    }
    const mirrors = open.filter((i) => !found[i] && variantKind(variants[i]) === REVERSE);
    const left = sameNumber.filter((p) => p.kind !== BASE && !claimed.has(p.id));
    if (mirrors.length === 1 && left.length === 1) claim(mirrors[0], left[0]);
  }

  return variants.map((v, i) => {
    const product = found[i];
    const row = product && chooseRow(v, product.rows);
    const price = row ? toPrice(row, v) : null;
    return product && price ? { productId: product.id, price, updated: file.d, kind: product.kind } : null;
  });
}
