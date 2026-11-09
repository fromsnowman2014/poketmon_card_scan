/**
 * Character count of a formatted amount, which Money exposes to CSS as --money-chars so a big total can shrink to
 * fit its box instead of running under the pictures next to it:
 *
 *   .box { container-type: inline-size }
 *   .total { font-size: clamp(22px, 100cqi / (var(--money-chars) * 0.64), 34px) }
 *
 * 0.64em is a safe width per character for bold tabular figures ("₩12,345,600" is 11 characters, "$842.50" is 7).
 * A leading "≈" (approx) counts as one more.
 */
export function moneyChars(text: string, approx = false): number {
  return Math.max(1, [...text].length + (approx ? 1 : 0));
}
