import { expect, it, vi } from 'vitest';
import { diagnosticAllowance, DiagnosticStoreError } from './repository.js';
import { createDiagnosticService } from './service.js';
import { normalizeStation } from '../catalog/normalize.js';
import type { PlaybackReportResult } from '@haen/contracts';
const station = normalizeStation({
  stationuuid: '00000000-0000-4000-8000-000000000001',
  name: 'Unit',
  url: 'https://radio.example/live',
  lastcheckok: 1,
})!;
const input = {
  reportId: '00000000-0000-4000-8000-000000000011',
  streamId: station.streams[0]!.id,
  failure: 'network' as const,
};
const receipt: PlaybackReportResult = {
  status: 'accepted',
  reportId: input.reportId,
  stationId: station.id,
  streamId: input.streamId,
  expiresAt: '2026-10-24T00:00:00Z',
};
it('uses UTC allowance boundaries and fails closed when time moves behind the stored period', () => {
  const state = { periodDay: '2026-10-17', acceptedCount: 1000, nextSlot: 0 };
  expect(diagnosticAllowance(state, new Date('2026-10-17T23:59:59.500Z'))).toMatchObject({
    used: 1000,
    retryAfter: 1,
  });
  expect(diagnosticAllowance(state, new Date('2026-10-18T00:00:00Z'))).toMatchObject({
    used: 0,
    retryAfter: 86400,
  });
  expect(() => diagnosticAllowance(state, new Date('2026-10-16T23:59:59Z'))).toThrow(
    DiagnosticStoreError,
  );
});
it('does not access a catalogue or writer when storage is unconfigured or the service has closed', async () => {
  const catalog = { station: vi.fn(async () => station) };
  const service = createDiagnosticService(catalog);
  expect((await service.report(station.id, input)).status).toBe('unavailable');
  expect(catalog.station).not.toHaveBeenCalled();
  const record = vi.fn(async () => receipt),
    enabled = createDiagnosticService(catalog, { record });
  enabled.close();
  expect((await enabled.report(station.id, input)).status).toBe('unavailable');
  expect(record).not.toHaveBeenCalled();
});
it('reuses a receipt, limits new same-source reports and serializes writers without changing a station', async () => {
  let time = 0,
    finish!: (value: PlaybackReportResult) => void;
  const record = vi.fn(
    () =>
      new Promise<PlaybackReportResult>((resolve) => {
        finish = resolve;
      }),
  );
  const service = createDiagnosticService({ station: async () => station }, { record }, () => time);
  const pending = service.report(station.id, input);
  await vi.waitFor(() => expect(record).toHaveBeenCalledOnce());
  expect(
    (
      await service.report(station.id, {
        ...input,
        reportId: '00000000-0000-4000-8000-000000000012',
      })
    ).status,
  ).toBe('limited');
  finish(receipt);
  expect(await pending).toEqual(receipt);
  expect(await service.report(station.id, input)).toEqual(receipt);
  expect(
    (
      await service.report(station.id, {
        ...input,
        reportId: '00000000-0000-4000-8000-000000000012',
      })
    ).status,
  ).toBe('limited');
  expect(record).toHaveBeenCalledOnce();
  expect(station.availability).toBe('available');
  time = 61000;
  const another = service.report(station.id, {
    ...input,
    reportId: '00000000-0000-4000-8000-000000000012',
  });
  await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2));
  finish(receipt);
  await another;
  service.close();
});
it('bounds failed-store attempts before catalogue reads and releases its in-flight slot after failure', async () => {
  const stationRead = vi.fn(async () => station),
    record = vi.fn(async () => {
      throw new Error('private database error');
    });
  const service = createDiagnosticService({ station: stationRead }, { record }, () => 0);
  for (let n = 0; n < 20; n++)
    expect((await service.report(station.id, input)).status).toBe('unavailable');
  expect((await service.report(station.id, input)).status).toBe('limited');
  expect(stationRead).toHaveBeenCalledTimes(20);
  expect(record).toHaveBeenCalledTimes(20);
  service.close();
});
