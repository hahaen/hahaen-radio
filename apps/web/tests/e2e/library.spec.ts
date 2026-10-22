import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { testStation } from '../../src/testing/stations.js';
import {
  first,
  second,
  originals,
  install,
  openDirectory,
  selectStation,
} from './listening-fixture.js';
const prefix = 'haen:personal:v1:';
function transfer(ids: number[], songs = false) {
  return {
    format: 'haen-favorites',
    version: 1,
    exportedAt: '2026-10-17T00:00:00.000Z',
    stations: ids.map((id) => ({
      id: testStation(id).id,
      name: originals.find((item) => item.id === testStation(id).id)?.name ?? 'Removed station',
      countryCode: 'GB',
      savedAt: id,
    })),
    songs: songs ? [{ artist: 'Test artist', title: 'Test song', savedAt: 1 }] : [],
  };
}
async function enter(page: Page, path = '/') {
  await page.goto(path);
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await openDirectory(page);
  await expect(page.getByTestId('directory-state')).toHaveText('找到 3 个电台');
  await page.keyboard.press('Escape');
}
async function play(page: Page, name: string) {
  await selectStation(page, name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.1);
}
const panel = (page: Page) => page.getByRole('dialog', { name: '我的收听' });
async function openLibrary(page: Page) {
  await page.getByRole('button', { name: '我的收听', exact: true }).click();
  await expect(panel(page)).toBeVisible();
}
async function upload(page: Page, data: unknown) {
  await panel(page)
    .locator('input[type=file]')
    .setInputFiles({
      name: 'favorites.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)),
    });
}

test('combines filter dimensions and favorites without interrupting actual current audio', async ({
  page,
}) => {
  await install(page);
  await enter(page);
  await play(page, first.name);
  await openDirectory(page);
  await page.locator('#station-directory').getByText('筛选电台', { exact: true }).click();
  await page.getByRole('checkbox', { name: '流行', exact: true }).check();
  await expect(page.getByTestId('directory-state')).toHaveText('找到 1 个电台');
  await expect(page.getByText('当前电台不在这些筛选条件中，播放会继续。')).toBeVisible();
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await openDirectory(page);
  await page.locator('#station-directory summary').click();
  await page.getByRole('checkbox', { name: '爵士', exact: true }).check();
  await expect(page.getByTestId('directory-state')).toHaveText('找到 2 个电台');
  await page.getByRole('checkbox', { name: /法语/ }).check();
  await page.getByRole('combobox', { name: '最低码率' }).selectOption('320');
  await expect(page.getByTestId('directory-state')).toHaveText('找到 1 个电台');
  await page.getByRole('checkbox', { name: '只看收藏', exact: true }).check();
  await expect(page.getByTestId('directory-state')).toHaveText('找到 0 个电台');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '随机下一站', exact: true })).toBeDisabled();
  await openDirectory(page);
  await page.locator('#station-directory summary').click();
  await page.getByRole('button', { name: '清除全部条件', exact: true }).click();
  await expect(page.getByTestId('directory-state')).toHaveText('找到 3 个电台');
  await page
    .getByRole('group', { name: '流派', exact: true })
    .getByRole('button', { name: '清空此项选择', exact: true })
    .click();
  await expect(page.getByTestId('directory-state')).toHaveText('找到 0 个电台');
  await page.getByRole('button', { name: '全部流派', exact: true }).click();
  await expect(page.getByTestId('directory-state')).toHaveText('找到 3 个电台');
});
test('restores successful listening paused and gives a shared station priority over saved filters and history', async ({
  page,
}) => {
  await install(page);
  await enter(page);
  await play(page, first.name);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '收藏 ' + first.name, exact: true }).click();
  await openDirectory(page);
  await page.locator('#station-directory').getByText('筛选电台', { exact: true }).click();
  await page.getByRole('checkbox', { name: '爵士', exact: true }).check();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('audio')).toHaveCount(0);
  await page.goto('/?station=' + second.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
  await openDirectory(page);
  await page.locator('#station-directory summary').click();
  await expect(page.getByRole('checkbox', { name: '爵士', exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('audio')).toHaveCount(0);
  await openLibrary(page);
  await expect(
    panel(page).getByRole('button', { name: '最近收听（1）', exact: true }),
  ).toBeVisible();
  await panel(page).getByRole('button', { name: '最近收听（1）', exact: true }).click();
  await panel(page).getByRole('button', { name: '清空最近收听', exact: true }).click();
  await panel(page).getByRole('button', { name: '确认移除', exact: true }).click();
  await expect(
    panel(page).getByRole('button', { name: '最近收听（0）', exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: '电台收藏（1）', exact: true }),
  ).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/把世界，\s*听近一点。/);
  await page.goto('/?station=invalid');
  await expect(page.getByText(/此分享链接没有有效的电台编号/)).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(0);
  await page.goto('/?station=' + testStation(9).id);
  await expect(
    page.getByText('这台电台已不在目录中，请选择其他电台。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '继续探索', exact: true })).toBeEnabled();
});
test('synchronizes independent favorites and history across real browser tabs', async ({
  page,
  context,
}) => {
  await install(page);
  await enter(page);
  await play(page, first.name);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '收藏 ' + first.name, exact: true }).click();
  const other = await context.newPage();
  await install(other);
  await other.goto('/');
  await expect(other.getByRole('heading', { level: 1 })).toHaveText(first.name);
  await play(other, second.name);
  await other.getByRole('button', { name: '暂停', exact: true }).click();
  await other.getByRole('button', { name: '收藏 ' + second.name, exact: true }).click();
  await openLibrary(page);
  await openLibrary(other);
  await expect(
    panel(page).getByRole('button', { name: '电台收藏（2）', exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: '最近收听（2）', exact: true }),
  ).toBeVisible();
  await panel(page)
    .getByRole('button', { name: '取消收藏 ' + first.name, exact: true })
    .click();
  await expect(
    panel(other).getByRole('button', { name: '电台收藏（1）', exact: true }),
  ).toBeVisible();
  await other.close();
});
test('merges imports, retains existing snapshots, rejects invalid files, and exports only favorites', async ({
  page,
}) => {
  await install(page);
  await enter(page);
  await play(page, first.name);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '收藏 ' + first.name, exact: true }).click();
  await openLibrary(page);
  const data = transfer([1, 2, 2], true);
  data.stations[0]!.name = 'Old imported name';
  await upload(page, data);
  await expect(
    panel(page).getByText('新增 2 项，已存在或重复 2 项。', { exact: true }),
  ).toBeVisible();
  await upload(page, data);
  await expect(
    panel(page).getByText('新增 0 项，已存在或重复 4 项。', { exact: true }),
  ).toBeVisible();
  await upload(page, { ...data, version: 2 });
  await expect(panel(page).getByText(/文件格式无法识别/)).toBeVisible();
  await panel(page)
    .locator('input[type=file]')
    .setInputFiles({
      name: 'huge.json',
      mimeType: 'application/json',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 32),
    });
  await expect(panel(page).getByText(/文件超过 2MiB/)).toBeVisible();
  const downloading = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: '导出收藏', exact: true }).click();
  const download = await downloading;
  const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(saved.stations).toHaveLength(2);
  expect(saved.songs).toHaveLength(1);
  expect(saved.stations.find((s: { id: string }) => s.id === first.id).name).toBe(first.name);
  expect(Object.keys(saved).sort()).toEqual([
    'exportedAt',
    'format',
    'songs',
    'stations',
    'version',
  ]);
  expect(JSON.stringify(saved)).not.toContain('https://media.');
});
test('retains unavailable favorites until confirmed cleanup and never treats a lookup outage as offline', async ({
  page,
}) => {
  const fixture = await install(page);
  await enter(page);
  await openLibrary(page);
  await upload(page, transfer([1, 2, 9]));
  await expect(
    panel(page).getByRole('button', { name: '电台收藏（3）', exact: true }),
  ).toBeVisible();
  fixture.failLookup(true);
  await panel(page).getByRole('button', { name: '刷新收藏状态', exact: true }).click();
  await expect(panel(page).getByText(/暂时无法核对收藏状态/)).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: '清理不可用收藏（0）', exact: true }),
  ).toBeDisabled();
  fixture.failLookup(false);
  fixture.unknown(first.id);
  await panel(page).getByRole('button', { name: '刷新收藏状态', exact: true }).click();
  await expect(
    panel(page).getByRole('button', { name: '清理不可用收藏（1）', exact: true }),
  ).toBeEnabled();
  await expect(panel(page).getByText('状态尚未确认', { exact: true })).toBeVisible();
  fixture.block(first.id);
  await panel(page).getByRole('button', { name: '刷新收藏状态', exact: true }).click();
  await panel(page).getByRole('button', { name: '清理不可用收藏（2）', exact: true }).click();
  await panel(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(
    panel(page).getByRole('button', { name: '电台收藏（3）', exact: true }),
  ).toBeVisible();
  await panel(page).getByRole('button', { name: '清理不可用收藏（2）', exact: true }).click();
  await panel(page).getByRole('button', { name: '确认移除', exact: true }).click();
  await expect(
    panel(page).getByRole('button', { name: '电台收藏（1）', exact: true }),
  ).toBeVisible();
});
test('keeps session favorites usable when browser storage is denied', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    }),
  );
  await install(page);
  await enter(page);
  await expect(page.getByRole('alert')).toContainText('暂时无法保存');
  await play(page, first.name);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '收藏 ' + first.name, exact: true }).click();
  await openLibrary(page);
  await expect(
    panel(page).getByRole('button', { name: '电台收藏（1）', exact: true }),
  ).toBeVisible();
  await panel(page).getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect(page.getByRole('button', { name: '我的收听', exact: true })).toBeFocused();
});
test('preserves unsupported local data and offers a translated scrollable library panel', async ({
  page,
}) => {
  await page.addInitScript(({ key }) => localStorage.setItem(key, '{"version":2}'), {
    key: prefix + 'favorite:' + first.id,
  });
  await install(page);
  await enter(page);
  await expect(page.getByRole('alert')).toContainText('原数据已保留');
  expect(
    await page.evaluate((key) => localStorage.getItem(key), prefix + 'favorite:' + first.id),
  ).toBe('{"version":2}');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'My listening', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'My listening' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Export favorites', exact: true })).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
test('uses the same favorite candidates for list and random exploration when the scene is unavailable', async ({
  page,
}) => {
  await install(page, false);
  await enter(page);
  await openLibrary(page);
  await upload(page, transfer([2]));
  await panel(page).getByRole('button', { name: '关闭面板', exact: true }).click();
  await openDirectory(page);
  await page.locator('#station-directory').getByText('筛选电台', { exact: true }).click();
  await page.getByRole('checkbox', { name: '只看收藏', exact: true }).check();
  await expect(page.getByTestId('directory-state')).toHaveText('找到 1 个电台');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '开始收听', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
});

test('shares a clean station URL with clipboard feedback and restores it without autoplay', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem('fixture:copied', text);
        },
      },
    });
  });
  await install(page);
  await enter(page, '/?discard=this#main');
  await play(page, first.name);
  await openLibrary(page);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
  await panel(page).getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '分享', exact: true }).click();
  await expect(page.getByText('电台链接已复制。', { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => sessionStorage.getItem('fixture:copied'));
  expect(copied).not.toBeNull();
  expect(new URL(copied!).search).toBe('?station=' + first.id);
  expect(new URL(copied!).hash).toBe('');
  await page.goto(copied!);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.name);
  await expect(page.locator('audio')).toHaveCount(0);
});
