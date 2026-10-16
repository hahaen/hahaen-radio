import { StationIdSchema } from '@haen/contracts';

export function stationLink(id: string, base: string) {
  const value = StationIdSchema.parse(id).toLowerCase();
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('station', value);
  return url.toString();
}
export function sharedStation(search: string): { id: string | null; invalid: boolean } {
  const values = new URLSearchParams(search).getAll('station');
  if (!values.length) return { id: null, invalid: false };
  const value = StationIdSchema.safeParse(values[0]);
  return values.length === 1 && value.success
    ? { id: value.data.toLowerCase(), invalid: false }
    : { id: null, invalid: true };
}
export async function shareStation(id: string, title: string) {
  const url = stationLink(id, location.href);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared' as const;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const;
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return 'copied' as const;
    }
  } catch {
    /* Offer manual copy. */
  }
  return url;
}
