import { useRef, useState, type FormEvent } from 'react';
import { useStrings, type Strings } from '../lib/i18n';
import { cx } from './cx';
import { Icon } from './Icon';
import './SearchBar.css';

const STRINGS: Strings<'placeholder' | 'label' | 'clear'> = {
  ko: { placeholder: '카드 이름이나 번호', label: '카드 검색', clear: '지우기' },
  en: { placeholder: 'Card name or number', label: 'Search cards', clear: 'Clear' },
};

export interface SearchBarProps {
  /** Called with the trimmed text when the user submits (keyboard "search" key or Enter). Empty text is ignored. */
  onSubmit: (query: string) => void;
  /** Controlled value; omit to let the bar manage its own text (seeded by defaultValue). */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/** Big rounded search field with a clear button. */
export function SearchBar({ onSubmit, value, defaultValue = '', onChange, placeholder, autoFocus, className }: SearchBarProps) {
  const t = useStrings(STRINGS);
  const input = useRef<HTMLInputElement>(null);
  const [inner, setInner] = useState(defaultValue);
  const text = value ?? inner;

  const change = (next: string) => {
    setInner(next);
    onChange?.(next);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    input.current?.blur(); // closes the iOS keyboard so results are visible
    onSubmit(q);
  };

  return (
    <form className={cx('searchbar', className)} role="search" onSubmit={submit}>
      <Icon name="search" className="searchbar-icon" />
      <input
        ref={input}
        className="searchbar-input"
        type="search"
        enterKeyHint="search"
        inputMode="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label={t('label')}
        placeholder={placeholder ?? t('placeholder')}
        value={text}
        onChange={(e) => change(e.target.value)}
      />
      {text && (
        <button
          type="button"
          className="searchbar-clear"
          aria-label={t('clear')}
          onClick={() => {
            change('');
            input.current?.focus();
          }}
        >
          <Icon name="x" size={18} strokeWidth={2.6} />
        </button>
      )}
    </form>
  );
}
