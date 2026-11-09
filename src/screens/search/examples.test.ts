import { describe, expect, it } from 'vitest';
import { parseQueryCode } from '../../lib/tcgdex';
import { NUMBER_EXAMPLES, searchExamples } from './examples';

describe('searchExamples', () => {
  it('offers the cards kids in each country hold', () => {
    expect(searchExamples('KR', 'ko')).toEqual(['피카츄', '리자몽 ex', 'sv8a 084/187']);
    expect(searchExamples('KR', 'en')).toEqual(['Pikachu', 'Charizard ex', 'sv8a 084/187']);
    expect(searchExamples('US', 'ko')).toEqual(['피카츄', '리자몽 ex', 'MEW 199/165']);
    expect(searchExamples('US', 'en')).toEqual(['Pikachu', 'Charizard ex', 'MEW 199/165']);
  });

  it('uses numbers the search reads as printed codes', () => {
    expect(parseQueryCode(NUMBER_EXAMPLES.KR.full)).toEqual({ setCode: 'sv8a', number: '084', total: '187' });
    expect(parseQueryCode(NUMBER_EXAMPLES.US.full)).toEqual({ setCode: 'MEW', number: '199', total: '165' });
    expect(parseQueryCode(NUMBER_EXAMPLES.KR.total)).toEqual({ number: '084', total: '187' });
    expect(parseQueryCode(NUMBER_EXAMPLES.US.total)).toEqual({ number: '199', total: '165' });
    expect(parseQueryCode(NUMBER_EXAMPLES.KR.set)).toEqual({ setCode: 'sv8a', number: '084' });
    expect(parseQueryCode(NUMBER_EXAMPLES.US.set)).toEqual({ setCode: 'MEW', number: '199' });
    // Kids type lowercase too.
    expect(parseQueryCode('mew 199')).toEqual({ setCode: 'MEW', number: '199' });
  });
});
