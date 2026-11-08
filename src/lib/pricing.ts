// Price normalization (TCGdex → CardVariant/PriceSummary in USD), kid value tiers, money formatting.
import type { CardVariant, CardmarketPrice, DisplayCurrency, PriceSummary, TcgplayerPrice, ValueTier } from './types';
import { eurToUsd, getRatesSync, type Rates } from './fx';

type Obj = Record<string, unknown>;

interface RawVariant {
  type: string;
  foil?: string;
  stamp?: string[];
  subtype?: string;
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
    thirdParty: asObj(o.thirdParty),
    pricing: o.pricing === undefined ? undefined : asObj(o.pricing),
  };
}

const isFirstEdition = (v: RawVariant) => !!v.stamp?.includes('1st-edition');
/** Plain reverse holo shares the normal printing's Cardmarket product (its "-holo" fields). */
const isPlainReverse = (v: RawVariant) => v.type === 'reverse' && !v.foil;

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
 * top-level pricing — except special foils / 1st edition, which are separate products with their own prices.
 */
function pricingFor(v: RawVariant, top: Obj): Obj {
  const own = v.pricing ?? {};
  if (own.tcgplayer || own.cardmarket) return own;
  return v.foil || isFirstEdition(v) ? {} : top;
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

function baseKey(v: RawVariant): string {
  if (isFirstEdition(v)) return 'firstEdition';
  return v.foil ? `${v.type}-${v.foil}` : v.type;
}

function uniqueKey(v: RawVariant, taken: Set<string>): string {
  const base = baseKey(v);
  let key = !taken.has(base) ? base : v.subtype && !taken.has(`${base}-${v.subtype}`) ? `${base}-${v.subtype}` : base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

function changePct(cm: CardmarketPrice | null | undefined): number | null {
  if (!cm?.avg7 || !cm.avg30) return null;
  return Math.round(((cm.avg7 - cm.avg30) / cm.avg30) * 1000) / 10;
}

const maxOf = (xs: (number | null)[]) => {
  const ns = xs.filter((x): x is number => x !== null);
  return ns.length ? Math.max(...ns) : null;
};
const minOf = (xs: (number | null)[]) => {
  const ns = xs.filter((x): x is number => x !== null);
  return ns.length ? Math.min(...ns) : null;
};

function summarizeTcgplayer(tcg: TcgplayerPrice, market: number, cm: CardmarketPrice | null | undefined): PriceSummary {
  // TCGplayer's highPrice is the highest listing and often a 999/10000 placeholder.
  const high = tcg.high !== null && tcg.high <= 3 * market ? tcg.high : maxOf([tcg.mid, market]);
  return { market: cents(market), low: cents(tcg.low), high: cents(high), changePct: changePct(cm), source: 'tcgplayer', converted: false };
}

function summarizeCardmarket(cm: CardmarketPrice, market: number, rates: Rates): PriceSummary {
  // Cardmarket's raw "low" is often a 0.02 junk listing; use the usual range of recent averages instead.
  const usual = [cm.avg1, cm.avg7, cm.avg30, cm.trend, market];
  const usd = (eur: number | null) => cents(eur === null ? null : eurToUsd(eur, rates));
  return {
    market: usd(market),
    low: usd(minOf(usual)),
    high: usd(maxOf([...usual, cm.avg])),
    changePct: changePct(cm),
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
  const cmMarket = cm ? (cm.trend ?? cm.avg30 ?? cm.avg ?? cm.avg7) : null;
  const summary =
    tcg && tcgMarket !== null
      ? summarizeTcgplayer(tcg, tcgMarket, cm)
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
    tcgplayer: tp.price,
    cardmarket,
    summary: summary && updated ? { ...summary, updated } : summary,
    tcgplayerId: price(v.thirdParty.tcgplayer) ?? tp.productId,
    cardmarketId: price(v.thirdParty.cardmarket) ?? price(asObj(pricing.cardmarket).idProduct) ?? undefined,
  };
}

/** All printings of a raw TCGdex card with normalized USD prices, plus the key to show first. */
export function buildVariants(raw: unknown, rates: Rates): { variants: CardVariant[]; defaultVariant: string } {
  const card = asObj(raw);
  const top = asObj(card.pricing);
  const taken = new Set<string>();
  const variants = rawVariants(card, top).map((v) => toVariant(v, top, rates, taken));
  const normal = variants.find((v) => v.key === 'normal' && v.summary);
  const def = normal ?? variants.find((v) => v.summary) ?? variants[0];
  return { variants, defaultVariant: def.key };
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
