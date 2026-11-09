import { Icon, type IconName } from '../../components/Icon';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** Shown before the label but hidden from screen readers (a flag would be read as "regional indicator U, S"). */
  emoji?: string;
  /** Language of the label, so 日本語 / 한국어 render with the right font and voice. */
  lang?: string;
}

interface SegmentedProps<T extends string> {
  /** id of the visible label. */
  labelledBy: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
}

/** Equal-width pill toggle; the selected option has aria-pressed. */
export function Segmented<T extends string>({ labelledBy, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="settings-seg" role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="settings-seg-btn"
          aria-pressed={o.value === value}
          lang={o.lang}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={18} />}
          {o.emoji && <span aria-hidden="true">{o.emoji} </span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}
