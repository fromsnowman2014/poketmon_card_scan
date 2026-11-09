import { cx } from '../../components/cx';
import { useStrings, type Strings } from '../../lib/i18n';
import type { Milestone, MilestoneId } from './stats';

const STRINGS: Strings<'title' | 'locked' | MilestoneId> = {
  ko: {
    title: '배지',
    locked: '아직 잠겨 있어요',
    first: '첫 카드',
    ten: '10장 모으기',
    rare: '첫 용돈 카드',
    treasure: '첫 보물 카드',
  },
  en: {
    title: 'Badges',
    locked: 'Not yet',
    first: 'First card',
    ten: '10 cards',
    rare: 'First Allowance',
    treasure: 'First Treasure',
  },
};

const EMOJI: Record<MilestoneId, string> = { first: '🎉', ten: '🔟', rare: '💎', treasure: '👑' };

/** Collection milestones: bright when earned, grey with progress while locked. */
export function Badges({ list }: { list: Milestone[] }) {
  const t = useStrings(STRINGS);
  return (
    <section className="stack-12" aria-labelledby="collection-badges">
      <h2 id="collection-badges" className="h2">
        {t('title')}
      </h2>
      <ul className="collection-badges">
        {list.map((m) => (
          <li
            key={m.id}
            className={cx('collection-badge', `collection-badge-${m.id}`, m.earned && 'collection-badge-earned')}
          >
            <span className="collection-badge-medal" aria-hidden="true">
              {EMOJI[m.id]}
            </span>
            <span className="collection-badge-label">{t(m.id)}</span>
            {!m.earned && (
              <span className="collection-badge-note">
                {m.progress ? `${m.progress.have}/${m.progress.need}` : <span className="sr-only">{t('locked')}</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
