import { randomBytes } from 'node:crypto';
import { closeSync, lstatSync, openSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export const logPolicy = {
  retentionMs: 7 * 24 * 3600000,
  segmentMs: 3600000,
  segmentBytes: 10 * 1024 * 1024,
  totalBytes: 30 * 1024 * 1024,
  maxFiles: 200,
  sweepMs: 60000,
};
const filename = /^haen-(\d{13})-[a-f0-9]{12}\.jsonl$/;
const events = new Set([
  'request_failed',
  'diagnostic_cleanup_finished',
  'diagnostic_cleanup_failed',
  'catalog_sync_finished',
  'catalog_sync_failed',
  'scheduler_started',
  'scheduler_start_failed',
  'api_start_failed',
]);

// Project only diagnostic fields; free text, URLs, headers, SQL and exception objects never persist.
function record(input: Record<string, unknown>, service: string, revision: string, time: number) {
  const output: Record<string, unknown> = {
    time: new Date(time).toISOString(),
    service,
    revision,
    level: [10, 20, 30, 40, 50, 60].includes(Number(input.level)) ? Number(input.level) : 30,
    event: events.has(String(input.event))
      ? input.event
      : input.msg === 'incoming request'
        ? 'request_started'
        : input.msg === 'request completed'
          ? 'request_completed'
          : 'runtime_message',
  };
  if (typeof input.reqId === 'string' && /^[a-f0-9-]{36}$/.test(input.reqId))
    output.requestId = input.reqId;
  const req = input.req as { method?: unknown; route?: unknown } | undefined;
  if (
    req &&
    ['GET', 'POST', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method))
  )
    output.method = req.method;
  if (typeof req?.route === 'string' && /^\/api\/v1\/[A-Za-z0-9/_:*-]{1,160}$/.test(req.route))
    output.route = req.route;
  const res = input.res as { statusCode?: unknown } | undefined;
  if (
    Number.isInteger(res?.statusCode) &&
    Number(res?.statusCode) >= 100 &&
    Number(res?.statusCode) <= 599
  )
    output.statusCode = res?.statusCode;
  for (const key of ['responseTime', 'removed', 'count', 'invalidCount'])
    if (typeof input[key] === 'number' && Number.isFinite(input[key]) && input[key] >= 0)
      output[key] = input[key];
  if (['busy', 'published'].includes(String(input.status))) output.status = input.status;
  return JSON.stringify(output) + '\n';
}

export function createRuntimeLog(
  service: 'api' | 'jobs',
  env: NodeJS.ProcessEnv = process.env,
  options: { now?: () => number; onFailure?: () => void } = {},
) {
  const now = options.now ?? Date.now;
  const revision = /^[a-f0-9]{40}$/.test(env.HAEN_APPLICATION_REVISION ?? '')
    ? env.HAEN_APPLICATION_REVISION!
    : 'unversioned';
  const directory = env.HAEN_LOG_DIRECTORY || undefined;
  let active: { path: string; fd: number; created: number; size: number } | undefined;
  let stopped = false;
  let failed = false;
  const closeFile = () => {
    if (active) {
      const fd = active.fd;
      active = undefined;
      closeSync(fd);
    }
  };
  const checkDirectory = () => {
    if (!directory || !isAbsolute(directory) || resolve(directory) !== directory)
      throw Error('Invalid runtime log directory');
    const stat = lstatSync(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700
    )
      throw Error('Invalid runtime log directory');
  };
  const sweep = (reserve = 0) => {
    if (!directory) return;
    checkDirectory();
    const files = readdirSync(directory)
      .map((name) => {
        const match = filename.exec(name);
        if (!match) throw Error('Unexpected runtime log entry');
        const path = join(directory, name),
          stat = lstatSync(path);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          stat.uid !== process.getuid?.() ||
          (stat.mode & 0o777) !== 0o600
        )
          throw Error('Invalid runtime log entry');
        return { path, created: Number(match[1]), size: stat.size };
      })
      .sort((a, b) => a.created - b.created || a.path.localeCompare(b.path));
    let size = files.reduce((sum, file) => sum + file.size, 0),
      count = files.length;
    for (const file of files) {
      if (
        file.created > now() - logPolicy.retentionMs &&
        size + reserve <= logPolicy.totalBytes &&
        count < logPolicy.maxFiles
      )
        continue;
      if (active?.path === file.path) closeFile();
      unlinkSync(file.path);
      size -= file.size;
      count--;
    }
  };
  if (directory) sweep();
  const failure = () => {
    if (failed) return;
    failed = true;
    try {
      closeFile();
    } catch {
      /* An I/O failure must still initiate shutdown. */
    }
    process.stderr.write('{"event":"runtime_log_failed"}\n');
    (options.onFailure ?? (() => process.kill(process.pid, 'SIGTERM')))();
  };
  const write = (raw: string) => {
    if (stopped || failed) return;
    try {
      // Pino sends one JSON record per write; oversized or malformed records lose their raw contents.
      let input: Record<string, unknown> = {};
      if (Buffer.byteLength(raw) <= 16384) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            input = parsed as Record<string, unknown>;
        } catch {
          /* Keep only a fixed runtime_message event. */
        }
      }
      const line = record(input, service, revision, now());
      if (!directory) {
        process.stdout.write(line);
        return;
      }
      if (
        active &&
        (active.created + logPolicy.segmentMs <= now() ||
          active.size + Buffer.byteLength(line) > logPolicy.segmentBytes)
      )
        closeFile();
      if (!active) {
        // Reserve a complete segment once; request logging does not rescan the directory.
        sweep(logPolicy.segmentBytes);
        const created = now(),
          path = join(directory, `haen-${created}-${randomBytes(6).toString('hex')}.jsonl`);
        active = { path, created, fd: openSync(path, 'wx', 0o600), size: 0 };
      }
      const bytes = Buffer.from(line);
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(active.fd, bytes, offset);
        if (!written) throw Error('Runtime log write failed');
        offset += written;
      }
      active.size += bytes.length;
    } catch {
      failure();
    }
  };
  const timer = directory
    ? setInterval(() => {
        try {
          sweep();
        } catch {
          failure();
        }
      }, logPolicy.sweepMs).unref()
    : undefined;
  return {
    write,
    event: (event: string, fields: Record<string, unknown> = {}) =>
      write(JSON.stringify({ ...fields, event })),
    close: () => {
      stopped = true;
      clearInterval(timer);
      closeFile();
    },
  };
}
