import { findSpecies, translateCardName } from './names';
import type { UiLang } from './types';

/**
 * A search result's name in the UI language when it names a Pokémon ("メガルチャブルex" → "Mega Hawlucha ex" /
 * "메가 루차불 ex"). Search results carry no dexIds, so the species is found from the name itself;
 * translateCardName then checks it really appears in the name. undefined for trainers or when nothing changes.
 */
export function nameInUiLang(name: string, lang: UiLang): string | undefined {
  for (const species of findSpecies(name, 3)) {
    const translated = translateCardName(name, [species.dexId], lang);
    if (translated) return translated === name ? undefined : translated;
  }
  return undefined;
}
