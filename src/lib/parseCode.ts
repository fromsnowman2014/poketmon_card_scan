// Parse the printed collector line of a Pokémon card ("G sv8a 084/187", "PAR EN 123/182", "085/SV-P")
// from noisy OCR text. Pure and dependency-free.
import type { CardLang, PrintedCode } from './types';

export interface ParsedCode extends PrintedCode {
  /** 0..1 heuristic confidence, used to weight votes across OCR passes. */
  score: number;
}

export interface ParseOptions {
  /** TCGdex JA set ids (`getSets('ja')`), used to snap noisy codes like "SV8A" / "sv8" to a real id. */
  knownSetIds?: readonly string[];
  /** EN printed abbreviations ("PAR", "MEG"), recognized even when OCR glues the tiny "EN" onto them. */
  knownEnAbbrs?: readonly string[];
}

// Characters Tesseract confuses with digits inside the number field.
const DIGIT_MAP: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0', U: '0', u: '0', '°': '0',
  I: '1', l: '1', i: '1', '|': '1', '!': '1', L: '1', ']': '1', '[': '1', j: '1', J: '1',
  Z: '2', z: '2', S: '5', s: '5', $: '5', G: '6', b: '6', T: '7', B: '8', g: '9', q: '9', A: '4',
};
const DIGITISH = '0-9OoQDUuIli|!L\\]\\[jJZzSs$GbTBgqA';
const toDigits = (s: string) => [...s].map((c) => DIGIT_MAP[c] ?? c).join('');
const isDigits = (s: string) => /^\d+$/.test(s);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HANGUL = /[가-힣]/;
const JA_SUFFIX_UPPER = new Set(['K', 'M', 'D', 'V', 'S', 'P', 'B', 'W', 'H', 'R', 'L', 'N', 'C', 'I']);

const JA_PROMO = new RegExp(`([${DIGITISH}]{3})\\s*/\\s*(SV|SM|S|M|XY|BW)\\s*-?\\s*P\\b`, 'i'); // 085/SV-P
const SVP_PROMO = /\b(SVP|MEP|PR-SV)\s*(EN|FR|DE|IT|ES|PT)?\s*([0-9OoIl]{1,3})\b/i; // SVP EN 085
const OLD_PROMO = /\b(SWSH|SM|XY|BW)\s*([0-9OoIl]{2,3})\b(?!\s*\/)/; // SWSH123
const SUBSET = /\b(TG|GG|SV|RC)\s*([0-9OoIl]{1,3})\s*\/\s*(?:TG|GG|SV|RC)?\s*([0-9OoIl]{2,3})\b/; // TG05/TG30
const NUM_CLEAN = /(?:^|[^0-9OoQDIl|])(\d{1,3})\s*\/\s*(\d{2,3})(?![0-9])/g;
const NUM_FUZZY = new RegExp(`(?:^|[^0-9A-Za-z])([${DIGITISH}]{1,3})\\s*/\\s*([${DIGITISH}]{2,3})(?![0-9])`, 'g');
const NUM_SLASH_AS_DIGIT = /(?:^|[^0-9])(\d{3})[71Il|)(](\d{3})(?![0-9])/g; // 0847187
const NUM_SLASH_TWICE = /(?:^|[^0-9])(\d{3})[71Il|]\s*\/\s*(\d{3})(?![0-9])/g; // 0847/187: outlined slash read twice
const NUM_STRAY_DIGIT = /(?:^|[^0-9])\d(\d{3})\s*\/\s*(\d{3})\d?(?![0-9])|(?:^|[^0-9])(\d{3})\s*\/\s*(\d{3})\d(?![0-9])/g; // 1084/1870
// The "EN" is a tiny superscript glued to the abbreviation box, so OCR yields "PAR EN", "PARen", "IMEGex".
const EN_SPACED = /\b([A-Z][A-Z0-9]{1,3})\s+(EN|FR|DE|IT|ES|PT)\b/g;
const EN_GLUED = /([A-Z]{3})\s?(EN|E[Nn]|e[NnXx])(?![a-z]{2})/g;
// JA/KO set codes: sv8a, sv4K, sv11B, s12a, SM12a, M2a (the regulation mark may be glued in front: "Gsv8a").
const JA_PATTERNS = [
  /([sS5$][vV])\s?([0-9OoIlB]{1,2})(?:([a-zA-Z@])|(?![0-9]))(?!\s*\/)/g,
  /(SM)([0-9OoIl]{1,2})(?:([a-zA-Z+])|(?![0-9]))(?!\s*\/)/g,
  /(?:^|[^a-zA-Z0-9])([sS])([0-9Il]{1,2})(?:([a-zA-Z])|(?![0-9]))(?!\s*\/)/g,
  /(?:^|[^a-zA-Z0-9])(M)([1-9])(?:([a-zA-Z])|(?![0-9]))(?!\s*\/)/g,
];

interface SetPart { setCode: string; lang?: CardLang; score: number }
interface NumberPart { number: string; total: string; score: number }

export function parsePrintedCode(rawText: string, opts: ParseOptions = {}): ParsedCode {
  const text = cleanup(rawText);
  const promo = parsePromo(text);
  if (promo) return promo;

  const out: ParsedCode = { score: 0 };
  const num = parseNumber(text);
  if (num) Object.assign(out, num);
  // The loose glued-abbreviation match goes last: words like "PORE" in noise would otherwise hide a JA code.
  const set = parseEnSet(text, opts.knownEnAbbrs) ?? parseJaSet(text, opts.knownSetIds) ?? parseGluedEnAbbr(text, opts.knownEnAbbrs);
  if (set) {
    out.setCode = set.setCode;
    if (set.lang) out.lang = set.lang;
    out.score += set.score;
  }
  out.score = Math.max(0, Math.min(1, Math.round(out.score * 100) / 100));
  return out;
}

/** Combine the parses of several OCR passes by score-weighted voting. */
export function mergeParses(parses: ParsedCode[]): ParsedCode {
  const weight = (p: ParsedCode) => p.score + 0.01;
  const vote = <K extends 'setCode' | 'lang'>(key: K): ParsedCode[K] => {
    const tally = new Map<ParsedCode[K], number>();
    for (const p of parses) if (p[key] !== undefined) tally.set(p[key], (tally.get(p[key]) ?? 0) + weight(p));
    return best(tally);
  };
  // number and total are voted as a pair so they stay consistent with each other
  const pairs = new Map<string, number>();
  for (const p of parses) {
    if (!p.number) continue;
    const key = `${p.number}|${p.total ?? ''}`;
    pairs.set(key, (pairs.get(key) ?? 0) + weight(p));
  }
  const [number, total] = best(pairs)?.split('|') ?? [];
  return {
    setCode: vote('setCode'),
    number,
    total: total || undefined,
    lang: vote('lang'),
    promo: parses.some((p) => p.promo) || undefined,
    score: parses.reduce((max, p) => Math.max(max, p.score), 0),
  };
}

function best<T>(tally: Map<T, number>): T | undefined {
  let top: T | undefined;
  let topScore = -1;
  for (const [value, score] of tally) if (score > topScore) [top, topScore] = [value, score];
  return top;
}

function cleanup(raw: string): string {
  return raw
    .normalize('NFKC') // full-width ０-９ ／ ａ-ｚ → ASCII
    .replace(/[\u2044\u2215\u29F8\\]/g, '/') // fraction / division slashes, backslash
    .replace(/[\u2010-\u2015\u2212]/g, '-') // hyphens, dashes, minus
    .replace(/[éèê]/g, 'e')
    .replace(/\s+/g, ' ');
}

function parsePromo(text: string): ParsedCode | undefined {
  const ja = JA_PROMO.exec(text);
  if (ja && isDigits(toDigits(ja[1]))) {
    return { setCode: `${ja[2].toUpperCase()}-P`, number: toDigits(ja[1]), lang: 'ja', promo: true, score: 0.9 };
  }
  const svp = SVP_PROMO.exec(text);
  if (svp && isDigits(toDigits(svp[3]))) {
    const lang = !svp[2] || svp[2].toUpperCase() === 'EN' ? 'en' : undefined;
    return { setCode: svp[1].toUpperCase(), number: toDigits(svp[3]), lang, promo: true, score: 0.85 };
  }
  const old = OLD_PROMO.exec(text);
  if (old && isDigits(toDigits(old[2])) && !/\d\s*\/\s*\d/.test(text)) {
    return { setCode: old[1], number: toDigits(old[2]), lang: 'en', promo: true, score: 0.7 };
  }
  return undefined;
}

function plausible(num: string, total: string): boolean {
  const n = parseInt(num, 10);
  const t = parseInt(total, 10);
  return t >= 10 && t <= 400 && n >= 1 && n <= Math.max(t * 2.5, t + 150); // secret rares exceed the total
}

function parseNumber(text: string): NumberPart | undefined {
  const sub = SUBSET.exec(text);
  if (sub && isDigits(toDigits(sub[2])) && isDigits(toDigits(sub[3]))) {
    return { number: sub[1] + toDigits(sub[2]), total: sub[1] + toDigits(sub[3]), score: 0.5 };
  }
  const cands: NumberPart[] = [];
  const add = (number: string, total: string, score: number) => {
    if (isDigits(number) && isDigits(total) && plausible(number, total)) {
      cands.push({ number, total, score: score - (number.length < total.length ? 0.15 : 0) });
    }
  };
  for (const m of text.matchAll(NUM_CLEAN)) add(m[1], m[2], 0.55);
  for (const m of text.matchAll(NUM_FUZZY)) {
    if (m[2].replace(/\D/g, '').length < 2) continue; // "Illus." reads as "11/5s"; a real total keeps 2+ digits
    const substitutions = [...m[1], ...m[2]].filter((c) => !/\d/.test(c)).length;
    const bothThree = m[1].length === 3 && m[2].length === 3 ? 0.05 : 0;
    add(toDigits(m[1]), toDigits(m[2]), 0.5 - substitutions * 0.08 + bothThree);
  }
  for (const m of text.matchAll(NUM_SLASH_AS_DIGIT)) add(m[1], m[2], 0.25);
  for (const m of text.matchAll(NUM_SLASH_TWICE)) add(m[1], m[2], 0.25);
  for (const m of text.matchAll(NUM_STRAY_DIGIT)) add(m[1] ?? m[3], m[2] ?? m[4], 0.2);
  return cands.sort((a, b) => b.score - a.score)[0];
}

function parseEnSet(text: string, knownAbbrs: readonly string[] = []): SetPart | undefined {
  for (const re of [EN_SPACED, EN_GLUED]) {
    for (const [, abbr, marker] of text.matchAll(re)) {
      if (/^(SV|SM|S|M)\d/i.test(abbr)) continue;
      // With a known list, anything else is OCR noise that happens to look like "AVREN" or "AAT ES".
      if (knownAbbrs.length && !knownAbbrs.includes(abbr)) continue;
      return { setCode: abbr, lang: /^e[nx]$/i.test(marker) ? 'en' : undefined, score: 0.4 };
    }
  }
  return undefined;
}

/** A known abbreviation with the superscript "EN" glued on as "e…" ("8PARegevmo"). */
function parseGluedEnAbbr(text: string, knownAbbrs: readonly string[] = []): SetPart | undefined {
  for (const abbr of knownAbbrs) {
    if (abbr.length >= 3 && new RegExp(`(?:^|[^A-Z])[A-Z0-9]?${escapeRe(abbr)}\\s?[eE]`).test(text)) {
      return { setCode: abbr, lang: 'en', score: 0.3 };
    }
  }
  return undefined;
}

function parseJaSet(text: string, knownIds?: readonly string[]): SetPart | undefined {
  for (const re of JA_PATTERNS) {
    for (const [, prefix, digits, suffix = ''] of text.matchAll(re)) {
      if (prefix === 'SV' && !/\d/.test(digits)) continue; // "SVIe…" is the EN abbreviation SVI, not "sv1a"
      // "sv80" / "sv8oo": the second "digit" may really be the suffix letter
      const code = normalizeJaCode(prefix, digits, suffix)
        ?? (digits.length === 2 ? normalizeJaCode(prefix, digits[0], digits[1]) : undefined);
      if (code) {
        // KO cards print the same codes as JA; only the name script (hangul vs kana) tells them apart
        const lang = HANGUL.test(text) ? 'ko' : 'ja';
        return { setCode: snap(code, knownIds), lang, score: prefix.toLowerCase() === 'sv' ? 0.4 : 0.3 };
      }
    }
  }
  return undefined;
}

/** "5v8o" → "SV8a", "SM12a" → "SM12a", "M2a" → "M2a"; undefined when the series number is impossible. */
function normalizeJaCode(prefix: string, digits: string, suffix: string): string | undefined {
  const series = prefix.toUpperCase().replace(/^[5$]/, 'S');
  const d = toDigits(digits);
  if (!isDigits(d)) return undefined;
  const n = parseInt(d, 10);
  const maxN = series === 'M' ? 9 : 12;
  if (n < 1 || n > maxN) return undefined;
  let suf = '';
  if (/[oe0@cdquA]/.test(suffix)) suf = 'a'; // a lowercase "a" is the usual OCR victim
  else if (suffix === 'a' || suffix === 'b') suf = suffix;
  else if (JA_SUFFIX_UPPER.has(suffix.toUpperCase())) suf = suffix.toUpperCase();
  return `${series}${n}${suf}`;
}

function snap(code: string, known?: readonly string[]): string {
  if (!known?.length) return code;
  const lc = code.toLowerCase();
  const exact = known.find((k) => k.toLowerCase() === lc);
  if (exact) return exact;
  // suffix misread: "sv8" may be "SV8a" (or the reverse) when only one of them exists
  const base = lc.replace(/[a-z]$/, '');
  const alts = known.filter((k) => k.toLowerCase() === base || k.toLowerCase().replace(/[a-z]$/, '') === base);
  return alts.length === 1 ? alts[0] : code;
}
