// TCGdex client: sets, card details (with normalized prices), printed-code lookup and multilingual search.
import type { CardBrief, CardDetail, CardLang, PrintedCode } from './types';
import { cached, fetchJson, HttpError } from './cache';
import { getRates, getRatesSync, type Rates } from './fx';
import { findSpecies, translateCardName } from './names';
import { buildVariants } from './pricing';
import { getJaSetPrices, setKey, type JaSetFile } from './tcgplayerJa';
import enSetData from '../data/en-sets.json';

export interface SetInfo {
  id: string;
  name: string;
  official: number;
  total: number;
  /** Full logo URL (…/logo.webp), use as-is. EN only; JA sets have no logos. */
  logo?: string;
  symbol?: string;
  releaseDate?: string;
  /** Printed EN abbreviation, e.g. "PAR" for sv04. */
  abbreviation?: string;
}

export interface SetCandidate {
  lang: CardLang;
  set: SetInfo;
  /** 1 = code and total agree, 0.9 = code matches (total unknown), lower = fuzzy. */
  score: number;
}

type DataLang = 'en' | 'ja';

const API = 'https://api.tcgdex.net/v2';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_CODE_RESULTS = 8;

/** TCG Pocket is digital-only (no physical cards, no prices). */
const POCKET_SET = /^(A\d+[ab]?|B\d+a?|P-A)$/;
const POCKET_CARD = /^(A\d+[ab]?|B\d+a?|P-A)-/;

/** Old EN promo codes printed as "SWSH123" / "SM01", whose localIds keep the prefix. */
const EN_PROMO_SETS: Record<string, string> = { SWSH: 'swshp', SM: 'smp', XY: 'xyp', BW: 'bwp', HGSS: 'hgssp', DP: 'dpp' };

const EN_SETS = new Map((enSetData as { id: string; abbr: string | null; releaseDate: string }[]).map((s) => [s.id, s]));

/** Printed EN set codes, uppercase ("PAR", "OBF", "SVP", "SWSH"…), to accept them typed in any case. */
const EN_CODES = new Set([
  ...[...EN_SETS.values()].flatMap((s) => (s.abbr && !s.abbr.includes(':') ? [s.abbr.toUpperCase()] : [])),
  ...Object.keys(EN_PROMO_SETS),
]);

/** Subset sets whose cards print a lettered total: "TG05/TG30", "GG35/GG70", "SV49/SV94". */
const SUBSET_SET_NAME = /\s(?:Trainer Gallery|Galarian Gallery|Shiny Vault)$/i;
const PROMO_SET_NAME = /promo|プロモ/i;

/** KO data is nearly empty and Korean cards print the JA set codes, so KO reads from JA. */
const dataLang = (lang: CardLang): DataLang => (lang === 'en' ? 'en' : 'ja');
const unique = <T>(xs: T[]) => [...new Set(xs)];
/** First item per key, order kept. */
function uniqueBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => !seen.has(key(x)) && !!seen.add(key(x)));
}

// ---------- sets ----------

interface RawSet {
  id: string;
  name?: string;
  logo?: string | null;
  releaseDate?: string;
  serie?: { id?: string } | null;
  cardCount?: { official?: number; total?: number };
}

const setsQuery = (lang: DataLang) =>
  `{ sets @locale(lang:"${lang}") { id name logo releaseDate serie { id } cardCount { official total } } }`;

/** GraphQL gives release dates (needed for newest-first ordering) in one call; REST list is the fallback. */
async function fetchRawSets(lang: DataLang): Promise<RawSet[]> {
  try {
    const res = await fetchJson<{ data?: { sets?: RawSet[] } }>(`${API}/graphql`, {
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: setsQuery(lang) }) },
    });
    if (res.data?.sets?.length) return res.data.sets;
  } catch {
    // fall through
  }
  return fetchJson<RawSet[]>(`${API}/${lang}/sets`);
}

function toSetInfo(raw: RawSet, lang: DataLang): SetInfo {
  const en = lang === 'en' ? EN_SETS.get(raw.id) : undefined;
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    official: raw.cardCount?.official ?? 0,
    total: raw.cardCount?.total ?? 0,
    logo: raw.logo ? `${raw.logo}.webp` : undefined,
    releaseDate: raw.releaseDate || en?.releaseDate || undefined,
    abbreviation: en?.abbr ?? undefined,
  };
}

/** All physical sets of a language, newest first (KO → JA sets). Cached 24h. */
export function getSets(lang: CardLang): Promise<SetInfo[]> {
  const src = dataLang(lang);
  return cached(`sets:${src}`, DAY, async () => {
    const raw = await fetchRawSets(src);
    const sets = uniqueBy(raw, (s) => s.id)
      .filter((s) => s.serie?.id !== 'tcgp' && !POCKET_SET.test(s.id))
      .map((s, index) => ({ set: toSetInfo(s, src), index }));
    // Undated sets (REST fallback) keep the API's chronological order, reversed.
    sets.sort((a, b) => (b.set.releaseDate ?? '').localeCompare(a.set.releaseDate ?? '') || b.index - a.index);
    return sets.map((s) => s.set);
  });
}

const setsOrEmpty = (lang: DataLang) => getSets(lang).catch(() => [] as SetInfo[]);

// ---------- cards ----------

interface RawCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  rarity?: string;
  hp?: number;
  types?: string[];
  dexId?: number[];
  illustrator?: string;
  set?: { id?: string; name?: string; cardCount?: { official?: number } };
}

interface RawListItem {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

/** `${base}/${quality}.webp` — the bare TCGdex image base URL is a 404. */
export function cardImage(base: string | undefined, quality: 'low' | 'high' = 'high'): string | undefined {
  return base ? `${base}/${quality}.webp` : undefined;
}

/** "SV-P-085" → {setId: "SV-P", localId: "085"}. Pass the known localId to split exactly. */
export function splitCardId(id: string, localId?: string): { setId: string; localId: string } {
  if (localId && id.endsWith(`-${localId}`)) return { setId: id.slice(0, -(localId.length + 1)), localId };
  const at = id.lastIndexOf('-');
  return at < 0 ? { setId: id, localId: '' } : { setId: id.slice(0, at), localId: id.slice(at + 1) };
}

/**
 * True for promo sets: JA "SV-P"/"M-P" (official 0), EN Black Star Promos. EN svp/smp/swshp/xyp… report the
 * number of promos as their official count, but their cards print no total ("SVP EN 085", "SWSH284").
 */
const isPromoSet = (setId: string, setName: string, official: number | undefined) =>
  !official || /-P$/i.test(setId) || PROMO_SET_NAME.test(setName);

/**
 * The card number as printed: "084/187"; JA promos "085/SV-P"; EN promos just the number ("085", "SWSH284");
 * subset sets keep the letters on the total ("TG05/TG30"); other lettered numbers ("RC1" in Generations) alone,
 * since their total is not the set's.
 */
export function printedNumber(card: { localId: string; setId: string; setName: string; lang: CardLang }, official: number | undefined): string {
  const { localId, setId, setName } = card;
  if (isPromoSet(setId, setName, official)) return card.lang !== 'en' && /-P$/i.test(setId) ? `${localId}/${setId.toUpperCase()}` : localId;
  const prefix = /^([A-Z]+)\d+$/i.exec(localId)?.[1];
  if (prefix) return SUBSET_SET_NAME.test(setName) ? `${localId}/${prefix.toUpperCase()}${official}` : localId;
  return `${localId}/${official}`;
}

function toDetail(raw: RawCard, lang: DataLang, rates: Rates, sets: SetInfo[], ja?: JaSetFile | null): CardDetail {
  const setId = raw.set?.id ?? splitCardId(raw.id, raw.localId).setId;
  const set = sets.find((s) => s.id === setId);
  const setName = raw.set?.name ?? set?.name ?? setId;
  const official = raw.set?.cardCount?.official ?? set?.official;
  const { variants, defaultVariant } = buildVariants(raw, rates, ja);
  // Variants are most common first: the picture of the regular card, also for cards TCGdex has no product id for.
  const tcgplayerId = variants.find((v) => v.tcgplayerId)?.tcgplayerId;
  return {
    id: raw.id,
    lang,
    localId: raw.localId,
    name: raw.name,
    image: raw.image,
    setId,
    setName,
    setOfficialCount: isPromoSet(setId, setName, official) ? undefined : official,
    printedNumber: printedNumber({ localId: raw.localId, setId, setName, lang }, official),
    setReleaseDate: set?.releaseDate,
    rarity: raw.rarity && raw.rarity !== 'None' ? raw.rarity : undefined,
    hp: raw.hp,
    types: raw.types,
    dexIds: raw.dexId ?? [],
    illustrator: raw.illustrator,
    imageFallback: tcgplayerId ? `https://tcgplayer-cdn.tcgplayer.com/product/${tcgplayerId}_400w.jpg` : undefined,
    variants,
    defaultVariant,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Full card with prices. KO reads JA data (lang stays 'ja'). Cached 30 min. 404 → HttpError status 404.
 * Never waits for exchange rates: EUR prices are converted with the last known (or fallback) rates while live
 * rates load in the background; pricing.applyRates re-converts once they arrive.
 * Japanese cards also load their set's TCGplayer price file (tcgplayerJa.getJaSetPrices) next to the card: it never
 * fails and gives up after 4 s, and without it the card has its Cardmarket prices, as before.
 */
export function getCard(lang: CardLang, id: string): Promise<CardDetail> {
  const src = dataLang(lang);
  return cached(`card:${src}:${id}`, 30 * MINUTE, async () => {
    void getRates();
    // The set is read off the card id ("SV-P-085" → "SV-P") so the price file loads next to the card, not after it.
    const setId = splitCardId(id).setId;
    const [raw, sets, ja] = await Promise.all([
      fetchJson<RawCard>(`${API}/${src}/cards/${encodeURIComponent(id)}`),
      setsOrEmpty(src),
      src === 'ja' ? getJaSetPrices(setId) : null,
    ]);
    // Prices are matched by card number: never with another set's file, should an id ever split differently.
    const sameSet = !raw.set?.id || setKey(raw.set.id) === setKey(setId);
    return toDetail(raw, src, getRatesSync(), sets, sameSet ? ja : null);
  });
}

const toBrief = (c: CardBrief): CardBrief => ({
  id: c.id,
  lang: c.lang,
  localId: c.localId,
  name: c.name,
  image: c.image,
  setId: c.setId,
  setName: c.setName,
});

/** Raw list endpoint (`/v2/{lang}/cards?…` filters), TCG Pocket removed, setName attached. Cached 10 min in memory. */
export async function listCards(lang: CardLang, params: Record<string, string>): Promise<CardBrief[]> {
  const src = dataLang(lang);
  const qs = new URLSearchParams(params).toString();
  const [items, sets] = await Promise.all([
    cached(`list:${src}:${qs}`, 10 * MINUTE, () => fetchJson<RawListItem[]>(`${API}/${src}/cards?${qs}`), { persist: false }),
    setsOrEmpty(src),
  ]);
  const setNames = new Map(sets.map((s) => [s.id, s.name]));
  return items
    .filter((c) => !POCKET_CARD.test(c.id))
    .map((c) => {
      const { setId } = splitCardId(c.id, c.localId);
      return { id: c.id, lang: src, localId: c.localId, name: c.name, image: c.image, setId, setName: setNames.get(setId) };
    });
}

/** Sorts cards newest set first (getSets order); unknown sets last, API order kept within a set. */
async function sortNewestFirst(cards: CardBrief[]): Promise<CardBrief[]> {
  const langs = unique(cards.map((c) => dataLang(c.lang)));
  const rank = new Map<string, number>();
  for (const lang of langs) (await setsOrEmpty(lang)).forEach((s, i) => rank.set(`${lang}:${s.id}`, i));
  const pos = (c: CardBrief) => rank.get(`${c.lang}:${c.setId}`) ?? Infinity;
  return [...cards].sort((a, b) => pos(a) - pos(b));
}

// ---------- printed code → card ----------

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const numericTotal = (code: PrintedCode) => (code.total && /^\d+$/.test(code.total) ? Number(code.total) : undefined);

const codeMatches = (set: SetInfo, code: string) => set.id.toLowerCase() === code || set.abbreviation?.toLowerCase() === code;

/**
 * Ranks one language's sets (newest first) for a printed code: sets named by the code and agreeing with the total
 * (or total unknown); else same-size sets by how close their id/abbreviation looks to the OCR-noisy code;
 * else the named sets despite the size mismatch (the total was probably misread).
 */
function rankSets(code: PrintedCode, sets: SetInfo[]): { set: SetInfo; score: number }[] {
  const c = code.setCode?.toLowerCase();
  const total = numericTotal(code);
  const named = c ? sets.filter((s) => codeMatches(s, c)) : [];
  if (total === undefined || code.promo) return named.map((set) => ({ set, score: 0.9 }));
  const agreeing = named.filter((s) => s.official === total);
  if (agreeing.length) return agreeing.map((set) => ({ set, score: 1 }));
  const sameSize = sets.filter((s) => s.official === total);
  if (!sameSize.length) return named.map((set) => ({ set, score: 0.5 }));
  const distance = (s: SetInfo) =>
    c ? Math.min(levenshtein(c, s.id.toLowerCase()), s.abbreviation ? levenshtein(c, s.abbreviation.toLowerCase()) : Infinity) : 2;
  return sameSize.map((set) => ({ set, score: Math.max(0.1, 0.8 - 0.1 * distance(set)) })).sort((a, b) => b.score - a.score);
}

/** Set candidates for a printed code across languages, best first (newest first among equals). */
export async function resolveSets(code: PrintedCode, langs: CardLang[]): Promise<SetCandidate[]> {
  const out: SetCandidate[] = [];
  for (const lang of unique(langs.map(dataLang))) {
    out.push(...rankSets(code, await setsOrEmpty(lang)).map((r) => ({ lang, ...r })));
  }
  return out.sort((a, b) => b.score - a.score);
}

const guessLangs = (code: PrintedCode): CardLang[] => (code.lang === 'en' ? ['en'] : code.lang ? ['ja'] : ['ja', 'en']);

/** Card-number spellings to try: JA ids are 3-digit; EN SV/ME-era padded, older sets unpadded; "TG01" as-is. */
function localIdVariants(number: string, lang: DataLang): string[] {
  const n = number.toUpperCase();
  if (!/^\d+$/.test(n)) return [n];
  const pad3 = n.padStart(3, '0');
  return lang === 'ja' ? [pad3] : unique([pad3, String(Number(n))]);
}

const normLocalId = (s: string) => s.toUpperCase().replace(/^0+(?=\d)/, '');

interface ExactGroup {
  lang: DataLang;
  setId: string;
  localIds: string[];
}

function exactGroups(code: PrintedCode, langs: DataLang[], ranked: SetCandidate[], jaSetsKnown: boolean): ExactGroup[] {
  const number = code.number ?? '';
  const sc = code.setCode;
  if (!sc) return [];
  const groups: ExactGroup[] = ranked
    .filter((r) => codeMatches(r.set, sc.toLowerCase()))
    .map((r) => ({ lang: dataLang(r.lang), setId: r.set.id, localIds: localIdVariants(number, dataLang(r.lang)) }));
  // JA prints the set id itself, so it can be tried blind when the set list couldn't be loaded.
  const jaLike = code.lang === 'ja' || code.lang === 'ko' || /^(SV|SM|S|M)\d|-P$/i.test(sc);
  if (langs.includes('ja') && jaLike && !jaSetsKnown) groups.push({ lang: 'ja', setId: sc, localIds: localIdVariants(number, 'ja') });
  const promoSet = EN_PROMO_SETS[sc.toUpperCase()];
  if (langs.includes('en') && promoSet && /^\d+$/.test(number)) {
    const p = sc.toUpperCase();
    groups.push({ lang: 'en', setId: promoSet, localIds: unique([p + number.padStart(2, '0'), p + number.padStart(3, '0')]) });
  }
  return groups;
}

/** Fetches each group's first existing card id (in parallel across groups). */
async function lookupExact(groups: ExactGroup[]): Promise<{ hits: CardBrief[]; error?: unknown }> {
  let error: unknown;
  const found = await Promise.all(
    groups.map(async (g) => {
      for (const localId of g.localIds) {
        try {
          return toBrief(await getCard(g.lang, `${g.setId}-${localId}`));
        } catch (e) {
          if (!(e instanceof HttpError && e.status === 404)) error ??= e;
        }
      }
      return undefined;
    }),
  );
  const hits = uniqueBy(
    found.filter((c): c is CardBrief => !!c),
    (c) => `${c.lang}:${c.id}`,
  );
  return { hits, error };
}

/** Number + set size only: one filtered list call per language, then exact client-side localId match. */
async function lookupByTotal(code: PrintedCode, total: number, langs: DataLang[], ranked: SetCandidate[]): Promise<CardBrief[]> {
  const want = normLocalId(code.number ?? '');
  const lists = await Promise.all(langs.map((lang) => listCards(lang, { 'set.cardCount.official': String(total), localId: code.number ?? '' })));
  const rank = new Map(ranked.map((r, i) => [`${r.lang}:${r.set.id}`, i]));
  const pos = (c: CardBrief) => rank.get(`${c.lang}:${c.setId}`) ?? Infinity;
  return lists
    .flat()
    .filter((c) => normLocalId(c.localId) === want)
    .sort((a, b) => pos(a) - pos(b))
    .slice(0, MAX_CODE_RESULTS);
}

/** Subset numbers ("TG05/TG30", "GG35/GG70", "SV49/SV94") live in their own sets (swsh9tg, sma…): list by number. */
async function lookupSubset(number: string, langs: DataLang[]): Promise<CardBrief[]> {
  const want = number.toUpperCase();
  const lists = await Promise.all(langs.map((lang) => listCards(lang, { localId: number })));
  const hits = lists.flat().filter((c) => c.localId.toUpperCase() === want);
  return (await sortNewestFirst(hits)).slice(0, MAX_CODE_RESULTS);
}

/**
 * Cards for a printed code. Exact set code + number first (JA "sv8a 084" → SV8a-084, promo "085/SV-P" → SV-P-085,
 * EN "PAR 123" → sv04-123); otherwise number/total against sets of that size, best set match first;
 * subset numbers ("TG05/TG30") by number alone.
 */
export async function findByCode(code: PrintedCode, langs: CardLang[] = guessLangs(code)): Promise<CardBrief[]> {
  if (!code.number) return [];
  const targets = unique(langs.map(dataLang));
  const ranked = await resolveSets(code, targets);
  const jaSetsKnown = targets.includes('ja') && (await setsOrEmpty('ja')).length > 0;
  const { hits, error } = await lookupExact(exactGroups(code, targets, ranked, jaSetsKnown));
  if (hits.length) return hits.slice(0, MAX_CODE_RESULTS);
  const total = numericTotal(code);
  if (total !== undefined) return lookupByTotal(code, total, targets, ranked);
  if (/^[A-Z]{1,3}\d+$/i.test(code.number) && !code.promo) return lookupSubset(code.number, targets);
  if (error) throw error;
  return [];
}

// ---------- search ----------

/**
 * A typed printed code: "084/187", "sv8a 084", "SV8a-084", "G sv8a 084/187", "PAR 123", "par 123/182",
 * "PAR EN 123/182", "TG01/TG30", "tg05/tg30", "085/SV-P", "sv08.5-084", "SWSH284", "svp 085".
 * Words without a digit count as a set code when written in capitals or when they are a known EN code followed
 * by a 2–3 digit number; other lowercase words ("mew 2") stay name searches.
 */
export function parseQueryCode(query: string): PrintedCode | undefined {
  const q = query.replace(/\s+/g, ' ').replace(/^[A-Z] (?=\S+ \S)/, '');
  const promo = /^(\d{1,3}) ?\/ ?([A-Z]{1,2}-P)$/i.exec(q);
  if (promo) return { setCode: promo[2].toUpperCase(), number: promo[1], promo: true, lang: 'ja' };
  // Old EN promos print one token: "SWSH284", "SM60", "XY01" (also "SVP085" typed without a space).
  const enPromo = /^(SWSH|HGSS|SVP|MEP|SM|XY|BW|DP) ?(\d{1,3})$/i.exec(q);
  if (enPromo) return { setCode: enPromo[1].toUpperCase(), number: enPromo[2], lang: 'en' };
  const m = /^(?:([A-Za-z][A-Za-z0-9.+]*?(?:-P)?)(?: (?:EN|JP|KR))?[ -])?([A-Za-z]{0,4}\d{1,3})(?: ?\/ ?([A-Za-z]{0,4}\d{1,3}))?$/i.exec(q);
  if (!m) return undefined;
  const [, rawSetCode, rawNumber, rawTotal] = m;
  const number = rawNumber.toUpperCase();
  const total = rawTotal?.toUpperCase();
  if (!rawSetCode) return { number, total };
  const known = EN_CODES.has(rawSetCode.toUpperCase());
  const isCode =
    !!total || /\d|-P$/i.test(rawSetCode) || /^[A-Z]{2,5}$/.test(rawSetCode) || (known && /^\d{2,3}$/.test(number));
  if (!isCode) return undefined;
  return { setCode: known ? rawSetCode.toUpperCase() : rawSetCode, number, total };
}

const HANGUL = /[\uAC00-\uD7A3]/;
const SCRIPT: Record<DataLang, RegExp> = { ja: /[\u3040-\u30FF\u4E00-\u9FFF]/, en: /[A-Za-z]/ };

/**
 * `name` filters to send to TCGdex: the species translated into `lang` (keeping "ex"/"V"…), plus the raw text for trainers.
 * TCGdex matches substrings, so a one- or two-letter query ("N") must match a name exactly or it returns thousands.
 */
function nameQueries(query: string, lang: DataLang): string[] {
  const out = new Map<string, string>();
  const add = (s: string) => out.set(s.toLowerCase(), s);
  const short = [...query].length <= 2;
  const found = findSpecies(query, 1)[0];
  const species = found && (!short || [found.en, found.ko, found.ja].includes(query)) ? found : undefined;
  if (species) add(translateCardName(query, [species.dexId], lang) ?? species[lang]);
  // eq: is case-sensitive; card names start with a capital.
  if ((!species || SCRIPT[lang].test(query)) && !HANGUL.test(query)) add(short ? `eq:${query[0].toUpperCase()}${query.slice(1)}` : query);
  return [...out.values()];
}

/**
 * Search by name in any of ko/ja/en (translated to `lang` via names.ts) or by printed number.
 * KO searches JA. Results carry setName and are sorted newest set first.
 */
export async function searchCards(query: string, lang: CardLang, limit = 60): Promise<CardBrief[]> {
  const q = query.normalize('NFKC').trim();
  if (!q) return [];
  const src = dataLang(lang);
  const code = parseQueryCode(q);
  if (code) return (await findByCode(code, unique<CardLang>([src, 'ja', 'en']))).slice(0, limit);
  const lists = await Promise.all(nameQueries(q, src).map((name) => listCards(src, { name })));
  return (await sortNewestFirst(uniqueBy(lists.flat(), (c) => c.id))).slice(0, limit);
}
