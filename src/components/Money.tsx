import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRates } from '../lib/fx';
import { formatMoney } from '../lib/pricing';
import { useSettings } from '../lib/store';
import { cx } from './cx';
import { HANGUL, moneyChars, moneyParts } from './moneyChars';
import './Money.css';

export interface MoneyProps {
  /** Amount in USD (all prices are stored in USD). null/undefined renders "—". */
  usd: number | null | undefined;
  /** Mark the amount as approximate (e.g. PriceSummary.converted): a small "약" before won in the Korean UI ("약 4,760원"), else "≈". */
  approx?: boolean;
  /** Adds a small line in the other currency underneath ("≈ $3.50" under won; "약 4,760원" / "≈ ₩4,760" under dollars). */
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
 * A price in the user's display currency (settings.currency), using live exchange rates. With KRW the won amount
 * is the main number and the dollar amount the small secondary line, and the other way round with USD. Won is
 * written the Korean way in the Korean UI ("4,760원", "198만 원").
 */
export function Money({ usd, approx, secondary, animate = false, className }: MoneyProps) {
  const { currency, uiLang: lang } = useSettings();
  const rates = useRates();
  const shown = useCountUp(usd, animate);
  const other = currency === 'USD' ? 'KRW' : 'USD';
  const hasValue = typeof usd === 'number' && Number.isFinite(usd);
  // Korean UI + won: "약 4,760원", "198만 원"; otherwise "≈ ₩4,760" / "≈ $3.50" (formatMoney).
  const main = moneyParts(shown, currency, rates, { approx, lang });
  // The final amount (not the counting-up one), so a big total doesn't change size while it animates.
  const style = { '--money-chars': moneyChars(formatMoney(usd, currency, rates, { approx, lang })) } as CSSProperties;

  return (
    <span className={cx('money', secondary && 'money-stack', className)} style={style}>
      <span className="money-main">
        {main.prefix && <span className={cx('money-approx', HANGUL.test(main.prefix) && 'money-approx-word')}>{main.prefix}</span>}
        {main.amount}
      </span>
      {secondary && hasValue && (
        <span className="money-sub">{formatMoney(usd, other, rates, { approx: approx || other === 'KRW', lang })}</span>
      )}
    </span>
  );
}
