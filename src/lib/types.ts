// Shared types — the contract between data, scanning and UI modules.
// Keep this file dependency-free.

/** Language of the physical card (TCGdex language code). */
export type CardLang = 'en' | 'ja' | 'ko';

/** Language of the app UI. */
export type UiLang = 'ko' | 'en';

/** Currency used for display. All prices are stored internally in USD. */
export type DisplayCurrency = 'USD' | 'KRW';

/** Light-weight card reference (search results, scan candidates, history). */
export interface CardBrief {
  /** TCGdex card id, e.g. "SV8a-084" (ja), "sv08.5-084" (en). */
  id: string;
  lang: CardLang;
  /** Number printed on the card, e.g. "084". */
  localId: string;
  /** Name in the card's own language, e.g. "ルチャブル". */
  name: string;
  /** TCGdex asset base URL WITHOUT quality/extension suffix, e.g. "https://assets.tcgdex.net/ja/SV/SV8a/084". */
  image?: string;
  /** TCGdex set id, e.g. "SV8a". */
  setId: string;
  /** Set name in the card's language, when known. */
  setName?: string;
}

/** Raw TCGplayer price block for one variant (USD). */
export interface TcgplayerPrice {
  low: number | null;
  mid: number | null;
  high: number | null;
  market: number | null;
  directLow: number | null;
}

/** Raw Cardmarket price block (EUR). */
export interface CardmarketPrice {
  avg: number | null;
  low: number | null;
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
}

/** Normalized, display-ready price summary for one variant. ALL values in USD. */
export interface PriceSummary {
  /** Headline "market price" (시세). */
  market: number | null;
  /** Lowest current price. */
  low: number | null;
  /** Highest (sanity-filtered) price. */
  high: number | null;
  /** Recent change in percent (e.g. +12.5 means up 12.5% vs 30-day average). null if unknown. */
  changePct: number | null;
  /** Where the headline number came from. */
  source: 'tcgplayer' | 'cardmarket';
  /** True when the numbers were converted from EUR (Cardmarket) — show as approximate (≈). */
  converted: boolean;
  /** ISO timestamp of the source price update, if known. */
  updated?: string;
}

/** One printing/finish of a card (normal, reverse holo, holo, 1st edition, …) with its prices. */
export interface CardVariant {
  /** Stable key, e.g. "normal", "reverse", "holo", "firstEdition", "reverse-masterball". */
  key: string;
  /** Raw TCGdex variant type, e.g. "normal" | "reverse" | "holo". */
  type: string;
  /** Optional foil sub-type, e.g. "masterball", "pokeball". */
  foil?: string;
  tcgplayer?: TcgplayerPrice | null;
  cardmarket?: CardmarketPrice | null;
  /** Display summary computed from the above (USD). null when no price data exists. */
  summary: PriceSummary | null;
  /** TCGplayer product id (for a deep link), if known. */
  tcgplayerId?: number;
  /** Cardmarket product id, if known. */
  cardmarketId?: number;
}

/** Full card details for the result screen. */
export interface CardDetail extends CardBrief {
  setName: string;
  /** Official set size printed after the slash, e.g. 187. */
  setOfficialCount?: number;
  setReleaseDate?: string;
  rarity?: string;
  hp?: number;
  types?: string[];
  /** National Pokédex numbers (empty for trainers/energy). */
  dexIds: number[];
  illustrator?: string;
  /** Printings with prices. Never empty: at least one entry (possibly with summary=null). */
  variants: CardVariant[];
  /** Key of the variant to show first (the one with the best price data / most common). */
  defaultVariant: string;
  /** ISO timestamp when we fetched this. */
  fetchedAt: string;
}

/** What OCR could read from the printed code line at the bottom of a card. */
export interface PrintedCode {
  /** Set code as printed, e.g. "sv8a" (ja/ko) or "PAR" (en abbreviation). */
  setCode?: string;
  /** Card number, digits/letters as printed, e.g. "084", "TG01". */
  number?: string;
  /** Total after the slash, e.g. "187". */
  total?: string;
  /** Language hint ('en' when "EN" marker seen, 'ja' for lowercase sv/s/sm codes …). */
  lang?: CardLang;
  promo?: boolean;
}

/** Result of identifying a photo. */
export interface IdentifyResult {
  /** Raw OCR text (for debugging / showing what was read). */
  rawText: string;
  code: PrintedCode;
  /** Candidate cards, best first. Empty when nothing matched. */
  candidates: CardBrief[];
}

/** Progress callback for long-running scan steps. */
export type ProgressFn = (stage: 'loading' | 'reading' | 'matching', progress: number) => void;

/** Compact eBay active-listing summary returned by the optional proxy worker. */
export interface EbayListing {
  title: string;
  price: number;
  currency: string;
  bidCount?: number;
  endsAt?: string;
  url: string;
  image?: string;
}

export interface EbaySummary {
  query: string;
  fetchedAt: string;
  auctions: { count: number; items: EbayListing[] };
  buyNow: { count: number; lowest: number | null; median: number | null; items: EbayListing[] };
  searchUrl: string;
}

/** A card saved in "My Cards". */
export interface CollectionItem {
  /** `${lang}:${id}:${variant}` */
  key: string;
  id: string;
  lang: CardLang;
  name: string;
  image?: string;
  setId: string;
  setName: string;
  localId: string;
  variant: string;
  qty: number;
  /** Last known market price in USD (per card). */
  priceUsd: number | null;
  /** Price at the time it was first added (to show gain/loss). */
  firstPriceUsd: number | null;
  priceUpdatedAt: string;
  addedAt: string;
  dexIds?: number[];
}

/** A recently viewed card (home screen history). */
export interface HistoryItem extends CardBrief {
  priceUsd: number | null;
  viewedAt: string;
}

export interface Settings {
  uiLang: UiLang;
  currency: DisplayCurrency;
  /** Default language used when searching by name. */
  searchLang: CardLang;
  /** Optional URL of the eBay proxy worker (see /worker). Empty = deep links only. */
  ebayWorkerUrl: string;
}

/** Fun price tiers for kids. */
export type ValueTier = 'common' | 'nice' | 'rare' | 'super' | 'treasure';
