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
test('explains local data and external requests in both languages, exposes real attribution and preserves playback and focus', async ({
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
  await page.screenshot({
    path: info.outputPath('information-privacy.png'),
    animations: 'disabled',
  });
  await panel.getByRole('button', { name: '资源署名', exact: true }).click();
  await expect(panel.getByRole('link', { name: 'CC BY 4.0', exact: true })).toHaveAttribute(
    'href',
    'https://creativecommons.org/licenses/by/4.0/',
  );
  for (const path of [
    '/fonts/noto-serif-sc-ui-LICENSE.txt',
    '/fonts/noto-sans-sc-ui-LICENSE.txt',
    '/fonts/ibm-plex-mono-ui-LICENSE.txt',
    '/licenses/lucide.txt',
  ]) {
    const link = panel.locator(`a[href="${path}"]`);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const response = await page.request.get(path);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toMatch(/Permission|PERMISSION/);
  }
  await panel.getByRole('button', { name: '使用帮助', exact: true }).click();
  await expect(panel.getByRole('heading', { name: '键盘操作', exact: true })).toHaveCount(1);
  await expect(panel.getByText(/暂停时移动场景只选台/)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '关于与帮助', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'About and help', exact: true }).click();
  const english = page.getByRole('dialog', { name: 'About and help' });
  await english.getByRole('button', { name: 'Privacy', exact: true }).click();
  await expect(english.getByText(/There are no cloud favorites or account sync/)).toBeVisible();
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    false,
  );
});
test('previews an explicit local feedback copy without requests, URLs or personal library content and offers manual copy on denial', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const notes: string[] = [];
    Reflect.set(window, '__haenNotes', notes);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          notes.push(text);
        },
      },
    });
  });
  const panel = await setup(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await panel.getByRole('button', { name: '问题反馈', exact: true }).click();
  const preview = panel.getByRole('textbox', { name: '问题说明（仅在本机生成）' });
  const text = await preview.inputValue();
  expect(text).toContain(first.id);
  expect(text).toContain('"playback": "playing"');
  expect(text).not.toContain('https:');
  expect(text).not.toContain('127.0.0.1');
  expect(text).not.toContain(first.name);
  expect(await page.evaluate(() => Reflect.get(window, '__haenNotes'))).toEqual([]);
  await panel.getByRole('button', { name: '复制问题说明', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('已复制。请补充问题描述后自行转交。');
  expect(await page.evaluate(() => Reflect.get(window, '__haenNotes'))).toEqual([text]);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    }),
  );
  await panel.getByRole('button', { name: '复制问题说明', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('无法自动复制，请选择下方文本手动复制。');
  await preview.focus();
  expect(
    await preview.evaluate(
      (element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart,
    ),
  ).toBe(text.length);
  expect(
    requests.filter(
      (url) =>
        new URL(url).origin === new URL(page.url()).origin &&
        new URL(url).pathname.startsWith('/api/'),
    ),
  ).toEqual([]);
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
    for (const name of ['Privacy', 'Credits', 'Help', 'Feedback']) {
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
