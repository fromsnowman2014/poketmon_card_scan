// Price normalization (TCGdex → CardVariant/PriceSummary in USD), kid value tiers, money formatting.
import type { CardVariant, CardmarketPrice, DisplayCurrency, PriceSummary, TcgplayerPrice, UiLang, ValueTier } from './types';
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

const present = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
const maxOf = (xs: (number | null)[]) => {
  const ns = present(xs);
  return ns.length ? Math.max(...ns) : null;
};
const minOf = (xs: (number | null)[]) => {
  const ns = present(xs);
  return ns.length ? Math.min(...ns) : null;
};
const median = (xs: (number | null)[]) => {
  const ns = present(xs).sort((a, b) => a - b);
  const m = ns.length >> 1;
  return ns.length === 0 ? null : ns.length % 2 ? ns[m] : (ns[m - 1] + ns[m]) / 2;
};

/**
 * A "highest price" above this many times the market price is a stray listing (a lone $95 Direct copy of a $2 promo,
 * a 999 placeholder, a Cardmarket spike), not what the card sells for. On Cardmarket the same goes the other way: an
 * average below a third of the market price is a lone 2-cent sale, not the usual low.
 */
const HIGH_MAX_RATIO = 3;

/**
 * Cardmarket's trend, unless the recent sales (avg1, avg7, avg30) say it is junk: under a third of their median, or
 * over 3× every one of them (HIGH_MAX_RATIO). Cheap Japanese cards sell rarely, and their trend can be €0.02 while
 * they sell for €0.18–0.30 (SV8a-092), or €4.87 while they sell for €0.08–0.12 (SV2a-148).
 */
function cardmarketTrend(cm: CardmarketPrice): number | null {
  const recent = [cm.avg1, cm.avg7, cm.avg30];
  const mid = median(recent);
  const top = maxOf(recent);
  if (cm.trend === null || mid === null || top === null) return cm.trend;
  return cm.trend * HIGH_MAX_RATIO < mid || cm.trend > top * HIGH_MAX_RATIO ? null : cm.trend;
}

/** A cheapest listing from this much up can stand in for averages nobody sells near (below it, a few cents don't matter). */
const LISTED_MIN_EUR = 1;

/**
 * Averages that look filled in rather than measured: no all-time average and the same number for the week, the month
 * (and the day). Some foil products (Poké Ball / Master Ball reverse) carry these, e.g. €0.25 everywhere.
 */
function placeholderAverages(cm: CardmarketPrice): boolean {
  return cm.avg === null && cm.avg7 !== null && cm.avg7 === cm.avg30 && (cm.avg1 === null || cm.avg1 === cm.avg7);
}

/**
 * Cardmarket's headline number (EUR): the trend, else the averages. A junk trend (cardmarketTrend) gives way to the
 * week's or the month's average; with neither (only one day's average to judge by), the trend stays. When the averages
 * look like placeholders and even the cheapest copy for sale costs more than 3× them (and at least €1), nobody sells
 * near them (€0.25 for a card whose cheapest copy is €40): the cheapest copy is then the honest price. Real averages are
 * never replaced by a single listing.
 */
function cardmarketMarket(cm: CardmarketPrice): number | null {
  const market = cm.trend === null ? cm.avg30 ?? cm.avg ?? cm.avg7 : cardmarketTrend(cm) ?? cm.avg7 ?? cm.avg30 ?? cm.trend;
  const unsold = market !== null && cm.low !== null && cm.low >= LISTED_MIN_EUR && cm.low > HIGH_MAX_RATIO * market;
  return unsold && placeholderAverages(cm) ? cm.low : market;
}

function summarizeTcgplayer(tcg: TcgplayerPrice, market: number, cm: CardmarketPrice | null | undefined, rates: Rates): PriceSummary {
  const toUsd = (eur: number | null) => (eur === null ? null : eurToUsd(eur, rates));
  const sane = (usd: number | null) => (usd !== null && usd <= HIGH_MAX_RATIO * market ? usd : null);
  // TCGplayer's highPrice is the highest listing and often a 999/10000 placeholder. Without a sane one, the highest
  // sane number we have: mid, the cheapest Direct listing or what the card sells for on Cardmarket — each one checked
  // on its own (a spiky Cardmarket avg doesn't hide a sane trend), and the market price when none passes.
  const fallback = [tcg.mid, tcg.directLow, ...(cm ? [cm.avg, cm.avg30, cardmarketTrend(cm)].map(toUsd) : [])];
  const high = sane(tcg.high) ?? maxOf(fallback.map(sane));
  // The trend comes from Cardmarket (another market): only when its price is in the same ballpark.
  const cmMarket = cm ? toUsd(cardmarketMarket(cm)) : null;
  const comparable = cmMarket !== null && cmMarket >= market / 2 && cmMarket <= market * 2;
  // Not rounded: amounts are rounded once, when shown (formatMoney), so a converted price isn't rounded twice.
  return {
    market,
    low: tcg.low === null ? null : Math.min(tcg.low, market),
    high: Math.max(high ?? market, market),
    changePct: comparable ? changePct(cm, market) : null,
    source: 'tcgplayer',
    converted: false,
  };
}

function summarizeCardmarket(cm: CardmarketPrice, market: number, rates: Rates): PriceSummary {
  // Cardmarket's raw "low" is often a 0.02 junk listing; use the usual range of recent averages instead, each one
  // within 3× of the market price either way (a lone 2-cent sale or an old spike is not the usual range). One day's
  // average is left out: on a cheap card it is a single sale (€0.02, or €5.39 for a €1.29 card), and it can only
  // matter when it is the odd one out — the week's average already counts that day.
  const near = (eur: number | null) =>
    eur !== null && eur <= market * HIGH_MAX_RATIO && eur * HIGH_MAX_RATIO >= market ? eur : null;
  const usual = [cm.avg7, cm.avg30, cardmarketTrend(cm), market].map(near);
  // Exact USD, not whole cents: €0.04 is $0.0447 → 60원, where $0.04 would show 50원. formatMoney rounds for display.
  const usd = (eur: number | null) => (eur === null ? null : eurToUsd(eur, rates));
  return {
    market: usd(market),
    low: usd(minOf(usual)),
    high: usd(maxOf([...usual, near(cm.avg)])),
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

// Thresholds in the money the kid knows, so a tier reads right in their own currency.
// US: under $1 pocket change, $5 snack money, $25 allowance, $100 prized, then treasure.
// KR: under 1,000원 (coins), 5,000원 (a snack), 30,000원 (an allowance), 150,000원 (precious), then treasure.
const TIERS: Record<DisplayCurrency, [number, ValueTier][]> = {
  USD: [
    [100, 'treasure'],
    [25, 'super'],
    [5, 'rare'],
    [1, 'nice'],
  ],
  KRW: [
    [150_000, 'treasure'],
    [30_000, 'super'],
    [5_000, 'rare'],
    [1_000, 'nice'],
  ],
};

/** The amount formatMoney shows, as a number: whole cents in USD, 10/100-won steps in KRW. */
function shownAmount(usd: number, currency: DisplayCurrency, rates: Rates): number {
  if (currency === 'USD') return Math.round(usd * 100) / 100;
  const krw = usd * rates.KRW;
  const step = Math.abs(krw) < 10000 ? 10 : 100;
  return Math.round(krw / step) * step;
}

/**
 * Kid-friendly value tier in the display currency. USD: common <$1, nice <$5, rare <$25, super <$100, treasure ≥$100.
 * KRW: common <1,000원, nice <5,000원, rare <30,000원, super <150,000원, treasure ≥150,000원. Compares the amount as
 * shown ($0.996 shows as "$1.00" and is "nice"), so the tier always matches the number on screen.
 */
export function valueTier(usd: number | null | undefined, currency: DisplayCurrency = 'USD', rates: Rates = getRatesSync()): ValueTier {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return 'common';
  const shown = shownAmount(usd, currency, rates);
  return TIERS[currency].find(([min]) => shown >= min)?.[1] ?? 'common';
}

const USD_CENTS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD_WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const KRW = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });

const KO_NUM = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

/**
 * Korean-style won for kids: "4,760원", "123,400원"; from 1,000,000원 compact "198만 원",
 * "1억 2,000만 원". `krw` is already rounded to the display step.
 */
function koWon(krw: number): string {
  const sign = krw < 0 ? '-' : '';
  const a = Math.abs(krw);
  if (a < 1_000_000) return `${sign}${KO_NUM.format(a)}원`;
  const man = Math.round(a / 10_000); // 만 = 10,000
  const eok = Math.floor(man / 10_000); // 억 = 100,000,000
  const rest = man % 10_000;
  if (eok === 0) return `${sign}${KO_NUM.format(man)}만 원`;
  return rest === 0 ? `${sign}${KO_NUM.format(eok)}억 원` : `${sign}${KO_NUM.format(eok)}억 ${KO_NUM.format(rest)}만 원`;
}

/**
 * "$0.45", "$12.34", "$1,234", "₩16,500", "—" for missing; approx adds "≈ ".
 * With `lang: 'ko'` and KRW, uses Korean style instead: "16,500원", "198만 원". The Korean UI writes "about" one way
 * for every currency: approx "약 16,500원", "약 $22.30".
 */
export function formatMoney(
  usd: number | null | undefined,
  currency: DisplayCurrency,
  rates: Rates = getRatesSync(),
  opts: { approx?: boolean; lang?: UiLang } = {},
): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '—';
  let text: string;
  const ko = opts.lang === 'ko';
  const rounded = shownAmount(usd, currency, rates);
  if (currency === 'KRW') text = ko ? koWon(rounded) : KRW.format(rounded);
  else text = Math.abs(rounded) >= 1000 ? USD_WHOLE.format(rounded) : USD_CENTS.format(rounded);
  if (!opts.approx) return text;
  return ko ? `약 ${text}` : `≈ ${text}`;
}
