# CardCheck — Architecture & module contracts

A free, kid-friendly Pokémon card **scanner + price checker**. Static PWA (Vite + React + TypeScript),
hosted on GitHub Pages, installable on iPhone via *Share → Add to Home Screen*. No backend is required;
an **optional** Cloudflare Worker (`/worker`) unlocks live eBay listing prices.

## Data sources (all free)

| What | Source | Notes |
|---|---|---|
| Card data, images, set lists (EN / JA / KO) | [TCGdex API](https://tcgdex.dev) `https://api.tcgdex.net/v2/{lang}/…` | No key, CORS `*` |
| Prices | TCGdex `pricing` → **TCGplayer** (USD, EN cards) and **Cardmarket** (EUR, also JA cards) | Converted to USD for display |
| Currency rates | `https://open.er-api.com/v6/latest/USD` | CORS `*`, cached 12h, hard-coded fallback |
| Pokémon names KO/JA/EN | `src/data/pokemon-names.json` generated from PokeAPI CSV (`npm run names`) | `[dexId, en, ko, ja][]` |
| EN set abbreviations | `src/data/en-sets.json` generated from TCGdex (`npm run en-sets`) | `[{id, abbr, official, total, name, releaseDate}]` — printed "PAR EN 123/182" → `sv04` |
| OCR | `tesseract.js` (runs on-device, eng data from CDN, cached by the service worker) | |
| eBay | Deep links (always) + optional Worker using eBay Browse API (active auctions / Buy It Now) | |

## Directory layout & ownership

```
src/
  main.tsx, App.tsx              app shell, routes, tab bar            (ui-foundation)
  styles/tokens.css, global.css  design tokens + base/utility classes  (ui-foundation)
  lib/types.ts                   shared types — THE CONTRACT           (lead; do not change shape casually)
  lib/cache.ts                   memory+localStorage TTL cache         (data)
  lib/fx.ts                      USD/EUR/KRW rates                     (data)
  lib/names.ts                   multilingual Pokémon names            (data)
  lib/tcgdex.ts                  TCGdex client                         (data)
  lib/pricing.ts                 price normalization, tiers, money fmt (data)
  lib/parseCode.ts               OCR text → PrintedCode                (scan)
  lib/ocr.ts                     tesseract worker + image preprocessing(scan)
  lib/identify.ts                photo → IdentifyResult                (scan)
  lib/ebay.ts                    eBay deep links + worker client       (ebay)
  lib/i18n.ts                    UI language helpers                   (ui-foundation)
  lib/router.ts                  tiny hash router                      (ui-foundation)
  lib/store.ts                   settings / collection / history       (ui-foundation)
  components/*                   shared UI components                  (ui-foundation)
  screens/<Name>Screen.tsx (+ .css)  one owner per screen
worker/                          optional eBay proxy (Cloudflare Worker) (ebay)
scripts/build-names.mjs          names data generator
.github/workflows/deploy.yml     GitHub Pages deploy                   (ebay/infra)
```

## Routes (in-memory router — the URL never changes while navigating)

iOS re-prompts for camera permission in installed PWAs whenever the URL/hash changes (WebKit bug 215884), so
navigation uses `history.pushState(state, '')` **without changing the URL**; the current path lives in
`history.state.path` (+ `sessionStorage` to survive reloads). A `#/…` hash present on first load is honored once
(deep link) and then removed with `replaceState`. Paths below are router paths, not URLs.

| Path | Screen |
|---|---|
| `/` | Home: big "Scan a card" button, search box, collection value, recently viewed |
| `/scan` | Camera viewfinder → OCR → "Is this your card?" candidates |
| `/search?q=<text>&lang=<en|ja|ko>` | Name / number search results grid |
| `/card/<lang>/<id>` | Result screen: price hero, low/high, trend, variant picker, eBay, add to My Cards |
| `/collection` | My Cards: total value, list, refresh prices |
| `/settings` | UI language, currency, default search language, optional eBay worker URL, data credits |

## Module APIs

### lib/cache.ts
```ts
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, opts?: { persist?: boolean }): Promise<T>;
export function clearCache(prefix?: string): void;
```

### lib/fx.ts
```ts
export interface Rates { EUR: number; KRW: number; fetchedAt: string }   // units per 1 USD
export const FALLBACK_RATES: Rates;
export function getRates(): Promise<Rates>;          // cached 12h, never throws (falls back)
export function getRatesSync(): Rates;               // last known or fallback
export function eurToUsd(eur: number, rates?: Rates): number;
```

### lib/names.ts
```ts
export interface Species { dexId: number; en: string; ko: string; ja: string }
export function speciesByDex(dexId: number): Species | undefined;
export function findSpecies(query: string, limit?: number): Species[]; // matches en/ko/ja; case/kana insensitive; exact > prefix > contains
export function localizedName(dexIds: number[] | undefined, lang: 'en' | 'ko' | 'ja'): string | undefined;
```

### Language notes
* **JA**: printed set code == TCGdex set id (case-insensitive): `sv8a 084/187` → `/v2/ja/cards/SV8a-084`. Promos `085/SV-P` → `SV-P-085`.
* **KO**: TCGdex KO data is nearly empty (≈240 cards). Korean cards print the same set codes as JA, so look them up
  on the **ja** endpoint and show the Korean Pokémon name from `names.ts` (dexId). `CardDetail.lang` stays `'ja'`
  for data purposes; the UI shows the Korean name when UI language is Korean.
* **EN**: printed abbreviation → set id via `src/data/en-sets.json`; SV/ME-era numbers are 3-digit padded
  (`sv08.5-084`), older sets unpadded (`sm6-84`) — try padded then unpadded.
* Exclude TCG Pocket digital sets everywhere: ids matching `/^(A\d+[ab]?|B\d+a?|P-A)-/`.

### lib/tcgdex.ts
```ts
export interface SetInfo { id: string; name: string; official: number; total: number; logo?: string; symbol?: string; releaseDate?: string; abbreviation?: string }
export function getSets(lang: CardLang): Promise<SetInfo[]>;                        // cached 24h
export function getCard(lang: CardLang, id: string): Promise<CardDetail>;           // cached 30min, builds variants via pricing.ts
export function searchCards(query: string, lang: CardLang, limit?: number): Promise<CardBrief[]>;
//   query may be a name in ANY of ko/ja/en (translated through names.ts to `lang`), or a printed number like "084/187" or "sv8a 084".
//   Results include setName (from getSets) and are sorted newest set first.
export function findByCode(code: PrintedCode, langs?: CardLang[]): Promise<CardBrief[]>;
//   Exact set code + number first; else number/total matched against sets whose official count == total.
export function cardImage(base: string | undefined, quality?: 'low' | 'high'): string | undefined; // `${base}/${quality}.webp`
export function splitCardId(id: string): { setId: string; localId: string };
```

### lib/pricing.ts
```ts
export function buildVariants(raw: unknown, rates: Rates): { variants: CardVariant[]; defaultVariant: string };
export function summarize(tcg: TcgplayerPrice | null | undefined, cm: CardmarketPrice | null | undefined, rates: Rates, updated?: string): PriceSummary | null;
export function valueTier(usd: number | null | undefined): ValueTier;  // common <$1, nice <$5, rare <$25, super <$100, treasure ≥$100
export function formatMoney(usd: number | null | undefined, currency: DisplayCurrency, rates?: Rates, opts?: { approx?: boolean }): string; // "$12.34", "₩16,500", "—"
```

### lib/parseCode.ts / lib/ocr.ts / lib/identify.ts
```ts
export function parsePrintedCode(text: string): PrintedCode;
export function preloadOcr(): Promise<void>;                 // warm up worker (call when Scan screen opens)
export function readCardText(card: HTMLCanvasElement, onProgress?: ProgressFn): Promise<string>;  // card = cropped card image (63:88)
export function identifyCard(card: HTMLCanvasElement, onProgress?: ProgressFn): Promise<IdentifyResult>;
export function cropToCard(source: HTMLVideoElement | HTMLImageElement | ImageBitmap, frame?: DOMRect, view?: DOMRect): HTMLCanvasElement;
```

### lib/ebay.ts
```ts
export function ebayQuery(card: Pick<CardDetail, 'name' | 'lang' | 'localId' | 'setId' | 'dexIds' | 'setName' | 'setOfficialCount'>): string;
export function ebayLinks(query: string): { all: string; auctions: string; buyNow: string; sold: string };
export function fetchEbaySummary(workerUrl: string, query: string, signal?: AbortSignal): Promise<EbaySummary>;
```

### lib/router.ts
```ts
export interface Route { path: string; segments: string[]; query: URLSearchParams }
export function useRoute(): Route;
export function navigate(to: string, opts?: { replace?: boolean }): void;   // to = "/card/ja/SV8a-084" (may include ?query)
export function goBack(fallback?: string): void;                            // history.back() if we have in-app history, else navigate(fallback ?? '/')
export function Link(props: { to: string; className?: string; children: ReactNode; ... }): JSX.Element; // <a> that calls navigate (no href change)
```

### lib/i18n.ts
```ts
export type Strings<K extends string> = Record<UiLang, Record<K, string>>;
export function useUiLang(): UiLang;
export function useStrings<K extends string>(s: Strings<K>): (key: K, vars?: Record<string, string | number>) => string;
// Each screen/component defines its OWN Strings object locally (no shared dictionary file to avoid edit conflicts).
```

### lib/store.ts (useSyncExternalStore-based, persisted to localStorage)
```ts
export function useSettings(): Settings;
export function updateSettings(patch: Partial<Settings>): void;
export function useCollection(): CollectionItem[];
export function addToCollection(card: CardDetail, variantKey: string): void;  // increments qty if present
export function removeFromCollection(key: string): void;
export function setQuantity(key: string, qty: number): void;
export function updateCollectionPrice(key: string, priceUsd: number | null): void;
export function useHistory(): HistoryItem[];                                   // newest first, max 20
export function pushHistory(card: CardDetail, priceUsd: number | null): void;
export function clearHistory(): void;
export function useSnapshots(): ValueSnapshot[];                               // one per local day, max 120
export function recordSnapshot(totalUsd: number): void;                         // upsert today's snapshot
export function collectionTotalUsd(items: CollectionItem[]): number;
export function resetAllData(): void;
// Settings default: { uiLang: navigator.language startsWith 'ko' ? 'ko' : 'en', currency: 'USD',
//   searchLang: uiLang === 'ko' ? 'ja' : 'en', ebayWorkerUrl: '', theme: 'system' }
// The search screen offers EN / 日本語 chips; Korean cards are found through 日本語 (same set codes).
```

## Price logic (summary)

* Headline **시세 / Market**: TCGplayer `marketPrice` (fallback `midPrice`) for the selected variant; if no TCGplayer data,
  Cardmarket `trend` (fallback `avg`, `avg7`, `avg30`) converted EUR→USD and flagged `converted` (shown with "≈").
* **Low**: TCGplayer `lowPrice` / Cardmarket `low`. **High**: TCGplayer `highPrice` after sanity filtering
  (TCGplayer often reports placeholder highs such as 999 for $0.10 cards); Cardmarket has no high → max of
  avg1/avg7/avg30/avg.
* **Trend**: Cardmarket `avg7` vs `avg30` (or avg1 vs avg7) → `changePct`.
* **eBay**: always deep links (auctions ending soonest, Buy It Now lowest first, sold listings). With the worker:
  live lowest Buy It Now, auction count and current bids.
