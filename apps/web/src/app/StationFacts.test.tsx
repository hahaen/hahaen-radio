import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/react';
import { setLanguage } from '../locales/i18n';
import { testStation } from '../testing/stations';
import { StationFacts } from './StationFacts';
beforeEach(async () => {
  await setLanguage('zh');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('shows a local clock only from supported timezone evidence and clears its interval', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  const detail = { ...testStation(1), timezone: 'Asia/Tokyo', timezoneSource: 'geonames' as const };
  const result = render(<StationFacts station={detail} detail={detail} />);
  expect(screen.getByText('09:00')).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(screen.getByText('09:01')).toBeInTheDocument();
  result.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it('omits unknown and invalid timezones rather than guessing a station time', () => {
  const station = testStation(1);
  const result = render(<StationFacts station={station} detail={station} />);
  expect(screen.queryByText('当地时间')).toBeNull();
  result.rerender(
    <StationFacts
      station={station}
      detail={{ ...station, timezone: 'Invalid/Zone', timezoneSource: 'geonames' }}
    />,
  );
  expect(screen.queryByText('当地时间')).toBeNull();
  expect(screen.getByText('英语')).toBeInTheDocument();
});
it('labels a country map position without presenting its anchor as station coordinates', async () => {
  const station = testStation(1);
  const result = render(<StationFacts station={station} detail={station} />);
  expect(screen.getByText('国家级位置')).toBeInTheDocument();
  expect(screen.queryByText('坐标')).toBeNull();
  expect(screen.queryByText('当地时间')).toBeNull();
  await act(async () => {
    await setLanguage('en');
  });
  expect(screen.getByText('Country-level location')).toBeInTheDocument();
  result.rerender(
    <StationFacts
      station={{ ...station, locationPrecision: 'coordinates', latitude: 47.5, longitude: 7.6 }}
      detail={station}
    />,
  );
  expect(screen.getByText('Coordinates')).toBeInTheDocument();
  expect(screen.queryByText('Country-level location')).toBeNull();
});
