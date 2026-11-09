# CardCheck UI kit

How to build a screen so every screen feels like the same app: blue, dark by default, big and simple,
friendly for kids. Contracts for the libraries are in [ARCHITECTURE.md](ARCHITECTURE.md).

**Rules of thumb**
- One big thing per screen (the price, the scan button, the total). Everything else is smaller and muted.
- Tap targets ≥ 44px. Text ≥ 13px. Inputs are 17px (iOS zooms into anything under 16px).
- Use tokens and utility classes. No hard-coded colors in screen CSS except one-off art.
- Every visible string comes from a local `Strings` object, in Korean and English.

## Screen skeleton

```tsx
// src/screens/CollectionScreen.tsx
import { TopBar } from '../components/TopBar';
import { useStrings, type Strings } from '../lib/i18n';
import './CollectionScreen.css';

const STRINGS: Strings<'title' | 'count'> = {
  ko: { title: '내 카드', count: '{n}장' },
  en: { title: 'My Cards', count: '{n} cards' },
};

export default function CollectionScreen() {
  const t = useStrings(STRINGS);
  return (
    <main className="screen collection">
      <TopBar title={t('title')} />
      <div className="screen-pad stack-24">
        <section className="surface surface-glow">…</section>
      </div>
    </main>
  );
}
```

- `.screen` is the page: centered (max 560px), full height, with bottom padding (`--screen-bottom`) that clears the
  tab bar, the part of the raised Scan button that sticks up, the iPhone home indicator and 28px of air. The
  **window** scrolls (not an inner div), so tap-status-bar-to-top and scroll restoration work.
- Anything that must be readable on the first view (the Card screen's price) has to end above
  `100svh - var(--safe-bottom) - var(--tabbar-h) - var(--tabbar-lift) - 5px`: the raised Scan button sits
  horizontally centered, right where centered content is. Check it at 375×667 (iPhone SE). The Card screen's order
  (art → name → chips → price → variants → add → eBay → more) is in ARCHITECTURE.md › Card screen layout.
- A screen without a TopBar gets a status-bar scrim from global.css (dark: frosted strip that fades in once the page
  is scrolled, via `<html data-scrolled>`; light: the gradient strip, always on).
- `<TopBar>` comes first. It is sticky and covers the status-bar area (`safe-area-inset-top`). A screen without a
  TopBar adds `.safe-top` to its first block.
- `.screen-pad` adds the 20px side gutter (+ landscape safe areas). Put content inside it, not the TopBar.
- The scan screen's camera, photo-adjust and analyzing steps are full-bleed: no TopBar/tab bar (TabBar hides itself
  on `/scan`); they handle `var(--safe-top)` / `var(--safe-bottom)` themselves. Its "Is this your card?" and number-form
  steps are normal `.screen` pages with a TopBar.
- A screen's parts live in `src/screens/<name>/` (e.g. `screens/card/PriceHero.tsx`); helpers more than one screen
  needs go to `src/lib/`.
- Screens are default exports. They read params with `useRoute()`; only `CardScreen` gets props
  (`{ lang: CardLang; id: string }`), and App remounts it for each card.

## Per-screen CSS

`src/screens/<Name>Screen.css`, imported by the screen. Prefix every class with the screen name so screens never
collide: `.home-hero`, `.home-recent`, `.card-price`, `.collection-grid`, `.scan-frame`, `.search-results`,
`.settings-row`. Put the prefix class on `<main>` too (`<main className="screen collection">`) for scoped
overrides. Only use `var(--…)` tokens for color, radius, motion and spacing.

`body` sets `word-break: keep-all` (+ `overflow-wrap: break-word`) so Korean wraps between words, never inside one
("볼게요" stays whole). Don't repeat it per screen.

## Design tokens (`src/styles/tokens.css`)

Dark is the default. `<html data-theme="dark|light">` is set by App from `settings.theme` (`'system'` follows the OS).
The light theme only redefines tokens, so token-based CSS works in both.

| Group | Tokens |
|---|---|
| Surfaces | `--bg` page, `--surface` cards/panels, `--surface-2` inset/pressed, `--surface-3` shimmer highlight, `--border`, `--chrome` translucent bars, `--overlay` modal backdrop |
| Text | `--text`, `--text-muted`, `--primary-text` (links, active), `--on-primary` (text on gradient) |
| Brand | `--primary`, `--primary-soft` (tinted fill), `--accent` (cyan), `--grad-primary` (CTA / scan button; #2563eb → #0e7490 so white text is ≥ 5:1 everywhere), `--grad-text` (gradient text on the page background, e.g. the wordmark), `--grad-hero` (top glow), `--grad-gold` (treasure) |
| Price moves | `--up`, `--up-soft`, `--down`, `--down-soft` |
| Tiers | `--tier-common|nice|rare|super|treasure` (+ `-bg`); light mode switches to darker text variants (all ≥ 4.5:1 on their tint) |
| Shape | `--radius-sm` 10, `--radius` 16, `--radius-lg` 24, `--radius-pill`; `--glow`, `--shadow-raised`, `--shadow-pop`, `--highlight` |
| Type | `--font` (Pretendard → Apple SD Gothic Neo → Hiragino Sans for kana), `--fs-price-xl` 52, `--fs-title` 28, `--fs-h2` 20, `--fs-body` 17, `--fs-small` 15, `--fs-caption` 13 |
| Layout | `--gutter` 20px, `--content-max` 560px, `--tap` 44px, `--topbar-h` 56px, `--tabbar-h` 64px, `--tabbar-lift` 24px (how far the 60px Scan button rises above the bar, plus a 5px ring), `--screen-bottom` (`.screen` bottom padding), `--safe-top/right/bottom/left` |
| Motion | `--ease` cubic-bezier(.2,.8,.2,1), `--dur` 180ms, `--dur-slow` 320ms |

## Utility classes (`src/styles/global.css`)

| Class | Use |
|---|---|
| `.screen`, `.screen-pad`, `.safe-top` | Page container, side gutter, status-bar padding (see skeleton) |
| `.stack-4/8/12/16/24` | Vertical flex column with that gap |
| `.row` / `.row-between` | Horizontal flex, centered; `-between` pushes ends apart. Add `.wrap` to wrap |
| `.grow`, `.center` | `flex: 1` (+ `min-width: 0`); centered column with centered text |
| `.grid-2` | Two equal columns, 12px gap (card grids) |
| `.scroll-x` | Horizontal snap scroller that bleeds to the screen edges (recent cards row). Use inside `.screen-pad`; children keep their own width |
| `.divider` | 1px rule |
| `.title` 28/700, `.h2` 20/700, `.body` 17/600, `.small` 15/500, `.caption` 13/500 | Type scale (body text is 17/600 by default) |
| `.price-xl` | 52/800 tabular numbers for the hero price |
| `.muted`, `.text-primary`, `.text-up`, `.text-down`, `.tabular`, `.truncate` | Text helpers |
| `.link` | Text button in the primary color |
| `.surface` | Panel: surface color, 1px border, 16px radius, 16px padding. `.surface-glow` adds the blue glow |
| `.surface-2` | Inset panel without border |
| `.btn` | Base button (44px pill). Combine: `.btn-primary` (gradient CTA), `.btn-secondary` (outlined), `.btn-ghost` (text), `.btn-lg` (56px, big CTA), `.btn-sm` (36px), `.btn-block` (full width), `.btn-icon` (44px round) |
| `.chip`, `.chip-row` | Toggle pill. Selected via `aria-pressed="true"` (or `aria-selected`, `.chip-active`). Button chips keep a 44px hit area |
| `.input` | 52px text field, 17px font |
| `.tier-<id>` | Sets `--tier` (text), `--tier-bg` (fill), `--tier-fill` (swatch; gold gradient for treasure) on the element. Use with `.tier-text`, `.tier-dot` or your own CSS |
| `.skeleton`, `.spinner` | Shimmer block / small spinner |
| `.fade-in`, `.pop-in` (scale .96→1), `.slide-up` | Enter animations |
| `.sr-only` | Visually hidden, read by screen readers |

```tsx
<button className="btn btn-primary btn-lg btn-block"><Icon name="plus" />{t('add')}</button>
<div className="chip-row">
  {variants.map((v) => (
    <button key={v.key} className="chip" aria-pressed={v.key === selected} onClick={() => setSelected(v.key)}>{label(v)}</button>
  ))}
</div>
<span className={`tier-dot tier-${tier}`} />
```

## Components (`src/components`)

All accept `className`. All built-in text is bilingual.

| Component | Props | Notes |
|---|---|---|
| `Icon` | `name: IconName; size?=24; strokeWidth?=2; label?` | Lucide-style. Names: `home camera cards search settings chevron-left chevron-right plus minus trash refresh external-link image keyboard zap x check trending-up trending-down steady sparkles info globe sun moon gavel tag cart receipt flashlight`. Decorative unless `label` is given |
| `TopBar` | `title?; back?: boolean \| string; onBack?; left?; right?` | Sticky, gains a blurred backdrop on scroll. `back` shows ‹ which calls `goBack(fallback)`; a string is the fallback path (default `/`). `left` is used only without a back button |
| `TabBar` | — | Rendered by App. Home · raised Scan · My Cards. Hidden on `/scan`; no tab is active on `/card/…` |
| `CardImage` | `image?; fallback?; photo?; alt; size?: 'thumb' \| 'full'; tier?; eager?; code?: { set; number }` | Tries TCGdex `${image}/low|high.webp` (a CORS failure is retried once as a plain image) → `fallback` (CardDetail.imageFallback) → `photo` (user data URL) → original card-back art. With `code`, the set code and number are printed on the card back whenever no picture shows, so look-alike backs can be told apart — pass it in every grid. Shimmers while loading, lazy by default (`eager` for the hero), always 63:88 with card corners. `tier` adds a glow in the tier color (gold for treasure). Width comes from the parent |
| `TierBadge` | `tier: ValueTier; cheer?; size?: 'sm' \| 'md' \| 'lg'` | Emoji + price-band name: 🍃 동전 카드, ⭐ 과자값 카드, 💎 용돈 카드, 🔥 귀한 카드, 👑 보물 카드 (Pocket change, Snack money, Allowance, Prized, Treasure) — money words, never the rarity words printed on cards. `cheer` uses kind, upbeat copy, cheap cards included ("🍃 가격은 작아도 멋진 카드!", "👑 보물 카드예요! 소중히 보관해요!"). Treasure is a shimmering gold pill. Also exports `TIER_ORDER`, `TIER_EMOJI`, `TIER_LABELS` (use with `useStrings`) |
| `ExternalLink` | `href; site: 'eBay' \| 'TCGplayer' \| 'Cardmarket'` + anchor props | The only way to link to a shop. Opens in a new tab after a one-time-per-session grown-up check (Sheet: "{site}는 진짜로 카드를 사고파는 곳이에요. 어른과 함께 볼까요?"). Adds a screen-reader "(새 탭)". Put an `external-link` icon in the link and say near it that a website opens |
| `Money` | `usd; approx?; secondary?; animate?` | Formats with `settings.currency` (KRW by default in Korean) and live rates. `approx` adds a small "≈" (pass `summary.converted` / `item.priceApprox`). `secondary` adds the other currency underneath ("≈ $0.04"). `animate` counts up over 600ms (skipped for reduced motion). Size it with a class: `<Money usd={p} approx secondary animate className="price-xl" />`. Sets `--money-chars` (length of the final amount, see below) |
| `SearchBar` | `onSubmit(q); value?; defaultValue?; onChange?; placeholder?; autoFocus?` | 58px pill with clear button; submits trimmed, non-empty text and closes the keyboard. Default placeholder "카드 이름이나 번호" |
| `Sheet` | `open; onClose; title?; children` | Bottom sheet on native `<dialog>` (focus trap, inert page). Escape, backdrop tap and × call `onClose` |
| `EmptyState` | `emoji; title; text?; action?` | Centered message for empty / not found / offline / error. `action` is usually one `.btn-primary .btn-lg .btn-block` |
| `Skeleton` | `shape?: 'line' \| 'card' \| 'circle'; width?; height?` | Pair with visible loading copy ("카드 읽는 중…") |
| `Confetti` | `count?=36` | One CSS burst from the center of the nearest positioned parent (`position: relative`). Change its `key` to fire again. Hidden for reduced motion. Use for `rare` tier ($5, 용돈 카드) or better, after a scan |
| `showToast(text, { icon?, durationMs? })` + `ToastHost` | — | Global toast above the tab bar, callable from anywhere: `showToast(t('added'), { icon: '✨' })`. App renders the host |
| `ErrorBoundary` | `resetKey` | Used by App around screens; friendly crash screen with "Reopen" |
| `cx(...classes)` | — | Joins truthy class names |

### Big amounts that must fit (`--money-chars`)
Won amounts are long ("₩12,345,600"). Make the box a size container and let the font shrink with the amount:

```css
.home-mycards > .grow { container-type: inline-size; }
.home-mycards-total {
  font-size: clamp(22px, 6.6vw, 34px);                                       /* fallback (iOS < 16) */
  font-size: clamp(20px, 100cqi / (var(--money-chars, 8) * 0.64), 34px);    /* 0.64em per bold tabular char */
}
```
Used by the Home and My Cards totals, the best card price and the Card screen's big price (`.card-price` is the container).

## Strings (i18n)

```tsx
const STRINGS: Strings<'title' | 'updated'> = {
  ko: { title: '시세', updated: '{when} 업데이트' },
  en: { title: 'Market price', updated: 'Updated {when}' },
};
const t = useStrings(STRINGS);                       // re-renders when the UI language changes
t('updated', { when: fmtRelativeTime(iso, lang) })   // "2시간 전 업데이트" / "Updated 2h ago"
const lang = useUiLang();                            // 'ko' | 'en', e.g. for names.translateCardName
```

Define `STRINGS` at module level (stable reference). Card names stay in the card's language; for JA/KO cards show
the name in the UI language as a subtitle (`translateCardName`, or `nameInUiLang` from `lib/localName` when the card
has no `dexIds`). English counts need a singular string: `count1: '1 card'` next to `count: '{n} cards'`.

## Router

```tsx
import { Link, navigate, goBack, useRoute } from '../lib/router';
<Link to="/settings" className="btn btn-icon btn-ghost" aria-label={t('settings')}><Icon name="settings" /></Link>
navigate(`/card/${card.lang}/${encodeURIComponent(card.id)}`);
navigate(`/search?q=${encodeURIComponent(q)}&lang=${lang}`);
navigate('/card/ja/SV8a-084', { replace: true });     // e.g. scan result: Back skips the scan screen
const { segments, query } = useRoute();               // query.get('q')
```

The URL never changes (iOS would re-ask for camera permission). Navigation scrolls to the top; Back restores the
previous scroll position. `Link` renders an `<a href="#/…">` so "open in new tab" still works as a deep link.

## Copy tone

Short sentences, talk to the kid ("you"), one emoji at most, no finance words: "My Cards" not "portfolio",
"시세 / price" not "market value". Encourage, never scold.

| State | KO | EN |
|---|---|---|
| My Cards empty | 아직 카드가 없어요! 첫 카드를 찍어볼까요? 📸 | No cards yet! Scan your first one 📸 |
| Reading | 카드 읽는 중… | Reading your card… |
| Loading price | 가격 확인 중… | Checking prices… |
| Not found | 음… 못 찾았어요 🤔 다시 찍거나 이름을 써 볼까요? | Hmm, can't find it 🤔 Try again or type the name. |
| No price | 아직 가격이 없어요. 수수께끼 카드! 🔍 | No price yet. This card is still a mystery! 🔍 |
| Offline | 인터넷이 없어요. 내 카드는 안전해요. | No internet. Your cards are safe here. |
| Camera denied | 카메라가 꺼져 있어요. 사진을 고르거나 직접 입력해요. | Camera is off. Use a photo or type instead. |
| Wrong card | 다른 카드예요? | Not this card? |
| Footer (after the eBay panel) | 가격은 예상이에요. 사고팔 땐 어른과 함께! | Prices are guesses. Ask a grown-up before buying or selling. |
| Leaving the app | eBay 웹사이트가 열려요 · 어른과 함께 봐요 | Opens the eBay website · Look with a grown-up |
| Price moved | 요즘 올랐어요 ▲25% / 요즘 내렸어요 ▼12% | Up lately ▲25% / Down lately ▼12% |
| Couldn't save | 앗, 내 카드를 저장하지 못했어요. 어른에게 폰 저장 공간을 봐 달라고 해요. | Oops, My Cards couldn't be saved. Ask a grown-up to check the phone's storage. |
| Scan tip | 아래쪽 작은 번호(084/187)를 읽어요. | We read the small number at the bottom, like 084/187. |
| Scan title | 카드를 네모에 꽉 맞춰요 | Fit the card in the box |
| OCR didn't load | 앗, 번호 읽기 도구를 못 불러왔어요 | Oops, the number reader didn't load |

## Motion & accessibility

- Enter with `.pop-in` / `.fade-in`; price counts up (`<Money animate>`); a scanned card of the `rare` tier ($5) or better gets `<Confetti>`; every
  tier gets a glow in its color.
  Global CSS shortens all animation under `prefers-reduced-motion`; don't add JS motion without checking it.
- Icon-only buttons need `aria-label`. Toggle chips use `aria-pressed`. Use `<button>` for actions, `<Link>` for
  navigation, `<ExternalLink site="eBay">` for eBay/TCGplayer (never a bare `target="_blank"` shop link: kids get
  the grown-up check first). Docs links (GitHub guide) may stay plain `<a target="_blank" rel="noopener noreferrer">`.
- One `<h1>` per screen: TopBar's `title`, or the screen's own main heading when its TopBar has no title (Home's
  wordmark, the card name on the Card screen, the scan step titles). Sections use `<h2 className="h2">`.
- Don't rely on color alone for up/down: pair with ▲/▼ or the trending icons.
- `navigator.vibrate` does nothing on iOS.
