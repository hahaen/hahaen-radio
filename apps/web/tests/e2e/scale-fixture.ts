import type { Page } from '@playwright/test';
import { encodeSceneEntry } from '@haen/contracts';
import { testScene, testStation } from '../../src/testing/stations.js';
import { first, second, install } from './listening-fixture.js';

// Synthetic scale data is restricted to this test; the application has no fixture fallback.
export const stations = Array.from({ length: 30000 }, (_, index) => ({
  ...(index === 0 ? first : index === 1 ? second : testStation(index + 1)),
  latitude: -75 + Math.floor(index / 300) * 1.5,
  longitude: -180 + (index % 300) * 1.2,
  locationPrecision: 'coordinates' as const,
  genre: index % 2 ? ('pop' as const) : ('jazz' as const),
  languages: [index % 2 ? 'fr' : 'en'],
  bitrate: index % 2 ? 320 : 128,
  streams: [{ ...testStation(index + 1).streams[0]!, url: 'https://media.haen.test/tone.mp3' }],
}));
const manifest = {
  ...testScene([]).manifest,
  stationCount: stations.length,
  playableCount: stations.length,
  countryCount: 1,
  genres: [
    { id: 'jazz', count: 15000 },
    { id: 'pop', count: 15000 },
  ],
  languages: [
    { id: 'en', count: 15000 },
    { id: 'fr', count: 15000 },
  ],
  chunks: Array.from({ length: 30 }, (_, index) => ({ index, count: 1000 })),
};
export async function installScale(page: Page) {
  await install(page);
  const counts = { chunks: 0, details: 0, searches: 0, media: 0, other: 0 };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'media.haen.test') counts.media++;
    else if (/\/stations\/[a-f0-9-]{36}$/.test(url.pathname)) counts.details++;
    else if (url.pathname === '/api/v1/stations') counts.searches++;
    else if (url.pathname.startsWith('/api/')) counts.other++;
  });
  await page.route('**/api/v1/catalog**', (route) => {
    const url = new URL(route.request().url()),
      last = url.pathname.split('/').at(-1);
    if (last === 'scene' || url.pathname === '/api/v1/catalog')
      return route.fulfill({ json: manifest });
    const index = Number(last);
    if (!Number.isInteger(index) || index < 0 || index >= 30)
      return route.fulfill({ status: 404, body: '' });
    counts.chunks++;
    return route.fulfill({
      json: {
        format: 1,
        version: manifest.version,
        restrictionsRevision: manifest.restrictionsRevision,
        index,
        entries: stations.slice(index * 1000, (index + 1) * 1000).map(encodeSceneEntry),
      },
    });
  });
  await page.route('**/api/v1/stations**', (route) => {
    const url = new URL(route.request().url()),
      q = url.searchParams;
    if (url.pathname === '/api/v1/stations') {
      const matches = stations.filter(
        (station) =>
          station.name.toLowerCase().includes((q.get('q') ?? '').toLowerCase()) &&
          (!q.has('genres') || q.get('genres')!.split(',').includes(station.genre)) &&
          (!q.has('languages') ||
            station.languages.some((language) =>
              q.get('languages')!.split(',').includes(language),
            )) &&
          station.bitrate >= Number(q.get('minBitrate') ?? 0),
      );
      const offset = Number(q.get('offset') ?? 0),
        limit = Number(q.get('limit') ?? 30);
      return route.fulfill({
        json: {
          items: matches.slice(offset, offset + limit),
          total: matches.length,
          offset,
          limit,
        },
      });
    }
    if (url.pathname.endsWith('/lookup')) {
      const ids = route.request().postDataJSON().ids as string[];
      return route.fulfill({
        json: { items: stations.filter((station) => ids.includes(station.id)), missing: [] },
      });
    }
    const id = url.pathname.split('/').at(-1),
      station = stations.find((item) => item.id === id);
    return route.fulfill(
      station
        ? { json: station }
        : {
            status: 404,
            json: { code: 'NOT_FOUND', message: 'Controlled scale fixture', requestId: 'scale' },
          },
    );
  });
  return counts;
}
