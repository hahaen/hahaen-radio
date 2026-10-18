import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setLanguage } from '../locales/i18n';
import { ChinaClock } from './ChinaClock';

beforeEach(async () => {
  await setLanguage('zh');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T13:27:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('always shows China time and a localized date without station data', async () => {
  render(<ChinaClock />);
  expect(screen.getByText('21:27')).toBeInTheDocument();
  expect(screen.getByText('中国时间 · 2026年10月18日星期日')).toBeInTheDocument();
  await act(async () => setLanguage('en'));
  expect(screen.getByText('21:27')).toBeInTheDocument();
  expect(screen.getByText('China time · Sunday, 18 October 2026')).toBeInTheDocument();
});

it('updates both the time and date at midnight in China', async () => {
  vi.setSystemTime(new Date('2026-10-18T15:59:59Z'));
  render(<ChinaClock />);
  expect(screen.getByText('23:59')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText('00:00')).toBeInTheDocument();
  expect(screen.getByText('中国时间 · 2026年10月19日星期一')).toBeInTheDocument();
});

it('refreshes after resuming and cleans up its timer and listeners in strict mode', () => {
  const result = render(
    <StrictMode>
      <ChinaClock />
    </StrictMode>,
  );
  expect(vi.getTimerCount()).toBe(1);
  vi.setSystemTime(new Date('2026-10-19T00:00:00Z'));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(screen.getByText('08:00')).toBeInTheDocument();
  vi.setSystemTime(new Date('2026-10-19T01:00:00Z'));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByText('09:00')).toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(1);
  result.unmount();
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(vi.getTimerCount()).toBe(0);
});
