import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRates } from '../lib/fx';
import { formatMoney } from '../lib/pricing';
import { COUNTRY_CURRENCY } from '../lib/region';
import { useSettings } from '../lib/store';
import type { Country, DisplayCurrency } from '../lib/types';
import { cx } from './cx';
import { HANGUL, moneyChars, moneyParts } from './moneyChars';
import './Money.css';

export interface MoneyProps {
  /** Amount in USD (all prices are stored in USD). null/undefined renders "—". */
  usd: number | null | undefined;
  /** Mark the amount as approximate (e.g. PriceSummary.converted): a small "약" in the Korean UI for any money ("약 4,760원", "약 $3.50"), "≈" in the English UI. */
  approx?: boolean;
  /**
   * Allows a small second line underneath in money the kid also knows (secondaryCurrency): the dollar amount under won
   * ("$3.50": prices and eBay are in dollars); under dollars, the won amount only for a kid who lives in Korea but
   * switched to dollars ("약 4,760원" / "≈ ₩4,760"). A kid in the US who sees dollars gets no second line at all.
   */
  secondary?: boolean;
  /** Counts up to the value (600ms) — for the big price on the result screen. */
  animate?: boolean;
  className?: string;
}

const COUNT_MS = 600;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Animates from the previously shown value to `target` with an ease-out curve. */
function useCountUp(target: number | null | undefined, enabled: boolean): number | null | undefined {
  const [shown, setShown] = useState(() => (enabled && typeof target === 'number' ? 0 : target));
  const last = useRef(0);

  useEffect(() => {
    if (!enabled || typeof target !== 'number' || !Number.isFinite(target) || reducedMotion()) {
      setShown(target);
      return;
    }
    const from = last.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - start) / COUNT_MS);
      const value = from + (target - from) * (1 - (1 - p) ** 3);
      last.current = value;
      setShown(value);
      if (p < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);

  return enabled ? shown : target;
}

/**
 * The money for Money's small second line, or null for none: dollars under won (the source prices and eBay are in
 * dollars, so Korean kids can compare); under dollars, the money of the kid's country when that isn't dollars (a
 * grown-up in Korea switched to dollars). A kid in the US seeing dollars gets no second line: no ₩ noise.
 */
export function secondaryCurrency(currency: DisplayCurrency, country: Country): DisplayCurrency | null {
  if (currency === 'KRW') return 'USD';
  const home = COUNTRY_CURRENCY[country];
  return home !== currency ? home : null;
}

/**
 * A price in the user's display currency (settings.currency), using live exchange rates. With `secondary`, a small
 * line underneath in the other money the kid knows (secondaryCurrency). Won is written the Korean way in the Korean
 * UI ("4,760원", "198만 원").
 */
export function Money({ usd, approx, secondary, animate = false, className }: MoneyProps) {
  const { currency, country, uiLang: lang } = useSettings();
  const rates = useRates();
  const shown = useCountUp(usd, animate);
  const hasValue = typeof usd === 'number' && Number.isFinite(usd);
  const other = secondary && hasValue ? secondaryCurrency(currency, country) : null;
  // Korean UI: "약 4,760원", "198만 원", "약 $3.50"; English UI: "≈ ₩4,760" / "≈ $3.50" (formatMoney).
  const main = moneyParts(shown, currency, rates, { approx, lang });
  // The final amount (not the counting-up one), so a big total doesn't change size while it animates.
  const style = { '--money-chars': moneyChars(formatMoney(usd, currency, rates, { approx, lang })) } as CSSProperties;

  return (
    <span className={cx('money', other && 'money-stack', className)} style={style}>
      <span className="money-main">
        {main.prefix && <span className={cx('money-approx', HANGUL.test(main.prefix) && 'money-approx-word')}>{main.prefix}</span>}
        {main.amount}
      </span>
      {other && (
        // Won converted from dollars is always approximate.
        <span className="money-sub">{formatMoney(usd, other, rates, { approx: approx || other === 'KRW', lang })}</span>
      )}
    </span>
  );
}
