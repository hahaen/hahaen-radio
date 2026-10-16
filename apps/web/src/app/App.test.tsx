import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setLanguage } from '../locales/i18n';
import { App } from './App';

beforeEach(async () => {
  await setLanguage('zh');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const app = (
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{app}</StrictMode> : app);
}

describe('application entry', () => {
  it('survives strict lifecycle replay and persists the user language', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'ok', service: 'haen-api' }))),
    );
    mount(true);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('连接已就绪');
    });
    await userEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'A wider world. A closer listen.',
    );
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('HAEN · Listen to the world.');
    expect(localStorage.getItem('haen:language:v1')).toBe('en');
  });

  it('offers an accessible retry and recovers from a failed connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Network unavailable'))
        .mockRejectedValueOnce(new TypeError('Network unavailable'))
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', service: 'haen-api' }))),
    );
    mount();
    const retry = await screen.findByRole('button', { name: '重试' }, { timeout: 3000 });
    await userEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('连接已就绪');
    });
  });
});
