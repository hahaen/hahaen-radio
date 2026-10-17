import { expect, test, type Page } from '@playwright/test';
import type { RecognitionResult } from '../../packages/contracts/src/recognition.js';
import { first, second, install, listenButton } from './listening-fixture.js';
const recognized = { artist: 'Original Sample Artist', title: 'Original Sample Song' };
function result(
  id = first.id,
  streamId = first.streams[0]!.id,
  status: RecognitionResult['status'] = 'found',
): RecognitionResult {
  const base = {
    stationId: id,
    streamId,
    source: 'audd' as const,
    timing: 'unknown' as const,
    retryAfter: 1,
    reason: null,
  };
  return status === 'found'
    ? { ...base, status, observedAt: '2026-10-17T00:00:00Z', song: recognized }
    : { ...base, status, observedAt: null, song: null };
}
async function setup(page: Page, capability: 'available' | 'disabled' = 'available') {
  await install(page);
  await page.route('**/api/v1/capabilities', (route) =>
    route.fulfill({ json: { recognition: capability } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await listenButton(page, first.name).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
}
async function section(page: Page) {
  await page.getByRole('button', { name: '曲目与歌词', exact: true }).click();
  const section = page.getByRole('region', { name: '手动识曲', exact: true });
  await expect(section).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  return section;
}
test('keeps unavailable identification honest in both languages without issuing a paid request', async ({
  page,
}) => {
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/recognition')) posts++;
  });
  await setup(page, 'disabled');
  const panel = await section(page);
  await expect(panel.getByText('识曲服务暂未启用，仍可正常收听。', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '识别当前片段', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'Track and lyrics', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Identify a song', exact: true })
      .getByText('Song identification is not enabled. Listening still works.', { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(0);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
});
test('identifies only on a click, keeps sample provenance and allows saving and searching the identified song', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  let posts = 0,
    lyrics = 0;
  await setup(page);
  await page.route('**/api/v1/stations/*/recognition', async (route) => {
    posts++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ streamId: first.streams[0]!.id });
    await route.fulfill({ json: result() });
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/lyrics') lyrics++;
  });
  const panel = await section(page);
  await expect(panel.getByRole('button', { name: '识别当前片段', exact: true })).toBeEnabled();
  expect(posts).toBe(0);
  await panel.getByRole('button', { name: '识别当前片段', exact: true }).click();
  await expect(panel.getByRole('heading', { name: recognized.title, exact: true })).toBeVisible();
  await expect(panel.getByText(/AudD 片段结果/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
  await panel.getByRole('button', { name: '收藏这首歌曲', exact: true }).click();
  await expect(panel.getByRole('button', { name: '取消歌曲收藏', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('navigation', { name: '搜索这首歌' }).getByRole('link')).toHaveCount(
    6,
  );
  expect(lyrics).toBe(0);
  expect(posts).toBe(1);
  await panel
    .getByRole('heading', { name: recognized.title, exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('recognition.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
  await page.keyboard.press('Escape');
  await section(page);
  expect(posts).toBe(1);
});
test('distinguishes no match, busy, cooldown, failure and exhausted allowance without automatic retries', async ({
  page,
}) => {
  const statuses = ['not-found', 'busy', 'cooldown', 'error', 'quota-exhausted'] as const;
  const texts = [
    '这次没有识别到歌曲，可以稍后再试。',
    '识曲服务正在处理其他请求，请稍后再试。',
    '识曲服务正在冷却，请稍后再试。',
    '这次识别未完成，请稍后再试。',
    '识曲额度已用完，基础收听仍可继续。',
  ];
  let posts = 0;
  await setup(page);
  await page.route('**/api/v1/stations/*/recognition', (route) =>
    route.fulfill({ json: result(first.id, first.streams[0]!.id, statuses[posts++]!) }),
  );
  const panel = await section(page),
    button = panel.getByRole('button', { name: '识别当前片段', exact: true });
  for (const [index, text] of texts.entries()) {
    await expect(button).toBeEnabled();
    await button.click();
    await expect(panel.getByText(text, { exact: true })).toBeVisible();
    expect(posts).toBe(index + 1);
  }
  await expect(button).toBeDisabled();
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
});
test('drops a late response after station selection and never identifies a new station automatically', async ({
  page,
}) => {
  let posts = 0;
  await setup(page);
  await page.route('**/api/v1/stations/*/recognition', async (route) => {
    posts++;
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({ json: result() }).catch(() => {});
  });
  const panel = await section(page);
  await panel.getByRole('button', { name: '识别当前片段', exact: true }).click();
  await expect.poll(() => posts).toBe(1);
  await page.keyboard.press('Escape');
  await listenButton(page, second.name).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  const next = await section(page);
  await page.waitForTimeout(800);
  await expect(next.getByRole('heading', { name: recognized.title, exact: true })).toHaveCount(0);
  expect(posts).toBe(1);
});
test('aborts a pending identification on native pause and retains basic playback controls after HTTP failure', async ({
  page,
}) => {
  let posts = 0;
  const failed: string[] = [];
  page.on('requestfailed', (request) => {
    if (request.url().endsWith('/recognition'))
      failed.push(request.failure()?.errorText ?? 'failed');
  });
  await setup(page);
  await page.route('**/api/v1/stations/*/recognition', async (route) => {
    posts++;
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route
      .fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable', requestId: 'fixture' },
      })
      .catch(() => {});
  });
  const panel = await section(page);
  await panel.getByRole('button', { name: '识别当前片段', exact: true }).click();
  await expect.poll(() => posts).toBe(1);
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.pause());
  await expect.poll(() => failed.length).toBe(1);
  await expect(panel.getByRole('button', { name: '识别当前片段', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  const retry = await section(page);
  await retry.getByRole('button', { name: '识别当前片段', exact: true }).click();
  await expect(retry.getByText('这次识别未完成，请稍后再试。', { exact: true })).toBeVisible();
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
});
