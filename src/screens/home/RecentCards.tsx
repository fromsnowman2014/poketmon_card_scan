import { CardImage } from '../../components/CardImage';
import { Money } from '../../components/Money';
import { useValueTier } from '../../components/TierBadge';
import { showToast } from '../../components/Toast';
import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { clearHistory } from '../../lib/store';
import type { HistoryItem } from '../../lib/types';
import { cardNames, cardPath } from '../card/format';

const STRINGS: Strings<'title' | 'clear' | 'cleared'> = {
  ko: { title: '최근 본 카드', clear: '지우기', cleared: '최근 본 카드를 지웠어요' },
  en: { title: 'Recently viewed', clear: 'Clear', cleared: 'Recently viewed cleared' },
};

/** Horizontal row of the last cards opened, newest first. */
export function RecentCards({ items }: { items: HistoryItem[] }) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const tierOf = useValueTier();

  const clear = () => {
    clearHistory();
    showToast(t('cleared'), { icon: '🧹' });
  };

  return (
    <section className="stack-12" aria-labelledby="home-recent-title">
      <div className="row-between">
        <h2 id="home-recent-title" className="h2">
          {t('title')}
        </h2>
        <button type="button" className="btn btn-ghost home-clear" onClick={clear}>
          {t('clear')}
        </button>
      </div>
      <ul className="scroll-x home-recent">
        {items.map((item) => {
          // The Card screen's title for this card (UI-language name first for JA cards).
          const name = cardNames({ name: item.name, dexIds: item.dexIds ?? [] }, item.lang, lang).title;
          return (
            <li key={`${item.lang}:${item.id}`}>
              {/* Opens on the printing whose price this is (the one the kid last looked at). */}
              <Link to={cardPath(item, item.variant)} className="home-recent-item">
                <CardImage
                  image={item.image}
                  fallback={item.imageFallback}
                  alt={name}
                  size="thumb"
                  code={{ set: item.setId, number: item.localId }}
                />
                <span className="home-recent-name truncate">{name}</span>
                <span className="home-recent-price">
                  {item.priceUsd !== null && <span className={`tier-dot tier-${tierOf(item.priceUsd)}`} />}
                  <Money usd={item.priceUsd} approx={item.priceApprox} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
