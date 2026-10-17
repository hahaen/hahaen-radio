import { afterEach, expect, it, vi } from 'vitest';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeLog, logPolicy } from './runtime-log.js';
import { buildApp } from '../app.js';
import { readEnvironment } from '../config/environment.js';

const roots: string[] = [],
  logs: ReturnType<typeof createRuntimeLog>[] = [];
const time = Date.UTC(2026, 9, 17);
afterEach(() => {
  for (const log of logs.splice(0)) log.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function fixture(now = () => time, onFailure = vi.fn()) {
  const directory = mkdtempSync(join(tmpdir(), 'haen-runtime-log-'));
  roots.push(directory);
  chmodSync(directory, 0o700);
  const log = createRuntimeLog(
    'api',
    { HAEN_LOG_DIRECTORY: directory, HAEN_APPLICATION_REVISION: 'a'.repeat(40) },
    { now, onFailure },
  );
  logs.push(log);
  return { directory, log, onFailure };
}
function contents(directory: string) {
  return readdirSync(directory)
    .map((file) => readFileSync(join(directory, file), 'utf8'))
    .join('');
}
function oldFile(directory: string, created: number, id = 'b', size = 0) {
  const path = join(directory, `haen-${created}-${id.repeat(12)}.jsonl`);
  writeFileSync(path, '', { mode: 0o600 });
  if (size) truncateSync(path, size);
  return path;
}
it('cleans expired segments during quiet running periods and again on restart', () => {
  vi.useFakeTimers();
  let now = time;
  const f = fixture(() => now);
  f.log.event('scheduler_started');
  expect(readdirSync(f.directory)).toHaveLength(1);
  now += logPolicy.retentionMs;
  vi.advanceTimersByTime(logPolicy.sweepMs);
  expect(readdirSync(f.directory)).toHaveLength(0);
  f.log.event('scheduler_started');
  f.log.close();
  now += logPolicy.retentionMs;
  const restarted = createRuntimeLog(
    'api',
    { HAEN_LOG_DIRECTORY: f.directory },
    { now: () => now },
  );
  logs.push(restarted);
  expect(readdirSync(f.directory)).toHaveLength(0);
});
it('rotates hourly, preserves private permissions and deletes oldest data before the capacity ceiling', () => {
  let now = time;
  const f = fixture(() => now);
  f.log.event('scheduler_started');
  now += logPolicy.segmentMs;
  f.log.event('scheduler_started');
  expect(readdirSync(f.directory)).toHaveLength(2);
  const oldest = oldFile(f.directory, time - 1000, 'b', logPolicy.segmentBytes);
  oldFile(f.directory, time - 500, 'c', logPolicy.segmentBytes);
  now += logPolicy.segmentMs;
  f.log.event('scheduler_started');
  expect(readdirSync(f.directory)).not.toContain(oldest.split('/').at(-1));
  const sizes = readdirSync(f.directory).map((file) => lstatSync(join(f.directory, file)));
  expect(sizes.reduce((sum, stat) => sum + stat.size, 0)).toBeLessThanOrEqual(logPolicy.totalBytes);
  expect(sizes.every((stat) => (stat.mode & 0o777) === 0o600)).toBe(true);
});
it('bounds segment count across rapid restarts without deleting unrelated entries', () => {
  const f = fixture();
  for (let i = 0; i < logPolicy.maxFiles; i++) {
    const name = `haen-${time - 1000 + i}-${i.toString(16).padStart(12, '0')}.jsonl`;
    writeFileSync(join(f.directory, name), '', { mode: 0o600 });
  }
  f.log.event('scheduler_started');
  expect(readdirSync(f.directory)).toHaveLength(logPolicy.maxFiles);
  f.log.close();
  writeFileSync(join(f.directory, 'keep.txt'), 'keep', { mode: 0o600 });
  expect(() => createRuntimeLog('api', { HAEN_LOG_DIRECTORY: f.directory })).toThrow(
    'Unexpected runtime log entry',
  );
  expect(readFileSync(join(f.directory, 'keep.txt'), 'utf8')).toBe('keep');
});
it('rotates a real full segment without requiring a clock tick', () => {
  const f = fixture();
  const raw = JSON.stringify({
    msg: 'incoming request',
    reqId: 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12),
    req: { method: 'GET', route: '/api/v1/' + 'x'.repeat(150) },
  });
  for (let i = 0; i < 40000; i++) f.log.write(raw);
  const files = readdirSync(f.directory);
  expect(files.length).toBeGreaterThan(1);
  expect(
    files.every((file) => lstatSync(join(f.directory, file)).size <= logPolicy.segmentBytes),
  ).toBe(true);
  expect(f.onFailure).not.toHaveBeenCalled();
}, 10000);
it('does not follow symlinks or accept public directories and files', () => {
  const f = fixture();
  f.log.close();
  chmodSync(f.directory, 0o755);
  expect(() => createRuntimeLog('api', { HAEN_LOG_DIRECTORY: f.directory })).toThrow('directory');
  chmodSync(f.directory, 0o700);
  const file = oldFile(f.directory, time);
  chmodSync(file, 0o644);
  expect(() => createRuntimeLog('api', { HAEN_LOG_DIRECTORY: f.directory })).toThrow('entry');
  rmSync(file);
  const outside = join(mkdtempSync(join(tmpdir(), 'haen-log-outside-')), 'untouched');
  roots.push(outside.slice(0, outside.lastIndexOf('/')));
  writeFileSync(outside, 'untouched', { mode: 0o600 });
  symlinkSync(outside, file);
  expect(() => createRuntimeLog('api', { HAEN_LOG_DIRECTORY: f.directory })).toThrow('entry');
  expect(readFileSync(outside, 'utf8')).toBe('untouched');
});
it('persists actual Fastify request correlation and safe routes without private request or error fields', async () => {
  const f = fixture();
  const app = buildApp(readEnvironment({ NODE_ENV: 'test' }), true, undefined, undefined, f.log);
  app.get('/api/v1/failure/:id', async () => {
    throw Error('private-error-fixture');
  });
  try {
    const response = await app.inject({
      url: '/api/v1/failure/private-path?token=private-query',
      headers: {
        authorization: 'private-auth',
        cookie: 'private-cookie',
        'x-request-id': 'private-client-id',
      },
    });
    expect(response.statusCode).toBe(500);
    const lines = contents(f.directory)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(
      lines.some(
        (line) =>
          line.event === 'request_failed' && line.requestId === response.headers['x-request-id'],
      ),
    ).toBe(true);
    expect(
      lines.some((line) => line.event === 'request_completed' && line.statusCode === 500),
    ).toBe(true);
    expect(lines.every((line) => line.service === 'api' && line.revision === 'a'.repeat(40))).toBe(
      true,
    );
    expect(contents(f.directory)).not.toContain('private-');
  } finally {
    await app.close();
  }
});
it('drops arbitrary plaintext, oversized records, visitor identifiers and nested secrets while retaining job counts', () => {
  const f = fixture();
  f.log.write('private-raw-value');
  f.log.write(
    JSON.stringify({
      msg: 'private-msg',
      token: 'private-token',
      req: { remoteAddress: 'private-ip' },
      err: { stack: 'private-stack' },
    }),
  );
  f.log.write(JSON.stringify({ msg: 'private-' + 'x'.repeat(16384) }));
  f.log.event('catalog_sync_finished', {
    status: 'published',
    count: 30000,
    invalidCount: 1,
    version: 'private-version',
    token: 'private-token',
  });
  expect(contents(f.directory)).not.toContain('private-');
  expect(JSON.parse(contents(f.directory).trim().split('\n').at(-1)!)).toMatchObject({
    event: 'catalog_sync_finished',
    count: 30000,
    invalidCount: 1,
    status: 'published',
  });
});
it('initiates shutdown once on storage failure and never falls back to raw output', () => {
  vi.useFakeTimers();
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const f = fixture();
  f.log.event('scheduler_started');
  writeFileSync(join(f.directory, 'unexpected'), 'private-fixture');
  vi.advanceTimersByTime(logPolicy.sweepMs);
  vi.advanceTimersByTime(logPolicy.sweepMs);
  f.log.event('catalog_sync_finished', { count: 1 });
  expect(f.onFailure).toHaveBeenCalledTimes(1);
  expect(stderr).toHaveBeenCalledWith('{"event":"runtime_log_failed"}\n');
  expect(readdirSync(f.directory)).toContain('unexpected');
});
