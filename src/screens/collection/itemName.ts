import { nameInUiLang } from '../../lib/localName';
import { translateCardName } from '../../lib/names';
import type { CollectionItem, UiLang } from '../../lib/types';

/**
 * The card's name in the UI language when it differs from the printed one ("ルチャブル" → "루차불"), so a kid
 * can read their Japanese cards. Some new JA cards come without dexIds; their species is found from the name.
 */
export function uiName(item: Pick<CollectionItem, 'name' | 'dexIds'>, lang: UiLang): string | undefined {
  const translated = item.dexIds?.length
    ? translateCardName(item.name, item.dexIds, lang)
    : nameInUiLang(item.name, lang);
  return translated && translated !== item.name ? translated : undefined;
}
