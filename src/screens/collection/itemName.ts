import type { CollectionItem, UiLang } from '../../lib/types';
import { cardNames } from '../card/format';

/**
 * A saved card's name and the line under it, exactly as its Card screen title shows them (format.cardNames), so a
 * card reads the same in My Cards as on its own page: JA cards lead with the UI-language name ("루차불" /
 * "Hawlucha") over the printed one ("ルチャブル"); EN cards keep the English name (+ the Korean one in the Korean
 * UI). Saved cards have no HP, so a card without dexIds is matched by its name (localName.nameInUiLang).
 */
export function itemNames(
  item: Pick<CollectionItem, 'name' | 'dexIds' | 'lang'>,
  uiLang: UiLang,
): { title: string; subtitle?: string } {
  return cardNames({ name: item.name, dexIds: item.dexIds ?? [] }, item.lang, uiLang);
}
