import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { testStation, testScene } from '../../src/testing/stations.js';
export const first = {
  ...testStation(1),
  name: 'Harbor Jazz',
  genre: 'jazz' as const,
  languages: ['en'],
  bitrate: 192,
};
export const second = {
  ...testStation(2),
  name: 'River Pop',
  genre: 'pop' as const,
  languages: ['fr'],
  bitrate: 320,
};
export const third = {
  ...testStation(3),
  name: 'World News',
  genre: 'news' as const,
  languages: ['fr'],
  bitrate: 64,
};
export const originals = [first, second, third];
export function listenButton(page: Page, name: string, language: 'zh' | 'en' = 'zh') {
  const label = (language === 'zh' ? '收听 ' : 'Listen to ') + name;
  return page.getByRole('button', {
    name: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)'),
  });
}
export async function openDirectory(page: Page) {
  if (await page.locator('#station-directory').count()) return;
  await page.getByRole('button', { name: /^(查找电台|Find a station)$/ }).click();
}
export async function selectStation(page: Page, name: string, language: 'zh' | 'en' = 'zh') {
  await openDirectory(page);
  await listenButton(page, name, language).click();
}
export async function install(page: Page, scene = true) {
  let lookupFailed = false;
  const blocked = new Set<string>();
  const uncertain = new Set<string>();
  const stations = () =>
    originals.map((item) => ({
      ...item,
      availability: blocked.has(item.id)
        ? ('blocked' as const)
        : uncertain.has(item.id)
          ? ('unknown' as const)
          : item.availability,
      streams:
        blocked.has(item.id) || uncertain.has(item.id)
          ? []
          : [
              {
                ...item.streams[0]!,
                url: 'https://media.haen.test/tone.mp3',
                hls: false,
                codec: 'MP3',
              },
            ],
    }));
  const sceneData = () => {
    const data = testScene(stations());
    const metadata = {
      genres: originals.map((s) => ({ id: s.genre, count: 1 })),
      languages: [
        { id: 'en', count: 1 },
        { id: 'fr', count: 2 },
      ],
    };
    return { manifest: { ...data.manifest, ...metadata }, chunk: data.chunk };
  };
  await page.route('**/api/v1/catalog**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/catalog') return route.fulfill({ json: sceneData().manifest });
    if (!scene)
      return route.fulfill({
        status: 503,
        json: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Fixture list fallback',
          requestId: 'fixture',
        },
      });
    return route.fulfill({
      json: url.pathname.endsWith('/scene') ? sceneData().manifest : sceneData().chunk,
    });
  });
  await page.route('**/api/v1/stations**', async (route) => {
    const url = new URL(route.request().url()),
      current = stations();
    if (url.pathname.endsWith('/lookup')) {
      if (lookupFailed)
        return route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture outage', requestId: 'fixture' },
        });
      const ids = route.request().postDataJSON().ids as string[];
      return route.fulfill({
        json: {
          items: current.filter((item) => ids.includes(item.id)),
          missing: ids.filter((id) => !current.some((item) => item.id === id)),
        },
      });
    }
    if (url.pathname === '/api/v1/stations') {
      const query = url.searchParams,
        languages = query.has('languages')
          ? query.get('languages')!.split(',').filter(Boolean)
          : null,
        genres = query.has('genres') ? query.get('genres')!.split(',').filter(Boolean) : null,
        excluded = (query.get('excludeIds') ?? '').split(',');
      const matches = current.filter(
        (item) =>
          item.availability === 'available' &&
          !excluded.includes(item.id) &&
          item.name.toLowerCase().includes((query.get('q') ?? '').toLowerCase()) &&
          (!genres || genres.includes(item.genre)) &&
          (!languages || item.languages.some((lang) => languages.includes(lang))) &&
          item.bitrate >= Number(query.get('minBitrate') ?? 0),
      );
      const offset = Number(query.get('offset') ?? 0),
        limit = Number(query.get('limit') ?? 30);
      return route.fulfill({
        json: {
          items: matches.slice(offset, offset + limit),
          total: matches.length,
          offset,
          limit,
        },
      });
    }
    const item = current.find((s) => s.id === url.pathname.split('/').at(-1));
    return route.fulfill(
      item
        ? { json: item }
        : {
            status: 404,
            json: { code: 'NOT_FOUND', message: 'Fixture missing', requestId: 'fixture' },
          },
    );
  });
  const body = await readFile(new URL('../fixtures/audio/tone.mp3', import.meta.url));
  await page.route('https://media.haen.test/**', async (route) => {
    const headers = route.request().headers();
    const range = headers['range']?.match(/^bytes=(\d+)-(\d*)$/),
      start = range ? Number(range[1]) : 0,
      end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    if (start >= body.length) return route.fulfill({ status: 416, body: '' });
    return route.fulfill({
      status: range ? 206 : 200,
      body: body.subarray(start, end + 1),
      contentType: 'audio/mpeg',
      headers: {
        'access-control-allow-origin': '*',
        'accept-ranges': 'bytes',
        ...(range ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}),
      },
    });
  });
  return {
    block: (id: string) => blocked.add(id),
    unknown: (id: string) => uncertain.add(id),
    failLookup: (value: boolean) => {
      lookupFailed = value;
    },
  };
}
