# CardCheck — Architecture & module contracts

A free, kid-friendly Pokémon card **scanner + price checker**. Static PWA (Vite + React + TypeScript),
hosted on GitHub Pages, installable on iPhone via *Share → Add to Home Screen*. No backend is required;
an **optional** Cloudflare Worker (`/worker`) unlocks live eBay listing prices.

## Data sources (all free)

| What | Source | Notes |
|---|---|---|
| Card data, images, set lists (EN / JA / KO) | [TCGdex API](https://tcgdex.dev) `https://api.tcgdex.net/v2/{lang}/…` | No key, CORS `*` |
| Prices, English cards | TCGdex `pricing` → **TCGplayer** (USD) and **Cardmarket** (EUR) | Converted to USD for display |
| Prices, Japanese cards (and Korean cards, which read the Japanese data) | **TCGplayer** (USD) from our own daily files `data/tcgplayer-ja/s/<set>.json`, built in CI from [tcgcsv.com](https://tcgcsv.com) (a free daily mirror of TCGplayer; category 85 = Pokémon Japan); TCGdex's **Cardmarket** block is the fallback | One product per printing (normal / mirror / Master Ball mirror …). See "Japanese card prices" |
| Currency rates | `open.er-api.com` → `api.frankfurter.dev` → jsDelivr `@fawazahmed0/currency-api` | CORS `*`, 3.5 s each, no retry, cached 12h (kept as "last known"), hard-coded fallback |
| Pokémon names KO/JA/EN | `src/data/pokemon-names.json` generated from PokeAPI CSV (`npm run names`) | `[dexId, en, ko, ja][]` |
| EN set abbreviations | `src/data/en-sets.json` generated from TCGdex (`npm run en-sets`) | `[{id, abbr, official, total, name, releaseDate}]` — printed "PAR EN 123/182" → `sv04` |
| OCR | `tesseract.js` (runs on-device, eng data from CDN, cached by the service worker) | |
| eBay | Deep links (always) + optional Worker using eBay Browse API (active auctions / Buy It Now) | Worker prices are eBay US totals incl. shipping to where the kid lives: US ZIP 10001, or Seoul 04524 with `&country=KR` (then only listings that ship to Korea) |

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
  lib/region.ts                  where the kid lives (US / KR) → money (lead)
  lib/router.ts                  in-memory router (URL never changes)  (ui-foundation)
  lib/store.ts                   settings / collection / history       (ui-foundation)
  lib/localName.ts, weekChange.ts, useOnline.ts   small helpers shared by several screens (see below)
  components/*                   shared UI components                  (ui-foundation)
  components/ExternalLink.tsx, grownUpGate.ts   every link to a shop goes through the grown-up check
  screens/<Name>Screen.tsx (+ .css)  one owner per screen; its parts live in screens/<name>/
  data/pokemon-names.json, en-sets.json   generated data (scripts/)
worker/                          optional eBay proxy (Cloudflare Worker) (ebay)
scripts/build-names.mjs, build-en-sets.mjs   data generators (npm run names / en-sets)
scripts/build-ja-prices.mjs (+ .test.mjs, fixtures/)   daily TCGplayer price files for Japanese cards (npm run ja-prices)
public/data/tcgplayer-ja/        those files (git-ignored; built in CI, copied into dist)
.github/workflows/deploy.yml     GitHub Pages deploy                   (ebay/infra)
```

Screens import from `lib/` and `components/` only, with these exceptions:
- `screens/card/format.ts`: the Collection grid reuses `variantLabel` so variant names read the same as on the Card
  screen, and every card name outside the Card screen uses `cardNames` so it reads in the same order as the Card title
  (`collection/itemName.ts`, `home/RecentCards.tsx`, `SearchScreen.tsx` result tiles, `scan/CandidatePicker.tsx`).
- `screens/collection/useRefreshPrices.ts`: Home's My Cards panel reuses the shared background price refresh.
- `screens/search/examples.ts`: Home's scan tip and search hint use the Search screen's per-country number examples.

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
| `/card/<lang>/<id>` | Result screen (layout below): art, name, chips, printing tiles, price panel (시세 + low/high), add to My Cards, eBay, More prices. `?v=<variantKey>` opens on that printing (links from My Cards, Best card and Recent carry it; an unknown key falls back). `?from=scan` (set by the Scan screen) fires confetti for 용돈 카드 or more ($5 / 5,000원, in the money shown) and may show the "shiny card?" toast |
| `/collection` | My Cards: total value, since last week, best card, cards by price, grid (edit mode), refresh prices |
| `/settings` | Where you live (🇺🇸 / 🇰🇷: sets the money and search language), UI language, money (follows the country; a grown-up can override it), theme, default search language, optional eBay worker URL (label exactly "eBay 워커 주소" / "eBay worker URL": worker/README.md points parents to it), install guide, reset, data credits |

### Card screen layout
Top to bottom. The kid picks the printing first, then reads its price; both are in the first view on every phone.
The details (tile sizes, names, copy) are in [UI-KIT.md](UI-KIT.md#card-screen-printings-and-the-price-panel).
1. Card art — sized so the price fits the first view: `useFitArt` (CardScreen.tsx) measures everything from the page top to
   the end of the elements marked `FOLD_ATTR` (the big price, the low–high row and the eBay hint; in the no-price panel
   its eBay button) except the art itself, and hands it to CSS as `--card-fold-h`; `.card-art` takes the height that is
   left above the tab bar and the raised Scan button (at least `--card-art-min` = 92 px wide, up to 46% of the width /
   220 px on tall phones). The panels of the card's **other** printings are rendered too, invisible and out of the flow
   (`.card-price-ghost`), and count in the measurement: the art is sized once for the tallest panel, so the tiles never
   move under a finger. The number only goes up for a card and starts over when the width changes. When the art is at
   its minimum and the page still doesn't fit, `data-tight="1"` (then `"2"`) on the body lets CSS drop a line: one-line
   tile names and price label, a shorter trend pill, then no printed-name subtitle (all still read by screen readers).
   Tap the art to zoom (Sheet). With no picture, `CardImage code` prints set + number on the card back.
   The real panel is `.card-price-slot > .card-price` (`querySelectorAll('.card-price')` also finds the invisible ones).
2. Title: the name in the UI language for JA/KO cards ("루차불" / "Hawlucha") with the printed name under it
   ("ルチャブル"); EN cards keep the English name (+ Korean name under it in the Korean UI). `format.cardNames`.
3. One chip row: flag (language read by screen readers) + set name + `printedNumberOf(card)` ("#084/187", "#TG05/TG30",
   "#085"), plus the rarity in Korean in the Korean UI (`rarityLabel`).
4. `VariantPicker` (only with two or more printings): one row of tiles, each a `<button aria-pressed>` with the short
   name over its price ("Normal $0.18 · Poké Ball $0.60 · Master Ball $2.27"), in the order of `card.variants` (most
   common first). Four or more printings scroll sideways inside the row. Names come from `format.variantLabel` /
   `variantShortLabel` with `{ cardLang, siblings }`: the plain mirror of a Japanese / Korean card is "Mirror" / "미러",
   or "Poké Ball mirror" / "몬스터볼 미러" when the card also has a special pattern (SV8a, M2a); "Reverse Holo" is for
   English cards only. The screen opens on `printing.startVariant`: the `?v=` printing, else the one printing of this
   card the kid saved, else `card.defaultVariant`.
5. `PriceHero` for the picked printing: tier cheer on the panel edge, "시세 · {printing}" with the optional calm trend
   pill ("요즘 올랐어요 ▲25%"), the big `Money` (second currency under it), the low–high row, the source line
   ("TCGplayer · 20시간 전 확인" / "TCGplayer · checked 20h ago": the time the price was read, not when it last
   changed), and a small "eBay 가격은 아래에 있어요 ↓" button that scrolls to the eBay panel and focuses its heading.
   The hint is part of the fold: drawn under the source line on tall phones, right under the low–high row on phones
   ≤ 800px tall (CSS `order`).
   Range labels (`format.rangeView`): "지금 파는 최저가" … "최고가" only when both ends are TCGplayer's own lowest and
   highest listing; otherwise one "보통 가격" / "Usual prices" label (a junk-low or sky-high listing was left out, or
   the numbers are Cardmarket averages). Between the two numbers a static bar with a small "시세" / "Market" tag
   (`format.rangeMarker`); when 시세 is within 2% of an end, or low = high, no bar: just "4,760원 ~ 9,000원".
   Special states: an asking price (`summary.asking`: listings but no recent sales) is titled "파는 사람이 부른 가격" /
   "Asking price" and shown with 약 / ≈; a mixed mirror price (Cardmarket's one number for all mirror patterns,
   `printing.isMixedMirror`) says so in the source line; a printing without a price shows the no-price panel ("아직
   가격이 없어요", plus "이 무늬는 드물어요…" for a rare pattern) with a button to the eBay panel.
   On the Korean route (`lang === 'ko'`) every price is approximate (the data is the Japanese card's).
6. Notes: "일본판 카드 가격이에요. 한글판은 다를 수 있어요." on the Korean route, then `VariantHelp`: the line "가격은
   반짝이 무늬에 따라 달라요. 구별하는 법 ›" opens the sheet "내 카드는 어떤 거예요?" (our own small drawings, one row per
   printing with how to tell and its price; tapping a row picks it).
7. `CollectButton` (saves the picked printing), then `EbayPanel` (live Buy It Now total incl. shipping + 보통 가격 +
   auctions when the worker is set, and always three tiles: 경매 가격 보기 · 지금 살 수 있는 가격 · 팔린 가격 보기; the
   search words follow the printing, e.g. "master ball"), then the "어른과 함께" disclaimer. Under its heading a
   shipping caption that follows the country, not the UI language (see Country and money › eBay).
   With won, `MorePrices` starts with the rate line "오늘 환율: 1달러 = 1,361원 · 방금 업데이트" (no "오늘" when older than a day).
8. `MorePrices` (closed `<details>`): raw TCGplayer USD / Cardmarket EUR numbers ("Ignored: too low" next to a junk
   low, "No recent sales" on an asking block, "All mirror patterns together" on a mixed block), TCGplayer link, the
   eBay search words.

Measured on the production build in Chromium (38 combinations: 375×667 and 390×844 with iPhone safe areas ×
US/Korean kid × ja/SV8a-084, ja/SV2a-094, ko/SV8a-084, en/base1-4, en/swsh1-10, en/sv03.5-001, en/sv03.5-003 and
en/sv03.5-199, plus three cards without the price files; every tile tapped in turn): the big price, the low–high row
and the eBay hint end above the raised Scan button every time (on the SE the hint ends at y ≈ 571, the limit is 574),
the tiles don't move when another printing is picked, and the point at the centre of every tile is that tile.

The screen also re-converts EUR prices with live rates (`applyRates(card, useRates())`), records history for the
printing on screen (`pushHistory(card, price, approx, variantKey)`, once per pick, so Recent shows what the kid last
looked at), and copies freshly loaded prices onto saved copies of the card (`updateCollectionPrice`; a printing
without a price right now keeps the price it was saved with). After a scan, when the screen shows the usual printing
and a shinier one is worth 3× more (`printing.hasShinyUpgrade`), one toast per session says "반짝이는 카드예요? 무늬를
고르면 딱 맞는 가격이 나와요." (sessionStorage `cc:variantNudged`).

## Country and money

The money follows **where the kid lives**, not the UI language: a Korean-speaking kid in Los Angeles gets Korean screens
with dollars, an English phone in Seoul gets won. `Settings.country: 'US' | 'KR'` sits next to `uiLang` and `currency`
(the currency follows the country but can be overridden).

```ts
// lib/region.ts
export const COUNTRIES: readonly Country[];                      // ['US', 'KR']
export const COUNTRY_FLAG: Record<Country, string>;              // US 🇺🇸, KR 🇰🇷
export const COUNTRY_CURRENCY: Record<Country, DisplayCurrency>; // US USD, KR KRW
export function countryDefaults(c: Country): { currency; searchLang };   // KR → KRW + 'ja' (Korean cards use JA data), US → USD + 'en'
export function readRegionHints(): RegionHints;                  // { timeZone (Intl), languages (navigator.languages) }
export function guessCountry(hints?: RegionHints): { country; confident: boolean; reason: 'timezone' | 'language-region' | 'language' | 'fallback' };
export function detectCountry(hints?: RegionHints): Country;
```

**Detection**, best evidence first:
1. The time zone (where the phone is): `Asia/Seoul` → KR; one of an exact list of US zones (the states and the dollar
   territories, plus `America/Indiana/…`, `America/Kentucky/…`, `America/North_Dakota/…`, `US/…` and the POSIX zones
   `EST5EDT`, `PST8PDT`, `HST`…) → US. Never a plain `America/` prefix: Canada, Mexico and South America live there too.
   Confident.
2. The first language tag with a KR or US region (`ko-KR`, `en-US`; only subtags before the first single-letter one, so
   the extension in `en-u-kr-latn` is not a region). Confident.
3. A bare `ko` → KR, not confident.
4. Otherwise US, not confident.

**Settings** (store.ts):
- First launch: `country` = the guess; `currency` and `searchLang` = `countryDefaults(country)`; `uiLang` still follows
  `navigator.language`. The guess is saved right away, so the country means where the kid was when the app first
  opened: a Seoul kid on holiday in Hawaii keeps seeing won. Settings (or the question below) changes it. A confident
  first guess also marks the question as answered, so it isn't asked abroad either. The save is best effort: plain
  `setItem` (no cache entries dropped during a render), and a saved value this version can't read is left alone.
- Migration: settings saved before `country` existed get the detected country. The old app saved the money and search
  language from the phone's language (Korean phone → won + 日本語, others → dollars + English) and saved the whole object
  whenever any setting changed, so a saved value equal to that old default is dropped for the country's; a different
  value was a real pick and stays. An English phone in Seoul that once changed the theme gets won.
- `updateSettings({ country })` to a different country also resets `currency` and `searchLang` to that country's
  defaults, unless the same patch sets them. A grown-up's money override survives reloads, not a country switch.
- Settings screen: the first field is "사는 곳 / Where you live" (🇰🇷 한국 · 🇺🇸 미국; English 🇺🇸 USA · 🇰🇷 Korea) with
  the note "가격은 원(₩)으로 보여 줘요." / "Prices show in dollars ($)."; then "돈 단위 / Money" (원 (₩) · 달러 ($), the
  country's money first). When the money differs from the country's, the country note hides and the money field says
  "원 대신 달러로 보고 있어요." / "You’re seeing dollars, not won." (`settings/regionOptions.ts`).

**First-launch question** (`home/CountryPrompt.tsx`, on Home only, never over a card or the camera): when
`needsCountryPrompt()` (no confident guess, and `cc:country-asked` unset), a Sheet asks "어디에 살아요? / Where do you
live?" in both languages, with two big buttons: 🇺🇸 미국 · USA ($ 달러 · Dollars) and 🇰🇷 한국 · Korea (₩ 원 · Won).
Picking one calls `updateSettings({ country, currency: COUNTRY_CURRENCY[country] })`: the button names the money, so
it always sets it, even when older saved settings already had that country with the other money; the search language
changes only with a real country change (as in Settings). ×, the backdrop or Escape keeps
the guess (`markCountryAsked`). Focus then goes to Home's heading. At most once per app load even when storage is
blocked. Picking a country in Settings also counts as answering (there a money override survives picking the same
country).

**Money on screen**:
- The main amount is in `settings.currency`. `Money secondary` adds a small line from `secondaryCurrency(currency,
  country)`: under won, the dollar amount (the source prices and eBay are in dollars); under dollars, won only for a kid
  who lives in Korea but switched to dollars. A kid in the US who sees dollars gets no second line: no ₩ anywhere.
- About-amounts: "약 " in the Korean UI for every currency ("약 4,760원", "약 $22.30"), "≈ " in the English UI.
- Tiers follow the money shown (`useValueTier()` in TierBadge → `valueTier(usd, currency, rates)`), comparing the
  amount as shown: USD $1 / $5 / $25 / $100, KRW 1,000원 / 5,000원 / 30,000원 / 150,000원 (coins, a snack, an
  allowance, precious). A $0.80 card is 🍃 동전 카드 in dollars and ⭐ 과자값 카드 as 1,090원. The Card tier and
  confetti, My Cards' tier bar and best card, Recent, and the price badges (locked ones show "5,000원 이상" / "$5+",
  `stats.tierFloorUsd`) all use it.
- With won, More prices starts with today's rate ("오늘 환율: 1달러 = 1,361원 · 방금 업데이트").
- Examples follow the country: Home's scan tip (KR "sv8a 084/187", US "199/165"), its search hint, Search's chips and
  help, and the manual number form (KR "sv8a 084/187", US "MEW 199/165"; `search/examples.ts`). The "한국어 카드는
  日本語에서 찾아요" notes (Search, Settings' search language) show only for Korea or the Korean UI.

**eBay**:
- `fetchEbaySummary(url, q, signal, country)`: Korea adds `&country=KR`; the US adds nothing, so its URL and the worker's
  cache entries are what they were.
- Worker: `country=KR` (any case, trimmed) prices shipping to Seoul (`X-EBAY-C-ENDUSERCTX:
  contextualLocation=country=KR,zip=04524`) and keeps only listings that ship there (filter `deliveryCountry:KR`); any
  other value (missing, `JP`, garbage) is the US (ZIP 10001, filter unchanged). Shipping is the cheapest option, null
  when eBay gives none or gives it in another currency. In Korea an unknown cost (calculated international shipping)
  is usually several dollars, so once at least 3 listings have a known cost, those sort first and alone set `lowest`
  and `median`. With fewer (one pricey listing would decide both), and in the US, listings are ranked by price + known
  shipping and an unknown cost shows as "배송비 별도 / + shipping". The answer echoes `shipTo: 'US' | 'KR'`; the cache key always
  includes `c=US` or `c=KR`, so the two never mix and entries from before the country existed are never served.
- The caption under the panel heading (none while loading): a kid in the US gets none; a kid in Korea whose worker
  answered with `shipTo: 'KR'` gets "한국까지 오는 배송비로 계산했어요" / "Shipping is priced to Korea"; a kid in Korea otherwise (no
  worker, a failure, an empty answer, or an older worker) gets "미국 eBay 가격이에요 · 한국으로 받으면 배송비가 더 들어요" /
  "Prices from eBay US · Shipping to Korea costs extra".
- A country change refetches. Settings' connection test sends the country too; for a kid in Korea whose worker didn't
  echo `shipTo: "KR"` it adds "한국까지 배송비를 보려면 워커를 새 버전으로 다시 배포해 주세요".

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
//   Japanese data also loads the set's TCGplayer price file (tcgplayerJa.getJaSetPrices) in the same Promise.all:
//   it never fails, gives up after 4 s, and without it the card has its Cardmarket prices.
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
export function buildVariants(raw: unknown, rates: Rates, ja?: JaSetFile | null): { variants: CardVariant[]; defaultVariant: string };
//   variants come most common first (the order the picker shows); keys are given in API order before sorting.
//   ja: the set's TCGplayer-Japan file (lib/tcgplayerJa.ts), Japanese cards only — see "Japanese card prices".
export const isApproxPrice: (summary) => boolean;   // converted (Cardmarket, euros) or asking (TCGplayer listings, no sales)
export function summarize(tcg: TcgplayerPrice | null | undefined, cm: CardmarketPrice | null | undefined, rates: Rates, updated?: string): PriceSummary | null;
export function applyRates<T extends { variants: CardVariant[] }>(card: T, rates: Rates): T;  // re-summarizes every variant with new rates
export function valueTier(usd: number | null | undefined, currency?: DisplayCurrency /* 'USD' */, rates?: Rates): ValueTier;
//   In the money shown: USD common <$1, nice <$5, rare <$25, super <$100, treasure ≥$100; KRW common <1,000원,
//   nice <5,000원, rare <30,000원, super <150,000원, treasure ≥150,000원. Compares the amount as formatMoney shows it.
//   Screens never call it directly: TierBadge's useValueTier() passes settings.currency and live rates.
//   Shown as 동전 / 과자값 / 용돈 / 귀한 / 보물 카드 (Pocket change / Snack money / Allowance / Prized / Treasure).
export function formatMoney(usd: number | null | undefined, currency: DisplayCurrency, rates?: Rates, opts?: { approx?: boolean; lang?: UiLang }): string;
//   "$12.34", "₩16,500", "—". USD: cents below $1,000, whole dollars above ("$1,234"). KRW: rounded to ₩10 below ₩10,000,
//   to ₩100 above. approx → "≈ " in the English UI; the Korean UI writes "약 " for every currency ("약 4,760원",
//   "약 $22.30"). KRW with lang 'ko' is written the Korean way: "4,760원", "123,400원", and from 1,000,000원 compact
//   "198만 원" / "1억 2,000만 원". Money passes the UI language, so the Korean UI never shows "₩" or "≈" (English UI with
//   won: "≈ ₩4,760"). This is the only place money is rounded (valueTier shares its rounding).
// Variant keys (buildVariants): "normal" | "holo" | "reverse" | "firstEdition", then "-<foil>" ("reverse-masterball"),
//   "-<subtype>" ("holo-shadowless"; "unlimited" is left out), "-<size>" ("normal-jumbo") and "-stamp-<stamps>"
//   ("reverse-stamp-gamestop", "normal-stamp-poketour-99"); "-2", "-3" only for true duplicates. CardVariant also
//   carries stamp / subtype / size. A variant with no own pricing borrows the card's top-level pricing — except
//   separate products (special foils, 1st edition, stamped, jumbo), which stay unpriced. Plain reverse reads Cardmarket
//   "-holo" fields and TCGplayer "reverse-holofoil".
// defaultVariant: the most common printing that has a price — normal > holo > other regular printings (shadowless…) >
//   1st edition > reverse > special foils > stamped/jumbo — else the most common one.
// summarize: TCGplayer when it has market ?? mid (a block marked `asking` gives its mid and marks the summary
//   `asking`: listings without recent sales, shown as an approximate "asking price", no trend badge).
//   low = the smaller of low and mid that lies between a third of market and market, else market (a lone 1-cent
//   listing is not what the card costs: "$0.01 – $0.15" for a 10-cent card); high = TCGplayer high if ≤ 3× market
//   (HIGH_MAX_RATIO), else the largest of mid, directLow and Cardmarket avg / avg30 / trend in USD that is itself
//   ≤ 3× market (each checked on its own, so one spiky average doesn't hide a sane trend); market when none passes;
//   always ≥ market.
//   Else Cardmarket EUR→USD (converted): market = trend ?? avg30 ?? avg ?? avg7, except a junk trend (under ⅓ of the
//   median of avg1/avg7/avg30, or over 3× all of them: cheap JA cards, SV8a-092 €0.02 trend vs €0.18–0.30 sales) →
//   avg7 ?? avg30; when the averages look like placeholders (avg null, avg7 = avg30 = avg1) and even Cardmarket's
//   cheapest copy (low ≥ €1) is over 3× them, nobody sells near them (€0.25 on some Poké Ball / Master Ball reverse
//   products, SV2a-104 vs a €40 low) → market = low;
//   low/high = min/max of avg7, avg30, the checked trend and market (+avg for high), each only within 3×
//   of market either way; avg1 (often one sale) is left out — Cardmarket's raw "low" is a junk listing. The TCGplayer
//   path's high fallback also uses the checked trend.
//   changePct = Cardmarket avg7 vs avg30, only when market ≥ $2, avg30 ≥ €1, 10% ≤ |move| ≤ 100%, and (TCGplayer
//   headline) Cardmarket's price is within 0.5–2× of it; else null. null without a headline. Amounts are exact USD, never
//   rounded to cents (€0.04 = $0.0447 → "약 60원", not the 50원 a rounded $0.04 gives); only formatMoney rounds.
//   valueTier compares the amount as shown (whole cents; 10/100-won steps).
//   Every "within 3×" test forgives float rounding (exactly 3× counts: 0.15 × 3 is 0.4499… in floats).
```

### lib/tcgplayerJa.ts — Japanese card prices

TCGdex has no TCGplayer prices for Japanese cards, only the product id of some printings, so the prices come from our
own files (see "Daily price files" under PWA & offline).

```ts
export type JaRow = [market, low, mid, high];                        // USD, null = no data
export type JaProduct = [number: string, tags: string, rows: Record<string, JaRow>];
export interface JaSetFile { v: 1; d: string /* when TCGplayer's prices were taken */; k: string; g: JaGroup[] }
export function setKey(setId: string): string;                       // "SV8a" → "sv8a", "SM1+" / "SM1p" → "sm1p"
export function getJaSetPrices(setId: string): Promise<JaSetFile | null>;
//   `${BASE_URL}data/tcgplayer-ja/s/<key>.json`, 4 s timeout, no retries, memory cache 6 h. Never rejects. null:
//   no file (404, or the app's HTML with status 200 on SPA hosts and `npm run dev`; remembered), a file older than
//   7 days, a network error (tried again next time), no page address (node tests).
export function matchJaVariants(localId, variants: JaVariantRef[], file): (JaMatch | null)[];   // pure
```

How one printing of a Japanese card gets its price (`tcgdex.getCard` loads the set file next to the card;
`pricing.buildVariants` asks `matchJaVariants`):

1. **Product.** (a) TCGdex's own TCGplayer id, when it is in the file (an id that is not there is a product without
   prices: nothing else is tried). (b) Otherwise card number + printing: the product whose number equals the card's
   (leading zeros and case ignored) and whose name tag says the same printing — no tag = the base card, "Mirror Foil" /
   "Mirror Holo(foil)" = plain mirror, "Master Ball Pattern" = masterball, "Poke Ball Pattern" = pokeball, "Energy Symbol
   Pattern" = energy, "<X> Ball Pattern" = `<x>ball`, "Team Rocket Pattern" = team-rocket; other brackets belong to the
   card's name — only when exactly one product fits and the card has one variant of that kind. (c) For a plain mirror
   only: the one product with that number that is not the base card and is still unclaimed (M2a lists a "reverse"
   where TCGplayer sells a "Poke Ball Pattern"). A product is never given to two variants. Half of the Japanese sets
   (SV2a, M2a, SV9a, the Sun & Moon era …) have no ids in TCGdex and are priced through (b).
2. **Row.** A Japanese product is one printing, so any of its rows is the right card; the order only prefers the
   likelier one (holo-ish: holofoil, unlimited-holofoil, normal …; plain: normal, unlimited, holofoil …; 1st-edition
   stamps: the 1st-edition rows first). A row without a market price gives way to its normal/holofoil twin that has one.
3. **Price.** Market price present → an exact TCGplayer price (`source: 'tcgplayer'`, `updated` = the file's time).
   No market price (listings, no recent sales): the variant's own Cardmarket price stays if it has one; otherwise the
   asking price is shown as approximate (`asking`): the middle listing, or the cheapest when the middle is over 3× it
   and it is at least $5; a lone listing of $100 or more is no price at all.
4. **Cardmarket next to it.** A variant's own Cardmarket block is kept (trend badge, More prices). The card-level
   "-holo" block a plain mirror borrows is dropped once the mirror has its own TCGplayer product: it averages every
   mirror pattern together (2.1× the plain mirror's price in SV8a).
5. **Fallback.** No file, no product, or no usable row → exactly the Cardmarket logic below (a plain mirror then
   shows the mixed "-holo" number, labelled "all mirror patterns together"; a Master Ball mirror has no price).

Measured on 3,341 cached cards of 22 sets: 793 printings go from "No price" to priced (223 Master Ball mirrors), none
lose a price, 1 default printing changes. No cross-check against Cardmarket for market-priced rows: on cheap cards the
two markets differ by 3× for honest reasons, and above $25 nearly every disagreement is a Cardmarket placeholder.

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
//   Extra tries stop starting 10 s after the first look ends while no number was read, 8 s once one was (the confirming
//   second look still starts until 10 s, so a slow phone can still open a sideways card directly), and end when two
//   looks read the same number with a fitting total and found the same two or more cards (`agreed`; never makes a scan
//   sure). Worst case before the number form: first look + 10 s + the try still running. A total read short ("084/18") is looked up again with the longer
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
export function ebayQuery(card: EbayCard, variantKey?: string): string;
//   variantKey: a JA/KO Master Ball mirror ("reverse-masterball…") adds "master ball" ("Hawlucha sv8a 084/187 master
//   ball Japanese"), the one pattern sellers name the same way; other printings change nothing.
//   EN "Lopunny 084/131 Prismatic Evolutions"; subsets use the parent set ("Zekrom TG05/TG30 Brilliant Stars");
//   EN promos "Pikachu with Grey Felt Hat 085 promo", "Galarian Moltres SWSH284" (never "Black Star Promos");
//   JA "Hawlucha sv8a 084/187 Japanese", promos "Pikachu 085/SV-P Japanese"; JA/KO trainers "sv8a 232/187 Japanese"
//   ("pokemon" only when there is no total). Korean route → "Korean".
export function ebayLinks(query: string): { all: string; auctions: string; buyNow: string; sold: string };
export function fetchEbaySummary(workerUrl: string, query: string, signal?: AbortSignal, country?: Country): Promise<EbaySummary>;
//   10 s timeout; non-2xx → HttpError (worker: 400 missing_q / q_too_long, 403 origin_not_allowed, 429 rate_limited,
//   500 not_configured, 502 ebay_unavailable) — callers fall back to the links. buyNow.lowest / median are totals incl.
//   shipping; lowestShipping is passed through when the worker sends it (older workers: absent).
//   country 'KR' adds `&country=KR`; 'US' / undefined add nothing (same URL and worker cache key as before).
//   shipTo is always set: 'KR' only when the worker echoed exactly "KR", else 'US' (older workers included).
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
//   A different `country` also resets currency and searchLang to countryDefaults(country) unless the same patch sets
//   them, and marks the country question answered.
export function needsCountryPrompt(): boolean;   // no confident guess (region.guessCountry) and "cc:country-asked" unset
export function markCountryAsked(): void;        // the question was answered or dismissed (the guess is kept)
export function useCollection(): CollectionItem[];                             // newest first
export function collectionKey(card: Pick<CardBrief, 'lang' | 'id'>, variantKey: string): string; // `${lang}:${id}:${variant}`
export function addToCollection(card: CardDetail, variantKey: string): string; // returns the key; qty+1 if present;
//   priceUsd (and firstPriceUsd when new) = that variant's summary.market, priceApprox = summary.converted; keeps
//   imageFallback + dexIds. The first call asks navigator.storage.persist() (best effort).
export function removeFromCollection(key: string): void;                       // also drops its thumb
export function setQuantity(key: string, qty: number): void;                    // floors, max 999, ≤ 0 removes
export function updateCollectionPrice(key: string, priceUsd: number | null, approx?: boolean): void; // firstPriceUsd filled if null
//   A null price changes nothing (not even the check time). An approximate price (Cardmarket, or an asking price)
//   does not replace an exact one saved less than 7 days ago (a failed price-file fetch must not turn $0.18 into
//   ≈ $0.03). When the price switches between exact and approximate (two markets), the card starts over:
//   firstPriceUsd = the new price and the card leaves the snapshot baselines, so gain/loss and "since last week"
//   don't show the switch as a price move.
export function onCollectionSaveFailed(listener: () => void): () => void;
//   Fires when a change to My Cards could not be written even after writeWithRoom freed cache space (App shows a
//   "couldn't save" toast, at most once a minute). The change still shows until the app is closed.
export function setCollectionThumb(key: string, dataUrl: string): void;        // user's photo for a saved card ("cc:thumbs")
export function useCollectionThumbs(): Readonly<Record<string, string>>;       // collection key → photo data URL
export function rememberScanPhoto(cardId: string, dataUrl: string): void;      // memory only, last 10 (Scan → Card screen)
export function getScanPhoto(cardId: string): string | undefined;
export function useHistory(): HistoryItem[];                                   // newest first, max 20, one per card
export function pushHistory(card: CardDetail, priceUsd: number | null, approx?: boolean, variantKey?: string): void;
//   approx → HistoryItem.priceApprox; variantKey → HistoryItem.variant (the printing the kid looked at; Recent reopens on it)
export function clearHistory(): void;
export function useSnapshots(): ValueSnapshot[];                               // oldest first, one per local day, max 120
export function recordSnapshot(items: readonly CollectionItem[]): void;          // upsert today's total + per-card [usd, qty] (no-op when unchanged)
export function collectionTotalUsd(items: CollectionItem[]): number;            // Σ priceUsd × qty (not rounded to cents; 1/100 cent against float noise)
export function resetAllData(): void;                                           // all keys above + settings + scan photos + clearCache()
// Keys "cc:settings", "cc:collection", "cc:history", "cc:snapshots", "cc:thumbs", each { v: 1, data }; unreadable,
//   foreign-version or malformed entries fall back to defaults (bad items are dropped individually). Thumbs live in
//   their own key so a full quota can only cost photos (then only the newest that fit are saved); pass small JPEGs (~200px wide).
// Settings default: { uiLang: navigator.language startsWith 'ko' ? 'ko' : 'en', country: guessCountry().country,
//   ...countryDefaults(country) (KR → KRW + ja, US → USD + en), ebayWorkerUrl: '', theme: 'system' }. Saved settings are
//   kept as they are; ones saved before `country` existed get the detected country and keep a currency / searchLang only
//   when it differs from the old phone-language default (a real pick). A first load without a saved country saves it.
//   "cc:country-asked" (true once the country question was answered) is cleared by resetAllData.
// CollectionItem.priceApprox / HistoryItem.priceApprox: the price was converted from EUR → grids, Recent, the totals
//   (when any saved card is approx) and the best card show "≈". Items saved before the field load as exact.
// The search screen offers EN / 日本語 chips; Korean cards are found through 日本語 (same set codes). Its suggestion chips,
//   not-found help and the manual number form use the country's example (search/examples.ts): KR "sv8a 084/187", US
//   "MEW 199/165"; the "한국어 카드는 日本語에서 찾아요" note shows for Korea or the Korean UI.
// Photo flow: Scan screen rememberScanPhoto(card.id, photo) → Card screen getScanPhoto(id) as CardImage `photo`
//   → on "Add to My Cards" setCollectionThumb(addToCollection(card, variant), photo) (shrunk to 200px wide; first add of
//   a card without a TCGdex picture only).
// Snapshots: Home (My Cards panel) and My Cards call recordSnapshot(items) whenever the list is not empty, so "since
//   last week" has data even if the kid only opens Home. Per-card data is kept only on the last 7 days of snapshots plus
//   the newest older one (the only possible baselines); older snapshots keep just their total.
// Saved prices refresh by themselves (screens/collection/useRefreshPrices.ts): when Home or My Cards opens online, prices
//   older than 24 h are re-checked in the background, 2 cards at a time, at most once an hour ("cc:pricesAutoRefreshedAt");
//   one refresh runs app-wide (the manual 가격 새로고침 joins or follows it). Opening a card also updates its saved copies.
//   The refresh converts with live rates (applyRates) and writes nothing for a printing without a price: the card keeps
//   its last price and is not looked up again for a day (remembered for the session).
// Not managed here: "cc:scanTipsSeen" (CameraView's first-time tips, kept by resetAllData), "cc:cache:*" (cache.ts),
//   "cc:pricesAutoRefreshedAt" (useRefreshPrices), sessionStorage "cc:grownUpOk" (grownUpGate) and
//   sessionStorage "cc:variantNudged" (CardScreen's once-a-session "shiny card?" toast).
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
// components/ExternalLink.tsx — every link that leaves the app: shops (eBay tiles and auction rows, TCGplayer) and, with
// kind="site", any other website (Settings credits, the worker guide on GitHub). A <button type="button" role="link">
// with no href (styled by its usual classes over a zero-specificity button reset), so there is no URL to long-press.
export function ExternalLink(props: ({ href: string; site: 'eBay' | 'TCGplayer' | 'Cardmarket'; kind?: 'shop' }
  | { href: string; site: string; kind: 'site' }) & ButtonHTMLAttributes): JSX.Element;
export function gateCopy(lang: UiLang, link: { site; kind? }): { title: string; body: string };
//   Tap or Enter → shopTap: the first time in a session a Sheet asks "eBay 웹사이트로 가요 · eBay는 진짜로 카드를
//   사고파는 곳이에요. 어른과 함께 볼까요?" (kind="site": "GitHub 웹사이트로 가요 · 앱 밖의 웹사이트가 열려요. 어른과 함께
//   볼까요?"); Cancel opens nothing; "어른과 함께 볼게요" remembers the OK for the session (shared by both kinds) and
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
vite.config.ts also allows `*.trycloudflare.com` hosts for `npm run dev` / `npm run preview` (`server` / `preview`
`allowedHosts`), so an iPhone can open a local build over an HTTPS Cloudflare Quick Tunnel with the live camera
([INSTALL.md](INSTALL.md) Part 3); other unknown hosts are still blocked.

**Updates never reload the app while a kid is using it** (`src/main.tsx`): a new deploy downloads in the background
and waits; it is applied (`updateSW(true)`) when the page goes hidden (Home button, app switcher), except within
5 minutes of tapping a photo input (the photo picker / camera app also hides the page and the photo would be lost);
a closed app gets it on the next cold launch. A resumed app checks for an update at most once an hour.
`clientsClaim` lets the first visit's service worker control the page, so that session's OCR engine and images get cached.

Runtime caches:

| Cache | URLs | Strategy |
|---|---|---|
| `tcgplayer-ja` (first rule) | our own `data/tcgplayer-ja/*.json` price files | NetworkFirst, 3 s timeout, 60 entries, 7 days. Never precached, so a daily redeploy with new prices leaves `sw.js` byte-identical and prompts no app update |
| `card-data` | `api.tcgdex.net` GET requests (POST GraphQL is not cached; `cache.ts` keeps those results in localStorage) | NetworkFirst, 8 s timeout, 7 days |
| `card-images-opaque` (first rule) | `assets.tcgdex.net` requests made without CORS (`request.mode === 'no-cors'`): pictures whose CORS headers come twice, which browsers reject — every Japanese one and a few English ones (e.g. sv03-125) — so `CardImage` loads every `assets.tcgdex.net/ja/` picture plain from the start and retries the few English ones plain after a CORS failure. Nothing reads card picture pixels, so no picture needs CORS | CacheFirst, status 0 only, 60 entries (each opaque response counts several MB of quota), 30 days, purged on quota errors |
| `card-images` | `assets.tcgdex.net` with CORS — `CardImage` loads EN pictures with `crossOrigin="anonymous"` so the responses are cacheable normally | CacheFirst, 600 entries, 30 days |
| `ocr-assets` | tesseract.js worker, core and `eng` data on jsDelivr. The worker loads the engine with `importScripts`, which gives opaque responses, so status 0 is allowed | CacheFirst, 90 days |
| `fonts` | Pretendard stylesheet (loaded with `crossorigin`) and its unicode-range subsets on jsDelivr | CacheFirst, 120 entries, 1 year |

After one online scan the OCR engine works offline; matching the code still needs card data, so offline scans only
find cards that were looked up before. Cards opened online (EN and JA pictures) show their picture offline. TCGplayer
fallback images have no CORS headers and stay in the browser's HTTP cache only.

### Daily price files (`data/tcgplayer-ja/`)

`scripts/build-ja-prices.mjs` (Node, no dependencies; `npm run ja-prices`; options at the top of the file) writes
`s/<key>.json` (one per TCGplayer set code; the only files the app reads), `index.json` (date, counts) and `all.json`
(everything, read only by the next run) into `public/data/tcgplayer-ja/`, which is git-ignored and copied into `dist`.

```json
{"v":1,"d":"2026-11-11T20:05:27Z","k":"sv8a","g":[{"id":23909,"n":"SV8a: Terastal Fest ex","c":1,
 "p":{"602464":["084/187","",{"normal":[0.18,0.01,0.17,1],"holofoil":[0.17,0.01,0.2,0.99]}],
      "602465":["084/187","Mirror Foil",{"holofoil":[0.6,0.34,0.63,1.84]}],
      "604564":["084/187","Master Ball Pattern",{"holofoil":[2.27,2.27,3.15,7]}]}}]}
```

Product = `[card number as TCGplayer writes it, name tags joined by "|", rows]`; row = `[market, low, mid, high]`;
`c: 1` = numbers and tags are filled in for the group. Sets whose TCGdex id is not a TCGplayer code get alias files
(`SET_ALIASES`: bw8a, pmcg1…6).

CI (`.github/workflows/deploy.yml`): the price step runs on deploy runs only (pushes to main, manual runs, and the
daily schedule at 21:17 and 03:17 UTC; tcgcsv refreshes around 20:00 UTC). It first copies the files already on the
site (`JA_PRICES_PREV` = the live `all.json`), asks tcgcsv's `last-updated.txt` whether anything is newer (1 request),
and only then downloads: one request at a time, 150 ms apart, own User-Agent, product lists only for new or changed
groups (first run ~900 requests, later ~460). It never fails the run: a broken or partial download (fewer than 90% of
yesterday's groups or rows, under half the rows with a market price, a 429 …) keeps yesterday's files. A scheduled
run publishes only when the prices are new and turns red after three days without fresh ones; pull requests never
touch the network (the script's own test uses a fixture and a stand-in server). GitHub pauses schedules after 60 days
without a commit; the app then falls back to Cardmarket once the files are 7 days old.

Known limits: republishing TCGplayer-derived prices is a grey area of TCGplayer's terms (tcgcsv itself says
"permission is implicit" and asks apps to sync once a day into their own cache, never from the browser): the source
label and product link stay visible, only the latest snapshot is published, and deleting the price step returns the
app to Cardmarket prices by itself. Sets without a TCGplayer group or set code (neo, e-Card, PCG … about a fifth of
the cards) keep Cardmarket or no price. Korean cards show the Japanese card's price. Cheap commons cost about three
times more on TCGplayer than on Cardmarket, so prices and tiers of saved Japanese cards moved once when this landed
(`store.updateCollectionPrice` rebases a card whose price switches between the two markets).

## Price logic (summary)

* Japanese cards take TCGplayer's price per printing from the daily files when the product is found (see
  "lib/tcgplayerJa.ts"); the rules below then apply to that TCGplayer block, and to Cardmarket when there is none.
* Headline **시세 / Market**: TCGplayer `marketPrice` (fallback `midPrice`) for the selected variant; if no TCGplayer data,
  Cardmarket `trend` (fallback `avg30`, `avg`, `avg7`; a junk trend gives way to `avg7`/`avg30`; averages nobody sells
  near, placeholders on some foil products, give way to the cheapest copy) converted EUR→USD and
  flagged `converted` (shown as approximate — "약 4,760원" / "약 $3.50" in the Korean UI, "≈ $3.50" / "≈ ₩4,760" in the
  English UI — in the hero, its low/high, saved cards, Recent and totals). Korean UI + won writes amounts the Korean way
  everywhere: "4,760원", "198만 원".
* **Low / high** — labelled by what they are. TCGplayer low: the cheapest of `lowPrice` and `midPrice` that is between
  a third of market and market (a 1-cent damaged-card listing is not "the usual lowest"), else market. TCGplayer high:
  `highPrice` unless it is above 3× market; then the largest of mid, Direct low and Cardmarket's averages that is itself
  ≤ 3× market, else market. When both ends are TCGplayer's own lowest and highest listing the row reads "지금 파는
  최저가 / Lowest for sale now" … "최고가 / Highest"; otherwise one "보통 가격 / Usual prices" label
  (`format.rangeView`). Cardmarket: the same "보통 가격 / Usual prices" label over the min/max of the recent averages
  (avg7, avg30, trend, avg; each within 3× of 시세; its raw `low` is a junk listing). The bar between them is a static
  picture with a "시세" tag, not a slider, and is left out ("~") when 시세 sits at one end.
* **Trend**: Cardmarket `avg7` vs `avg30` → `changePct`, only for real moves (see pricing rules); shown as a small grey
  pill "요즘 올랐어요 ▲25%" / "요즘 내렸어요 ▼12%" with only the arrow and number coloured. No pill = no notable move.
* **eBay**: always deep links (auctions ending soonest, Buy It Now lowest price + shipping, sold listings), through the
  grown-up check. With the worker: "지금 살 수 있는 최저가" = lowest Buy It Now **total incl. shipping** with
  "배송비 6,130원 포함" / "무료 배송" / "배송비 별도" (lowestShipping unknown), "보통 가격" = median total of a Best Match sample
  (50 listings; the price-sorted 50 when there is only one page), a shipping caption by country (none for a kid in the
  US; "한국까지 오는 배송비로 계산했어요" or "미국 eBay 가격이에요 · 한국으로 받으면 배송비가 더 들어요" for a kid in Korea, see
  Country and money), and up to 3 auctions (현재가 / 시작가 **plus shipping** with the same note as Buy It Now — "배송비 1,700원 포함",
  "무료 배송", or the bid alone with "배송비 별도" — so they compare; "입찰 3번" / "아직 입찰 없음", time left; heading "경매 중 약 12개" when eBay counts
  more than came back, hidden when the worker filtered them all). Lots, playsets, repacks and fakes are always dropped,
  graded slabs unless the query names a grader. The worker rate-limits each IP (30/min by default).
