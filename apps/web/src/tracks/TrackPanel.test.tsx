import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NowPlaying } from '@haen/contracts';
import i18n from '../locales/i18n';
import { createLibrary } from '../library/store';
import { TrackPanel } from './TrackPanel';
vi.mock('../app/Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('resets manual lyric timing when the station changes even if a cached song identity is identical', async () => {
  await i18n.changeLanguage('zh');
  const song = { artist: 'Artist', title: 'Song' };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            source: 'lrclib',
            status: 'found',
            items: [
              {
                id: 1,
                ...song,
                album: 'Album',
                duration: 180,
                instrumental: false,
                plain: 'Original test line',
                lines: [{ at: 0, text: 'Original test line' }],
              },
            ],
            retryAfter: null,
          }),
        ),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
    library = createLibrary();
  const value: NowPlaying = {
    stationId: '00000000-0000-4000-8000-000000000001',
    streamId: 'a'.repeat(24),
    status: 'available',
    source: 'station-icy',
    observedAt: '2026-10-17T00:00:00.000Z',
    rawTitle: 'Artist - Song',
    song,
    timing: 'unknown',
    retryAfter: 15,
  };
  const view = (current: NowPlaying) => (
    <QueryClientProvider client={client}>
      <TrackPanel
        value={current}
        active={true}
        loading={false}
        failed={false}
        library={library}
        onClose={() => {}}
      />
    </QueryClientProvider>
  );
  const result = render(view(value));
  fireEvent.click(screen.getByRole('button', { name: '查找歌词' }));
  fireEvent.click(await screen.findByRole('button', { name: '以此刻作为 00:00' }));
  expect(screen.getByText(/手动位置/)).toBeTruthy();
  result.rerender(
    view({ ...value, stationId: '00000000-0000-4000-8000-000000000002', streamId: 'b'.repeat(24) }),
  );
  expect(screen.queryByText(/手动位置/)).toBeNull();
  expect(screen.getByRole('button', { name: '查找歌词' })).toBeTruthy();
  cleanup();
  client.clear();
});
