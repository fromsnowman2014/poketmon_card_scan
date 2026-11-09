import { CardImage } from '../../components/CardImage';
import { Icon } from '../../components/Icon';
import { Money } from '../../components/Money';
import { TierBadge } from '../../components/TierBadge';
import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { valueTier } from '../../lib/pricing';
import { Link } from '../../lib/router';
import type { CollectionItem } from '../../lib/types';
import { uiName } from './itemName';

const STRINGS: Strings<'title'> = {
  ko: { title: '최고의 카드' },
  en: { title: 'Best card' },
};

/** Spotlight on the most valuable card. */
export function BestCard({ item, photo }: { item: CollectionItem; photo?: string }) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const tier = valueTier(item.priceUsd);
  const sub = uiName(item, lang);
  return (
    <Link
      to={`/card/${item.lang}/${encodeURIComponent(item.id)}`}
      className={`surface collection-best tier-${tier} slide-up`}
    >
      <CardImage
        image={item.image}
        fallback={item.imageFallback}
        photo={photo}
        alt={item.name}
        size="thumb"
        tier={tier}
        code={{ set: item.setId, number: item.localId }}
        className="collection-best-art"
      />
      <span className="grow stack-4">
        <span className="row collection-best-label">
          <Icon name="sparkles" size={18} />
          {t('title')}
        </span>
        <span className="collection-best-name">{item.name}</span>
        <span className="small muted truncate">{sub ?? `${item.setName} · #${item.localId}`}</span>
        <Money usd={item.priceUsd} approx={item.priceApprox} className="collection-best-price" />
        <TierBadge tier={tier} size="sm" />
      </span>
      <Icon name="chevron-right" className="collection-chevron" />
    </Link>
  );
}
