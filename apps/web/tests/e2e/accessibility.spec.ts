import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { first, install, openDirectory, listenButton, selectStation } from './listening-fixture.js';

test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
});

async function attachJson(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name);
  await writeFile(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}
async function paintContext(page: Page, selector: string) {
  const root = (await page.locator('dialog[open]').count())
    ? page.locator('dialog[open]')
    : page.locator('body');
  return root.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const paint = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        paint.push({
          tag: node.tagName,
          background: style.backgroundColor,
          image: style.backgroundImage,
          opacity: style.opacity,
          filter: style.filter,
          backdrop: style.backdropFilter,
        });
      }
      return { color: getComputedStyle(element).color, paint };
    }),
  );
}

const labels = {
  zh: {
    settings: '收听设置',
    library: '我的收听',
    information: '关于与帮助',
    track: '曲目与歌词',
    filters: '筛选电台',
    favorite: '收藏 ',
    play: '收听 ',
    topics: ['隐私说明', '使用帮助'],
  },
  en: {
    settings: 'Listening settings',
    library: 'My listening',
    information: 'About and help',
    track: 'Track and lyrics',
    filters: 'Filter stations',
    favorite: 'Favorite ',
    play: 'Listen to ',
    topics: ['Privacy', 'Help'],
  },
};
async function enter(page: Page, language: 'zh' | 'en', scene = true) {
  await install(page, scene);
  await page.route('**/api/v1/stations/*/now-playing?*', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: {
        stationId: first.id,
        streamId: url.searchParams.get('streamId'),
        source: 'station-icy',
        status: 'available',
        rawTitle: 'Fixture Artist - Fixture Song',
        song: { artist: 'Fixture Artist', title: 'Fixture Song' },
        observedAt: new Date().toISOString(),
        timing: 'unknown',
        retryAfter: 60,
      },
    });
  });
  await page.route('**/api/v1/lyrics?*', (route) =>
    route.fulfill({
      json: {
        source: 'lrclib',
        status: 'found',
        items: [
          {
            id: 1,
            artist: 'Fixture Artist',
            title: 'Fixture Song',
            album: '',
            duration: 180,
            instrumental: false,
            plain: 'Fixture lyric line',
            lines: [{ at: 0, text: 'Fixture lyric line' }],
          },
          {
            id: 2,
            artist: 'Fixture Artist',
            title: 'Fixture Song',
            album: 'Alternative fixture',
            duration: 180,
            instrumental: false,
            plain: 'Alternative fixture lyric',
            lines: [{ at: 0, text: 'Alternative fixture lyric' }],
          },
        ],
        retryAfter: null,
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: language === 'zh' ? '中文' : 'EN', exact: true }).click();
  await openDirectory(page);
  await expect(page.getByTestId('directory-state')).toContainText('3');
  await page.keyboard.press('Escape');
}
for (const language of ['zh', 'en'] as const) {
  test(`audits named controls, contrast and semantics across listening panels in ${language}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(120000);
    await enter(page, language);
    const text = labels[language],
      reports: unknown[] = [],
      failures: unknown[] = [];
    const scan = async (state: string) => {
      await page.evaluate(() => document.fonts.ready);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      const issues = result.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        targets: item.nodes.map((node) => node.target),
      }));
      const incomplete = [];
      for (const item of result.incomplete) {
        const contexts = [];
        if (item.id === 'color-contrast')
          for (const node of item.nodes) {
            if (node.target.length === 1 && typeof node.target[0] === 'string')
              contexts.push({
                selector: node.target[0],
                styles: await paintContext(page, node.target[0]),
              });
          }
        incomplete.push({ id: item.id, targets: item.nodes.map((node) => node.target), contexts });
      }
      reports.push({
        state,
        engine: result.testEngine,
        violations: issues,
        incomplete,
      });
      if (state === 'settings')
        await page.screenshot({ path: info.outputPath(`settings-${language}.png`) });
      if (issues.length) failures.push({ state, issues });
    };
    await scan('globe');
    await openDirectory(page);
    await page.locator('#station-directory').getByText(text.filters, { exact: true }).click();
    await scan('filters');
    const search = page.getByRole('searchbox', {
      name: language === 'zh' ? '搜索电台' : 'Search stations',
      exact: true,
    });
    await search.fill('no-fixture-radio-match');
    await search.press('Enter');
    await expect(page.getByTestId('directory-state')).toContainText('0');
    await scan('no-results');
    await search.fill('');
    await search.press('Enter');
    await expect(page.getByTestId('directory-state')).toContainText('3');
    await selectStation(page, first.name, language);
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'playing');
    await page
      .getByRole('button', { name: text.favorite + first.name, exact: true })
      .first()
      .click();
    await scan('playing');
    for (const kind of ['settings', 'library', 'information'] as const) {
      await page.getByRole('button', { name: text[kind], exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await scan(kind);
      if (kind === 'library') {
        for (const index of [1, 2]) {
          await dialog.getByRole('group').first().getByRole('button').nth(index).click();
          await scan('library-' + index);
        }
      }
      if (kind === 'information') {
        for (const topic of text.topics) {
          await dialog.getByRole('button', { name: topic, exact: true }).click();
          await scan('information-' + topic);
        }
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
    await page.getByRole('button', { name: text.library, exact: true }).click();
    const saved = page.getByRole('dialog');
    await saved.getByRole('group').first().getByRole('button').nth(2).click();
    await expect(saved.getByRole('group').first().getByRole('button').nth(2)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await scan('saved-song-list');
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', {
        name: language === 'zh' ? '沉浸收听' : 'Immersive listening',
        exact: true,
      })
      .click();
    await scan('immersive');
    await attachJson(info, 'accessibility-scans.json', {
      language,
      viewport: page.viewportSize(),
      browser: browser.browserType().name(),
      version: browser.version(),
      reports,
    });
    expect(failures).toEqual([]);
  });
}

test('audits the list fallback when the scene service is unavailable', async ({ page }, info) => {
  await enter(page, 'en', false);
  await openDirectory(page);
  await expect(listenButton(page, first.name, 'en')).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  await attachJson(info, 'fallback-accessibility.json', {
    violations: result.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
    incomplete: result.incomplete.map((item) => item.id),
  });
  expect(result.violations.map((item) => item.id)).toEqual([]);
});

async function assertVisibleFocus(page: Page) {
  const state = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const rect = element.getBoundingClientRect(),
      style = getComputedStyle(element);
    return {
      dialog: !!element.closest('dialog'),
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth,
      outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
    };
  });
  expect(state).toEqual({ dialog: true, visible: true, outline: true });
}
test('keeps nonmodal panel focus visible and restores the actual opener', async ({ page }) => {
  await enter(page, 'en');
  for (const name of [labels.en.settings, labels.en.library, labels.en.information]) {
    const opener = page.getByRole('button', { name, exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Tab');
    for (let i = 0; i < 3; i++) {
      await assertVisibleFocus(page);
      await page.keyboard.press('Tab');
    }
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('Shift+Tab');
      await assertVisibleFocus(page);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});

test('keeps modal targets usable on narrow, landscape and enlarged-text layouts', async ({
  page,
}, info: TestInfo) => {
  await enter(page, 'en');
  for (const size of [
    { width: 320, height: 720 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.getByRole('button', { name: labels.en.settings, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    if (size.width === 390) {
      await dialog.evaluate((element) => {
        const values = [
          ...element.querySelectorAll<HTMLElement>(
            'h2,h3,p,button,label,input,select,legend,dt,dd,kbd,span,small',
          ),
        ].map((node) => ({ node, size: parseFloat(getComputedStyle(node).fontSize) }));
        for (const value of values) value.node.style.fontSize = value.size * 2 + 'px';
      });
    }
    const undersized = await dialog.evaluate((element) =>
      [...element.querySelectorAll<HTMLElement>('button,input,select,a')]
        .filter((node) => !node.matches(':disabled,[type=hidden]') && node.getClientRects().length)
        .map((node) => {
          const target = node.matches('[type=checkbox]') ? node.closest('label')! : node;
          const rect = target.getBoundingClientRect();
          return {
            label: node.getAttribute('aria-label') ?? target.textContent?.trim().slice(0, 60),
            width: rect.width,
            height: rect.height,
          };
        })
        .filter((target) => target.width < 43.5 || target.height < 43.5),
    );
    expect(undersized).toEqual([]);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`settings-top-${size.width}.png`) });
    await page.keyboard.press('Tab');
    for (let i = 0; i < 3; i++) {
      await assertVisibleFocus(page);
      await page.keyboard.press('Tab');
    }
    await page.screenshot({ path: info.outputPath(`settings-focus-${size.width}.png`) });
    await page.keyboard.press('Escape');
  }
});
