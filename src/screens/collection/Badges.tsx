import { cx } from '../../components/cx';
import { useRates } from '../../lib/fx';
import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { formatMoney } from '../../lib/pricing';
import { useSettings } from '../../lib/store';
import type { Milestone, MilestoneId } from './stats';

const STRINGS: Strings<'title' | 'locked' | 'goal' | MilestoneId> = {
  ko: {
    title: '배지',
    locked: '아직 잠겨 있어요',
    goal: '{amount} 이상',
    first: '첫 카드',
    ten: '10장 모으기',
    rare: '첫 용돈 카드',
    treasure: '첫 보물 카드',
  },
  en: {
    title: 'Badges',
    locked: 'Not yet',
    goal: '{amount}+',
    first: 'First card',
    ten: '10 cards',
    rare: 'First Allowance',
    treasure: 'First Treasure',
  },
};

const EMOJI: Record<MilestoneId, string> = { first: '🎉', ten: '🔟', rare: '💎', treasure: '👑' };

/** "$5.00" → "$5": a goal reads as a round amount (won amounts have no decimals). */
const wholeDollars = (text: string) => text.replace(/\.00$/, '');

/**
 * Collection milestones: bright when earned, grey while locked, with how far along the count badges are and what a
 * card must be worth for the price badges, in the money shown ("5,000원 이상" / "$5+").
 */
export function Badges({ list }: { list: Milestone[] }) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const { currency } = useSettings();
  const rates = useRates();
  const goal = (usd: number) => t('goal', { amount: wholeDollars(formatMoney(usd, currency, rates, { lang })) });
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
                <span className="sr-only">{t('locked')} · </span>
                {m.progress ? `${m.progress.have}/${m.progress.need}` : m.goalUsd !== undefined && goal(m.goalUsd)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
