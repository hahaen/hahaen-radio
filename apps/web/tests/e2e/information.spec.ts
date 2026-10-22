import { expect, test, type Page } from '@playwright/test';
import { first, install, selectStation } from './listening-fixture.js';

async function setup(page: Page) {
  await install(page);
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await selectStation(page, first.name);
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
  await page.getByRole('button', { name: '关于与帮助', exact: true }).click();
  return page.getByRole('dialog', { name: '关于与帮助' });
}
test('explains local data and external requests in both languages, keeps only the requested topics and preserves playback and focus', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  const panel = await setup(page);
  await expect(panel.getByRole('heading', { name: '关于声屿', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '隐私说明', exact: true }).click();
  await expect(panel.getByText(/没有云端收藏或账号同步/)).toBeVisible();
  await expect(panel.getByText(/不使用你的麦克风/)).toHaveCount(1);
  await expect(panel.getByText(/只有点击查询歌词|点击识曲/)).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('information-privacy.png'),
    animations: 'disabled',
  });
  await expect(panel.getByRole('navigation').getByRole('button')).toHaveText([
    '关于声屿',
    '隐私说明',
    '使用帮助',
  ]);
  await panel.getByRole('button', { name: '使用帮助', exact: true }).click();
  await expect(panel.getByRole('heading', { name: '键盘操作', exact: true })).toHaveCount(1);
  await expect(panel.getByText(/暂停时移动场景只选台/)).toHaveCount(1);
  await expect(panel.getByText(/歌曲收藏作为历史数据/)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '关于与帮助', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'About and help', exact: true }).click();
  const english = page.getByRole('dialog', { name: 'About and help' });
  await english.getByRole('button', { name: 'Privacy', exact: true }).click();
  await expect(english.getByText(/There are no cloud favorites or account sync/)).toBeVisible();
  await expect(english.getByText(/Only when you request lyrics|only a click asks/)).toHaveCount(0);
  await expect(english.getByRole('navigation').getByRole('button')).toHaveText([
    'About HAEN',
    'Privacy',
    'Help',
  ]);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
});
test('keeps all topics readable at narrow, tablet and landscape sizes with doubled English text and contained focus', async ({
  page,
}, info) => {
  await setup(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'About and help', exact: true }).click();
  await page.addStyleTag({
    content:
      'dialog :is(button,p,h4,label,dd,dt,a) {font-size:32px!important} dialog h2 {font-size:56px!important} dialog h3 {font-size:48px!important} dialog :is(textarea,kbd) {font-size:28px!important}',
  });
  const panel = page.getByRole('dialog', { name: 'About and help' });
  for (const size of [
    { width: 320, height: 720 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    for (const name of ['Privacy', 'Help']) {
      await panel.getByRole('button', { name, exact: true }).click();
      await expect(panel.getByRole('heading', { name, exact: true })).toHaveCount(1);
      expect(
        await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath('information-en-large.png'),
    animations: 'disabled',
  });
  await panel.getByRole('button', { name: 'Close panel', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'About and help', exact: true })).toBeFocused();
});
