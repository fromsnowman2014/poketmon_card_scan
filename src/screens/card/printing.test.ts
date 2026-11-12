import { describe, expect, it } from 'vitest';
import type { CardVariant, PriceSummary } from '../../lib/types';
import {
  hasShinyPatterns,
  hasShinyUpgrade,
  howToTell,
  isMixedMirror,
  isRarePattern,
  patternArt,
  startVariant,
  tileLayout,
} from './printing';

const price = (market: number | null, source: PriceSummary['source'] = 'tcgplayer'): PriceSummary => ({
  market,
  low: market,
  high: market,
  changePct: null,
  source,
  converted: source === 'cardmarket',
});

function v(key: string, market: number | null | undefined, extra: Partial<CardVariant> = {}): CardVariant {
  const [type, ...rest] = key.split('-');
  const foil = type === 'reverse' && rest.length ? rest.join('-') : undefined;
  return { key, type, ...(foil ? { foil } : {}), summary: market === undefined ? null : price(market), ...extra };
}

/** ja/SV8a-084 with the TCGplayer-Japan file: Normal $0.18, Poké Ball mirror $0.60, Master Ball mirror $2.27. */
const hawlucha = { variants: [v('normal', 0.18), v('reverse', 0.6), v('reverse-masterball', 2.27)], defaultVariant: 'normal' };
const SV8A = { cardLang: 'ja', siblings: ['normal', 'reverse', 'reverse-masterball'] } as const;

describe('startVariant', () => {
  it('opens on the printing the link asks for', () => {
    expect(startVariant(hawlucha, 'reverse-masterball', [])).toBe('reverse-masterball');
    expect(startVariant(hawlucha, 'reverse-masterball', ['reverse'])).toBe('reverse-masterball');
  });

  it('ignores a printing the card does not have', () => {
    expect(startVariant(hawlucha, 'holo', [])).toBe('normal');
    expect(startVariant(hawlucha, '', [])).toBe('normal');
    expect(startVariant(hawlucha, null, [])).toBe('normal');
  });

  it('else opens on the only printing of the card saved in My Cards', () => {
    expect(startVariant(hawlucha, null, ['reverse'])).toBe('reverse');
    expect(startVariant(hawlucha, undefined, ['reverse-masterball', 'reverse-masterball'])).toBe('reverse-masterball');
    // A saved key the card no longer has does not count.
    expect(startVariant(hawlucha, null, ['holo', 'reverse'])).toBe('reverse');
    expect(startVariant(hawlucha, null, ['holo'])).toBe('normal');
  });

  it('else the default: nothing saved, or more than one printing saved', () => {
    expect(startVariant(hawlucha, null, [])).toBe('normal');
    expect(startVariant(hawlucha, null, ['reverse', 'reverse-masterball'])).toBe('normal');
  });
});

describe('tileLayout', () => {
  it('shares one row up to three plain names, scrolls for more or for long names', () => {
    expect(tileLayout(['Normal', 'Poké Ball', 'Master Ball'])).toBe('grid');
    expect(tileLayout(['기본', '리버스 홀로'])).toBe('grid');
    expect(tileLayout(['Normal', 'Reverse Holo', 'Poké Ball', 'Master Ball'])).toBe('scroll');
    expect(tileLayout(['Holo', 'Holo · Shadowless'])).toBe('scroll');
  });
});

describe('isMixedMirror', () => {
  it('marks a Cardmarket-priced plain mirror on a card that also has a special pattern', () => {
    const mirror = v('reverse', undefined, { summary: price(1.69, 'cardmarket') });
    const all = [v('normal', undefined, { summary: price(0.03, 'cardmarket') }), mirror, v('reverse-masterball', undefined)];
    expect(isMixedMirror(mirror, all)).toBe(true);
    expect(isMixedMirror(all[0], all)).toBe(false);
    expect(isMixedMirror(all[2], all)).toBe(false);
  });

  it('not with its own TCGplayer price, and not without a special pattern next to it', () => {
    expect(isMixedMirror(hawlucha.variants[1], hawlucha.variants)).toBe(false);
    const mirror = v('reverse', undefined, { summary: price(1.69, 'cardmarket') });
    expect(isMixedMirror(mirror, [v('normal', 0.1), mirror])).toBe(false);
    expect(isMixedMirror(v('reverse', undefined), [v('reverse', undefined), v('reverse-masterball', 2)])).toBe(false);
  });
});

describe('isRarePattern', () => {
  it('is an unpriced Master Ball printing next to a priced one', () => {
    const master = v('reverse-masterball', undefined);
    expect(isRarePattern(master, [v('normal', 0.03), master, v('reverse', 1.69)])).toBe(true);
    expect(isRarePattern(v('reverse-masterball', null), [v('normal', 0.03), v('reverse-masterball', null)])).toBe(true);
  });

  it('not when it has a price, nothing else has one, or it is another printing', () => {
    expect(isRarePattern(hawlucha.variants[2], hawlucha.variants)).toBe(false);
    const master = v('reverse-masterball', undefined);
    expect(isRarePattern(master, [v('normal', undefined), master])).toBe(false);
    const energy = v('reverse-energy', undefined);
    expect(isRarePattern(energy, [v('normal', 0.1), energy])).toBe(false);
  });
});

describe('hasShinyUpgrade', () => {
  it('is true on the default printing when a shinier one costs 3× or more', () => {
    expect(hasShinyUpgrade(hawlucha, 'normal')).toBe(true); // $0.60 and $2.27 against $0.18
    // Exactly 3×, whatever the cents.
    expect(hasShinyUpgrade({ variants: [v('normal', 0.15), v('reverse', 0.45)], defaultVariant: 'normal' }, 'normal')).toBe(true);
    // A special pattern next to a plain mirror default.
    expect(hasShinyUpgrade({ variants: [v('reverse', 1), v('reverse-masterball', 9)], defaultVariant: 'reverse' }, 'reverse')).toBe(true);
    expect(hasShinyUpgrade({ variants: [v('normal', 1), v('holo', 5)], defaultVariant: 'normal' }, 'normal')).toBe(true);
  });

  it('is false when the screen already shows another printing, or nothing shinier is worth 3×', () => {
    expect(hasShinyUpgrade(hawlucha, 'reverse')).toBe(false);
    expect(hasShinyUpgrade({ variants: [v('normal', 0.2), v('reverse', 0.5)], defaultVariant: 'normal' }, 'normal')).toBe(false);
    expect(hasShinyUpgrade({ variants: [v('normal', 0.2), v('reverse', undefined)], defaultVariant: 'normal' }, 'normal')).toBe(false);
    expect(hasShinyUpgrade({ variants: [v('normal', undefined), v('reverse', 5)], defaultVariant: 'normal' }, 'normal')).toBe(false);
    expect(hasShinyUpgrade({ variants: [v('holo', 100)], defaultVariant: 'holo' }, 'holo')).toBe(false);
  });

  it('is not about stamps and editions: those are not a shiny pattern', () => {
    const base = [v('holo', 400), v('holo-shadowless', 3000, { subtype: 'shadowless' }), v('firstEdition', 9000, { type: 'holo', stamp: ['1st-edition'] })];
    expect(hasShinyUpgrade({ variants: base, defaultVariant: 'holo' }, 'holo')).toBe(false);
  });
});

describe('howToTell', () => {
  it('describes the printings of a Japanese card with ball patterns', () => {
    expect(howToTell(hawlucha.variants[0], SV8A)).toBe('normalNoBall');
    expect(howToTell(hawlucha.variants[1], SV8A)).toBe('pokeball'); // the plain mirror is the Poké Ball one here
    expect(howToTell(hawlucha.variants[2], SV8A)).toBe('masterball');
    expect(howToTell(v('reverse-pokeball', 1), { cardLang: 'ja' })).toBe('pokeball');
    expect(howToTell(v('reverse-energy', 1), { cardLang: 'ja' })).toBe('energy');
    expect(howToTell(v('reverse-loveball', 1), { cardLang: 'ja' })).toBe('ball');
    expect(howToTell(v('reverse-team-rocket', 1), { cardLang: 'ja' })).toBe('rocket');
    expect(howToTell(v('holo', 1), { cardLang: 'ja', siblings: ['holo', 'reverse-pokeball', 'reverse-masterball'] })).toBe('holo');
  });

  it('uses the pattern the price data names for a plain mirror (M2a)', () => {
    const ctx = { cardLang: 'ja', siblings: ['normal', 'reverse-energy', 'reverse'], patterns: { reverse: 'team-rocket' } } as const;
    expect(howToTell(v('reverse', 1, { pattern: 'team-rocket' }), ctx)).toBe('rocket');
    expect(patternArt(v('reverse', 1, { pattern: 'team-rocket' }), ctx).mark).toBe('rocket');
    expect(howToTell(v('reverse', 1, { pattern: 'friendball' }), { cardLang: 'ja' })).toBe('ball');
    // The normal card of such a set: "no ball pattern" only when a sibling has a ball.
    expect(howToTell(v('normal', 1), ctx)).toBe('normal');
    expect(howToTell(v('normal', 1), { ...ctx, patterns: { reverse: 'duskball' } })).toBe('normalNoBall');
  });

  it('keeps it plain where no ball pattern is around', () => {
    const en = { cardLang: 'en', siblings: ['normal', 'reverse'] } as const;
    expect(howToTell(v('normal', 1), en)).toBe('normal');
    expect(howToTell(v('reverse', 1), en)).toBe('mirror');
    expect(howToTell(v('reverse', 1), { cardLang: 'ja', siblings: ['normal', 'reverse'] })).toBe('mirror');
    expect(howToTell(v('reverse-cosmos', 1), en)).toBe('mirror');
    expect(howToTell(v('normal', 1))).toBe('normal');
    // An English set with Poké Ball / Master Ball printings: its Reverse Holo stays a Reverse Holo.
    const prismatic = { cardLang: 'en', siblings: ['normal', 'reverse', 'reverse-pokeball', 'reverse-masterball'] } as const;
    expect(howToTell(v('normal', 1), prismatic)).toBe('normalNoBall');
    expect(howToTell(v('reverse', 1), prismatic)).toBe('mirror');
  });

  it('leads with what sets a printing apart: a stamp, the size, the 1st Edition mark', () => {
    expect(howToTell(v('normal-stamp-set-logo', 1, { type: 'normal', stamp: ['set-logo'] }))).toBe('stamp');
    expect(howToTell(v('normal-jumbo', 1, { type: 'normal', size: 'jumbo' }))).toBe('jumbo');
    expect(howToTell(v('firstEdition', 1, { type: 'holo', stamp: ['1st-edition'] }))).toBe('firstEdition');
    expect(howToTell(v('firstEdition', 1, { type: 'holo', stamp: ['1st edition'] }))).toBe('firstEdition');
  });

  it('says nothing about a printing it cannot describe in a line', () => {
    expect(howToTell(v('holo-shadowless', 1, { type: 'holo', subtype: 'shadowless' }))).toBeNull();
    expect(howToTell(v('holo', 1, { subtype: 'unlimited' }))).toBe('holo');
    expect(howToTell(v('cracked', 1))).toBeNull();
  });
});

describe('patternArt', () => {
  it('draws what shines and the mark of the pattern', () => {
    expect(patternArt(hawlucha.variants[0], SV8A)).toEqual({ shine: 'none' });
    expect(patternArt(hawlucha.variants[1], SV8A)).toEqual({ shine: 'body', mark: 'ball' });
    expect(patternArt(hawlucha.variants[2], SV8A)).toEqual({ shine: 'body', mark: 'master' });
    expect(patternArt(v('reverse-energy', 1))).toEqual({ shine: 'body', mark: 'energy' });
    expect(patternArt(v('reverse-quickball', 1))).toEqual({ shine: 'body', mark: 'ball' });
    expect(patternArt(v('reverse-team-rocket', 1))).toEqual({ shine: 'body', mark: 'rocket' });
    expect(patternArt(v('reverse', 1), { cardLang: 'en', siblings: ['normal', 'reverse'] })).toEqual({ shine: 'body' });
    expect(patternArt(v('holo', 1))).toEqual({ shine: 'picture' });
    expect(patternArt(v('firstEdition', 1, { type: 'holo', stamp: ['1st-edition'] }))).toEqual({ shine: 'picture', stamp: true });
  });
});

describe('hasShinyPatterns', () => {
  it('is about cards with a mirror printing', () => {
    expect(hasShinyPatterns(hawlucha.variants)).toBe(true);
    expect(hasShinyPatterns([v('holo', 1), v('holo-shadowless', 2, { type: 'holo' })])).toBe(false);
  });
});
