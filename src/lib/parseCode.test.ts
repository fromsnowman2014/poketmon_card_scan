import { describe, expect, it } from 'vitest';
import { mergeParses, parsePrintedCode, type ParseOptions } from './parseCode';
import type { PrintedCode } from './types';

const known: ParseOptions = {
  knownSetIds: ['SV8', 'SV8a', 'SV7', 'SV7a', 'SV4a', 'SV4K', 'SV4M', 'SV11B', 'SV11W', 'S12a', 'SM12a', 'M2a', 'SV-P'],
  knownEnAbbrs: ['SVI', 'PAL', 'OBF', 'MEW', 'PAR', 'PAF', 'TEF', 'TWM', 'SFA', 'SCR', 'SSP', 'PRE', 'JTG', 'DRI', 'MEG', 'PFL', 'SSH', 'BRS'],
};

const fields = ({ setCode, number, total, lang, promo }: PrintedCode) => ({ setCode, number, total, lang, promo });

function expectCode(input: string, expected: PrintedCode, opts?: ParseOptions) {
  expect(fields(parsePrintedCode(input, opts))).toEqual(fields(expected));
}

describe('parsePrintedCode: Japanese / Korean set codes', () => {
  const sv8a = { setCode: 'SV8a', number: '084', total: '187', lang: 'ja' } as const;
  it.each([
    'G sv8a 084/187',
    'Bsv8ag 084/187', // regulation mark glued on (real OCR)
    'ET lUsSRGOSSAN id G sv8ag 084/187 g - I88 l', // real OCR of the whole strip
    'G sv8o O84 / I87',
    '5v8a. 084/187',
    'svBa 084/187',
    'sv8a084/187',
    'ｓｖ８ａ　０８４／１８７', // full-width
  ])('%s → SV8a 084/187', (input) => expectCode(input, sv8a));

  it('snaps upper-case codes to the real set id', () => {
    expectCode('G SV8A 084/187', sv8a, known);
  });

  it('reads the slash misread as 7 and a code with the suffix read as 0', () => {
    expectCode('Gt I0547167 sv80', { setCode: 'SV8a', number: '054', total: '167', lang: 'ja' });
  });

  it.each([
    ['H sv4K 066/066', { setCode: 'SV4K', number: '066', total: '066', lang: 'ja' }],
    ['F s12a 262/172', { setCode: 'S12a', number: '262', total: '172', lang: 'ja' }],
    ['SM12a 001/173', { setCode: 'SM12a', number: '001', total: '173', lang: 'ja' }],
    ['I M2a 201/193', { setCode: 'M2a', number: '201', total: '193', lang: 'ja' }],
    ['H sv11B 175/086', { setCode: 'SV11B', number: '175', total: '086', lang: 'ja' }],
    ['G sv8a 217/187', { setCode: 'SV8a', number: '217', total: '187', lang: 'ja' }], // secret rare above the total
  ] as const)('%s', (input, expected) => expectCode(input, expected));

  it('snaps a dropped suffix when only one set matches', () => {
    expectCode('G sv4 236/190', { setCode: 'SV4a', number: '236', total: '190', lang: 'ja' }, { knownSetIds: ['SV4a', 'SV5a'] });
  });

  it('marks Hangul text as Korean', () => {
    expectCode('G sv4a 236/190 피카츄', { setCode: 'SV4a', number: '236', total: '190', lang: 'ko' });
    expectCode('루차불 G sv8a 084/187', { setCode: 'SV8a', number: '084', total: '187', lang: 'ko' });
  });

  it('reads the suffix when OCR doubles it (real OCR)', () => {
    expectCode('sv8ocvars', { setCode: 'SV8a', lang: 'ja' });
    expectCode('8Isv8oepaaEm', { setCode: 'SV8a', lang: 'ja' });
  });

  it('prefers a JA code over a known abbreviation hidden in noise (real OCR)', () => {
    expectCode('Ld dnd umn ug Nur maul SE -t | sv8o & | 5084/,187, 0 EL Con Tyr co - ; ere PORE I ES HCE', { setCode: 'SV8a', lang: 'ja' }, { knownEnAbbrs: ['POR'] });
  });

  it('gives up on an unreadable code (real OCR)', () => {
    expect(parsePrintedCode('@ svéo | cvars')).toEqual({ score: 0 });
  });
});

describe('parsePrintedCode: promos', () => {
  it.each([
    ['085/SV-P', { setCode: 'SV-P', number: '085', lang: 'ja', promo: true }],
    ['O85 / SV—P', { setCode: 'SV-P', number: '085', lang: 'ja', promo: true }],
    ['O01/M-P', { setCode: 'M-P', number: '001', lang: 'ja', promo: true }],
    ['SVP EN 085', { setCode: 'SVP', number: '085', lang: 'en', promo: true }],
    ['MEP EN 012', { setCode: 'MEP', number: '012', lang: 'en', promo: true }],
    ['SWSH123', { setCode: 'SWSH', number: '123', lang: 'en', promo: true }],
  ] as const)('%s', (input, expected) => expectCode(input, expected));
});

describe('parsePrintedCode: English', () => {
  it.each([
    ['G PAR EN 123/182', { setCode: 'PAR', number: '123', total: '182', lang: 'en' }],
    ['H MEG EN 012/132', { setCode: 'MEG', number: '012', total: '132', lang: 'en' }],
    ['G PRE EN O84/131', { setCode: 'PRE', number: '084', total: '131', lang: 'en' }],
    ['G SVI EN 001/198', { setCode: 'SVI', number: '001', total: '198', lang: 'en' }],
    ['D SSH EN 025/202', { setCode: 'SSH', number: '025', total: '202', lang: 'en' }],
    ['PAR FR 123/182', { setCode: 'PAR', number: '123', total: '182' }], // other European prints: no lang
  ] as const)('%s', (input, expected) => expectCode(input, expected));

  it('reads the superscript EN glued onto the abbreviation (real OCR)', () => {
    expectCode('ThisPoke lllusNaokiSaito fromtheft INEGe 012/132 IMEGex', { setCode: 'MEG', number: '012', total: '132', lang: 'en' });
  });

  it('ignores abbreviation-like noise that is not a known set (real OCR)', () => {
    expectCode('AVRENRLLoWRL BoKRIYkh5a/1878Ehay', {}, known);
    expectCode('si8a AAT ES Suma', {}, known);
  });

  it('does not read the glued EN abbreviation SVI as a JA code', () => {
    expectCode('8SVIegevmo 001/198', { setCode: 'SVI', number: '001', total: '198', lang: 'en' }, known);
  });

  it('matches known abbreviations in garbled text (real OCR)', () => {
    expectCode('11/usWAnesakiJDynamig 8PARegevmo 1237182k4 02023Pokemon/Nintendo', { setCode: 'PAR', number: '123', total: '182', lang: 'en' }, known);
  });

  it.each([
    ['58/102', { number: '58', total: '102' }],
    ['Illus. Mitsuhiro Arita 4/102 ★', { number: '4', total: '102' }],
    ['D 025/202 ★', { number: '025', total: '202' }],
    ['TG05/TG30', { number: 'TG05', total: 'TG30' }],
    ['GG01/GG70', { number: 'GG01', total: 'GG70' }],
    ['SV001/SV122', { number: 'SV001', total: 'SV122' }],
    ['RC1/RC32', { number: 'RC1', total: 'RC32' }],
  ] as const)('number only: %s', (input, expected) => expectCode(input, expected));
});

describe('parsePrintedCode: noise', () => {
  it('drops stray box-edge and rarity digits (real OCR)', () => {
    expectCode('R//IUsHGOSSANEE STOVE FO 1084/1870 Er Te', { number: '084', total: '187' });
  });

  it('does not read the illustrator line as a number (real OCR)', () => {
    expect(parsePrintedCode('11/5sWAncsokiJDynGmid').number).toBeUndefined();
  });

  it('reads a slash seen twice (real OCR)', () => {
    expectCode('I RALUIN0847/187', { number: '084', total: '187' });
  });

  it('keeps a partial number without inventing a set code (real OCR)', () => {
    expectCode('XY GOSS GAN Hye - asx EN0s4/187 HPS', { number: '4', total: '187' });
  });

  it.each(['', '   ', 'hello world', '©2023 Pokémon/Nintendo/Creatures/GAME FREAK', '999/999'])(
    'finds nothing in %j',
    (input) => expect(parsePrintedCode(input).number).toBeUndefined(),
  );

  it('scores a clean read above a fuzzy one', () => {
    expect(parsePrintedCode('G sv8a 084/187').score).toBeGreaterThan(parsePrintedCode('G sv8o O84 / I87').score);
    expect(parsePrintedCode('G sv8a 084/187').score).toBeLessThanOrEqual(1);
  });
});

describe('mergeParses', () => {
  it('recovers SV8a 084/187 from real per-pass OCR output', () => {
    const merged = mergeParses(['Bsv8ag 084/187', 'oY 084/187', 'Bsv8a', '@ svéo | cvars', 'Gt I0547167'].map((t) => parsePrintedCode(t)));
    expect(fields(merged)).toEqual({ setCode: 'SV8a', number: '084', total: '187', lang: 'ja', promo: undefined });
  });

  it('votes number and total as a pair', () => {
    const merged = mergeParses(['084/187', '084/187', '034/181'].map((t) => parsePrintedCode(t)));
    expect([merged.number, merged.total]).toEqual(['084', '187']);
  });

  it('keeps the promo flag and the best score', () => {
    const merged = mergeParses([parsePrintedCode('085/SV-P'), parsePrintedCode('nothing')]);
    expect(merged).toMatchObject({ setCode: 'SV-P', number: '085', promo: true, score: 0.9 });
    expect(merged.total).toBeUndefined();
  });

  it('returns an empty code for no passes', () => {
    expect(fields(mergeParses([]))).toEqual(fields({}));
    expect(mergeParses([]).score).toBe(0);
  });
});
