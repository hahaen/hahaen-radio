import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { emptyCollection, type AccountLibrary } from '@haen/contracts';
import { install, first, second } from './listening-fixture.js';
const user = { id: '00000000-0000-4000-8000-000000000099', username: 'listener_alpha' };
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
  { width: 844, height: 390 },
]) {
  test(`optional unified login, auto import and guest restoration at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await install(page);
    await page.addInitScript((station) => {
      localStorage.setItem('haen:language:v1', 'zh');
      const item = {
        id: station.id,
        name: station.name,
        countryCode: station.countryCode,
        savedAt: 1,
      };
      if (!sessionStorage.getItem('account-fixture-seeded')) {
        localStorage.setItem(
          'haen:personal:v1:favorite:' + station.id,
          JSON.stringify({ version: 1, value: item }),
        );
        localStorage.setItem(
          'haen:personal:v1:history:' + station.id,
          JSON.stringify({ version: 1, value: item }),
        );
        sessionStorage.setItem('account-fixture-seeded', '1');
      }
    }, first);
    let loggedIn = false;
    let remote: AccountLibrary = { revision: 0, collection: emptyCollection() };
    await page.route('**/api/v1/account/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
      if (path.endsWith('/login')) {
        if (String(body.username).toLowerCase().startsWith('admin'))
          return route.fulfill({
            status: 403,
            json: { code: 'ACCOUNT_RESERVED', message: 'Reserved', requestId: 'fixture' },
          });
        loggedIn = true;
        return route.fulfill({ json: { user } });
      }
      if (path.endsWith('/logout')) {
        loggedIn = false;
        return route.fulfill({ json: { user: null } });
      }
      if (path.endsWith('/session'))
        return route.fulfill({ json: { user: loggedIn ? user : null } });
      if (!loggedIn)
        return route.fulfill({
          status: 401,
          json: { code: 'UNAUTHORIZED', message: 'Sign in', requestId: 'fixture' },
        });
      if (body) remote = { revision: body.revision + 1, collection: body.collection };
      return route.fulfill({ json: remote });
    });
    await page.clock.install();
    await page.goto('/');
    await page.getByRole('button', { name: '我的收听', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '我的收听' });
    await expect(panel.getByRole('button', { name: '电台收藏（1）', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '登录，跨设备同步收听' }).click();
    await panel.getByLabel('账号', { exact: true }).fill('ADMIN');
    await panel.getByLabel('密码', { exact: true }).fill(randomBytes(3).toString('hex'));
    await panel.getByRole('button', { name: '登录 / 自动注册', exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveText('此账号名称为系统保留名称，请换一个。');
    await panel.getByLabel('账号', { exact: true }).fill(user.username);
    await panel.getByLabel('密码', { exact: true }).fill(randomBytes(3).toString('hex'));
    await panel.getByRole('button', { name: '显示密码' }).click();
    await expect(panel.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
    await panel.getByRole('button', { name: '隐藏密码' }).click();
    await panel
      .getByRole('button', { name: '登录 / 自动注册', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('account-form.png') });
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await panel.getByRole('button', { name: '登录 / 自动注册', exact: true }).click();
    await expect(panel.getByText('已与账号同步', { exact: true })).toBeVisible();
    expect(remote.collection.favorites[0]?.id).toBe(first.id);
    expect(remote.collection.history[0]?.id).toBe(first.id);
    remote = {
      revision: remote.revision + 1,
      collection: {
        ...remote.collection,
        favorites: [
          ...remote.collection.favorites,
          {
            id: second.id,
            name: second.name,
            countryCode: second.countryCode,
            savedAt: 2,
          },
        ],
      },
    };
    await page.clock.fastForward(30000);
    await expect(panel.getByRole('button', { name: '电台收藏（2）', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '取消收藏 ' + second.name, exact: true }).click();
    await expect.poll(() => remote.collection.favorites.map((item) => item.id)).toEqual([first.id]);
    await page.reload();
    await page.getByRole('button', { name: '我的收听', exact: true }).click();
    await expect(panel.getByText(user.username, { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(panel.getByRole('button', { name: '登录，跨设备同步收听' })).toBeVisible();
    await expect(panel.getByRole('button', { name: '电台收藏（1）', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
