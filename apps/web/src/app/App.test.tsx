import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setLanguage } from '../locales/i18n';
import { testStation } from '../testing/stations';
import { App } from './App';

vi.mock('../graphics/GlobePanel', () => ({ GlobePanel: () => null }));
function withoutScene(fetcher: (input: string | URL | Request) => Promise<Response>) {
  return (input: string | URL | Request) =>
    String(input).includes('/catalog/scene')
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              code: 'SERVICE_UNAVAILABLE',
              message: 'Fixture intentionally uses list fallback',
              requestId: 'fixture',
            }),
            { status: 503 },
          ),
        )
      : fetcher(input);
}

beforeEach(async () => {
  localStorage.clear();
  await setLanguage('zh');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const response = () =>
  new Response(JSON.stringify({ items: [testStation(1)], total: 1, offset: 0, limit: 30 }));
function mount(strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const app = (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </MemoryRouter>
  );
  render(strict ? <StrictMode>{app}</StrictMode> : app);
}
describe('radio application entry', () => {
  it('survives strict lifecycle replay, loads stations without autoplay and preserves language', async () => {
    vi.stubGlobal('fetch', withoutScene(vi.fn(async () => response())));
    mount(true);
    await screen.findByRole('button', { name: '收听 Test radio 1' });
    expect(screen.getByRole('status')).toHaveTextContent('尚未播放');
    expect(document.querySelectorAll('audio')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'A wider world. A closer listen.',
    );
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('HAEN · Listen to the world.');
    expect(localStorage.getItem('haen:language:v1')).toBe('en');
    expect(screen.getByRole('link', { name: 'GeoNames' })).toHaveAttribute(
      'href',
      'https://www.geonames.org/',
    );
    expect(screen.getByRole('searchbox', { name: 'Search stations' })).toHaveAttribute(
      'placeholder',
      'Station, country or region',
    );
  });
  it('offers an accessible retry and recovers from a failed directory request', async () => {
    vi.stubGlobal(
      'fetch',
      withoutScene(
        vi
          .fn()
          .mockRejectedValueOnce(new TypeError('Network unavailable'))
          .mockRejectedValueOnce(new TypeError('Network unavailable'))
          .mockImplementation(async () => response()),
      ),
    );
    mount();
    const retry = await within(screen.getByRole('region', { name: '探索电台' })).findByRole(
      'button',
      { name: '重试' },
      { timeout: 3000 },
    );
    await userEvent.click(retry);
    await screen.findByRole('button', { name: '收听 Test radio 1' });
  });
  it('selects a station, displays actual media events and pauses through the player', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/stations?')
        ? response()
        : new Response(JSON.stringify(testStation(1))),
    );
    vi.stubGlobal('fetch', withoutScene(fetcher));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: '收听 Test radio 1' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('正在收听'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Test radio 1');
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(screen.getByRole('status')).toHaveTextContent('已暂停');
    await userEvent.click(screen.getByRole('button', { name: '静音' }));
    expect(screen.getByRole('button', { name: '取消静音' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: '固定当前电台' }));
    expect(screen.getByRole('button', { name: '取消固定' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
