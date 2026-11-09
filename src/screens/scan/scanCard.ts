// Scan policy on top of identifyCard: decide whether a result is sure enough to open directly, and take
// one more look when it is not. OCR of a live-video crop (~700 px wide) misreads the small italic number
// often enough ("084/187" → "083/087") that a lone candidate is not proof by itself.
import { identifyCard, type IdentifyOutcome } from '../../lib/identify';
import { releaseCanvas, SMALL_CODE_STRIP, upscaleTo, type Rect } from '../../lib/imageProc';
import type { CodeStripStatus } from '../../lib/ocr';
import { resolveSets } from '../../lib/tcgdex';
import type { CardBrief, IdentifyResult, PrintedCode, ProgressFn } from '../../lib/types';

export type Stage = Parameters<ProgressFn>[0];
/** 1: first look. 2: a closer look (higher band, or a resampled copy). 'turn': the photo turned sideways. */
export type Look = 1 | 2 | 'turn';
export type ScanProgress = (stage: Stage, progress: number, look: Look) => void;

export interface ScanOptions {
  /** True once nobody wants the result (the kid stopped or left): OCR and lookups end at the next step. */
  isStale?: () => boolean;
  /**
   * The card cut from the photo turned clockwise by `q` quarter turns. Tried (q = 1, then 3) when the first
   * look reads no number at all: sideways photos are common when a card on a table is shot from above.
   */
  turned?: (q: 1 | 3) => HTMLCanvasElement;
  /** Clock for the time budget (tests). */
  now?: () => number;
}

export interface ScanOutcome {
  code: PrintedCode;
  candidates: CardBrief[];
  /** One candidate whose set code, total and number all agree with what was read. */
  sure: boolean;
  /** 'unavailable': the OCR engine could not load, nothing was read. 'stopped': isStale cut it short. */
  status: CodeStripStatus;
  /** The turned crop the result was read from (the caller releases it); absent for the original crop. */
  card?: HTMLCanvasElement;
  /** The band the number was read in when it is not the usual CODE_STRIP (a card held small). */
  band?: Rect;
}

/** Best OCR passes for the higher band: enough to read a small card, cheap on a miss. */
const SMALL_PASSES = 3;
/** Best OCR passes per turned try: two agreeing passes settle an upright card; a wrong turn costs little. */
const TURN_PASSES = 2;
/**
 * Once this long has passed without reading any number, skip the remaining extra tries (higher band, turned
 * photo, second look): on a slow phone a photo with no readable number should reach the number form soon.
 */
const EXTRA_TRIES_BUDGET_MS = 10_000;

const sameNumber = (a: string, b: string) =>
  a.replace(/^0+(?=.)/, '').toUpperCase() === b.replace(/^0+(?=.)/, '').toUpperCase();

/**
 * Sure = exactly one candidate, and the printed set code names that very set with a matching total
 * (resolveSets score 1). A misread digit in the set code or total then shows up as a mismatch.
 */
export async function isSure({ code, candidates }: Pick<IdentifyResult, 'code' | 'candidates'>): Promise<boolean> {
  const [card] = candidates;
  if (
    candidates.length !== 1 ||
    !code.setCode ||
    !code.total ||
    !code.number ||
    !sameNumber(card.localId, code.number)
  ) {
    return false;
  }
  try {
    const sets = await resolveSets(code, [card.lang]);
    return sets.length === 1 && sets[0].score === 1 && sets[0].set.id === card.setId;
  } catch {
    return false;
  }
}

/** A different resampling of the same card: Tesseract often reads it right where the original failed. */
function resampled(card: HTMLCanvasElement): HTMLCanvasElement {
  return upscaleTo(card, card.width < 1000 ? 1100 : Math.round(card.width * 0.7));
}

function unique(cards: CardBrief[]): CardBrief[] {
  return [...new Map(cards.map((c) => [`${c.lang}:${c.id}`, c])).values()];
}

/** The crop and band a read came from, so the next look and the number preview use the same place. */
interface Read {
  r: IdentifyOutcome;
  card: HTMLCanvasElement;
  band?: Rect;
}

/**
 * identifyCard, plus extra looks when the first answer is not sure. When no number was read at all: the band
 * above the usual one (a card held small), then the photo turned 90° and 270° (photo path only). Then a second
 * look at a resampled copy. Never throws.
 */
export async function scanCard(card: HTMLCanvasElement, onProgress: ScanProgress, opts: ScanOptions = {}): Promise<ScanOutcome> {
  const { isStale, turned, now = () => Date.now() } = opts;
  const start = now();
  const inBudget = () => now() - start < EXTRA_TRIES_BUDGET_MS;
  const stopped = (r: IdentifyOutcome): ScanOutcome => ({ code: r.code, candidates: [], sure: false, status: 'stopped' });

  const first = await identifyCard(card, (stage, p) => onProgress(stage, p, 1), { isStale });
  if (first.status === 'stopped') return stopped(first);
  if (await isSure(first)) return { code: first.code, candidates: first.candidates, sure: true, status: 'done' };
  if (first.status === 'unavailable') {
    // The engine never loaded (or died): no point in more looks.
    return { code: first.code, candidates: first.candidates, sure: false, status: first.code.number ? 'done' : 'unavailable' };
  }

  let best: Read = { r: first, card };
  let turnedCard: HTMLCanvasElement | undefined;
  const result = (outcome: Omit<ScanOutcome, 'status' | 'card' | 'band'>): ScanOutcome => {
    if (isStale?.()) {
      if (turnedCard) releaseCanvas(turnedCard);
      return stopped(best.r);
    }
    return { ...outcome, status: 'done', card: turnedCard, band: best.band };
  };

  if (!first.code.number && inBudget() && !isStale?.()) {
    const small = await identifyCard(card, (stage, p) => onProgress(stage, p, 2), {
      isStale,
      band: SMALL_CODE_STRIP,
      maxPasses: SMALL_PASSES,
    });
    if (small.code.number && small.status !== 'stopped') best = { r: small, card, band: SMALL_CODE_STRIP };
  }
  if (!best.r.code.number && turned) {
    for (const q of [1, 3] as const) {
      if (isStale?.() || !inBudget()) break;
      let crop: HTMLCanvasElement;
      try {
        crop = turned(q);
      } catch {
        break; // the photo is gone (closed): keep what the first look found
      }
      const r = await identifyCard(crop, (stage, p) => onProgress(stage, p, 'turn'), { isStale, maxPasses: TURN_PASSES });
      if (r.code.number && r.status !== 'stopped') {
        best = { r, card: crop };
        turnedCard = crop;
        break;
      }
      releaseCanvas(crop);
      if (r.status !== 'done') break;
    }
  }
  if (best.r !== first && (await isSure(best.r))) {
    return result({ code: best.r.code, candidates: best.r.candidates, sure: true });
  }

  if (isStale?.() || (!best.r.code.number && !inBudget())) {
    return result({ code: best.r.code, candidates: best.r.candidates, sure: false });
  }
  const copy = resampled(best.card);
  const second = await identifyCard(copy, (stage, p) => onProgress(stage, p, 2), { isStale, band: best.band });
  releaseCanvas(copy);
  if (second.status !== 'stopped' && (await isSure(second))) {
    return result({ code: second.code, candidates: second.candidates, sure: true });
  }

  return result({
    // Keep the fuller read to pre-fill the number form.
    code: second.code.number && !best.r.code.number ? second.code : best.r.code,
    candidates: unique([...best.r.candidates, ...second.candidates]),
    sure: false,
  });
}
