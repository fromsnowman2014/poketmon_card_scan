// Scan policy on top of identifyCard: decide whether a result is sure enough to open directly, and take
// more looks when it is not. OCR of a live-video crop (~700 px wide) misreads the small italic number
// often enough ("084/187" → "054/187", even in two passes that agree) that one look is not proof by itself.
import { findCards, identifyCard, type IdentifyOutcome } from '../../lib/identify';
import { CODE_STRIP, cropRegion, releaseCanvas, SMALL_CODE_STRIP, upscaleTo, type Rect } from '../../lib/imageProc';
import type { CodeStripStatus } from '../../lib/ocr';
import { resolveSets } from '../../lib/tcgdex';
import type { CardBrief, IdentifyResult, PrintedCode, ProgressFn } from '../../lib/types';

export type Stage = Parameters<ProgressFn>[0];
/** 1: first look. 2: a closer look (higher band, zoomed in, or a resampled copy). 'turn': the photo turned sideways. */
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
  /**
   * The crop is a live camera frame cut at the guide frame. Kids hold the card at 75–95% of the guide, which moves the
   * number up and in from where it sits on a filled frame, so the crop zoomed in on its center (LIVE_ZOOM) is read too.
   */
  live?: boolean;
  /** Clock for the time budget (tests). */
  now?: () => number;
}

export interface ScanOutcome {
  code: PrintedCode;
  candidates: CardBrief[];
  /** One candidate whose set code, total and number all agree with what was read (on a small crop, in two looks). */
  sure: boolean;
  /** 'unavailable': the OCR engine could not load, nothing was read. 'stopped': isStale cut it short. */
  status: CodeStripStatus;
  /** The turned crop the result was read from (the caller releases it); absent for the original crop. */
  card?: HTMLCanvasElement;
  /** Where the number was read, as fractions of the original (or turned) crop, when not the usual CODE_STRIP. */
  band?: Rect;
}

/** Best OCR passes for the higher band: enough to read a small card, cheap on a miss. */
const SMALL_PASSES = 3;
/** Best OCR passes per turned try: two agreeing passes settle an upright card; a wrong turn costs little. */
const TURN_PASSES = 2;
/**
 * Extra tries (turned photo, higher band, zoomed crop, second look) stop starting once they have run this long without
 * reading any number, so a photo with no readable number reaches the number form soon. Counted from the end of the
 * first look, so a slow phone still gets them. Worst case: first look + this + the try still running (≤ 6 passes).
 */
const EXTRA_TRIES_BUDGET_MS = 10_000;
/**
 * Once a number was read, the zoomed and turned looks only add cards to pick from: they stop starting this long after
 * the first look ends, so a slow phone doesn't run all 4 looks. The second look (the one that confirms the best read
 * and can open the card directly) still starts until EXTRA_TRIES_BUDGET_MS, so the worst case stays first look + 10 s +
 * the try still running.
 */
const READ_TRIES_BUDGET_MS = 8_000;
/** A crop narrower than this (a 1080p camera frame gives ~720 px) misreads digits often: a sure look needs a second that agrees. */
export const CONFIRM_BELOW_PX = 1000;
/**
 * Live-camera zooms: the central 88% and 80% of the crop. A card held at ~75–95% of the guide fills the first, and one
 * at ~65–85% the second, where the usual band reads its number without much of the background around the card (which
 * throws off the contrast). The unzoomed first look covers ~85–105%.
 */
export const LIVE_ZOOMS = [0.88, 0.8] as const;

/**
 * Whether the number read is the card's. A card that prints leading zeros ('084', '004') must be read with them:
 * '84' or '4' is a read that lost digits ('084' read as '4' opened #004). Without printed zeros ('4/102') a stray
 * zero is fine.
 */
export function sameNumber(localId: string, read: string): boolean {
  const a = localId.toUpperCase();
  const b = read.toUpperCase();
  if (a === b) return true;
  if (/^0./.test(a)) return false;
  return a.replace(/^0+(?=.)/, '') === b.replace(/^0+(?=.)/, '');
}

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

/**
 * Whether the first look's text suggests a card lying sideways: no digit at all, or mostly 1–2 character bits
 * (Tesseract chops turned glyphs into fragments; an upright card gives words). Measured on real photos: sideways
 * 0.56–0.67 bits over 48–162 lines, upright cards held small 0.26–0.32 over 19–29 lines.
 */
export function looksSideways(rawText: string): boolean {
  if (!/\d/.test(rawText)) return true;
  const lines = rawText.split('\n').filter((l) => l.trim());
  const bits = lines.filter((l) => l.replace(/\s/g, '').length <= 2).length;
  return lines.length >= 15 && bits / lines.length >= 0.45;
}

/** A different resampling of the same card: Tesseract often reads it right where the original failed. */
function resampled(card: HTMLCanvasElement): HTMLCanvasElement {
  return upscaleTo(card, card.width < 1000 ? 1100 : Math.round(card.width * 0.7));
}

/** The central `zoom` of the crop at its own resolution (a card held smaller than the guide fills it). */
function zoomedIn(card: HTMLCanvasElement, zoom: number): HTMLCanvasElement {
  const m = (1 - zoom) / 2;
  return cropRegion(card, m, m, zoom, zoom);
}

/** `band` of the zoomed crop, as fractions of the crop it was cut from. */
export function unzoom(band: Rect, zoom: number): Rect {
  const m = (1 - zoom) / 2;
  return { x: m + band.x * zoom, y: m + band.y * zoom, w: band.w * zoom, h: band.h * zoom };
}

const cardKey = (c: CardBrief) => `${c.lang}:${c.id}`;

/** One look that read a number: what it read, the crop and band it read, and that band on the crop the kid sees. */
interface Read {
  r: IdentifyOutcome;
  card: HTMLCanvasElement;
  band?: Rect;
  shown?: Rect;
  sure: boolean;
}

/**
 * A read whose total came out short ("084/18": the last digit lost at the strip edge) finds no card. When another look
 * read a longer total that starts the same ("187"), look the number up with that one.
 */
async function borrowTotals(reads: Read[], isStale?: () => boolean): Promise<void> {
  for (const x of reads) {
    const { total } = x.r.code;
    if (x.r.candidates.length || !total || isStale?.()) continue;
    const longer = reads.map((y) => y.r.code.total).find((t) => t && t.length > total.length && t.startsWith(total));
    if (!longer) continue;
    const code = { ...x.r.code, total: longer };
    x.r = { ...x.r, code, candidates: await findCards(code, { isStale }) };
  }
}

/** Every candidate of the reads: `first`'s, then the ones more looks found, then in the order of the reads. */
function voted(reads: Read[], first?: Read): CardBrief[] {
  const tally = new Map<string, { card: CardBrief; votes: number; order: number }>();
  for (const { r } of reads) {
    for (const c of r.candidates) {
      const t = tally.get(cardKey(c));
      if (t) t.votes++;
      else tally.set(cardKey(c), { card: c, votes: 1, order: tally.size });
    }
  }
  const own = new Set(first?.r.candidates.map(cardKey));
  const mine = (t: { card: CardBrief }) => (own.has(cardKey(t.card)) ? 1 : 0);
  return [...tally.values()].sort((a, b) => mine(b) - mine(a) || b.votes - a.votes || a.order - b.order).map((t) => t.card);
}

/** The number without leading zeros, for comparing two reads (the zeros were checked by isSure). */
const digits = (n: string | undefined) => (n ?? '').replace(/^0+(?=.)/, '').toUpperCase();
/** Two totals that may be the same print, one read short ('18' for '187'). */
const totalsFit = (a?: string, b?: string) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

/**
 * The read that settles the scan, if any. A big crop: any sure read. A small crop (`confirm`): a sure read whose number
 * another look also read, and no look that read another number on what looks like the same line (same set code, or a
 * fitting total). Reads of other text ("1/260" from the artist line) neither confirm nor block.
 */
function settled<T extends Pick<Read, 'r' | 'sure'>>(reads: T[], confirm: boolean): T | undefined {
  const sure = reads.find((x) => x.sure);
  if (!sure || !confirm) return sure;
  const { number, total, setCode } = sure.r.code;
  const others = reads.filter((x) => x !== sure).map((x) => x.r.code);
  const agree = others.filter((c) => digits(c.number) === digits(number));
  const conflict = others.some(
    (c) => digits(c.number) !== digits(number) && (totalsFit(c.total, total) || (!!c.setCode && c.setCode === setCode)),
  );
  return agree.length && !conflict ? sure : undefined;
}

const sameCards = (a: CardBrief[], b: CardBrief[]) =>
  a.length === b.length && a.every((c) => b.some((d) => cardKey(c) === cardKey(d)));

/**
 * Two looks that read the same number (leading zeros aside) with a fitting total and found the same cards, more than
 * one (an English "189/198" is in several sets): more looks would most likely repeat them, so the scan ends there and
 * the picker shows those cards. One card found twice keeps looking (within the budget): a later look that reads the
 * set code right opens it (camera tests: 2 of 11 direct opens came from the 4th look after two agreeing ones).
 * Never makes a scan sure.
 */
function agreed(reads: Pick<Read, 'r'>[]): boolean {
  return reads.some(({ r: a }, i) =>
    reads.slice(i + 1).some(
      ({ r: b }) =>
        a.candidates.length > 1 &&
        digits(a.code.number) === digits(b.code.number) &&
        totalsFit(a.code.total, b.code.total) &&
        sameCards(a.candidates, b.candidates),
    ),
  );
}

/** Whether read `b` backs number `a`: the same digits, or its tail ("4" is "084" with the "08" lost). */
const backs = (a: string | undefined, b: string | undefined) => {
  const [da, db] = [digits(a), digits(b)];
  return da === db || (db.length > 0 && db.length < da.length && da.endsWith(db));
};

/** The read to show and build on: the one whose number most looks back; on a tie a sure one, then the earliest. */
function lead<T extends Pick<Read, 'r' | 'sure'>>(reads: T[]): T | undefined {
  const rank = (x: T) => reads.filter((y) => backs(x.r.code.number, y.r.code.number)).length * 2 + (x.sure ? 1 : 0);
  return reads.reduce<T | undefined>((best, x) => (!best || rank(x) > rank(best) ? x : best), undefined);
}

/**
 * identifyCard, plus extra looks while the answer is not settled. When no number was read at all: the photo turned 90°
 * and 270° (photo path; before the higher band when the first look read no digit at all) and the band above the usual
 * one (a card held small; photo path). On a live camera frame: the crop zoomed in on its center (LIVE_ZOOMS). Then a
 * second look at a resampled copy of the best read. On a small crop, a sure answer needs two looks that agree; anything
 * less goes to the picker, the cards more looks found first. The extra looks end early once two of them read the same
 * number and found the same few cards (agreed). The zoomed and turned looks stop starting 8 s after the first look
 * once a number was read (10 s while none was); the confirming second look starts until 10 s. At most 4 looks (24 OCR
 * passes) on a live frame. Never throws.
 */
export async function scanCard(card: HTMLCanvasElement, onProgress: ScanProgress, opts: ScanOptions = {}): Promise<ScanOutcome> {
  const { isStale, turned, live, now = () => Date.now() } = opts;
  const stopped = (r: IdentifyOutcome): ScanOutcome => ({ code: r.code, candidates: [], sure: false, status: 'stopped' });
  const confirm = card.width < CONFIRM_BELOW_PX;

  const first = await identifyCard(card, (stage, p) => onProgress(stage, p, 1), { isStale });
  if (first.status === 'stopped') return stopped(first);
  const firstSure = await isSure(first);
  if (firstSure && !confirm) return { code: first.code, candidates: first.candidates, sure: true, status: 'done' };
  if (first.status === 'unavailable') {
    // The engine never loaded (or died): no point in more looks.
    return { code: first.code, candidates: first.candidates, sure: false, status: first.code.number ? 'done' : 'unavailable' };
  }

  const extraStart = now();
  const inBudget = () => now() - extraStart < EXTRA_TRIES_BUDGET_MS;
  const inReadBudget = () => now() - extraStart < READ_TRIES_BUDGET_MS;
  const reads: Read[] = first.code.number ? [{ r: first, card, sure: firstSure }] : [];
  const zoomed: HTMLCanvasElement[] = []; // freed at the end
  let turnedCard: HTMLCanvasElement | undefined;
  const over = () => !!isStale?.() || !!settled(reads, confirm);
  /**
   * Whether another extra look should start: not settled, no two looks agree yet, and time left (8 s once a number was
   * read, else 10 s; the confirming second look always gets the 10 s).
   */
  const more = (confirming = false) =>
    !over() && !agreed(reads) && (reads.length > 0 && !confirming ? inReadBudget() : inBudget());

  /** One look; kept when it read a number. */
  const look = async (crop: HTMLCanvasElement, l: Look, o: { band?: Rect; shown?: Rect; maxPasses?: number } = {}) => {
    const r = await identifyCard(crop, (stage, p) => onProgress(stage, p, l), { isStale, band: o.band, maxPasses: o.maxPasses });
    if (r.status !== 'stopped' && r.code.number) {
      reads.push({ r, card: crop, band: o.band, shown: o.shown ?? o.band, sure: await isSure(r) });
    }
    return r;
  };
  const smallBand = async () => {
    // A live frame reads that part of the card in the zoomed crop instead (wider, and level with the card's own contrast).
    if (live || reads.length || over() || !inBudget()) return;
    await look(card, 2, { band: SMALL_CODE_STRIP, maxPasses: SMALL_PASSES });
  };
  const turns = async () => {
    for (const q of [1, 3] as const) {
      if (!turned || reads.length || over() || !inBudget()) return;
      let crop: HTMLCanvasElement;
      try {
        crop = turned(q);
      } catch {
        return; // the photo is gone (closed): keep what the looks found
      }
      const r = await look(crop, 'turn', { maxPasses: TURN_PASSES });
      if (r.code.number && r.status !== 'stopped') {
        turnedCard = crop;
        return;
      }
      releaseCanvas(crop);
      if (r.status !== 'done') return;
    }
  };

  if (!first.code.number) {
    // Most likely a sideways photo: turn it before reading the band above.
    const sideways = looksSideways(first.rawText);
    if (sideways) await turns();
    await smallBand();
    if (!sideways) await turns();
  }

  for (const zoom of live && !turnedCard ? LIVE_ZOOMS : []) {
    if (!more()) break;
    const z = zoomedIn(card, zoom);
    zoomed.push(z);
    await look(z, 2, { shown: unzoom(CODE_STRIP, zoom) });
  }

  if (more(true)) {
    const from: Pick<Read, 'card' | 'band' | 'shown'> = lead(reads) ?? { card: turnedCard ?? card };
    const copy = resampled(from.card);
    await look(copy, 2, { band: from.band, shown: from.shown });
    releaseCanvas(copy);
  }

  zoomed.forEach(releaseCanvas);
  const done = settled(reads, confirm);
  if (!done) await borrowTotals(reads, isStale);
  if (isStale?.()) {
    if (turnedCard) releaseCanvas(turnedCard);
    return stopped(first);
  }
  if (done) return { code: done.r.code, candidates: done.r.candidates, sure: true, status: 'done', card: turnedCard, band: done.shown };
  const from = lead(reads);
  return {
    // The read most looks agree with pre-fills the number form.
    code: from?.r.code ?? first.code,
    // The lead read's cards first, then the rest, the ones more looks found first.
    candidates: voted(from ? [from, ...reads.filter((x) => x !== from)] : reads, from),
    sure: false,
    status: 'done',
    card: turnedCard,
    band: from?.shown,
  };
}
