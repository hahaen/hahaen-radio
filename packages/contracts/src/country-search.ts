const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const names = [
  new Intl.DisplayNames(['en'], { type: 'region' }),
  new Intl.DisplayNames(['zh-CN'], { type: 'region' }),
];
const cache = new Map<string, string>();

/** Shared location search terms for browser collections and API queries. */
export function countrySearchText(code: string | null): string {
  if (!code) return '';
  const normalized = code.toUpperCase();
  if (!cache.has(normalized)) {
    const codes = normalized === 'TW' ? [normalized, 'CN'] : [normalized];
    cache.set(
      normalized,
      fold(codes.flatMap((item) => [item, ...names.map((name) => name.of(item))]).join(' ')),
    );
  }
  return cache.get(normalized)!;
}
