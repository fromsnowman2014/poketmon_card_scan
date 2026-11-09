import { useState, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import { useStrings, type Strings } from '../lib/i18n';
import { cx } from './cx';
import { confirmGrownUp, openShop, shopTap } from './grownUpGate';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './ExternalLink.css';

/** Shops the app links to. */
export type ExternalSite = 'eBay' | 'TCGplayer' | 'Cardmarket';

/** Korean topic particle after each name ("eBay는", "Cardmarket은"). */
const TOPIC_KO: Record<ExternalSite, string> = { eBay: 'eBay는', TCGplayer: 'TCGplayer는', Cardmarket: 'Cardmarket은' };

const STRINGS: Strings<'title' | 'body' | 'ok' | 'cancel' | 'newTab'> = {
  ko: {
    title: '{site} 웹사이트로 가요',
    body: '{topic} 진짜로 카드를 사고파는 곳이에요. 어른과 함께 볼까요?',
    ok: '어른과 함께 볼게요',
    cancel: '취소',
    newTab: '(새 탭)',
  },
  en: {
    title: 'Opening {site}',
    body: '{site} is a real shop. Look together with a grown‑up!',
    ok: 'OK, with a grown‑up',
    cancel: 'Cancel',
    newTab: '(new tab)',
  },
};

export interface ExternalLinkProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'role'> {
  /** The shop page (http/https only; anything else does nothing). */
  href: string;
  /** Named in the grown-up question ("eBay 웹사이트로 가요"). */
  site: ExternalSite;
}

/**
 * A link that leaves the app for a shop. The first tap in a session opens a sheet asking the kid to look
 * together with a grown-up; after "OK" every shop link opens directly (new tab) until the session ends.
 *
 * It is a <button role="link"> with no href, styled by its className like the link it replaces: an <a href>
 * would let iOS long-press "Open in New Tab" (or a middle click) skip the question. Enter/Space and screen
 * readers ("link, … (new tab)") still work as for a link.
 */
export function ExternalLink({ href, site, onClick, children, className, ...rest }: ExternalLinkProps) {
  const t = useStrings(STRINGS);
  const [asking, setAsking] = useState(false);

  const click = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    shopTap(href, () => setAsking(true));
  };

  const proceed = () => {
    confirmGrownUp();
    setAsking(false);
    openShop(href);
  };

  return (
    <>
      <button {...rest} type="button" role="link" className={cx('ext-link', className)} onClick={click}>
        {children}
        <span className="sr-only">{t('newTab')}</span>
      </button>
      <Sheet open={asking} onClose={() => setAsking(false)} title={t('title', { site })}>
        <div className="ext-gate stack-16">
          <span className="ext-gate-emoji" aria-hidden="true">
            🤝
          </span>
          <p className="body ext-gate-text">{t('body', { site, topic: TOPIC_KO[site] })}</p>
          <div className="stack-8">
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={proceed}>
              {t('ok')}
              <Icon name="external-link" size={20} />
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setAsking(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
