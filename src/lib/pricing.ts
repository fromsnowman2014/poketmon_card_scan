// Price normalization (TCGdex → CardVariant/PriceSummary in USD), kid value tiers, money formatting.
import type { CardVariant, CardmarketPrice, DisplayCurrency, PriceSummary, TcgplayerPrice, ValueTier } from './types';
import { eurToUsd, getRatesSync, type Rates } from './fx';

type Obj = Record<string, unknown>;

interface RawVariant {
  type: string;
  foil?: string;
  stamp?: string[];
  subtype?: string;
  /** "standard" or e.g. "jumbo". */
  size?: string;
  thirdParty: Obj;
  pricing?: Obj;
}

const asObj = (x: unknown): Obj => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Obj) : {});
const asStr = (x: unknown): string | undefined => (typeof x === 'string' && x ? x : undefined);
/** Positive finite number, else null. Sources use 0 as "no data". */
const price = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
const cents = (n: number | null): number | null => (n === null ? null : Math.round(n * 100) / 100);
const allNull = (o: object) => Object.values(o).every((v) => v === null);

function toRawVariant(x: unknown): RawVariant {
  const o = asObj(x);
  return {
    type: asStr(o.type) ?? 'normal',
    foil: asStr(o.foil),
    stamp: Array.isArray(o.stamp) ? o.stamp.filter((s): s is string => typeof s === 'string') : undefined,
    subtype: asStr(o.subtype),
    size: asStr(o.size),
    thirdParty: asObj(o.thirdParty),
    pricing: o.pricing === undefined ? undefined : asObj(o.pricing),
  };
}

const FIRST_EDITION = '1st-edition';
const isFirstEdition = (v: RawVariant) => !!v.stamp?.includes(FIRST_EDITION);
/** Stamps other than 1st edition: "gamestop", "set-logo", "pre-release", "player-rewards-program", "poketour-99"… */
const otherStamps = (v: RawVariant) => (v.stamp ?? []).filter((s) => s !== FIRST_EDITION);
const isOversize = (v: RawVariant) => !!v.size && v.size !== 'standard';
/** "unlimited" is how TCGdex names the regular printing next to 1st edition / shadowless ones. */
const plainSubtype = (v: RawVariant) => !v.subtype || v.subtype === 'unlimited';
/** Plain reverse holo shares the normal printing's Cardmarket product (its "-holo" fields). */
const isPlainReverse = (v: RawVariant) => v.type === 'reverse' && !v.foil;
/** Separate products with their own prices: special foils, 1st edition, stamped and jumbo cards. */
const isSeparateProduct = (v: RawVariant) => !!v.foil || isFirstEdition(v) || otherStamps(v).length > 0 || isOversize(v);

/**
 * Which printing a kid most likely holds, lower first: plain normal, plain holo, other regular printings
 * (shadowless, error prints…), 1st edition, reverse holo, special foils, then stamped / jumbo cards.
 */
function commonness(v: RawVariant): number {
  if (otherStamps(v).length || isOversize(v)) return 6;
  if (v.foil) return 5;
  if (v.type === 'reverse') return 4;
  if (isFirstEdition(v)) return 3;
  if (!plainSubtype(v)) return 2;
  return v.type === 'normal' ? 0 : v.type === 'holo' ? 1 : 2;
}

/** Variants from `variants_detailed`, or derived from the `variants` flags + top-level pricing. */
function rawVariants(card: Obj, top: Obj): RawVariant[] {
  if (Array.isArray(card.variants_detailed) && card.variants_detailed.length) return card.variants_detailed.map(toRawVariant);
  const flags = asObj(card.variants);
  const out: RawVariant[] = [];
  if (flags.normal) out.push({ type: 'normal', thirdParty: {}, pricing: top });
  if (flags.holo) out.push({ type: 'holo', thirdParty: {}, pricing: top });
  if (flags.reverse) out.push({ type: 'reverse', thirdParty: {}, pricing: top });
  // Top-level Cardmarket describes the unlimited printing, not the 1st edition.
  if (flags.firstEdition) out.push({ type: 'holo', stamp: ['1st-edition'], thirdParty: {}, pricing: { tcgplayer: top.tcgplayer } });
  return out.length ? out : [{ type: 'normal', thirdParty: {}, pricing: top }];
}

/**
 * The pricing block a variant should use. Entries with no own pricing (both sources null) borrow the card's
 * top-level pricing — except separate products (special foils, 1st edition, stamped, jumbo), which stay unpriced.
 */
function pricingFor(v: RawVariant, top: Obj): Obj {
  const own = v.pricing ?? {};
  if (own.tcgplayer || own.cardmarket) return own;
  return isSeparateProduct(v) ? {} : top;
}

function tcgplayerKey(v: RawVariant, tp: Obj): string | undefined {
  if (isPlainReverse(v)) return 'reverse-holofoil';
  const candidates = isFirstEdition(v)
    ? ['1st-edition-holofoil', '1st-edition']
    : v.type === 'holo' || v.foil
      ? ['holofoil', 'unlimited-holofoil']
      : ['normal', 'holofoil', 'unlimited', 'unlimited-holofoil'];
  return candidates.find((k) => tp[k]);
}

function pickTcgplayer(v: RawVariant, tpRaw: unknown): { price: TcgplayerPrice | null; productId?: number } {
  const tp = asObj(tpRaw);
  const key = tcgplayerKey(v, tp);
  const p = key ? asObj(tp[key]) : {};
  const out: TcgplayerPrice = {
    low: price(p.lowPrice),
    mid: price(p.midPrice),
    high: price(p.highPrice),
    market: price(p.marketPrice),
    directLow: price(p.directLowPrice),
  };
  return { price: allNull(out) ? null : out, productId: price(p.productId) ?? undefined };
}

function pickCardmarket(v: RawVariant, cmRaw: unknown): CardmarketPrice | null {
  const cm = asObj(cmRaw);
  const s = isPlainReverse(v) ? '-holo' : '';
  const out: CardmarketPrice = {
    avg: price(cm['avg' + s]),
    low: price(cm['low' + s]),
    trend: price(cm['trend' + s]),
    avg1: price(cm['avg1' + s]),
    avg7: price(cm['avg7' + s]),
    avg30: price(cm['avg30' + s]),
  };
  return allNull(out) ? null : out;
}

/**
 * "normal", "holo", "reverse", "reverse-masterball", "firstEdition", plus the sub-type ("holo-shadowless"),
 * size ("normal-jumbo") and other stamps ("reverse-stamp-gamestop", "holo-stamp-pre-release") when present.
 */
function baseKey(v: RawVariant): string {
  const parts = [isFirstEdition(v) ? 'firstEdition' : v.type];
  if (v.foil) parts.push(v.foil);
  if (!plainSubtype(v)) parts.push(v.subtype as string);
  if (isOversize(v)) parts.push(v.size as string);
  const stamps = otherStamps(v);
  if (stamps.length) parts.push('stamp', ...stamps);
  return parts.join('-');
}

function uniqueKey(v: RawVariant, taken: Set<string>): string {
  const base = baseKey(v);
  // "unlimited" is left out of keys; it still tells two otherwise identical printings apart.
  const alt = v.subtype === 'unlimited' ? `${base}-unlimited` : undefined;
  let key = !taken.has(base) ? base : alt && !taken.has(alt) ? alt : base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Up/down badges only for cards worth a few dollars whose price really moved (penny cards swing ±300% on 2¢). */
const TREND_MIN_MARKET_USD = 2;
const TREND_MIN_AVG30_EUR = 1;
const TREND_MIN_PCT = 10;
/** Bigger swings come from a handful of sales, not a real trend. */
const TREND_MAX_PCT = 100;

/** Cardmarket avg7 vs avg30 in percent, or null when the move is too small, too wild or on too cheap a card. */
function changePct(cm: CardmarketPrice | null | undefined, marketUsd: number): number | null {
  if (!cm?.avg7 || !cm.avg30) return null;
  if (marketUsd < TREND_MIN_MARKET_USD || cm.avg30 < TREND_MIN_AVG30_EUR) return null;
  const pct = round1(((cm.avg7 - cm.avg30) / cm.avg30) * 100);
  return Math.abs(pct) >= TREND_MIN_PCT && Math.abs(pct) <= TREND_MAX_PCT ? pct : null;
}

/** Cardmarket's headline number (EUR): trend, else the averages. */
const cardmarketMarket = (cm: CardmarketPrice) => cm.trend ?? cm.avg30 ?? cm.avg ?? cm.avg7;

const maxOf = (xs: (number | null)[]) => {
  const ns = xs.filter((x): x is number => x !== null);
  return ns.length ? Math.max(...ns) : null;
};
const minOf = (xs: (number | null)[]) => {
  const ns = xs.filter((x): x is number => x !== null);
  return ns.length ? Math.min(...ns) : null;
};

function summarizeTcgplayer(tcg: TcgplayerPrice, market: number, cm: CardmarketPrice | null | undefined, rates: Rates): PriceSummary {
  const toUsd = (eur: number | null) => (eur === null ? null : eurToUsd(eur, rates));
  // TCGplayer's highPrice is the highest listing and often a 999/10000 placeholder. Without a sane one, the
  // highest real number we have: mid, cheapest Direct listing or what the card sells for on Cardmarket.
  const high =
    tcg.high !== null && tcg.high <= 3 * market
      ? tcg.high
      : maxOf([tcg.mid, market, tcg.directLow, toUsd(cm ? maxOf([cm.avg, cm.avg30, cm.trend]) : null)]);
  // The trend comes from Cardmarket (another market): only when its price is in the same ballpark.
  const cmMarket = cm ? toUsd(cardmarketMarket(cm)) : null;
  const comparable = cmMarket !== null && cmMarket >= market / 2 && cmMarket <= market * 2;
  return {
    market: cents(market),
    low: cents(tcg.low === null ? null : Math.min(tcg.low, market)),
    high: cents(Math.max(high ?? market, market)),
    changePct: comparable ? changePct(cm, market) : null,
    source: 'tcgplayer',
    converted: false,
  };
}

function summarizeCardmarket(cm: CardmarketPrice, market: number, rates: Rates): PriceSummary {
  // Cardmarket's raw "low" is often a 0.02 junk listing; use the usual range of recent averages instead.
  const usual = [cm.avg1, cm.avg7, cm.avg30, cm.trend, market];
  const usd = (eur: number | null) => cents(eur === null ? null : eurToUsd(eur, rates));
  return {
    market: usd(market),
    low: usd(minOf(usual)),
    high: usd(maxOf([...usual, cm.avg])),
    changePct: changePct(cm, eurToUsd(market, rates)),
    source: 'cardmarket',
    converted: true,
  };
}

/** Display summary in USD: TCGplayer when it has a market/mid price, else Cardmarket converted from EUR. */
export function summarize(
  tcg: TcgplayerPrice | null | undefined,
  cm: CardmarketPrice | null | undefined,
  rates: Rates,
  updated?: string,
): PriceSummary | null {
  const tcgMarket = tcg ? (tcg.market ?? tcg.mid) : null;
  const cmMarket = cm ? cardmarketMarket(cm) : null;
  const summary =
    tcg && tcgMarket !== null
      ? summarizeTcgplayer(tcg, tcgMarket, cm, rates)
      : cm && cmMarket !== null
        ? summarizeCardmarket(cm, cmMarket, rates)
        : null;
  return summary && updated ? { ...summary, updated } : summary;
}

function toVariant(v: RawVariant, top: Obj, rates: Rates, taken: Set<string>): CardVariant {
  const pricing = pricingFor(v, top);
  const tp = pickTcgplayer(v, pricing.tcgplayer);
  const cardmarket = pickCardmarket(v, pricing.cardmarket);
  const summary = summarize(tp.price, cardmarket, rates);
  const updatedFrom = summary?.source === 'tcgplayer' ? pricing.tcgplayer : pricing.cardmarket;
  const updated = asStr(asObj(updatedFrom).updated);
  return {
    key: uniqueKey(v, taken),
    type: v.type,
    ...(v.foil ? { foil: v.foil } : {}),
    ...(v.stamp?.length ? { stamp: v.stamp } : {}),
    ...(v.subtype ? { subtype: v.subtype } : {}),
    ...(isOversize(v) ? { size: v.size } : {}),
    tcgplayer: tp.price,
    cardmarket,
    summary: summary && updated ? { ...summary, updated } : summary,
    tcgplayerId: price(v.thirdParty.tcgplayer) ?? tp.productId,
    cardmarketId: price(v.thirdParty.cardmarket) ?? price(asObj(pricing.cardmarket).idProduct) ?? undefined,
  };
}

/**
 * All printings of a raw TCGdex card with normalized USD prices, plus the key to show first: the most common
 * printing that has a price (see `commonness`), else the most common one.
 */
export function buildVariants(raw: unknown, rates: Rates): { variants: CardVariant[]; defaultVariant: string } {
  const card = asObj(raw);
  const top = asObj(card.pricing);
  const taken = new Set<string>();
  const rawList = rawVariants(card, top);
  const variants = rawList.map((v) => toVariant(v, top, rates, taken));
  const byCommonness = variants
    .map((variant, i) => ({ variant, rank: commonness(rawList[i]) }))
    .sort((a, b) => a.rank - b.rank) // stable: API order among equals
    .map((x) => x.variant);
  const def = byCommonness.find((v) => v.summary) ?? byCommonness[0];
  return { variants, defaultVariant: def.key };
}

/**
 * Recomputes every variant's summary with `rates` (EUR→USD for Cardmarket prices). A CardDetail is built with the
 * rates known at fetch time, which may be the stale/fallback ones: call this when live rates arrive (useRates).
 */
export function applyRates<T extends { variants: CardVariant[] }>(card: T, rates: Rates): T {
  return {
    ...card,
    variants: card.variants.map((v) => ({ ...v, summary: summarize(v.tcgplayer, v.cardmarket, rates, v.summary?.updated) })),
  };
}

const TIERS: [number, ValueTier][] = [
  [100, 'treasure'],
  [25, 'super'],
  [5, 'rare'],
  [1, 'nice'],
];

/** Kid-friendly value tier: common <$1, nice <$5, rare <$25, super <$100, treasure ≥$100. */
export function valueTier(usd: number | null | undefined): ValueTier {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return 'common';
  return TIERS.find(([min]) => usd >= min)?.[1] ?? 'common';
}

const USD_CENTS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD_WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const KRW = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });

/** "$0.45", "$12.34", "$1,234", "₩16,500", "—" for missing; approx adds "≈ ". */
export function formatMoney(
  usd: number | null | undefined,
  currency: DisplayCurrency,
  rates: Rates = getRatesSync(),
  opts: { approx?: boolean } = {},
): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '—';
  let text: string;
  if (currency === 'KRW') {
    const krw = usd * rates.KRW;
    const step = Math.abs(krw) < 10000 ? 10 : 100;
    text = KRW.format(Math.round(krw / step) * step);
  } else {
    const rounded = Math.round(usd * 100) / 100;
    text = Math.abs(rounded) >= 1000 ? USD_WHOLE.format(rounded) : USD_CENTS.format(rounded);
  }
  return opts.approx ? `≈ ${text}` : text;
}
