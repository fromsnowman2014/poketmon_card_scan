// Scan policy on top of identifyCard: decide whether a result is sure enough to open directly, and take
// one more look when it is not. OCR of a live-video crop (~700 px wide) misreads the small italic number
// often enough ("084/187" → "083/087") that a lone candidate is not proof by itself.
import { identifyCard } from '../../lib/identify';
import { releaseCanvas, upscaleTo } from '../../lib/imageProc';
import { resolveSets } from '../../lib/tcgdex';
import type { CardBrief, IdentifyResult, PrintedCode, ProgressFn } from '../../lib/types';

export type Stage = Parameters<ProgressFn>[0];
export type ScanProgress = (stage: Stage, progress: number, look: 1 | 2) => void;

export interface ScanOutcome {
  code: PrintedCode;
  candidates: CardBrief[];
  /** One candidate whose set code, total and number all agree with what was read. */
  sure: boolean;
}

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

/** identifyCard, plus a second look at a resampled copy when the first answer is not sure. Never throws. */
export async function scanCard(card: HTMLCanvasElement, onProgress: ScanProgress): Promise<ScanOutcome> {
  const first = await identifyCard(card, (stage, p) => onProgress(stage, p, 1));
  if (await isSure(first)) return { code: first.code, candidates: first.candidates, sure: true };

  const copy = resampled(card);
  const second = await identifyCard(copy, (stage, p) => onProgress(stage, p, 2));
  releaseCanvas(copy);
  if (await isSure(second)) return { code: second.code, candidates: second.candidates, sure: true };

  return {
    // Keep the fuller read to pre-fill the number form.
    code: second.code.number && !first.code.number ? second.code : first.code,
    candidates: unique([...first.candidates, ...second.candidates]),
    sure: false,
  };
}
