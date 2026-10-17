import { expect, it } from 'vitest';
import { supportNote, reportableFailure } from './support-note';

it('creates an allowlisted local snapshot without copying a page URL, stream URL or unrelated personal content', () => {
  const context = {
    stationId: '00000000-0000-4000-8000-000000000001',
    streamId: 'a'.repeat(24),
    status: 'failed' as const,
    failure: 'network' as const,
    url: 'https://private-user:private-token@radio.example/live',
    favorites: ['private favorite'],
  };
  const note = supportNote(context, 'en', new Date('2026-10-17T01:00:00Z'));
  expect(JSON.parse(note)).toMatchObject({
    observedAt: '2026-10-17T01:00:00.000Z',
    stationId: context.stationId,
    streamId: context.streamId,
    playback: 'failed',
    failure: 'network',
  });
  expect(note).not.toContain('private');
  expect(note).not.toContain('https:');
});
it('does not mistake unvalidated URLs for station or stream identifiers', () => {
  const note = JSON.parse(
    supportNote(
      {
        stationId: 'https://user:token@example.test/',
        streamId: 'https://example.test/stream',
        status: 'idle',
        failure: null,
      },
      'zh',
    ),
  );
  expect(note.stationId).toBeNull();
  expect(note.streamId).toBeNull();
  expect(note.interfaceLanguage).toBe('zh');
});
it('offers a report only for an actual failed state with validated identifiers and a fixed failure type', () => {
  const context = {
    stationId: '00000000-0000-4000-8000-000000000001',
    streamId: 'a'.repeat(24),
    status: 'failed' as const,
    failure: 'timeout' as const,
  };
  expect(reportableFailure({ ...context, status: 'playing' })).toBeNull();
  expect(reportableFailure({ ...context, streamId: null })).toBeNull();
  expect(reportableFailure({ ...context, failure: null })).toBeNull();
  expect(reportableFailure({ ...context, stationId: 'https://private.example/' })).toBeNull();
  expect(reportableFailure(context)).toEqual({
    stationId: context.stationId,
    streamId: context.streamId,
    failure: 'timeout',
  });
});
