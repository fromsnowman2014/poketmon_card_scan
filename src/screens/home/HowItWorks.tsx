import { Icon, type IconName } from '../../components/Icon';
import { useStrings, type Strings } from '../../lib/i18n';

type Step = 'snap' | 'read' | 'price';

const STRINGS: Strings<'title' | Step> = {
  ko: { title: '이렇게 써요', snap: '카드를 찍어요', read: '번호를 읽어요', price: '가격을 봐요' },
  en: { title: 'How it works', snap: 'Snap a card', read: 'We read its number', price: 'See the price' },
};

const STEPS: [Step, IconName][] = [
  ['snap', 'camera'],
  ['read', 'sparkles'],
  ['price', 'tag'],
];

/** Three-step explainer for first-time users (nothing scanned or saved yet). */
export function HowItWorks() {
  const t = useStrings(STRINGS);
  return (
    <section className="stack-12 slide-up" aria-labelledby="home-how-title">
      <h2 id="home-how-title" className="h2">
        {t('title')}
      </h2>
      <ol className="home-steps">
        {STEPS.map(([step, icon], i) => (
          <li key={step} className="home-step">
            <span className="home-step-icon">
              <Icon name={icon} size={24} />
              <span className="home-step-num" aria-hidden="true">
                {i + 1}
              </span>
            </span>
            <span className="home-step-text">{t(step)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
