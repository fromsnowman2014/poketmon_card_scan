import type { ReactNode } from 'react';
import { cx } from './cx';
import './EmptyState.css';

export interface EmptyStateProps {
  emoji: string;
  title: ReactNode;
  text?: ReactNode;
  /** Usually one big button. */
  action?: ReactNode;
  className?: string;
}

/** Friendly centered message for empty, not-found, offline and error states. */
export function EmptyState({ emoji, title, text, action, className }: EmptyStateProps) {
  return (
    <div className={cx('empty-state', 'fade-in', className)}>
      <div className="empty-state-emoji" aria-hidden="true">
        {emoji}
      </div>
      <h2 className="h2">{title}</h2>
      {text && <p className="empty-state-text muted">{text}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
