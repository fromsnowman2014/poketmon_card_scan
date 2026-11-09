// Shared types — the contract between data, scanning and UI modules.
// Keep this file dependency-free.

/** Language of the physical card (TCGdex language code). */
export type CardLang = 'en' | 'ja' | 'ko';

/** Language of the app UI. */
export type UiLang = 'ko' | 'en';

/** Currency used for display. All prices are stored internally in USD. */
export type DisplayCurrency = 'USD' | 'KRW';

/**
 * Where the kid lives (not the UI language): picks the default money (US → dollars, KR → won), the default card
 * search language, price-tier thresholds that feel right in that money, and where eBay shipping is estimated to.
 */
export type Country = 'US' | 'KR';

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

/**
 * Normalized price summary for one variant. ALL values in USD, exact (EUR converted at the current rate), not rounded
 * to cents: they are rounded once, for display, by pricing.formatMoney.
 */
export interface PriceSummary {
  /** Headline "market price" (시세). */
  market: number | null;
  /** Lowest current price. */
  low: number | null;
  /** Highest (sanity-filtered) price. */
  high: number | null;
  /**
   * Recent change in percent (e.g. +12.5 means up 12.5% vs 30-day average). null if unknown or not meaningful:
   * cards under $2, Cardmarket avg30 under €1, moves under 10% or over 100%, or a TCGplayer headline that
   * Cardmarket prices very differently. Non-null values are always real moves worth a badge.
   */
  changePct: number | null;
  /** Where the headline number came from. */
  source: 'tcgplayer' | 'cardmarket';
  /** True when the numbers were converted from EUR (Cardmarket) — show as approximate ("약 4,760원" / "≈ $3.50"). */
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
  /** Stamps printed on this variant as TCGdex names them, e.g. ["1st-edition"], ["gamestop"], ["pre-release"]. */
  stamp?: string[];
  /** TCGdex printing sub-type, e.g. "shadowless", "1999-2000-copyright" ("unlimited" is the regular printing). */
  subtype?: string;
  /** Card size when not standard, e.g. "jumbo". */
  size?: string;
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
  /**
   * Card number exactly as printed on the card, for display chips and eBay queries, e.g.
   * "084/187", "TG05/TG30", "GG35/GG70", "SWSH284", "085" (EN SVP promo), "085/SV-P" (JA promo).
   * Undefined when unknown: fall back to localId.
   */
  printedNumber?: string;
  setReleaseDate?: string;
  rarity?: string;
  hp?: number;
  types?: string[];
  /** National Pokédex numbers (empty for trainers/energy). */
  dexIds: number[];
  illustrator?: string;
  /**
   * Fallback image when TCGdex has none (many JA cards): TCGplayer CDN
   * `https://tcgplayer-cdn.tcgplayer.com/product/{tcgplayerId}_400w.jpg`. Full URL, use as-is.
   */
  imageFallback?: string;
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
  shipping?: number | null;
  condition?: string | null;
  graded?: boolean;
}

export interface EbaySummary {
  query: string;
  fetchedAt: string;
  auctions: { count: number; items: EbayListing[] };
  /**
   * Buy It Now listings. `lowest` and `median` are TOTAL costs (price + shipping) in USD, so a
   * 99¢ card with $4.99 shipping counts as $5.98. `lowestShipping` is the shipping part of the
   * lowest listing (0 = free shipping, null = unknown).
   */
  buyNow: { count: number; lowest: number | null; median: number | null; lowestShipping?: number | null; items: EbayListing[] };
  searchUrl: string;
  soldUrl?: string;
  /**
   * Where the shipping in these totals goes (the worker's echo of `&country=`). fetchEbaySummary always fills it:
   * an older worker that doesn't send it priced shipping to the US, so it reads as 'US'.
   */
  shipTo?: Country;
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
  /** True when priceUsd was converted from EUR (Cardmarket, PriceSummary.converted): show it with "≈". */
  priceApprox?: boolean;
  /** Price at the time it was first added (to show gain/loss). */
  firstPriceUsd: number | null;
  priceUpdatedAt: string;
  addedAt: string;
  dexIds?: number[];
  /** CardDetail.imageFallback, kept because most JA cards have no TCGdex image. */
  imageFallback?: string;
}

/** A recently viewed card (home screen history). */
export interface HistoryItem extends CardBrief {
  priceUsd: number | null;
  /** True when priceUsd was converted from EUR (PriceSummary.converted): show it with "≈". */
  priceApprox?: boolean;
  viewedAt: string;
  /** For showing the name in the UI language (names.translateCardName). */
  dexIds?: number[];
  imageFallback?: string;
}

export interface Settings {
  uiLang: UiLang;
  /** Where the kid lives (region.detectCountry on first launch). Changing it resets currency and searchLang to its defaults. */
  country: Country;
  /** Defaults to the country's money (US → USD, KR → KRW); can be overridden. */
  currency: DisplayCurrency;
  /** Default language used when searching by name. */
  searchLang: CardLang;
  /** Optional URL of the eBay proxy worker (see /worker). Empty = deep links only. */
  ebayWorkerUrl: string;
  theme: 'system' | 'dark' | 'light';
}

/** Daily snapshot of the collection total, used for "since last week" change. */
export interface ValueSnapshot {
  /** YYYY-MM-DD (local date) */
  date: string;
  totalUsd: number;
  /**
   * Saved cards that day: collection key → [price per card in USD, quantity]; unpriced cards are left out.
   * "Since last week" compares only cards present in both snapshots, so adding a card is never a price rise.
   * Missing on snapshots from before this field existed, and dropped from old snapshots that can no longer be a baseline.
   */
  cards?: Record<string, [usd: number, qty: number]>;
}

/** Fun price tiers for kids. */
export type ValueTier = 'common' | 'nice' | 'rare' | 'super' | 'treasure';
