# CardCheck — Architecture & module contracts

A free, kid-friendly Pokémon card **scanner + price checker**. Static PWA (Vite + React + TypeScript),
hosted on GitHub Pages, installable on iPhone via *Share → Add to Home Screen*. No backend is required;
an **optional** Cloudflare Worker (`/worker`) unlocks live eBay listing prices.

## Data sources (all free)

| What | Source | Notes |
|---|---|---|
| Card data, images, set lists (EN / JA / KO) | [TCGdex API](https://tcgdex.dev) `https://api.tcgdex.net/v2/{lang}/…` | No key, CORS `*` |
| Prices | TCGdex `pricing` → **TCGplayer** (USD, EN cards) and **Cardmarket** (EUR, also JA cards) | Converted to USD for display |
| Currency rates | `open.er-api.com` → `api.frankfurter.dev` → jsDelivr `@fawazahmed0/currency-api` | CORS `*`, 3.5 s each, no retry, cached 12h (kept as "last known"), hard-coded fallback |
| Pokémon names KO/JA/EN | `src/data/pokemon-names.json` generated from PokeAPI CSV (`npm run names`) | `[dexId, en, ko, ja][]` |
| EN set abbreviations | `src/data/en-sets.json` generated from TCGdex (`npm run en-sets`) | `[{id, abbr, official, total, name, releaseDate}]` — printed "PAR EN 123/182" → `sv04` |
| OCR | `tesseract.js` (runs on-device, eng data from CDN, cached by the service worker) | |
| eBay | Deep links (always) + optional Worker using eBay Browse API (active auctions / Buy It Now) | Worker prices are eBay US totals incl. shipping to a US ZIP |

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
  lib/imageProc.ts               card crop, pixel ops, canvas helpers  (scan)
  lib/parseCode.ts               OCR text → PrintedCode                (scan)
  lib/ocr.ts                     tesseract worker + strip preprocessing(scan)
  lib/identify.ts                photo → IdentifyResult                (scan)
  lib/ebay.ts                    eBay deep links + worker client       (ebay)
  lib/i18n.ts                    UI language helpers                   (ui-foundation)
  lib/router.ts                  in-memory router (URL never changes)  (ui-foundation)
  lib/store.ts                   settings / collection / history       (ui-foundation)
  lib/localName.ts, weekChange.ts, useOnline.ts   small helpers shared by several screens (see below)
  components/*                   shared UI components                  (ui-foundation)
  components/ExternalLink.tsx, grownUpGate.ts   every link to a shop goes through the grown-up check
  screens/<Name>Screen.tsx (+ .css)  one owner per screen; its parts live in screens/<name>/
  data/pokemon-names.json, en-sets.json   generated data (scripts/)
worker/                          optional eBay proxy (Cloudflare Worker) (ebay)
scripts/build-names.mjs, build-en-sets.mjs   data generators (npm run names / en-sets)
.github/workflows/deploy.yml     GitHub Pages deploy                   (ebay/infra)
```

Screens import from `lib/` and `components/` only, with two exceptions: the Collection grid reuses
`screens/card/format.ts` (`variantLabel`) so variant names read the same as on the Card screen, and Home's
My Cards panel reuses `screens/collection/useRefreshPrices.ts` (the shared background price refresh).

## Routes (in-memory router — the URL never changes while navigating)

iOS re-prompts for camera permission in installed PWAs whenever the URL/hash changes (WebKit bug 215884), so
navigation uses `history.pushState(state, '')` **without changing the URL**; the current path lives in
`history.state.path` (+ `sessionStorage` to survive reloads). A `#/…` hash present on first load is honored once
(deep link) and then removed with `replaceState`. Paths below are router paths, not URLs.

| Path | Screen |
|---|---|
| `/` | Home: big "Scan a card" button, search box, collection value, recently viewed |
| `/scan` | Camera viewfinder or a photo → OCR → the card (when sure) or "Is this your card?" candidates → typed number |
| `/search?q=<text>&lang=<en|ja|ko>` | Name / number search results grid |
| `/card/<lang>/<id>` | Result screen (layout below): art, name, chips, price hero (시세 + low/high), variant picker, add to My Cards, eBay, More prices. `?from=scan` (set by the Scan screen) fires confetti for 용돈 카드 ($5) or more |
| `/collection` | My Cards: total value, since last week, best card, cards by price, grid (edit mode), refresh prices |
| `/settings` | UI language, currency (default KRW for Korean, USD otherwise), theme, default search language, optional eBay worker URL (label exactly "eBay 워커 주소" / "eBay worker URL": worker/README.md points parents to it), install guide, reset, data credits |

### Card screen layout
Top to bottom, so that the price is the first thing under the card on every phone:
1. Card art — sized so the price fits the first view: `useFitArt` (CardScreen.tsx) measures everything from the page top to
   the end of the elements marked `FOLD_ATTR` (the big price and the low–high row) except the art itself, and hands it to
   CSS as `--card-fold-h`; `.card-art` takes the height that is left above the tab bar and the raised Scan button (at least
   92 px wide, up to 46% of the width / 220 px on tall phones; ~128 px on an iPhone SE). Re-measured on every resize (fonts,
   another variant). Tap to zoom (Sheet). With no picture, `CardImage code` prints set + number on the card back.
2. Title: the name in the UI language for JA/KO cards ("루차불" / "Hawlucha") with the printed name under it
   ("ルチャブル"); EN cards keep the English name (+ Korean name under it in the Korean UI). `format.cardNames`.
3. One chip row: flag (language read by screen readers) + set name + `printedNumberOf(card)` ("#084/187", "#TG05/TG30",
   "#085"), plus the rarity in Korean in the Korean UI (`rarityLabel`).
4. `PriceHero`: tier cheer on the panel edge, 시세 (+ variant name) with the optional calm trend pill on the same row
   ("요즘 올랐어요 ▲25%"), the big `Money` (second currency under it), the low–high row and the source line ("23시간 전
   업데이트 · TCGplayer"), then a small "eBay 가격은 아래에 있어요 ↓" button that scrolls to the eBay panel and focuses its
   heading (it sits under the source line, so it never pushes the low–high row down; below the fold on an SE).
   TCGplayer: "지금 파는 최저가" … "최고가". Cardmarket (converted, 약/≈ on both): one "요즘 거래 가격" label.
   Between the two numbers a static bar with a small "시세" / "Market" tag where 시세 sits (`format.rangeMarker`); when 시세
   is within 2% of an end, or low = high, no bar: just "4,760원 ~ 9,000원" ("–" in English).
5. `VariantPicker`, then `CollectButton`.
6. `EbayPanel` (live Buy It Now total incl. shipping + 보통 가격 + auctions when the worker is set, and always three
   tiles: 경매 가격 보기 · 지금 살 수 있는 가격 · 팔린 가격 보기), then the "어른과 함께" disclaimer.
7. `MorePrices` (closed `<details>`): raw TCGplayer USD / Cardmarket EUR numbers, TCGplayer link, the eBay search words.

Measured on the production build in Chromium (104 combinations: 375×667, 390×844 and 430×932 × Korean/English × KRW/USD
× dark/light for ja/SV8a-084, ko/SV8a-084, en/sv03.5-199 and en/svp-085, plus trend-pill cards on the SE): the big price,
its second currency and the low–high row end above the raised Scan button every time (on the SE the row ends at
y ≈ 571, the button starts at 579). The worst case (two-line name, wrapped chips and a trend pill on an SE) shrinks the
art towards its 92 px minimum.

The screen also re-converts EUR prices with live rates (`applyRates(card, useRates())`), records history with the
approx flag, and copies freshly loaded prices onto saved copies of the card (`updateCollectionPrice`).

## Module APIs

### lib/cache.ts
```ts
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, opts?: { persist?: boolean; keep?: boolean }): Promise<T>;
//   memory Map + localStorage ("cc:cache:" prefix, persist defaults true); concurrent calls share one fn(); rejections not cached.
//   keep: the stored entry survives pruning after it expires (exchange rates: the "last known" fallback).
//   Expired entries are pruned 5 s after the session first uses the cache. Writes go through writeWithRoom.
export function peekCached<T>(key: string): T | undefined;   // last stored value even if expired ("last known" fallbacks)
export function pruneExpiredCache(): number;                // drops expired non-keep entries from localStorage; never throws
export function writeWithRoom(write: () => void): boolean;
//   Runs a localStorage write; on a quota error frees cache space and retries: expired entries first, then the oldest
//   quarter at a time (keep entries never). store.ts writes My Cards through it, so cached API data goes before the
//   kid's cards. False when it still fails (blocked storage).
export function clearCache(prefix?: string): void;
export class HttpError extends Error { readonly status: number }
export function fetchJson<T>(url: string, opts?: { timeoutMs?: number /* 12000 */; retries?: number /* 2 */; init?: RequestInit }): Promise<T>;
//   AbortController timeout; retries network errors/timeouts and HTTP 5xx with 400ms, 1200ms backoff; 4xx → HttpError (404 → .status 404).
```

### lib/fx.ts
```ts
export interface Rates { EUR: number; KRW: number; fetchedAt: string }   // units per 1 USD
export const FALLBACK_RATES: Rates;
export function getRates(): Promise<Rates>;          // cached 12h (keep), never throws (falls back)
export function getRatesSync(): Rates;               // last known (memory/localStorage, even if stale) or fallback; stable reference
export function eurToUsd(eur: number, rates?: Rates): number;
export function useRates(): Rates;                   // React hook: getRatesSync() first, re-renders when getRates() resolves
// Sources, in order, 3.5 s each and no retry: open.er-api.com/v6/latest/USD → api.frankfurter.dev/v1 (base=USD) →
// cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest → FALLBACK_RATES {EUR 0.8957, KRW 1359}.
// After every provider fails, getRates() answers from getRatesSync() for 5 min without refetching.
// Nothing waits for rates: getCard converts with getRatesSync() and pricing.applyRates re-converts when useRates updates.
```

### lib/names.ts
```ts
export interface Species { dexId: number; en: string; ko: string; ja: string }
export function speciesByDex(dexId: number): Species | undefined;
export function findSpecies(query: string, limit?: number): Species[]; // matches en/ko/ja; case/kana insensitive; exact > prefix > contains
export function localizedName(dexIds: number[] | undefined, lang: 'en' | 'ko' | 'ja'): string | undefined;
//   findSpecies normalizes NFKC/case/hiragana→katakana/punctuation and also tries the query without card affixes
//   (Mega/メガ/메가, Alolan/Galarian/Hisuian/Paldean, Radiant, Team Rocket's; ex/EX/V/VMAX/VSTAR/GX/BREAK).
export function translateCardName(name: string, dexIds: number[] | undefined, toLang: 'en' | 'ko' | 'ja'): string | undefined;
//   Replaces the species part of a card name and keeps affixes: "ブラッキーex" [197] → "Umbreon ex" / "블래키 ex";
//   "メガゲンガーex" [94] → "Mega Gengar ex"; "Pikachu & Zekrom GX" [25,644] → "ピカチュウ&ゼクロムGX".
//   Unknown words around the species (e.g. "Iono's") are dropped. undefined without dexIds or when no species is found in the name.
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
//   logo is a full URL ending in .webp (EN only; use as-is). symbol is never set (TCGdex symbol URLs 404).
export function getSets(lang: CardLang): Promise<SetInfo[]>;                        // cached 24h
//   Newest first, ids de-duplicated, TCG Pocket removed; 'ko' returns the JA sets; 'en' gets abbreviation from en-sets.json.
//   Fetched with one GraphQL POST (/v2/graphql — the REST list has no releaseDate); falls back to REST /v2/{lang}/sets.
export function getCard(lang: CardLang, id: string): Promise<CardDetail>;           // cached 30min, builds variants via pricing.ts
//   'ko' reads ja. Never waits for exchange rates (last known ones; live rates load in the background).
//   rarity "None" dropped; setOfficialCount undefined for promo sets (JA official 0, ids ending "-P", EN "… Promos");
//   printedNumber always set (see below); imageFallback = TCGplayer CDN 400w image of the first variant's tcgplayer
//   product id. 404 → HttpError status 404.
export function printedNumber(card: { localId; setId; setName; lang }, official: number | undefined): string;
//   "084/187"; JA promos "085/SV-P"; EN promos the number alone ("085", "SWSH284"); subsets keep the letters on the
//   total ("TG05/TG30", "GG35/GG70", "SV49/SV94"); other lettered numbers alone ("RC1").
export function parseQueryCode(query: string): PrintedCode | undefined;
//   Typed codes for searchCards: "084/187", "sv8a 084", "SV8a-084", "PAR 123", "par 123", "obf 125/197", "085/SV-P",
//   "SWSH284", "SM60", "svp 085", "tg05/tg30". A word without digits is a set code when written in capitals or when it
//   is a known EN code followed by a 2–3 digit number; other lowercase words ("mew 2") stay name searches.
export function searchCards(query: string, lang: CardLang, limit?: number /* 60 */): Promise<CardBrief[]>;
//   query may be a name in ANY of ko/ja/en (translated through names.ts to `lang`, keeping "ex"/"V"… suffixes), or a printed
//   code (parseQueryCode → findByCode over ja+en). Raw text is also queried
//   (trainer names) unless it is Hangul or in another script than `lang` with a species match. 'ko' searches ja.
//   Queries of 1–2 characters ("N") match names exactly (`name=eq:N`) and count as a species only on an exact name ("뮤").
//   Results include setName (from getSets), TCG Pocket removed, sorted newest set first. A bare number ("084") finds nothing.
//   CardBrief has no imageFallback: new JA sets (M-era) list without images, so grids show the CardImage card back.
export function findByCode(code: PrintedCode, langs?: CardLang[]): Promise<CardBrief[]>;
//   langs default: en → ['en'], ja/ko → ['ja'], unknown → ['ja','en']. Exact set code + number first (JA pad3; EN padded then
//   unpadded; "TG01" as-is; old EN promos "SWSH123"/"SM01" → swshp/smp/…); else
//   /cards?set.cardCount.official={total}&localId={n} + exact localId match, ordered by resolveSets rank; else subset numbers
//   with a non-numeric total ("TG05/TG30", "GG35/GG70", "SV49/SV94") → /cards?localId={n}, newest set first. Max 8.
export function resolveSets(code: PrintedCode, langs: CardLang[]): Promise<SetCandidate[]>;
//   export interface SetCandidate { lang: CardLang; set: SetInfo; score: number }
//   Sets named by the code (JA id / EN id or abbreviation) that agree with the total (score 1; 0.9 when total unknown or promo);
//   else same-size sets ranked by edit distance to the noisy code (0.1–0.8), newest first among equals; else the named sets
//   despite the size mismatch (0.5). Exact matches suppress fuzzy alternatives, so length === 1 means "unambiguous".
export function listCards(lang: CardLang, params: Record<string, string>): Promise<CardBrief[]>;
//   Raw list endpoint (/v2/{lang}/cards?{params}), TCG Pocket removed, setName attached, API order. Memory-cached 10 min.
export function cardImage(base: string | undefined, quality?: 'low' | 'high'): string | undefined; // `${base}/${quality}.webp`
export function splitCardId(id: string, localId?: string): { setId: string; localId: string };    // "SV-P-085" → SV-P / 085
```

### lib/pricing.ts
```ts
export function buildVariants(raw: unknown, rates: Rates): { variants: CardVariant[]; defaultVariant: string };
export function summarize(tcg: TcgplayerPrice | null | undefined, cm: CardmarketPrice | null | undefined, rates: Rates, updated?: string): PriceSummary | null;
export function applyRates<T extends { variants: CardVariant[] }>(card: T, rates: Rates): T;  // re-summarizes every variant with new rates
export function valueTier(usd: number | null | undefined): ValueTier;  // common <$1, nice <$5, rare <$25, super <$100, treasure ≥$100
//   Shown as 동전 / 과자값 / 용돈 / 귀한 / 보물 카드 (Pocket change / Snack money / Allowance / Prized / Treasure).
export function formatMoney(usd: number | null | undefined, currency: DisplayCurrency, rates?: Rates, opts?: { approx?: boolean; lang?: UiLang }): string;
//   "$12.34", "₩16,500", "—". USD: cents below $1,000, whole dollars above ("$1,234"). KRW: rounded to ₩10 below ₩10,000,
//   to ₩100 above. approx → "≈ " prefix. KRW with lang 'ko' is written the Korean way: "4,760원", "123,400원", and from
//   1,000,000원 compact "198만 원" / "1억 2,000만 원"; approx → "약 4,760원". Money passes the UI language, so the Korean UI
//   never shows "₩" or "≈ ₩" (English UI with won: "≈ ₩4,760"). This is the only place money is rounded.
// Variant keys (buildVariants): "normal" | "holo" | "reverse" | "firstEdition", then "-<foil>" ("reverse-masterball"),
//   "-<subtype>" ("holo-shadowless"; "unlimited" is left out), "-<size>" ("normal-jumbo") and "-stamp-<stamps>"
//   ("reverse-stamp-gamestop", "normal-stamp-poketour-99"); "-2", "-3" only for true duplicates. CardVariant also
//   carries stamp / subtype / size. A variant with no own pricing borrows the card's top-level pricing — except
//   separate products (special foils, 1st edition, stamped, jumbo), which stay unpriced. Plain reverse reads Cardmarket
//   "-holo" fields and TCGplayer "reverse-holofoil".
// defaultVariant: the most common printing that has a price — normal > holo > other regular printings (shadowless…) >
//   1st edition > reverse > special foils > stamped/jumbo — else the most common one.
// summarize: TCGplayer when it has market ?? mid: low = min(low, market); high = TCGplayer high if ≤ 3× market
//   (HIGH_MAX_RATIO), else the largest of mid, directLow and Cardmarket avg / avg30 / trend in USD that is itself
//   ≤ 3× market (each checked on its own, so one spiky average doesn't hide a sane trend); market when none passes;
//   always ≥ market.
//   Else Cardmarket EUR→USD (converted): market = trend ?? avg30 ?? avg ?? avg7; low/high = min/max of avg1, avg7, avg30,
//   trend, market (+avg for high) — Cardmarket's raw "low" is a junk listing.
//   changePct = Cardmarket avg7 vs avg30, only when market ≥ $2, avg30 ≥ €1, 10% ≤ |move| ≤ 100%, and (TCGplayer
//   headline) Cardmarket's price is within 0.5–2× of it; else null. null without a headline. Amounts are exact USD, never
//   rounded to cents (€0.04 = $0.0447 → "약 60원", not the 50원 a rounded $0.04 gives); only formatMoney rounds.
//   valueTier compares whole cents, like the dollar amount shown.
```

### lib/imageProc.ts / lib/parseCode.ts / lib/ocr.ts / lib/identify.ts (scan)
Import these only from the Scan screen and its parts (`screens/scan/*`, a lazy chunk): ocr.ts loads tesseract.js with a
dynamic import, keep it that way.
```ts
// imageProc.ts — pure pixel ops + canvas helpers
export type BoxLike = Pick<DOMRectReadOnly, 'x' | 'y' | 'width' | 'height'>;
export function cropToCard(source: HTMLVideoElement | HTMLImageElement | ImageBitmap | HTMLCanvasElement, frame?: BoxLike, view?: BoxLike): HTMLCanvasElement;
//   frame + view: the guide frame and the <video>/<img> element (getBoundingClientRect), media drawn with object-fit: cover.
//   frame alone: already source px. Neither: centered 63:88 rect filling 92%. Output ≤ 1600 px wide; overhang filled white.
export function cropTurnedCard(source: CardSource, q: QuarterTurns, frame?: BoxLike): HTMLCanvasElement; // card cut from the photo turned q×90° clockwise
export function turnPicture(source: CardSource, q?: QuarterTurns /* 1 */): HTMLCanvasElement;  // whole photo turned (Rotate button), long side ≤ 2400 px
export const CODE_STRIP: Rect;        // collector-line band { x 0, y .86, w .55, h .14 } of the 63:88 crop
export const SMALL_CODE_STRIP: Rect;  // the band above it { y .78, h .14 }: a card held at ~70–88% of the guide (photo path)
export function fileToBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement>;   // picked photo, EXIF-upright (<img> fallback)
export function canvasToDataUrl(canvas: HTMLCanvasElement, maxW?: number /* 320 */, quality?: number /* .8 */): string; // JPEG
export function releaseCanvas(canvas: HTMLCanvasElement): void;   // free canvas memory now (iOS has a hard budget)
//   also: CARD_ASPECT, NAME_STRIP, QuarterTurns, turnPoint, turnedCardRect, grayscale/contrastStretch/threshold/negate/shear/pad,
//   coverToSource, centerCardRect, cardSourceRect, clipRect, cropRegion, upscaleTo, readPixels, pixelsToCanvas (ocr.ts / tests).

// parseCode.ts — pure
export interface ParsedCode extends PrintedCode { score: number }   // 0..1 confidence, weights the vote across passes
export interface ParseOptions { knownSetIds?: readonly string[]; knownEnAbbrs?: readonly string[] }
export function parsePrintedCode(rawText: string, opts?: ParseOptions): ParsedCode;  // "G sv8a 084/187" → {setCode:"SV8a", number:"084", total:"187", lang:"ja"}
export function mergeParses(parses: ParsedCode[]): ParsedCode;

// ocr.ts — one long-lived tesseract worker; engine + eng data (~4.5 MB) from cdn.jsdelivr.net, cached by the service worker
export function preloadOcr(): Promise<void>;                 // call when the Scan screen opens; idempotent, never rejects
export function readCodeStrip(card: HTMLCanvasElement, opts?: ReadCodeOptions): Promise<CodeStripResult>;
//   ReadCodeOptions { onProgress?; shouldStop?(merged, parsed); isStale?(): boolean; maxPasses?: number; band?: Rect; parse? }
//   CodeStripResult { passes: { text; parsed }[]; merged: ParsedCode; status: 'done' | 'stopped' | 'unavailable' }
export const CODE_PASSES: readonly CodePass[];               // the passes, best first (the Scan screen shows i/6 progress)
export const LOW_RES_PASSES: readonly CodePass[];            // 6 passes tuned for a band under 520 source px (a 1080p camera crop)
export function ocrLoading(): boolean;                       // the engine is still downloading (the scan gave up waiting, not the load)
export function interiorText(tsv: string | null | undefined, top: number, bottom: number): string | undefined;
//   Up to 6 preprocessing passes over `band` (default CODE_STRIP), voted together; a band narrower than 520 source px
//   uses LOW_RES_PASSES instead. Never throws. Text whose line box is cut by the band's top or bottom edge is ignored
//   (interiorText), so half a line can't be misread (084 → 053).
// Engine load: createWorker's errorHandler is raced against it (tesseract never rejects a failed language download).
//   Waiting and killing are separate. A scan stops WAITING after 30 s without load progress (counted from when it started
//   waiting) → status 'unavailable', and the Scan screen shows 'ocrSlow' while ocrLoading() is true ("번호 읽기 도구를
//   아직 받고 있어요"). The load goes on in the background and the next scan reuses it; stopping a scan (X / Back) never
//   drops it. The engine is KILLED only on errorHandler or when one load step is silent for 150 s (tesseract reports
//   progress only at the start and end of the ~3 MB language file): the worker is terminated (captured through a short
//   Worker-constructor wrap) and forgotten, so the next scan downloads afresh → 'ocrUnavailable'. A recognize pass that
//   hangs 20 s resets the engine. isStale is polled every 150 ms while waiting.

// identify.ts
export function identifyCard(card: HTMLCanvasElement, onProgress?: ProgressFn, opts?: { langHint?: CardLang; isStale?; maxPasses?; band? }): Promise<IdentifyOutcome>;
//   IdentifyOutcome = IdentifyResult + status ('unavailable' when the OCR engine could not load; 'stopped' when isStale).
//   card = cropToCard output. Never throws; candidates [] when nothing was read or matched (offer typed search); lookups
//   are skipped once isStale.
//   Stops early once two passes agree and resolveSets gives exactly one set. 1–3 s on desktop, expect 2–4× on phones.
//   langHint 'ko' turns a JA-style code into code.lang 'ko' (OCR cannot see Hangul); lookups still go to 'ja'.
//   A single misread pass can still win (e.g. 054 for 084): never navigate on a lone candidate without the check below.
export function findCards(code: PrintedCode, opts?: { langHint?; isStale? }): Promise<CardBrief[]>;
//   The lookup identifyCard does, for a code fixed up from several looks (scanCard's short-total retry). Never throws.

// screens/scan/scanCard.ts — the Scan screen's policy on top of identifyCard
export function scanCard(card: HTMLCanvasElement, onProgress: ScanProgress, opts?: { isStale?; turned?: (q: 1 | 3) => HTMLCanvasElement; live?: boolean; now? }): Promise<ScanOutcome>;
//   ScanOutcome { code, candidates, sure, status, card? (the turned crop the result came from; caller frees it), band? }
//   ScanProgress(stage, progress, look: 1 | 2 | 'turn') — Analyzing shows "카드를 돌려서 볼게요…" for 'turn'.
//   live: a camera frame (CameraView); photos and the Rotate button pass `turned` instead.
//   sure = exactly one candidate whose number matches (sameNumber: a card that prints leading zeros must be read with
//   them — "4" or "84" is never sure for #084) and whose printed set code names that set with a matching total
//   (resolveSets score 1). On a crop under 1000 px wide (CONFIRM_BELOW_PX, i.e. camera frames) a sure read also needs a
//   second look that read the same number, and no look may have read another number on the same line.
//   Sure → open the card directly (replace, ?from=scan). Not sure, in order:
//   - no number read (photo path): the photo turned 90° and 270° (2 passes each) and the higher band (SMALL_CODE_STRIP,
//     3 passes); the turns go first when the first look looksSideways (no digit, or mostly 1–2 character fragments);
//   - live path: the crop zoomed to its central 88% and 80% (LIVE_ZOOMS, a second crop scale; no higher band);
//   - then one second look at a resampled copy of the best read (+≈1.5 s). At most 4 looks (24 passes) per live frame.
//   Extra tries stop starting 10 s after the first look ends unless a number was read (worst case before the number
//   form: first look + 10 s + the try still running). A total read short ("084/18") is looked up again with the longer
//   total another look read (findCards). Sure results from a zoomed look report `band` mapped back to the crop (unzoom).
//   Then "Is this your card?" (the card most looks agree on first; one candidate: side by side with the kid's photo),
//   then the number form, pre-filled with what OCR read, showing an enlarged crop of the band the number was read in,
//   with a reason: notFound, unread (+ "hold the card upright and fill the box" tip), ocrSlow (still downloading:
//   "번호 읽기 도구를 아직 받고 있어요 · 조금 뒤에 다시 찍어 봐요") or ocrUnavailable ("번호 읽기 도구를 못 불러왔어요").
// PhotoAdjust has a "⟳ 돌리기 / Rotate" button (turnPicture 90°, safe against double taps and Back).
// Stopping (X / Back) makes isStale true: OCR stops between passes, lookups are skipped, the next scan doesn't queue;
//   an engine download in progress keeps going.
```

### Korean cards across screens
Candidates and `CardDetail` for Korean cards have `lang: 'ja'` (data language). Keep the user's language in the route instead:
Search navigates to `/card/ko/<id>` when it ran with `lang=ko` (its chips offer only EN / 日本語, so only links carry `ko`);
Card screen calls `getCard('ko', id)` (reads ja), shows the Korean name as the title and passes `{ ...card, lang: 'ko' }`
to `ebayQuery` so the query says "Korean". The Scan screen does not pass a `langHint` (OCR cannot see Hangul and there is
no language picker), so a scanned Korean card opens as `/card/ja/…`. Collection/history keys use `card.lang` ('ja').
The Card screen also fills missing `dexIds` from the name for Pokémon (cards with HP) before `ebayQuery`, since some new
JA cards come without them: "Umbreon ex sv8a 217/187 Japanese" instead of "pokemon sv8a 217/187 Japanese".

### lib/ebay.ts
```ts
export type EbayCard = Pick<CardDetail, 'name' | 'lang' | 'localId' | 'setId' | 'dexIds' | 'setName' | 'setOfficialCount' | 'printedNumber'>;
export function ebayQuery(card: EbayCard): string;
//   EN "Lopunny 084/131 Prismatic Evolutions"; subsets use the parent set ("Zekrom TG05/TG30 Brilliant Stars");
//   EN promos "Pikachu with Grey Felt Hat 085 promo", "Galarian Moltres SWSH284" (never "Black Star Promos");
//   JA "Hawlucha sv8a 084/187 Japanese", promos "Pikachu 085/SV-P Japanese"; JA/KO trainers "sv8a 232/187 Japanese"
//   ("pokemon" only when there is no total). Korean route → "Korean".
export function ebayLinks(query: string): { all: string; auctions: string; buyNow: string; sold: string };
export function fetchEbaySummary(workerUrl: string, query: string, signal?: AbortSignal): Promise<EbaySummary>;
//   10 s timeout; non-2xx → HttpError (worker: 400 missing_q / q_too_long, 403 origin_not_allowed, 429 rate_limited,
//   500 not_configured, 502 ebay_unavailable) — callers fall back to the links. buyNow.lowest / median are totals incl.
//   shipping; lowestShipping is passed through when the worker sends it (older workers: absent).
```

### lib/router.ts
```ts
export interface Route { path: string; href: string; segments: string[]; query: URLSearchParams }  // href = path + query
export function useRoute(): Route;
export function navigate(to: string, opts?: { replace?: boolean }): void;   // to = "/card/ja/SV8a-084" (may include ?query)
//   Scrolls to top; navigating to the current href only scrolls to top (tapping the active tab). Back restores scroll.
export function goBack(fallback?: string): void;                            // history.back() if we have in-app history, else navigate(fallback ?? '/', { replace: true })
export function Link(props: { to: string; replace?: boolean } & AnchorHTMLAttributes): JSX.Element;
//   <a href="#/…"> whose click calls navigate (the URL never changes; the hash href only serves "open in new tab").
// Screens are default exports without props, reading params from useRoute(), except
// CardScreen({ lang, id }) — App validates /card/<lang>/<id> and remounts it per card.
```

### lib/i18n.ts
```ts
export type Strings<K extends string> = Record<UiLang, Record<K, string>>;
export function useUiLang(): UiLang;
export function useStrings<K extends string>(s: Strings<K>): (key: K, vars?: Record<string, string | number>) => string; // "{n}장" → "3장"
export function interpolate(template: string, vars?: Record<string, string | number>): string;
export function fmtRelativeTime(iso: string, lang: UiLang, now?: number): string;   // "방금", "2시간 전" / "just now", "2h ago"
// Each screen/component defines its OWN Strings object locally (no shared dictionary file to avoid edit conflicts).
```

### lib/store.ts (useSyncExternalStore-based, persisted to localStorage)
```ts
export function useSettings(): Settings;
export function updateSettings(patch: Partial<Settings>): void;                // invalid fields are ignored
export function useCollection(): CollectionItem[];                             // newest first
export function collectionKey(card: Pick<CardBrief, 'lang' | 'id'>, variantKey: string): string; // `${lang}:${id}:${variant}`
export function addToCollection(card: CardDetail, variantKey: string): string; // returns the key; qty+1 if present;
//   priceUsd (and firstPriceUsd when new) = that variant's summary.market, priceApprox = summary.converted; keeps
//   imageFallback + dexIds. The first call asks navigator.storage.persist() (best effort).
export function removeFromCollection(key: string): void;                       // also drops its thumb
export function setQuantity(key: string, qty: number): void;                    // floors, max 999, ≤ 0 removes
export function updateCollectionPrice(key: string, priceUsd: number | null, approx?: boolean): void; // firstPriceUsd filled if null
export function onCollectionSaveFailed(listener: () => void): () => void;
//   Fires when a change to My Cards could not be written even after writeWithRoom freed cache space (App shows a
//   "couldn't save" toast, at most once a minute). The change still shows until the app is closed.
export function setCollectionThumb(key: string, dataUrl: string): void;        // user's photo for a saved card ("cc:thumbs")
export function useCollectionThumbs(): Readonly<Record<string, string>>;       // collection key → photo data URL
export function rememberScanPhoto(cardId: string, dataUrl: string): void;      // memory only, last 10 (Scan → Card screen)
export function getScanPhoto(cardId: string): string | undefined;
export function useHistory(): HistoryItem[];                                   // newest first, max 20, one per card
export function pushHistory(card: CardDetail, priceUsd: number | null, approx?: boolean): void;   // approx → HistoryItem.priceApprox
export function clearHistory(): void;
export function useSnapshots(): ValueSnapshot[];                               // oldest first, one per local day, max 120
export function recordSnapshot(items: readonly CollectionItem[]): void;          // upsert today's total + per-card [usd, qty] (no-op when unchanged)
export function collectionTotalUsd(items: CollectionItem[]): number;            // Σ priceUsd × qty (not rounded to cents; 1/100 cent against float noise)
export function resetAllData(): void;                                           // all keys above + settings + scan photos + clearCache()
// Keys "cc:settings", "cc:collection", "cc:history", "cc:snapshots", "cc:thumbs", each { v: 1, data }; unreadable,
//   foreign-version or malformed entries fall back to defaults (bad items are dropped individually). Thumbs live in
//   their own key so a full quota can only cost photos (then only the newest that fit are saved); pass small JPEGs (~200px wide).
// Settings default: { uiLang: navigator.language startsWith 'ko' ? 'ko' : 'en', currency: uiLang === 'ko' ? 'KRW' : 'USD',
//   searchLang: uiLang === 'ko' ? 'ja' : 'en', ebayWorkerUrl: '', theme: 'system' } (saved settings are kept as they are).
// CollectionItem.priceApprox / HistoryItem.priceApprox: the price was converted from EUR → grids, Recent, the totals
//   (when any saved card is approx) and the best card show "≈". Items saved before the field load as exact.
// The search screen offers EN / 日本語 chips; Korean cards are found through 日本語 (same set codes).
// Photo flow: Scan screen rememberScanPhoto(card.id, photo) → Card screen getScanPhoto(id) as CardImage `photo`
//   → on "Add to My Cards" setCollectionThumb(addToCollection(card, variant), photo) (shrunk to 200px wide; first add of
//   a card without a TCGdex picture only).
// Snapshots: Home (My Cards panel) and My Cards call recordSnapshot(items) whenever the list is not empty, so "since
//   last week" has data even if the kid only opens Home. Per-card data is kept only on the last 7 days of snapshots plus
//   the newest older one (the only possible baselines); older snapshots keep just their total.
// Saved prices refresh by themselves (screens/collection/useRefreshPrices.ts): when Home or My Cards opens online, prices
//   older than 24 h are re-checked in the background, 2 cards at a time, at most once an hour ("cc:pricesAutoRefreshedAt");
//   one refresh runs app-wide (the manual 가격 새로고침 joins or follows it). Opening a card also updates its saved copies.
// Not managed here: "cc:scanTipsSeen" (CameraView's first-time tips, kept by resetAllData), "cc:cache:*" (cache.ts),
//   "cc:pricesAutoRefreshedAt" (useRefreshPrices) and sessionStorage "cc:grownUpOk" (grownUpGate).
```

### Small shared helpers (lib)
```ts
// localName.ts — a card name in the UI language when there are no dexIds (search results, some new JA cards):
export function nameInUiLang(name: string, lang: UiLang): string | undefined;  // "ルチャブル" → "루차불"; trainers → undefined
// weekChange.ts — the "since last week" number on Home and My Cards:
export function weekChange(snapshots: readonly ValueSnapshot[], items: readonly Pick<CollectionItem, 'key' | 'priceUsd' | 'qty'>[], today: string): { deltaUsd: number; days: number } | null;
//   against the earlier snapshot with per-card data closest to 7 days before today (the older one on a tie); days < 7
//   while the app is new. Only cards present at both times count, as min(qty now, qty then) × (price now − price then):
//   adding or removing cards is never a rise or drop. null without a baseline or a card in common. deltaUsd is rounded
//   to cents, so a sub-cent move counts as no change (Home and My Cards hide the line at 0).
export function todayLocal(d?: Date): string;                                   // "YYYY-MM-DD", the snapshot date format
// useOnline.ts
export function useOnline(): boolean;                                           // navigator.onLine, re-renders on change
```

### Links that leave the app (grown-up check)
```ts
// components/ExternalLink.tsx — shops (eBay tiles and auction rows, TCGplayer): a <button type="button" role="link">
// with no href (styled by its usual classes over a zero-specificity button reset), so there is no URL to long-press.
export function ExternalLink(props: { href: string; site: 'eBay' | 'TCGplayer' | 'Cardmarket' } & ButtonHTMLAttributes): JSX.Element;
//   Tap or Enter → shopTap: the first time in a session a Sheet asks "eBay 웹사이트로 가요 · eBay는 진짜로 카드를
//   사고파는 곳이에요. 어른과 함께 볼까요?"; Cancel opens nothing; "어른과 함께 볼게요" remembers the OK for the session and
//   opens the page with window.open(url, '_blank', 'noopener'). Later taps open directly.
// components/grownUpGate.ts
export const GROWN_UP_KEY = 'cc:grownUpOk';      // sessionStorage; falls back to memory when storage is blocked
export function grownUpConfirmed(): boolean;
export function confirmGrownUp(): void;
export function isWebUrl(url: string): boolean;  // http/https only: a javascript: URL from a worker never opens
export function openShop(url: string, open?): boolean;   // window.open(url, '_blank', 'noopener'); false for non-web URLs
export function shopTap(url: string, ask: () => void, open?, storage?): 'opened' | 'asked' | 'blocked';
```
Tiles use viewing words (경매 가격 보기 · 지금 살 수 있는 가격 · 팔린 가격 보기), an external-link icon and the caption
"eBay 웹사이트가 열려요 · 어른과 함께 봐요". Middle-click / Ctrl-click no longer open shop pages (by design).

UI building blocks (components, CSS classes, copy tone): see [UI-KIT.md](UI-KIT.md).

## PWA & offline

`vite-plugin-pwa` (generateSW, `registerType: 'prompt'`, `clientsClaim: true`): the app shell (JS, CSS, HTML, icons,
manifest) is precached, so the installed app opens offline and shows My Cards. The base path comes from `BASE_PATH`
(CI passes the GitHub Pages path; `/` for Cloudflare Pages), normalised by `normalizeBase` in vite.config.ts.

**Updates never reload the app while a kid is using it** (`src/main.tsx`): a new deploy downloads in the background
and waits; it is applied (`updateSW(true)`) when the page goes hidden (Home button, app switcher), except within
5 minutes of tapping a photo input (the photo picker / camera app also hides the page and the photo would be lost);
a closed app gets it on the next cold launch. A resumed app checks for an update at most once an hour.
`clientsClaim` lets the first visit's service worker control the page, so that session's OCR engine and images get cached.

Runtime caches:

| Cache | URLs | Strategy |
|---|---|---|
| `card-data` | `api.tcgdex.net` GET requests (POST GraphQL is not cached; `cache.ts` keeps those results in localStorage) | NetworkFirst, 8 s timeout, 7 days |
| `card-images-opaque` (first rule) | `assets.tcgdex.net` requests made without CORS (`request.mode === 'no-cors'`): pictures whose CORS headers come twice, which browsers reject — every Japanese one and a few English ones (e.g. sv03-125) — so `CardImage` retries them plain. Once a plain retry of a Japanese picture has worked, later `assets.tcgdex.net/ja/` pictures load plain from the start (sessionStorage `cc:jaImgPlain`) | CacheFirst, status 0 only, 60 entries (each opaque response counts several MB of quota), 30 days, purged on quota errors |
| `card-images` | `assets.tcgdex.net` with CORS — `CardImage` loads EN pictures with `crossOrigin="anonymous"` so the responses are cacheable normally | CacheFirst, 600 entries, 30 days |
| `ocr-assets` | tesseract.js worker, core and `eng` data on jsDelivr. The worker loads the engine with `importScripts`, which gives opaque responses, so status 0 is allowed | CacheFirst, 90 days |
| `fonts` | Pretendard stylesheet (loaded with `crossorigin`) and its unicode-range subsets on jsDelivr | CacheFirst, 120 entries, 1 year |

After one online scan the OCR engine works offline; matching the code still needs card data, so offline scans only
find cards that were looked up before. Cards opened online (EN and JA pictures) show their picture offline. TCGplayer
fallback images have no CORS headers and stay in the browser's HTTP cache only.

## Price logic (summary)

* Headline **시세 / Market**: TCGplayer `marketPrice` (fallback `midPrice`) for the selected variant; if no TCGplayer data,
  Cardmarket `trend` (fallback `avg30`, `avg`, `avg7`) converted EUR→USD and flagged `converted` (shown as approximate —
  "약 4,760원" in the Korean UI with won, "≈ $3.50" / "≈ ₩4,760" otherwise — in the hero, its low/high, saved cards,
  Recent and totals). Korean UI + won writes amounts the Korean way everywhere: "4,760원", "198만 원".
* **Low / high** — labelled by what they are. TCGplayer: "지금 파는 최저가 / Lowest for sale now" (`lowPrice`, ≤ market)
  and "최고가 / Highest" (`highPrice` unless it is above 3× market; then the largest of mid, Direct low and Cardmarket's
  averages that is itself ≤ 3× market, else market). Cardmarket: one "요즘 거래 가격 / Recent prices" label over the
  min/max of the recent averages (its raw `low` is a junk listing). The bar between them is a static picture with a
  "시세" tag, not a slider, and is left out ("~") when 시세 sits at one end.
* **Trend**: Cardmarket `avg7` vs `avg30` → `changePct`, only for real moves (see pricing rules); shown as a small grey
  pill "요즘 올랐어요 ▲25%" / "요즘 내렸어요 ▼12%" with only the arrow and number coloured. No pill = no notable move.
* **eBay**: always deep links (auctions ending soonest, Buy It Now lowest price + shipping, sold listings), through the
  grown-up check. With the worker: "지금 살 수 있는 최저가" = lowest Buy It Now **total incl. shipping** with
  "배송비 6,130원 포함" / "무료 배송" / "배송비 별도" (lowestShipping unknown), "보통 가격" = median total of a Best Match sample
  (50 listings; the price-sorted 50 when there is only one page), the caption "미국 eBay 기준 · 한국으로 배송하면 더 비싸요",
  and up to 3 auctions (현재가 / 시작가 **plus shipping** with the same note as Buy It Now — "배송비 1,700원 포함",
  "무료 배송", or the bid alone with "배송비 별도" — so they compare; "입찰 3번" / "아직 입찰 없음", time left; heading "경매 중 약 12개" when eBay counts
  more than came back, hidden when the worker filtered them all). Lots, playsets, repacks and fakes are always dropped,
  graded slabs unless the query names a grader. The worker rate-limits each IP (30/min by default).
