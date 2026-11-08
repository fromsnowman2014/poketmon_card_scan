import { useEffect, useState, type ReactNode } from 'react';
import { useStrings, type Strings } from '../lib/i18n';
import { goBack } from '../lib/router';
import { cx } from './cx';
import { Icon } from './Icon';
import './TopBar.css';

const STRINGS: Strings<'back'> = {
  ko: { back: '뒤로' },
  en: { back: 'Back' },
};

export interface TopBarProps {
  title?: ReactNode;
  /** Show a back button. A string is the fallback path when there is no in-app history (default "/"). */
  back?: boolean | string;
  /** Replaces the default goBack() behavior of the back button. */
  onBack?: () => void;
  /** Left slot, used when there is no back button (e.g. a logo). */
  left?: ReactNode;
  /** Right slot (icon buttons, links). */
  right?: ReactNode;
  className?: string;
}

function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
}

/** Sticky header that covers the iOS status bar area; gains a backdrop once the page scrolls. */
export function TopBar({ title, back, onBack, left, right, className }: TopBarProps) {
  const t = useStrings(STRINGS);
  const scrolled = useScrolled();
  const handleBack = onBack ?? (() => goBack(typeof back === 'string' ? back : '/'));

  return (
    <header className={cx('topbar', scrolled && 'topbar-scrolled', className)}>
      <div className="topbar-inner">
        <div className="topbar-side">
          {back || onBack ? (
            <button type="button" className="btn btn-icon topbar-back" onClick={handleBack} aria-label={t('back')}>
              <Icon name="chevron-left" size={28} />
            </button>
          ) : (
            left
          )}
        </div>
        {title !== undefined && <h1 className="topbar-title truncate">{title}</h1>}
        <div className="topbar-side topbar-right">{right}</div>
      </div>
    </header>
  );
}
