// Example searches for the Search screen, by where the kid lives (settings.country) and the UI language.
import type { Country, UiLang } from '../../lib/types';

/**
 * A printed number from a card kids in that country hold. Korean kids have Korean/Japanese cards, searched in the
 * JA data ("sv8a 084/187", Hawlucha); American kids have English cards, which print the set's abbreviation
 * ("MEW 199/165", Charizard ex from Pokémon 151). `total` and `set` are the two shorter ways to type it.
 */
export const NUMBER_EXAMPLES: Record<Country, { full: string; total: string; set: string }> = {
  KR: { full: 'sv8a 084/187', total: '084/187', set: 'sv8a 084' },
  US: { full: 'MEW 199/165', total: '199/165', set: 'MEW 199' },
};

const NAME_EXAMPLES: Record<UiLang, string[]> = { ko: ['피카츄', '리자몽 ex'], en: ['Pikachu', 'Charizard ex'] };

/**
 * The suggestion chips: two names in the UI language (searchCards translates them to the search language) and a
 * number from that country's cards. Each finds cards with the country's default search language (KR 日本語, US
 * English); checked live against TCGdex.
 */
export function searchExamples(country: Country, uiLang: UiLang): string[] {
  return [...NAME_EXAMPLES[uiLang], NUMBER_EXAMPLES[country].full];
}
