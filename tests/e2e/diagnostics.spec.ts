import { expect, test, type Page } from '@playwright/test';
import { first, second, install, listenButton } from './listening-fixture.js';
import type { PlaybackReportRequest } from '../../packages/contracts/src/diagnostics.js';
async function setup(page: Page, english = false) {
  await install(page);
  await page.route('https://media.haen.test/tone.mp3', (route) =>
    route.fulfill({ status: 503, body: '' }),
  );
  await page.goto('/?station=' + first.id);
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
  await page.getByRole('button', { name: '固定当前电台', exact: true }).click();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'failed');
  if (english) await page.getByRole('button', { name: 'EN', exact: true }).click();
  return feedback(page, english);
}
async function feedback(page: Page, english = false) {
  await page
    .getByRole('button', { name: english ? 'About and help' : '关于与帮助', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: english ? 'About and help' : '关于与帮助' });
  await dialog
    .getByRole('button', { name: english ? 'Feedback' : '问题反馈', exact: true })
    .click();
  const report = dialog.getByRole('region', {
    name: english ? 'Minimal playback failure report' : '精简播放故障报告',
  });
  await report.scrollIntoViewIfNeeded();
  return report;
}
function accepted(stationId: string, input: PlaybackReportRequest) {
  return {
    status: 'accepted',
    stationId,
    streamId: input.streamId,
    reportId: input.reportId,
    expiresAt: '2026-10-24T00:00:00Z',
  };
}
test('submits only after an explicit click, exposes the exact minimal fields and does not take the station offline', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  const report = await setup(page);
  let posts = 0;
  await page.route('**/api/v1/stations/*/playback-reports', (route) => {
    posts++;
    const input = route.request().postDataJSON() as PlaybackReportRequest;
    expect(Object.keys(input).sort()).toEqual(['failure', 'reportId', 'streamId']);
    expect(input.streamId).toBe(first.streams[0]!.id);
    expect(input.reportId).toMatch(/^[a-f0-9-]{36}$/);
    return route.fulfill({ status: 202, json: accepted(first.id, input) });
  });
  expect(posts).toBe(0);
  await expect(report.getByText(first.id, { exact: true })).toBeVisible();
  await report.getByRole('button', { name: '提交精简故障报告', exact: true }).click();
  await expect(
    report.getByText('已收到这条故障报告。它是待核实的反馈，不会自动下线电台。', { exact: true }),
  ).toBeVisible();
  await expect(
    report.getByRole('button', { name: '提交精简故障报告', exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(1);
  await report.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('diagnostic-report.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
  await expect(listenButton(page, first.name)).toBeEnabled();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  const enlarged = await feedback(page, true);
  await page.addStyleTag({
    content:
      'dialog :is(button,p,h4,label,dd,dt,a) {font-size:32px!important} dialog h2 {font-size:56px!important} dialog h3 {font-size:48px!important} dialog :is(textarea,kbd) {font-size:28px!important}',
  });
  for (const size of [
    { width: 320, height: 720 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    const button = enlarged.getByRole('button', {
      name: 'Submit minimal failure report',
      exact: true,
    });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    expect(
      await enlarged.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(posts).toBe(1);
});
test('keeps retries manual, reuses a single receipt after an uncertain request and handles unavailable and limited responses in English', async ({
  page,
}) => {
  const report = await setup(page, true);
  const ids: string[] = [];
  await page.route('**/api/v1/stations/*/playback-reports', (route) => {
    const input = route.request().postDataJSON() as PlaybackReportRequest;
    ids.push(input.reportId);
    if (ids.length === 1) return route.abort('failed');
    if (ids.length === 2)
      return route.fulfill({
        status: 404,
        json: { code: 'NOT_FOUND', message: 'Not found', requestId: 'test' },
      });
    if (ids.length === 3)
      return route.fulfill({ status: 429, json: { status: 'limited', retryAfter: 1 } });
    return route.fulfill({ status: 202, json: accepted(first.id, input) });
  });
  const button = report.getByRole('button', { name: 'Submit minimal failure report', exact: true });
  await button.click();
  await expect(report.getByText(/Receipt could not be confirmed/)).toBeVisible();
  expect(ids).toHaveLength(1);
  await button.click();
  await expect(report.getByText(/Reporting is unavailable/)).toBeVisible();
  expect(ids).toHaveLength(2);
  await button.click();
  await expect(report.getByText(/Too many attempts or today/)).toBeVisible();
  await expect(button).toBeEnabled();
  expect(ids).toHaveLength(3);
  await button.click();
  await expect(report.getByText(/This failure report was received/)).toBeVisible();
  expect(ids).toHaveLength(4);
  expect(new Set(ids).size).toBe(1);
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined }),
  );
  const unsupported = await feedback(page, true);
  await expect(
    unsupported.getByText(/Your environment cannot create a report receipt/),
  ).toBeVisible();
  await expect(
    unsupported.getByRole('button', { name: 'Submit minimal failure report', exact: true }),
  ).toBeDisabled();
  expect(ids).toHaveLength(4);
});
test('aborts a dismissed request and never displays its late receipt after selecting another failed station', async ({
  page,
}) => {
  const report = await setup(page);
  let posts = 0;
  await page.route('**/api/v1/stations/*/playback-reports', async (route) => {
    posts++;
    const input = route.request().postDataJSON() as PlaybackReportRequest;
    if (posts === 1) await new Promise((resolve) => setTimeout(resolve, 700));
    await route
      .fulfill({ status: 202, json: accepted(posts === 1 ? first.id : second.id, input) })
      .catch(() => {});
  });
  await report.getByRole('button', { name: '提交精简故障报告', exact: true }).click();
  await expect.poll(() => posts).toBe(1);
  await page.keyboard.press('Escape');
  await listenButton(page, second.name).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'failed');
  const next = await feedback(page);
  await page.waitForTimeout(800);
  await expect(next.getByText(/已收到这条故障报告/)).toHaveCount(0);
  expect(posts).toBe(1);
  await next.getByRole('button', { name: '提交精简故障报告', exact: true }).click();
  await expect(next.getByText(/已收到这条故障报告/)).toBeVisible();
  expect(posts).toBe(2);
});
