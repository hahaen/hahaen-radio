import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setLanguage } from '../locales/i18n';
import { ChinaClock } from './ChinaClock';
import { createLunarFormatter } from './lunar-date';

beforeEach(async () => {
  await setLanguage('zh');
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-10-18T13:27:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('always shows China time and a localized date without station data', async () => {
  render(<ChinaClock />);
  expect(screen.getByText('21:27:00')).toBeInTheDocument();
  expect(screen.getByText('中国时间 · 2026年10月18日星期日')).toBeInTheDocument();
  expect(screen.getByText('农历九月初九')).toBeInTheDocument();
  await act(async () => setLanguage('en'));
  expect(screen.getByText('21:27:00')).toBeInTheDocument();
  expect(screen.getByText('China time · Sunday, 18 October 2026')).toBeInTheDocument();
  expect(screen.getByText('Lunar: month 9, day 9')).toBeInTheDocument();
});

it('ticks on second boundaries and rolls over minutes without shifting the date', async () => {
  vi.setSystemTime(new Date('2026-10-18T13:27:58.750Z'));
  render(<ChinaClock />);
  expect(screen.getByText('21:27:58')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(249));
  expect(screen.getByText('21:27:58')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByText('21:27:59')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText('21:28:00')).toBeInTheDocument();
  expect(screen.getByText('中国时间 · 2026年10月18日星期日')).toBeInTheDocument();
});

it('updates both the time and date at midnight in China', async () => {
  vi.setSystemTime(new Date('2026-10-18T15:59:59Z'));
  render(<ChinaClock />);
  expect(screen.getByText('23:59:59')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText('00:00:00')).toBeInTheDocument();
  expect(screen.getByText('中国时间 · 2026年10月19日星期一')).toBeInTheDocument();
  expect(screen.getByText('农历九月初十')).toBeInTheDocument();
});

it.each([
  ['2026-02-17T00:00:00Z', '农历正月初一', 'Lunar: month 1, day 1'],
  ['2025-07-25T00:00:00Z', '农历闰六月初一', 'Lunar: leap month 6, day 1'],
  ['2026-11-08T00:00:00Z', '农历九月三十', 'Lunar: month 9, day 30'],
  ['2026-02-16T00:00:00Z', '农历腊月廿九', 'Lunar: month 12, day 29'],
])('shows the lunar date at %s in both languages', async (instant, chinese, english) => {
  vi.setSystemTime(new Date(instant));
  render(<ChinaClock />);
  expect(screen.getByText(chinese)).toBeInTheDocument();
  await act(async () => setLanguage('en'));
  expect(screen.getByText(english)).toBeInTheDocument();
});

it('keeps the China clock when the runtime does not support the Chinese calendar', () => {
  const resolved = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    ...resolved,
    calendar: 'gregory',
  });
  expect(createLunarFormatter()).toBeNull();
  render(<ChinaClock />);
  expect(screen.getByText('21:27:00')).toBeInTheDocument();
  expect(screen.getByText('中国时间 · 2026年10月18日星期日')).toBeInTheDocument();
  expect(screen.queryByText(/^农历/)).toBeNull();
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
  expect(screen.getByText('08:00:00')).toBeInTheDocument();
  vi.setSystemTime(new Date('2026-10-19T01:00:00Z'));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByText('09:00:00')).toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(1);
  result.unmount();
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(vi.getTimerCount()).toBe(0);
});
