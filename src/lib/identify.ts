// Photo of a card → candidate cards: OCR the printed collector line, then look the code up on TCGdex.
import enSets from '../data/en-sets.json';
import type { Rect } from './imageProc';
import { preloadOcr, readCodeStrip, type CodeStripStatus } from './ocr';
import type { ParsedCode } from './parseCode';
import { findByCode, getSets, resolveSets } from './tcgdex';
import type { CardBrief, CardLang, IdentifyResult, PrintedCode, ProgressFn } from './types';

export interface IdentifyOptions {
  /**
   * The language the user says the card is in. Breaks ties when OCR found no set code, and 'ko' labels JA-style
   * codes as Korean (Korean cards print the same codes, and OCR cannot tell them apart).
   */
  langHint?: CardLang;
  /** True once the result is no longer wanted (the kid stopped): ends OCR between passes and skips the lookups. */
  isStale?: () => boolean;
  /** Read with only the best few OCR passes (cheap extra tries, e.g. the photo turned sideways). */
  maxPasses?: number;
  /** The part of the card holding the collector line, as fractions (default: ocr.ts's CODE_STRIP). */
  band?: Rect;
}

export interface IdentifyOutcome extends IdentifyResult {
  /** 'unavailable': the OCR engine could not load (offer typing). 'stopped': isStale cut it short. */
  status: CodeStripStatus;
}

// Subset keys like "SHF:SV" never appear in OCR text; 2-letter abbreviations match too much noise.
const EN_ABBRS = (enSets as { abbr: string | null }[]).flatMap((s) => (s.abbr && /^[A-Z0-9]{3,}$/.test(s.abbr) ? [s.abbr] : []));

/** Read the collector line of a cropped card (63:88) and find matching cards, best first. Never throws. */
export async function identifyCard(card: HTMLCanvasElement, onProgress?: ProgressFn, opts: IdentifyOptions = {}): Promise<IdentifyOutcome> {
  const { langHint: hint, isStale, maxPasses, band } = opts;
  onProgress?.('loading', 0);
  void preloadOcr(); // the engine loads while the set list does; readCodeStrip waits for it
  const knownSetIds = await jaSetIds();
  const read = await readCodeStrip(card, {
    onProgress,
    isStale,
    maxPasses,
    band,
    parse: { knownSetIds, knownEnAbbrs: EN_ABBRS },
    shouldStop: (sofar, parsed) => isConfident(sofar, parsed, hint),
  });
  const rawText = read.passes.map((p) => p.text.trim()).filter(Boolean).join('\n');
  const code = toPrintedCode(read.merged, hint);
  const status: CodeStripStatus = isStale?.() ? 'stopped' : read.status;
  if (!code.number || status === 'stopped') return { rawText, code, candidates: [], status };
  return { rawText, code, candidates: await lookup(code, hint, onProgress, isStale), status };
}

/** The cards for a printed code (e.g. one fixed up from two looks), the way identifyCard looks them up. Never throws. */
export function findCards(code: PrintedCode, opts: Pick<IdentifyOptions, 'langHint' | 'isStale'> = {}): Promise<CardBrief[]> {
  return code.number ? lookup(code, opts.langHint, undefined, opts.isStale) : Promise.resolve([]);
}

async function jaSetIds(): Promise<string[]> {
  try {
    return (await getSets('ja')).map((s) => s.id);
  } catch {
    return [];
  }
}

// KO cards print JA set codes and TCGdex's KO data is nearly empty, so Korean cards are looked up as Japanese.
const dataLang = (lang: CardLang): CardLang => (lang === 'ko' ? 'ja' : lang);
const otherLang = (lang: CardLang): CardLang => (lang === 'en' ? 'ja' : 'en');

/** Lookup languages in groups; a later group is tried only when the earlier ones found nothing. */
function lookupPlan(code: PrintedCode, hint?: CardLang): CardLang[][] {
  if (code.lang) {
    const lang = dataLang(code.lang);
    return [[lang], [otherLang(lang)]];
  }
  const first = dataLang(hint ?? 'ja');
  return [[first, otherLang(first)]];
}

const forLookup = (code: PrintedCode): PrintedCode => (code.lang ? { ...code, lang: dataLang(code.lang) } : code);

/** Early exit: two passes agree on the number and the code points at exactly one set. */
async function isConfident(merged: ParsedCode, parsed: ParsedCode[], hint?: CardLang): Promise<boolean> {
  if (!merged.number) return false;
  const agreeing = parsed.filter((p) => p.number === merged.number && p.total === merged.total).length;
  if (agreeing < 2) return false;
  try {
    const code = toPrintedCode(merged, hint);
    return (await resolveSets(forLookup(code), lookupPlan(code, hint)[0])).length === 1;
  } catch {
    return false;
  }
}

function toPrintedCode({ setCode, number, total, lang, promo }: ParsedCode, hint?: CardLang): PrintedCode {
  return { setCode, number, total, lang: lang === 'ja' && hint === 'ko' ? 'ko' : lang, promo };
}

async function lookup(code: PrintedCode, hint: CardLang | undefined, onProgress?: ProgressFn, isStale?: () => boolean): Promise<CardBrief[]> {
  const plan = lookupPlan(code, hint);
  let found: CardBrief[] = [];
  for (const [i, langs] of plan.entries()) {
    if (isStale?.()) return [];
    onProgress?.('matching', i / plan.length);
    found = await findByCode(forLookup(code), langs).catch(() => []);
    if (found.length) break;
  }
  onProgress?.('matching', 1);
  return found;
}
