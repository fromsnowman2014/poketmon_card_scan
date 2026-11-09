import type { Rates } from '../lib/fx';
import { formatMoney } from '../lib/pricing';
import type { DisplayCurrency, UiLang } from '../lib/types';

/** A Hangul syllable ("원", "만", "약") is ~0.86em wide in bold Pretendard: about 1.35 of the 0.64em budget below. */
const HANGUL_WIDTH = 1.4;
/** One Hangul syllable (가–힣). */
export const HANGUL = /[가-힣]/;

/**
 * Width of a formatted amount in "characters" of 0.64em, which Money exposes to CSS as --money-chars so a big total
 * can shrink to fit its box instead of running under the pictures next to it:
 *
 *   .box { container-type: inline-size }
 *   .total { font-size: clamp(22px, 100cqi / (var(--money-chars) * 0.64), 34px) }
 *
 * 0.64em is a safe width for bold tabular figures, "₩", "$", "≈" and spaces ("₩12,345,600" is 11, "$842.50" is 7).
 * Hangul counts 1.4 ("123,400원" is 8.4, "약 198만 원" is 9.2). `approx` adds one for a "≈" drawn outside `text`.
 */
export function moneyChars(text: string, approx = false): number {
  const width = [...text].reduce((sum, ch) => sum + (HANGUL.test(ch) ? HANGUL_WIDTH : 1), approx ? 1 : 0);
  return Math.max(1, Math.round(width * 10) / 10);
}

/**
 * formatMoney split into the "approximately" sign and the amount, so Money can draw the sign smaller:
 * { prefix: "약 ", amount: "4,760원" } or { prefix: "약 ", amount: "$3.50" } (Korean UI, any money),
 * { prefix: "≈ ", amount: "$3.50" } (English UI), else prefix "". `text` is the whole string ("약 4,760원").
 */
export function moneyParts(
  usd: number | null | undefined,
  currency: DisplayCurrency,
  rates: Rates,
  opts: { approx?: boolean; lang?: UiLang },
): { prefix: string; amount: string; text: string } {
  const text = formatMoney(usd, currency, rates, opts);
  const amount = formatMoney(usd, currency, rates, { lang: opts.lang });
  const prefix = text !== amount && text.endsWith(amount) ? text.slice(0, text.length - amount.length) : '';
  return { prefix, amount: prefix ? amount : text, text };
}
