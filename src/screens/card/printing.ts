// Pure helpers for a card's printings: which one the screen opens on, how the picker lays them out, what the price
// panel has to say about one, and what the "how to tell" sheet draws. Kept apart from React so they are unit-tested.
import type { CardDetail, CardVariant } from '../../lib/types';
import { foilOf, plainMirrorIsPokeBall, type VariantLabelContext } from './format';

type Printing = Pick<CardVariant, 'key' | 'type' | 'foil' | 'stamp' | 'subtype' | 'size' | 'summary'>;

/**
 * The printing the Card screen opens on: the one asked for (`?v=`, from My Cards and Recent) when the card has it,
 * else the only printing of this card saved in My Cards, else the card's default.
 */
export function startVariant(
  card: Pick<CardDetail, 'variants' | 'defaultVariant'>,
  wanted: string | null | undefined,
  savedKeys: readonly string[],
): string {
  const has = (key: string | null | undefined): key is string => !!key && card.variants.some((v) => v.key === key);
  if (has(wanted)) return wanted;
  const saved = [...new Set(savedKeys)].filter(has);
  return saved.length === 1 ? saved[0] : card.defaultVariant;
}

/** Up to three plain names share one row in equal columns; more printings, or a name like "Holo · Shadowless", scroll sideways. */
export function tileLayout(shortNames: readonly string[]): 'grid' | 'scroll' {
  return shortNames.length > 3 || shortNames.some((name) => name.includes(' · ')) ? 'scroll' : 'grid';
}

/**
 * True when a plain mirror's price is Cardmarket's number for every mirror pattern of the card together: it has no
 * TCGplayer price and the card also has a special pattern (Master Ball…). The panel says so next to the source.
 */
export function isMixedMirror(variant: Printing, variants: readonly Printing[]): boolean {
  return (
    variant.type === 'reverse' &&
    !variant.foil &&
    variant.summary?.source === 'cardmarket' &&
    variants.some((v) => v.key !== variant.key && v.type === 'reverse' && !!v.foil)
  );
}

/** An unpriced Master Ball printing of a card whose other printings have prices: rare, and worth more than those. */
export function isRarePattern(variant: Printing, variants: readonly Printing[]): boolean {
  const priced = (v: Printing) => v.summary != null && v.summary.market !== null;
  return variant.foil === 'masterball' && !priced(variant) && variants.some((v) => v.key !== variant.key && priced(v));
}

/** A shinier printing counts from this many times the price of the one shown. */
const NUDGE_RATIO = 3;

/**
 * After a scan: is it worth telling the kid to check the shiny pattern? Only when the screen shows the card's default
 * printing and a shinier one (another finish, or a special pattern) costs at least 3× as much.
 */
export function hasShinyUpgrade(card: Pick<CardDetail, 'variants' | 'defaultVariant'>, shownKey: string): boolean {
  const shown = card.variants.find((v) => v.key === card.defaultVariant);
  const base = shown?.summary?.market;
  if (!shown || shownKey !== shown.key || !base) return false;
  return card.variants.some((v) => {
    const market = v.summary?.market;
    const shinier = v.type !== shown.type || (!!v.foil && v.foil !== shown.foil);
    // Float-tolerant: exactly 3× counts.
    return v.key !== shown.key && shinier && market != null && market >= NUDGE_RATIO * base * (1 - 1e-9);
  });
}

/** One line of "how to tell" copy (VariantHelp), or null when we have nothing true and simple to say. */
export type HowKey =
  | 'normal'
  | 'normalNoBall'
  | 'holo'
  | 'mirror'
  | 'pokeball'
  | 'masterball'
  | 'energy'
  | 'ball'
  | 'rocket'
  | 'firstEdition'
  | 'stamp'
  | 'jumbo';

/** The little drawing next to it: what shines, the mark in the bottom half, and a stamp dot. */
export interface PatternArt {
  shine: 'none' | 'picture' | 'body';
  mark?: 'ball' | 'master' | 'energy' | 'rocket';
  stamp?: boolean;
}

const isFirstEdition = (v: Printing) => !!v.stamp?.some((s) => s === '1st-edition' || s === '1st edition');
const otherStamps = (v: Printing) => (v.stamp ?? []).filter((s) => s !== '1st-edition' && s !== '1st edition');
const isBall = (foil: string | undefined) => !!foil && foil.endsWith('ball');

/** The pattern a printing shows: its own foil, or Poké Ball for the plain mirror of a card that works that way. */
function patternOf(v: Printing, ctx: VariantLabelContext): string | undefined {
  if (v.type !== 'reverse') return undefined;
  return v.foil ?? (plainMirrorIsPokeBall(ctx) ? 'pokeball' : undefined);
}

const MARKS: Record<string, PatternArt['mark']> = { masterball: 'master', energy: 'energy', 'team-rocket': 'rocket' };

export function patternArt(v: Printing, ctx: VariantLabelContext = {}): PatternArt {
  const pattern = patternOf(v, ctx);
  const mark = pattern ? (MARKS[pattern] ?? (isBall(pattern) ? 'ball' : undefined)) : undefined;
  const shine = v.type === 'reverse' ? 'body' : v.type === 'holo' ? 'picture' : 'none';
  return { shine, ...(mark ? { mark } : {}), ...(v.stamp?.length ? { stamp: true } : {}) };
}

/**
 * Which "how to tell" line fits a printing. What sets it apart from its siblings comes first: an extra stamp, a giant
 * card, the 1st Edition mark; then the shine. A sub-type we can't describe in a line (shadowless…) gets none.
 */
export function howToTell(v: Printing, ctx: VariantLabelContext = {}): HowKey | null {
  if (otherStamps(v).length) return 'stamp';
  if (v.size && v.size !== 'standard') return 'jumbo';
  if (isFirstEdition(v)) return 'firstEdition';
  if (v.subtype && v.subtype !== 'unlimited') return null;
  const pattern = patternOf(v, ctx);
  if (pattern === 'pokeball' || pattern === 'masterball' || pattern === 'energy') return pattern;
  if (pattern === 'team-rocket') return 'rocket';
  if (isBall(pattern)) return 'ball';
  if (v.type === 'reverse') return 'mirror';
  if (v.type === 'holo') return 'holo';
  if (v.type !== 'normal') return null;
  // "No ball pattern" only where a sibling has one.
  const balls = plainMirrorIsPokeBall(ctx) || (ctx.siblings ?? []).some((key) => isBall(foilOf(key)));
  return balls ? 'normalNoBall' : 'normal';
}

/** True when the card's printings differ by a shiny pattern (a mirror among them): the wording of the help line. */
export function hasShinyPatterns(variants: readonly Printing[]): boolean {
  return variants.some((v) => v.type === 'reverse');
}
