import { useState, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import { interpolate, useStrings, useUiLang, type Strings } from '../lib/i18n';
import type { UiLang } from '../lib/types';
import { cx } from './cx';
import { confirmGrownUp, openShop, shopTap } from './grownUpGate';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './ExternalLink.css';

/** Shops the app links to. */
export type ExternalSite = 'eBay' | 'TCGplayer' | 'Cardmarket';

/** Korean topic particle after each name ("eBay는", "Cardmarket은"). */
const TOPIC_KO: Record<ExternalSite, string> = { eBay: 'eBay는', TCGplayer: 'TCGplayer는', Cardmarket: 'Cardmarket은' };

const STRINGS: Strings<'ok' | 'cancel' | 'newTab'> = {
  ko: { ok: '어른과 함께 볼게요', cancel: '취소', newTab: '(새 탭)' },
  en: { ok: 'OK, with a grown‑up', cancel: 'Cancel', newTab: '(new tab)' },
};

/** The question's title and text: a shop is "a real shop"; any other site is just "a website outside the app". */
const GATE: Strings<'title' | 'shopBody' | 'siteBody'> = {
  ko: {
    title: '{site} 웹사이트로 가요',
    shopBody: '{topic} 진짜로 카드를 사고파는 곳이에요. 어른과 함께 볼까요?',
    siteBody: '앱 밖의 웹사이트가 열려요. 어른과 함께 볼까요?',
  },
  en: {
    title: 'Opening {site}',
    shopBody: '{site} is a real shop. Look together with a grown‑up!',
    siteBody: 'This opens a website outside the app. Look together with a grown‑up!',
  },
};

interface CommonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'role'> {
  /** The page to open (http/https only; anything else does nothing). */
  href: string;
}

/** A shop (the default): the grown-up question says cards are really bought and sold there. */
interface ShopLinkProps extends CommonProps {
  /** Named in the grown-up question ("eBay 웹사이트로 가요"). */
  site: ExternalSite;
  kind?: 'shop';
}

/** Any other website (GitHub, TCGdex, …): same grown-up question, without the shop wording. */
interface SiteLinkProps extends CommonProps {
  /** Named in the question's title ("GitHub 웹사이트로 가요" / "Opening GitHub"). */
  site: string;
  kind: 'site';
}

export type ExternalLinkProps = ShopLinkProps | SiteLinkProps;

/** Title and text of the grown-up question for `site`, in `lang`. */
export function gateCopy(lang: UiLang, link: Pick<ShopLinkProps, 'site' | 'kind'> | Pick<SiteLinkProps, 'site' | 'kind'>): { title: string; body: string } {
  const s = GATE[lang];
  const title = interpolate(s.title, { site: link.site });
  if (link.kind === 'site') return { title, body: s.siteBody };
  return { title, body: interpolate(s.shopBody, { site: link.site, topic: TOPIC_KO[link.site] }) };
}

/**
 * A link that leaves the app (a shop, or with kind="site" any other website). The first tap in a session opens a
 * sheet asking the kid to look together with a grown-up; after "OK" every external link opens directly (new tab)
 * until the session ends.
 *
 * It is a <button role="link"> with no href, styled by its className like the link it replaces: an <a href>
 * would let iOS long-press "Open in New Tab" (or a middle click) skip the question. Enter/Space and screen
 * readers ("link, … (new tab)") still work as for a link.
 */
export function ExternalLink(props: ExternalLinkProps) {
  // site and kind only feed the question (gateCopy): keep them off the <button>.
  const { href, site: _site, kind: _kind, onClick, children, className, ...rest } = props;
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const [asking, setAsking] = useState(false);
  const copy = gateCopy(lang, props);

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
      <Sheet open={asking} onClose={() => setAsking(false)} title={copy.title}>
        <div className="ext-gate stack-16">
          <span className="ext-gate-emoji" aria-hidden="true">
            🤝
          </span>
          <p className="body ext-gate-text">{copy.body}</p>
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
