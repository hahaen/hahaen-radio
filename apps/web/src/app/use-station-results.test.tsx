import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { StationPreview } from '@haen/contracts';
import { searchStations } from '../services/catalog';
import { testStation } from '../testing/stations';
import { useStationResults } from './use-station-results';

vi.mock('../services/catalog', () => ({ searchStations: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('keeps loaded API rows when the complete local catalog becomes available', async () => {
  const entries = Array.from({ length: 75 }, (_, index) => testStation(index + 1));
  vi.mocked(searchStations).mockImplementation(async (_filters, offset = 0) => ({
    items: entries.slice(offset, offset + 30),
    total: entries.length,
    offset,
    limit: 30,
  }));
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const filters = { q: '' };
  const initialProps: { candidates: StationPreview[] | undefined } = { candidates: undefined };
  const { result, rerender, unmount } = renderHook(
    ({ candidates }: { candidates: StationPreview[] | undefined }) =>
      useStationResults(filters, candidates),
    { wrapper, initialProps },
  );
  await waitFor(() => expect(result.current.data?.items).toHaveLength(30));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.data?.items).toHaveLength(60));
  rerender({ candidates: entries });
  expect(result.current.data?.items).toHaveLength(60);
  act(() => result.current.loadMore());
  expect(result.current.data?.items).toHaveLength(75);
  expect(result.current.hasMore).toBe(false);
  expect(searchStations).toHaveBeenCalledTimes(2);
  unmount();
  client.clear();
});
