import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RecognitionPanel } from './RecognitionPanel';
import { createLibrary } from '../library/store';
import i18n from '../locales/i18n';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const id = '00000000-0000-4000-8000-000000000001',
  streamId = 'a'.repeat(24);
it('does not identify automatically, preserves song provenance and rejects a late result after cancellation', async () => {
  await i18n.changeLanguage('zh');
  let finish!: (value: Response) => void;
  const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : new Response('{"recognition":"available"}'),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
    library = createLibrary();
  const view = (active: boolean) => (
    <QueryClientProvider client={client}>
      <RecognitionPanel stationId={id} streamId={streamId} active={active} library={library} />
    </QueryClientProvider>
  );
  const result = render(view(true));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '识别当前片段' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '识别当前片段' }));
  await waitFor(() =>
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1),
  );
  result.rerender(view(false));
  expect(fetch.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.signal?.aborted).toBe(
    true,
  );
  await act(async () => {
    finish(
      new Response(
        JSON.stringify({
          stationId: id,
          streamId,
          source: 'audd',
          timing: 'unknown',
          status: 'found',
          song: { artist: 'Late artist', title: 'Late title' },
          observedAt: '2026-10-17T00:00:00Z',
          retryAfter: 60,
          reason: null,
        }),
      ),
    );
  });
  expect(screen.queryByText('Late title')).toBeNull();
  expect(library.store.getState().songs).toHaveLength(0);
  cleanup();
  client.clear();
});
