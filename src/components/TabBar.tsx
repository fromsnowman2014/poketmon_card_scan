import { useStrings, type Strings } from '../lib/i18n';
import { Link, useRoute } from '../lib/router';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import './TabBar.css';

const STRINGS: Strings<'nav' | 'home' | 'scan' | 'cards'> = {
  ko: { nav: '메뉴', home: '홈', scan: '스캔', cards: '내 카드' },
  en: { nav: 'Main menu', home: 'Home', scan: 'Scan', cards: 'My Cards' },
};

type Tab = 'home' | 'collection';

/** Which tab a screen belongs to (card details belong to neither). */
function activeTab(top: string | undefined): Tab | null {
  if (top === 'collection') return 'collection';
  if (top === 'card') return null;
  return 'home';
}

function TabLink({ to, icon, label, active }: { to: string; icon: IconName; label: string; active: boolean }) {
  return (
    <Link to={to} className="tabbar-tab" aria-current={active ? 'page' : undefined}>
      <Icon name={icon} size={26} />
      <span className="tabbar-label">{label}</span>
    </Link>
  );
}

/** Bottom navigation: Home · raised Scan button · My Cards. Hidden on the scan screen. */
export function TabBar({ className }: { className?: string }) {
  const t = useStrings(STRINGS);
  const top = useRoute().segments[0];
  if (top === 'scan') return null;
  const active = activeTab(top);

  return (
    <nav className={cx('tabbar', className)} aria-label={t('nav')}>
      <div className="tabbar-inner">
        <TabLink to="/" icon="home" label={t('home')} active={active === 'home'} />
        <Link to="/scan" className="tabbar-scan">
          <span className="tabbar-scan-btn">
            <Icon name="camera" size={30} strokeWidth={2.2} />
          </span>
          <span className="tabbar-label">{t('scan')}</span>
        </Link>
        <TabLink to="/collection" icon="cards" label={t('cards')} active={active === 'collection'} />
      </div>
    </nav>
  );
}
