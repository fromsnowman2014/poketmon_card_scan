// UI language helpers. Every screen/component keeps its own Strings object (no shared dictionary file).
import { useCallback } from 'react';
import { useSettings } from './store';
import type { UiLang } from './types';

export type Strings<K extends string> = Record<UiLang, Record<K, string>>;
export type Vars = Record<string, string | number>;
export type Translate<K extends string> = (key: K, vars?: Vars) => string;

/** Replaces {name} placeholders; unknown placeholders are left as-is. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export function useUiLang(): UiLang {
  return useSettings().uiLang;
}

/** `const t = useStrings(STRINGS); t('title', { n: 3 })` */
export function useStrings<K extends string>(strings: Strings<K>): Translate<K> {
  const lang = useUiLang();
  return useCallback((key: K, vars?: Vars) => interpolate(strings[lang][key], vars), [strings, lang]);
}

const RELATIVE: Record<UiLang, { now: string; m: string; h: string; d: string; mo: string; y: string }> = {
  ko: { now: '방금', m: '{n}분 전', h: '{n}시간 전', d: '{n}일 전', mo: '{n}개월 전', y: '{n}년 전' },
  en: { now: 'just now', m: '{n}m ago', h: '{n}h ago', d: '{n}d ago', mo: '{n}mo ago', y: '{n}y ago' },
};

/** "2시간 전" / "2h ago". Empty string for an unparsable date; future times read as "just now". */
export function fmtRelativeTime(iso: string, lang: UiLang, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const r = RELATIVE[lang];
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return r.now;
  if (min < 60) return interpolate(r.m, { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return interpolate(r.h, { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return interpolate(r.d, { n: d });
  if (d < 365) return interpolate(r.mo, { n: Math.floor(d / 30) });
  return interpolate(r.y, { n: Math.floor(d / 365) });
}
