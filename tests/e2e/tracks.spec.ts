import { expect, test, type Page } from '@playwright/test';
import type { NowPlaying, LyricsResult } from '../../packages/contracts/src/tracks.js';
import { first, second, install } from './listening-fixture.js';
const song = { artist: 'Harbor Artist', title: 'Night Arrival' };
const record = {
  id: 1,
  ...song,
  album: 'Original test album',
  duration: 180,
  instrumental: false,
  plain: 'A light across the water\nA quiet shore ahead',
  lines: [
    { at: 0, text: 'A light across the water' },
    { at: 2, text: 'A quiet shore ahead' },
    { at: 5, text: 'The night carries our song' },
  ],
};
async function setup(page: Page) {
  await install(page);
  let rawTitle = `${song.artist} - ${song.title}`,
    lyrics: LyricsResult = { source: 'lrclib', status: 'found', items: [record], retryAfter: null },
    reads = 0,
    lyricReads = 0,
    failLyrics = false,
    failMetadata = false;
  await page.route('**/api/v1/stations/*/now-playing?*', async (route) => {
    reads++;
    const url = new URL(route.request().url()),
      id = url.pathname.split('/')[4]!;
    const data: NowPlaying = {
      stationId: id,
      streamId: url.searchParams.get('streamId')!,
      source: 'station-icy',
      status: rawTitle ? 'available' : 'unavailable',
      rawTitle: rawTitle || null,
      song: rawTitle.includes(' - ')
        ? { artist: rawTitle.split(' - ')[0]!, title: rawTitle.split(' - ').slice(1).join(' - ') }
        : null,
      observedAt: new Date().toISOString(),
      timing: 'unknown',
      retryAfter: 15,
    };
    await route.fulfill(
      failMetadata
        ? {
            status: 503,
            json: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Fixture unavailable',
              requestId: 'fixture',
            },
          }
        : { json: data },
    );
  });
  await page.route('**/api/v1/lyrics?*', async (route) => {
    lyricReads++;
    await route.fulfill(
      failLyrics
        ? {
            status: 503,
            json: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Fixture unavailable',
              requestId: 'fixture',
            },
          }
        : { json: lyrics },
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('button', { name: '收听 ' + first.name, exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await expect(page.getByText(rawTitle, { exact: true })).toBeVisible();
  return {
    setTitle: (value: string) => {
      rawTitle = value;
    },
    setLyrics: (value: LyricsResult) => {
      lyrics = value;
    },
    failLyrics: (value: boolean) => {
      failLyrics = value;
    },
    failMetadata: (value: boolean) => {
      failMetadata = value;
    },
    reads: () => reads,
    lyricReads: () => lyricReads,
  };
}
async function panel(page: Page) {
  await page.getByRole('button', { name: '曲目与歌词', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '曲目与歌词', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
test('saves real supplied song identities, offers six encoded searches, migrates and copies the song list', async ({
  page,
  context,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem('copiedSongs', text);
        },
      },
    }),
  );
  const fixture = await setup(page),
    dialog = await panel(page);
  await expect(dialog.getByText(/以下文字由电台提供/)).toBeVisible();
  expect(fixture.lyricReads()).toBe(0);
  if (await page.evaluate(() => !!navigator.mediaSession && typeof MediaMetadata === 'function'))
    await expect
      .poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title))
      .toBe(song.title);
  await dialog.getByRole('button', { name: '收藏这首歌曲', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '取消歌曲收藏', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    await dialog.getByRole('navigation', { name: '搜索这首歌' }).getByRole('link').count(),
  ).toBe(6);
  for (const link of await dialog
    .getByRole('navigation', { name: '搜索这首歌' })
    .getByRole('link')
    .all())
    expect(decodeURIComponent((await link.getAttribute('href'))!.replace(/\+/g, ' '))).toContain(
      song.artist + ' ' + song.title,
    );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '我的收听', exact: true }).click();
  const library = page.getByRole('dialog', { name: '我的收听' });
  await library.getByRole('button', { name: '歌曲收藏（1）', exact: true }).click();
  await library.getByRole('button', { name: '复制歌曲清单', exact: true }).click();
  await expect(library.getByText('歌曲清单已复制。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('copiedSongs'))).toBe(
    song.artist + ' — ' + song.title,
  );
  const downloadPromise = page.waitForEvent('download');
  await library.getByRole('button', { name: '导出收藏', exact: true }).click();
  const download = await downloadPromise,
    stream = await download.createReadStream();
  const buffers: Buffer[] = [];
  for await (const chunk of stream!) buffers.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(buffers).toString()).songs[0]).toMatchObject(song);
  const peer = await context.newPage();
  await install(peer);
  await peer.goto('/');
  await peer.getByRole('button', { name: '我的收听', exact: true }).click();
  const peerLibrary = peer.getByRole('dialog', { name: '我的收听' });
  await expect(
    peerLibrary.getByRole('button', { name: '歌曲收藏（1）', exact: true }),
  ).toBeVisible();
  await library.getByRole('button', { name: '移除歌曲 ' + song.title, exact: true }).click();
  await expect(library.getByRole('button', { name: '歌曲收藏（0）', exact: true })).toBeVisible();
  await expect(
    peerLibrary.getByRole('button', { name: '歌曲收藏（0）', exact: true }),
  ).toBeVisible();
  await peer.close();
});
test('keeps timestamp lyrics static until manual calibration, follows real playing time and freezes on actual pause', async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await setup(page),
    dialog = await panel(page);
  await dialog.getByRole('button', { name: '查找歌词', exact: true }).click();
  const lines = dialog.getByLabel('带时间戳的歌词', { exact: true });
  await expect(lines).toBeVisible();
  expect(fixture.lyricReads()).toBe(1);
  await expect(lines.locator('[aria-current=true]')).toHaveCount(0);
  await page.clock.fastForward(3000);
  await expect(lines.locator('[aria-current=true]')).toHaveCount(0);
  await dialog.getByRole('button', { name: '以此刻作为 00:00', exact: true }).click();
  await page.clock.fastForward(3000);
  await expect(lines.locator('[aria-current=true]')).toContainText('A quiet shore ahead');
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.pause());
  await expect(dialog.getByText(/当前未读取直播元数据/)).toBeVisible();
  const current = await dialog.getByText(/手动位置/).textContent(),
    reads = fixture.reads();
  await page.clock.fastForward(16000);
  expect(fixture.reads()).toBe(reads);
  expect(await dialog.getByText(/手动位置/).textContent()).toBe(current);
  await dialog.getByRole('button', { name: '时间 +0.5 秒', exact: true }).click();
  await expect(dialog.getByText(/偏移 0.5 秒/)).toBeVisible();
  await dialog.getByRole('button', { name: '暂停跟随', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '恢复跟随', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
test('resets calibration on a new broadcast title and does not request lyrics for unstructured or missing metadata', async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await setup(page),
    dialog = await panel(page);
  await dialog.getByRole('button', { name: '查找歌词', exact: true }).click();
  await dialog.getByRole('button', { name: '以此刻作为 00:00', exact: true }).click();
  fixture.setTitle('Another Artist - Another Song');
  await page.clock.fastForward(16000);
  await expect(dialog.getByRole('heading', { name: 'Another Song', exact: true })).toBeVisible();
  await expect(dialog.getByText(/手动位置/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '查找歌词', exact: true })).toBeVisible();
  expect(fixture.lyricReads()).toBe(1);
  fixture.setTitle('An unstructured programme title');
  await page.clock.fastForward(16000);
  await expect(dialog.getByText(/无法可靠区分歌手与曲名/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '收藏这首歌曲', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '查找歌词', exact: true })).toHaveCount(0);
  fixture.setTitle('');
  await page.clock.fastForward(16000);
  await expect(dialog.getByText('此线路未提供可读取的曲目信息。', { exact: true })).toBeVisible();
});
test('shows selectable versions, plain and instrumental lyrics, and explicit empty, rate-limited and failed responses', async ({
  page,
}) => {
  const fixture = await setup(page),
    dialog = await panel(page);
  fixture.setLyrics({
    source: 'lrclib',
    status: 'found',
    items: [
      { ...record, lines: [] },
      {
        ...record,
        id: 2,
        album: 'Instrumental test version',
        instrumental: true,
        plain: null,
        lines: [],
      },
    ],
    retryAfter: null,
  });
  await dialog.getByRole('button', { name: '查找歌词', exact: true }).click();
  const version = dialog.getByRole('combobox', { name: '歌词版本', exact: true });
  await version.selectOption('1');
  await expect(dialog.getByText(record.plain, { exact: true })).toBeVisible();
  await version.selectOption('2');
  await expect(dialog.getByText('此版本标为纯音乐，没有歌词。', { exact: true })).toBeVisible();
  fixture.setLyrics({ source: 'lrclib', status: 'not-found', items: [], retryAfter: null });
  await dialog.getByRole('button', { name: '重新查询歌词', exact: true }).click();
  await expect(dialog.getByText('没有找到歌手与曲名一致的歌词。', { exact: true })).toBeVisible();
  fixture.setLyrics({ source: 'lrclib', status: 'rate-limited', items: [], retryAfter: 60 });
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await expect(
    dialog.getByText('歌词服务正在限流，请在约 60 秒后重试。', { exact: true }),
  ).toBeVisible();
  fixture.failLyrics(true);
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await expect(dialog.getByText('歌词服务暂时不可用，请稍后重试。', { exact: true })).toBeVisible();
});
test('keeps the song and lyrics dialog usable on desktop and narrow phone layouts', async ({
  page,
}, info) => {
  await setup(page);
  const dialog = await panel(page);
  await dialog.getByRole('button', { name: '查找歌词', exact: true }).click();
  await expect(dialog.getByLabel('带时间戳的歌词', { exact: true })).toBeVisible();
  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
    ['narrow', 320, 700],
    ['landscape', 844, 390],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await dialog.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: info.outputPath('lyrics-' + name + '.png') });
    await dialog.getByLabel('带时间戳的歌词', { exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByLabel('带时间戳的歌词', { exact: true })).toBeVisible();
  }
});

test('ignores a late metadata response after selecting a different actual station', async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await setup(page);
  let release: () => void = () => {},
    waiting = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/stations/' + first.id + '/now-playing?*', async (route) => {
    waiting = true;
    await held;
    const streamId = new URL(route.request().url()).searchParams.get('streamId')!;
    await route.fulfill({
      json: {
        stationId: first.id,
        streamId,
        source: 'station-icy',
        status: 'available',
        rawTitle: 'Old Artist - Old Song',
        song: { artist: 'Old Artist', title: 'Old Song' },
        observedAt: new Date().toISOString(),
        timing: 'unknown',
        retryAfter: 15,
      },
    });
  });
  await page.clock.fastForward(16000);
  await expect.poll(() => waiting).toBe(true);
  fixture.setTitle('Second Artist - Second Song');
  await page.getByRole('button', { name: '收听 ' + second.name, exact: true }).click();
  await expect(page.getByText('Second Artist - Second Song', { exact: true })).toBeVisible();
  release();
  const dialog = await panel(page);
  await expect(dialog.getByRole('heading', { name: 'Second Song', exact: true })).toBeVisible();
  await expect(dialog.getByText('Old Song', { exact: true })).toHaveCount(0);
});
test('offers selectable text when clipboard is denied and keeps English lyrics usable with doubled phone text', async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException('Denied', 'NotAllowedError');
        },
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const track = await panel(page);
  await track.getByRole('button', { name: '收藏这首歌曲', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '我的收听', exact: true }).click();
  const library = page.getByRole('dialog', { name: '我的收听' });
  await library.getByRole('button', { name: '歌曲收藏（1）', exact: true }).click();
  await library.getByRole('button', { name: '复制歌曲清单', exact: true }).click();
  await expect(library.getByRole('textbox')).toHaveValue(song.artist + ' — ' + song.title);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'Track and lyrics', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Track and lyrics' });
  await dialog.getByRole('button', { name: 'Find lyrics', exact: true }).click();
  await expect(dialog.getByLabel('Timestamped lyrics', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const values = [...document.querySelectorAll<HTMLElement>('dialog, dialog *')].map(
      (element) => {
        const style = getComputedStyle(element);
        return { element, font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
      },
    );
    for (const { element, font, line } of values) {
      element.style.fontSize = font * 2 + 'px';
      if (Number.isFinite(line)) element.style.lineHeight = line * 2 + 'px';
    }
  });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await dialog.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: info.outputPath('lyrics-text200-en.png') });
  const lyrics = dialog.getByLabel('Timestamped lyrics', { exact: true });
  await lyrics.scrollIntoViewIfNeeded();
  expect(await lyrics.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  const time = await lyrics.locator('time').first().boundingBox(),
    text = await lyrics.locator('span').first().boundingBox();
  expect(time!.x + time!.width).toBeLessThanOrEqual(text!.x);
  await page.screenshot({ path: info.outputPath('lyrics-text200-lines-en.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Track and lyrics', exact: true })).toBeFocused();
});
test('marks cached metadata as an earlier observation after failure and keeps actual audio playing', async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await setup(page);
  fixture.failMetadata(true);
  await page.clock.fastForward(16000);
  await expect(page.getByText('上次观测', { exact: true })).toBeVisible();
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
  if (await page.evaluate(() => !!navigator.mediaSession && typeof MediaMetadata === 'function'))
    await expect
      .poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title))
      .toBe(first.name);
  const dialog = await panel(page);
  await expect(
    dialog.getByText('暂时无法读取曲目信息，不影响收听。', { exact: true }),
  ).toBeVisible();
});
