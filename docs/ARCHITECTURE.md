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
  screens/<Name>Screen.tsx (+ .css)  one owner per screen; its parts live in screens/<name>/
  data/pokemon-names.json, en-sets.json   generated data (scripts/)
worker/                          optional eBay proxy (Cloudflare Worker) (ebay)
scripts/build-names.mjs, build-en-sets.mjs   data generators (npm run names / en-sets)
.github/workflows/deploy.yml     GitHub Pages deploy                   (ebay/infra)
```

Screens import from `lib/` and `components/` only, with one exception: the Collection grid reuses
`screens/card/format.ts` (`variantLabel`) so variant names read the same as on the Card screen.

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
| `/card/<lang>/<id>` | Result screen: price hero, low/high, trend, variant picker, eBay, add to My Cards. `?from=scan` (set by the Scan screen) fires confetti for Rare-or-better |
| `/collection` | My Cards: total value, list, refresh prices |
| `/settings` | UI language, currency, default search language, optional eBay worker URL (label exactly "eBay 워커 주소" / "eBay worker URL": worker/README.md points parents to it), data credits |

## Module APIs

### lib/cache.ts
```ts
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, opts?: { persist?: boolean }): Promise<T>;
//   memory Map + localStorage ("cc:cache:" prefix, persist defaults true); concurrent calls share one fn(); rejections not cached;
//   storage errors ignored (quota → prunes expired entries once, then memory only).
export function peekCached<T>(key: string): T | undefined;   // last stored value even if expired ("last known" fallbacks)
export function clearCache(prefix?: string): void;
export class HttpError extends Error { readonly status: number }
export function fetchJson<T>(url: string, opts?: { timeoutMs?: number /* 12000 */; retries?: number /* 2 */; init?: RequestInit }): Promise<T>;
//   AbortController timeout; retries network errors/timeouts and HTTP 5xx with 400ms, 1200ms backoff; 4xx → HttpError (404 → .status 404).
```

### lib/fx.ts
```ts
export interface Rates { EUR: number; KRW: number; fetchedAt: string }   // units per 1 USD
export const FALLBACK_RATES: Rates;
export function getRates(): Promise<Rates>;          // cached 12h, never throws (falls back)
export function getRatesSync(): Rates;               // last known (memory/localStorage, even if stale) or fallback; stable reference
export function eurToUsd(eur: number, rates?: Rates): number;
export function useRates(): Rates;                   // React hook: getRatesSync() first, re-renders when getRates() resolves
// Sources: open.er-api.com/v6/latest/USD → api.frankfurter.dev (base=USD) → FALLBACK_RATES {EUR 0.8957, KRW 1359}.
// After both providers fail, getRates() answers from getRatesSync() for 5 min without refetching.
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
//   'ko' reads ja. rarity "None" dropped; setOfficialCount undefined for promo sets (0);
//   imageFallback = TCGplayer CDN 400w image of the first variant's tcgplayer product id. 404 → HttpError status 404.
export function searchCards(query: string, lang: CardLang, limit?: number /* 60 */): Promise<CardBrief[]>;
//   query may be a name in ANY of ko/ja/en (translated through names.ts to `lang`, keeping "ex"/"V"… suffixes), or a printed
//   code like "084/187", "sv8a 084", "SV8a-084", "PAR 123", "085/SV-P" (→ findByCode over ja+en). Raw text is also queried
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
export function valueTier(usd: number | null | undefined): ValueTier;  // common <$1, nice <$5, rare <$25, super <$100, treasure ≥$100
export function formatMoney(usd: number | null | undefined, currency: DisplayCurrency, rates?: Rates, opts?: { approx?: boolean }): string; // "$12.34", "₩16,500", "—"
//   USD: cents below $1,000, whole dollars above ("$1,234"). KRW: rounded to ₩10 below ₩10,000, to ₩100 above. approx → "≈ " prefix.
// Variant rules (buildVariants): keys "normal" | "holo" | "reverse" | "<type>-<foil>" | "firstEdition", "-<subtype>" added on
//   collisions. A variant with no own pricing borrows the card's top-level pricing — except special foils (pokeball/masterball…)
//   and 1st edition, which are separate products and stay unpriced. Plain reverse reads Cardmarket "-holo" fields and TCGplayer
//   "reverse-holofoil". defaultVariant: "normal" if priced, else first priced, else first.
// summarize: TCGplayer (market ?? mid; high only if ≤ 3× market, else max(mid, market)) else Cardmarket EUR→USD
//   (market = trend ?? avg30 ?? avg ?? avg7; low/high = min/max of avg1, avg7, avg30, trend (+avg for high)). changePct =
//   Cardmarket avg7 vs avg30. Money rounded to cents; null when there is no headline number.
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
export function fileToBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement>;   // picked photo, EXIF-upright (<img> fallback)
export function canvasToDataUrl(canvas: HTMLCanvasElement, maxW?: number /* 320 */, quality?: number /* .8 */): string; // JPEG
export function releaseCanvas(canvas: HTMLCanvasElement): void;   // free canvas memory now (iOS has a hard budget)
//   also: CARD_ASPECT, CODE_STRIP, NAME_STRIP, grayscale/contrastStretch/threshold/negate/shear/pad, coverToSource,
//   centerCardRect, cardSourceRect, clipRect, cropRegion, upscaleTo, readPixels, pixelsToCanvas (used by ocr.ts / tests).

// parseCode.ts — pure
export interface ParsedCode extends PrintedCode { score: number }   // 0..1 confidence, weights the vote across passes
export interface ParseOptions { knownSetIds?: readonly string[]; knownEnAbbrs?: readonly string[] }
export function parsePrintedCode(rawText: string, opts?: ParseOptions): ParsedCode;  // "G sv8a 084/187" → {setCode:"SV8a", number:"084", total:"187", lang:"ja"}
export function mergeParses(parses: ParsedCode[]): ParsedCode;

// ocr.ts — one long-lived tesseract worker; engine + eng data (~4.5 MB) from cdn.jsdelivr.net, cached by the service worker
export function preloadOcr(): Promise<void>;                 // call when the Scan screen opens; idempotent, never rejects
export function readCodeStrip(card: HTMLCanvasElement, opts?: { onProgress?: ProgressFn; shouldStop?: (merged: ParsedCode, parsed: ParsedCode[]) => boolean | Promise<boolean>; parse?: ParseOptions }): Promise<{ passes: { text: string; parsed: ParsedCode }[]; merged: ParsedCode }>;
export const CODE_PASSES: readonly CodePass[];               // the passes, best first (the Scan screen shows i/6 progress)
//   Up to 6 preprocessing passes over the collector-line strip (bottom-left 55% × 10%), voted together. Never throws.

// identify.ts
export function identifyCard(card: HTMLCanvasElement, onProgress?: ProgressFn, opts?: { langHint?: CardLang }): Promise<IdentifyResult>;
//   card = cropToCard output. Never throws; candidates [] when nothing was read or matched (offer typed search).
//   Stops early once two passes agree and resolveSets gives exactly one set. 1–3 s on desktop, expect 2–4× on phones.
//   langHint 'ko' turns a JA-style code into code.lang 'ko' (OCR cannot see Hangul); lookups still go to 'ja'.
//   A single misread pass can still win (e.g. 054 for 084): never navigate on a lone candidate without the check below.

// screens/scan/scanCard.ts — the Scan screen's policy on top of identifyCard
export function scanCard(card: HTMLCanvasElement, onProgress: ScanProgress): Promise<ScanOutcome>; // { code, candidates, sure }
//   sure = exactly one candidate whose number matches and whose printed set code names that set with a matching total
//   (resolveSets score 1). Sure → open the card directly (replace, ?from=scan). Not sure → one automatic second look at a
//   resampled copy (+≈1.5 s), then "Is this your card?" (one candidate: side by side with the kid's photo), then the number
//   form, pre-filled with what OCR read and showing an enlarged crop of the number strip.
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
export function ebayQuery(card: Pick<CardDetail, 'name' | 'lang' | 'localId' | 'setId' | 'dexIds' | 'setName' | 'setOfficialCount'>): string;
export function ebayLinks(query: string): { all: string; auctions: string; buyNow: string; sold: string };
export function fetchEbaySummary(workerUrl: string, query: string, signal?: AbortSignal): Promise<EbaySummary>;
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
//   priceUsd (and firstPriceUsd when new) = that variant's summary.market; keeps imageFallback + dexIds.
export function removeFromCollection(key: string): void;                       // also drops its thumb
export function setQuantity(key: string, qty: number): void;                    // floors, max 999, ≤ 0 removes
export function updateCollectionPrice(key: string, priceUsd: number | null): void; // firstPriceUsd filled if it was null
export function setCollectionThumb(key: string, dataUrl: string): void;        // user's photo for a saved card ("cc:thumbs")
export function useCollectionThumbs(): Readonly<Record<string, string>>;       // collection key → photo data URL
export function rememberScanPhoto(cardId: string, dataUrl: string): void;      // memory only, last 10 (Scan → Card screen)
export function getScanPhoto(cardId: string): string | undefined;
export function useHistory(): HistoryItem[];                                   // newest first, max 20, one per card
export function pushHistory(card: CardDetail, priceUsd: number | null): void;
export function clearHistory(): void;
export function useSnapshots(): ValueSnapshot[];                               // oldest first, one per local day, max 120
export function recordSnapshot(totalUsd: number): void;                         // upsert today's snapshot
export function collectionTotalUsd(items: CollectionItem[]): number;            // Σ priceUsd × qty, cents
export function resetAllData(): void;                                           // all keys above + settings + scan photos + clearCache()
// Keys "cc:settings", "cc:collection", "cc:history", "cc:snapshots", "cc:thumbs", each { v: 1, data }; unreadable,
//   foreign-version or malformed entries fall back to defaults (bad items are dropped individually). Thumbs live in
//   their own key so a full quota can only cost photos (then only the newest that fit are saved); pass small JPEGs (~200px wide).
// Settings default: { uiLang: navigator.language startsWith 'ko' ? 'ko' : 'en', currency: 'USD',
//   searchLang: uiLang === 'ko' ? 'ja' : 'en', ebayWorkerUrl: '', theme: 'system' }
// The search screen offers EN / 日本語 chips; Korean cards are found through 日本語 (same set codes).
// Photo flow: Scan screen rememberScanPhoto(card.id, photo) → Card screen getScanPhoto(id) as CardImage `photo`
//   → on "Add to My Cards" setCollectionThumb(addToCollection(card, variant), photo) (shrunk to 200px wide; first add of
//   a card without a TCGdex picture only).
// Snapshots: Home (My Cards panel) and My Cards call recordSnapshot(collectionTotalUsd(items)) whenever the list is not
//   empty, so "since last week" has data even if the kid only opens Home.
// Not managed here: "cc:scanTipsSeen" (CameraView's first-time tips, kept by resetAllData) and "cc:cache:*" (cache.ts).
```

### Small shared helpers (lib)
```ts
// localName.ts — a card name in the UI language when there are no dexIds (search results, some new JA cards):
export function nameInUiLang(name: string, lang: UiLang): string | undefined;  // "ルチャブル" → "루차불"; trainers → undefined
// weekChange.ts — the "since last week" number on Home and My Cards:
export function weekChange(snapshots: readonly ValueSnapshot[], totalUsd: number, today: string): { deltaUsd: number; days: number } | null;
//   against the earlier snapshot closest to 7 days before today (the older one on a tie); days < 7 while the app is new.
export function todayLocal(d?: Date): string;                                   // "YYYY-MM-DD", the snapshot date format
// useOnline.ts
export function useOnline(): boolean;                                           // navigator.onLine, re-renders on change
```

UI building blocks (components, CSS classes, copy tone): see [UI-KIT.md](UI-KIT.md).

## PWA & offline

`vite-plugin-pwa` (generateSW, `registerType: 'autoUpdate'`): the app shell (JS, CSS, HTML, icons, manifest) is
precached, so the installed app opens offline and shows My Cards. Runtime caches:

| Cache | URLs | Strategy |
|---|---|---|
| `card-data` | `api.tcgdex.net` GET requests (POST GraphQL is not cached; `cache.ts` keeps those results in localStorage) | NetworkFirst, 8 s timeout, 7 days |
| `card-images` | `assets.tcgdex.net` — `CardImage` loads these with `crossOrigin="anonymous"` so the responses are cacheable (opaque ones are not) | CacheFirst, 600 entries, 30 days |
| `ocr-assets` | tesseract.js worker, core and `eng` data on jsDelivr. The worker loads the engine with `importScripts`, which gives opaque responses, so status 0 is allowed | CacheFirst, 90 days |
| `fonts` | Pretendard stylesheet (loaded with `crossorigin`) and its unicode-range subsets on jsDelivr | CacheFirst, 120 entries, 1 year |

After one online scan the OCR engine works offline; matching the code still needs card data, so offline scans only
find cards that were looked up before. TCGplayer fallback images have no CORS headers and stay in the browser's HTTP
cache only.

## Price logic (summary)

* Headline **시세 / Market**: TCGplayer `marketPrice` (fallback `midPrice`) for the selected variant; if no TCGplayer data,
  Cardmarket `trend` (fallback `avg`, `avg7`, `avg30`) converted EUR→USD and flagged `converted` (shown with "≈").
* **Low**: TCGplayer `lowPrice` / Cardmarket `low`. **High**: TCGplayer `highPrice` after sanity filtering
  (TCGplayer often reports placeholder highs such as 999 for $0.10 cards); Cardmarket has no high → max of
  avg1/avg7/avg30/avg.
* **Trend**: Cardmarket `avg7` vs `avg30` (or avg1 vs avg7) → `changePct`.
* **eBay**: always deep links (auctions ending soonest, Buy It Now lowest first, sold listings). With the worker:
  live lowest Buy It Now, auction count and current bids.
