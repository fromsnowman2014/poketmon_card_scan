/** Joins truthy class names: cx('btn', active && 'btn-primary', className). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
