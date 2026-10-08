/** Read a CSS custom property from tokens.css (falls back outside a browser, e.g. in tests). */
export function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
