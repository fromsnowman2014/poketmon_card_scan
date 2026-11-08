// Multilingual Pokémon species names (EN / KO / JA) for search translation and display.
import rows from '../data/pokemon-names.json';

export interface Species {
  dexId: number;
  en: string;
  ko: string;
  ja: string;
}

type NameLang = 'en' | 'ko' | 'ja';
const LANGS: NameLang[] = ['en', 'ko', 'ja'];

const SPECIES: Species[] = (rows as [number, string, string, string][]).map(([dexId, en, ko, ja]) => ({ dexId, en, ko, ja }));
const BY_DEX = new Map(SPECIES.map((s) => [s.dexId, s]));

/** Words printed before the species on cards ("Mega Gengar ex", "メガゲンガーex"). */
const PREFIXES: Record<NameLang, string>[] = [
  { en: 'Mega', ko: '메가', ja: 'メガ' },
  { en: 'Alolan', ko: '알로라', ja: 'アローラ' },
  { en: 'Galarian', ko: '가라르', ja: 'ガラル' },
  { en: 'Hisuian', ko: '히스이', ja: 'ヒスイ' },
  { en: 'Paldean', ko: '팔데아', ja: 'パルデア' },
  { en: 'Radiant', ko: '빛나는', ja: 'かがやく' },
  { en: "Team Rocket's", ko: '로켓단의', ja: 'ロケット団の' },
];

/** Card mechanics printed after the species; identical in every language. Longest first. */
const SUFFIX_TOKEN = /^\s*(VMAX|VSTAR|V-UNION|BREAK|LV\.?X|GX|EX|ex|V|X|Y|☆|δ)/;

const toKatakana = (s: string) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** Matching key: width/case/kana-insensitive, letters and digits only. */
function normalize(s: string): string {
  return toKatakana(s.normalize('NFKC').toLowerCase()).replace(/[^\p{L}\p{N}]/gu, '');
}

const PREFIX_FORMS = PREFIXES.flatMap((p) => LANGS.map((l) => p[l].toLowerCase()));

/** Query without card prefixes/suffixes: "メガゲンガーex" → "ゲンガー", "pikachu vmax" → "pikachu". */
function stripAffixes(query: string): string {
  let q = query.normalize('NFKC').toLowerCase().trim();
  const prefix = PREFIX_FORMS.find((p) => q.startsWith(p));
  if (prefix) q = q.slice(prefix.length);
  return q.replace(/(?:[\s-]*(?:vmax|vstar|v-union|break|gx|ex|v))+$/, '');
}

let index: { s: Species; keys: string[] }[] | undefined;
function getIndex() {
  index ??= SPECIES.map((s) => ({ s, keys: LANGS.map((l) => normalize(s[l])).filter(Boolean) }));
  return index;
}

export function speciesByDex(dexId: number): Species | undefined {
  return BY_DEX.get(dexId);
}

/** Species whose EN/KO/JA name matches `query` (exact > prefix > contains), best first. */
export function findSpecies(query: string, limit = 8): Species[] {
  const variants = [...new Set([normalize(query), normalize(stripAffixes(query))])].filter(Boolean);
  if (!variants.length) return [];
  const scored: { s: Species; score: number; len: number }[] = [];
  for (const { s, keys } of getIndex()) {
    let score = 0;
    let len = Infinity;
    for (const key of keys) {
      for (const q of variants) {
        const sc = key === q ? 3 : key.startsWith(q) ? 2 : key.includes(q) ? 1 : 0;
        if (sc > score || (sc === score && sc > 0 && key.length < len)) {
          score = sc;
          len = key.length;
        }
      }
    }
    if (score) scored.push({ s, score, len });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.len - b.len || a.s.dexId - b.s.dexId)
    .slice(0, limit)
    .map((x) => x.s);
}

/** Name of the first species in `dexIds` in `lang`. */
export function localizedName(dexIds: number[] | undefined, lang: NameLang): string | undefined {
  const first = dexIds?.length ? speciesByDex(dexIds[0]) : undefined;
  return first?.[lang] || undefined;
}

const cleanName = (s: string) => s.normalize('NFKC').replace(/[’‘]/g, "'");

interface Hit {
  start: number;
  end: number;
  s: Species;
}

/** Where each species of `dexIds` appears in `name` (any language), in reading order, non-overlapping. */
function findSpeciesInName(name: string, dexIds: number[]): Hit[] {
  const lower = name.toLowerCase();
  const hits: Hit[] = [];
  for (const id of dexIds) {
    const s = speciesByDex(id);
    if (!s) continue;
    let best: Hit | undefined;
    for (const l of LANGS) {
      const needle = cleanName(s[l]).toLowerCase();
      const at = needle ? lower.indexOf(needle) : -1;
      if (at >= 0 && (!best || needle.length > best.end - best.start)) best = { start: at, end: at + needle.length, s };
    }
    if (best) hits.push(best);
  }
  hits.sort((a, b) => a.start - b.start);
  return hits.filter((h, i) => i === 0 || h.start >= hits[i - 1].end);
}

function suffixTokens(after: string): string[] {
  const tokens: string[] = [];
  let rest = after;
  for (let m = SUFFIX_TOKEN.exec(rest); m; m = SUFFIX_TOKEN.exec(rest)) {
    tokens.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  // A token run that stops inside a Latin word ("Vulpix") wasn't a suffix.
  return /^[A-Za-z]/.test(rest) ? [] : tokens;
}

/**
 * Card name with the species part translated, keeping prefixes/suffixes:
 * "ブラッキーex" [197] → en "Umbreon ex", ko "블래키 ex"; "メガゲンガーex" [94] → en "Mega Gengar ex".
 * undefined when there are no dexIds (trainers/energy) or the species isn't found in the name.
 */
export function translateCardName(name: string, dexIds: number[] | undefined, toLang: NameLang): string | undefined {
  if (!dexIds?.length) return undefined;
  const src = cleanName(name);
  const hits = findSpeciesInName(src, dexIds);
  if (!hits.length) return undefined;
  const before = src.slice(0, hits[0].start).toLowerCase();
  const prefixes = PREFIXES.filter((p) => LANGS.some((l) => before.includes(p[l].toLowerCase()))).map((p) => p[toLang]);
  const species = hits.map((h) => h.s[toLang]);
  const suffixes = suffixTokens(src.slice(hits[hits.length - 1].end));
  return toLang === 'ja'
    ? prefixes.join('') + species.join('&') + suffixes.join('')
    : [...prefixes, species.join(' & '), ...suffixes].join(' ');
}
