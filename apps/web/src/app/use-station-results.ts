import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { StationPreview } from '@haen/contracts';
import { searchStations, type SearchFilters } from '../services/catalog';

const BATCH_SIZE = 30;

export function useStationResults(
  filters: SearchFilters,
  candidates: readonly StationPreview[] | undefined,
) {
  const [visible, setVisible] = useState({ filters, limit: BATCH_SIZE });
  const requestedLimit = visible.filters === filters ? visible.limit : BATCH_SIZE;
  if (visible.filters !== filters) setVisible({ filters, limit: BATCH_SIZE });

  const remote = useInfiniteQuery({
    queryKey: ['station-directory', filters],
    enabled: candidates === undefined,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => searchStations(filters, pageParam, BATCH_SIZE, signal),
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return last.items.length > 0 && next < last.total ? next : undefined;
    },
    retry: 1,
    staleTime: 30000,
    // Refocusing should not refetch every previously loaded batch in a long list.
    refetchOnWindowFocus: false,
  });
  const remoteItems = useMemo(() => {
    const byId = new Map<string, StationPreview>();
    for (const page of remote.data?.pages ?? []) {
      for (const station of page.items) byId.set(station.id, station);
    }
    return [...byId.values()];
  }, [remote.data]);
  // Keep already loaded rows when the complete local catalog replaces the API fallback.
  const limit = Math.max(requestedLimit, remoteItems.length);
  const data = useMemo(
    () =>
      candidates
        ? { items: candidates.slice(0, limit), total: candidates.length }
        : remote.data
          ? { items: remoteItems, total: remote.data.pages.at(-1)!.total }
          : undefined,
    [candidates, limit, remote.data, remoteItems],
  );
  const { fetchNextPage, hasNextPage, isFetching } = remote;
  const loadMore = useCallback(() => {
    if (candidates) {
      setVisible({ filters, limit: Math.min(candidates.length, limit + BATCH_SIZE) });
    } else if (hasNextPage && !isFetching) {
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [candidates, filters, limit, hasNextPage, isFetching, fetchNextPage]);

  return {
    data,
    hasMore: candidates ? limit < candidates.length : !!remote.hasNextPage,
    isPending: candidates === undefined && remote.isPending,
    isError: candidates === undefined && remote.isError && !remote.isFetchNextPageError,
    isFetching: candidates === undefined && remote.isFetching,
    loadMoreError: candidates === undefined && remote.isFetchNextPageError,
    loadMore,
    refetch: remote.refetch,
  };
}
