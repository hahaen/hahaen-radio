import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { RecognitionConfig } from '../../config/recognition.js';
const StateSchema = z.strictObject({
  version: z.literal(1),
  budgetId: z.string(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  limit: z.number().int().positive(),
  used: z.number().int().nonnegative(),
});
export class RecognitionQuotaError extends Error {
  constructor() {
    super(
      'Recognition quota unavailable: check initialization, permissions and exclusive ownership',
    );
  }
}
export async function openRecognitionQuota(config: RecognitionConfig, initialize = false) {
  const parent = dirname(config.statePath);
  const directory = await lstat(parent).catch(() => {
    throw new RecognitionQuotaError();
  });
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' && directory.uid !== process.getuid())
  )
    throw new RecognitionQuotaError();
  const lockPath = config.statePath + '.lock';
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new RecognitionQuotaError();
  });
  const fingerprint = createHash('sha256').update(config.token).digest('hex');
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await lock.close();
    await unlink(lockPath);
  };
  try {
    await lock.writeFile(String(process.pid) + '\n');
    if (initialize) {
      const file = await open(config.statePath, 'wx', 0o600);
      try {
        await file.writeFile(
          JSON.stringify({
            version: 1,
            budgetId: config.budgetId,
            fingerprint,
            limit: config.limit,
            used: 0,
          }) + '\n',
        );
        await file.sync();
      } finally {
        await file.close();
      }
    }
    const info = await lstat(config.statePath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
      info.size > 4096
    )
      throw new RecognitionQuotaError();
    const state = StateSchema.parse(JSON.parse(await readFile(config.statePath, 'utf8')));
    if (
      state.budgetId !== config.budgetId ||
      state.limit !== config.limit ||
      state.fingerprint !== fingerprint ||
      state.used > state.limit
    )
      throw new RecognitionQuotaError();
    let closed = false,
      healthy = true,
      serial = Promise.resolve();
    return {
      get available() {
        return !closed && healthy;
      },
      get exhausted() {
        return state.used >= state.limit;
      },
      reserve(): Promise<boolean> {
        const task = serial.then(async () => {
          if (closed || !healthy) throw new RecognitionQuotaError();
          if (state.used >= state.limit) return false;
          const temp = config.statePath + '.' + randomUUID() + '.tmp';
          try {
            const file = await open(temp, 'wx', 0o600);
            try {
              await file.writeFile(JSON.stringify({ ...state, used: state.used + 1 }) + '\n');
              await file.sync();
            } finally {
              await file.close();
            }
            await rename(temp, config.statePath);
            const folder = await open(parent, 'r');
            try {
              await folder.sync();
            } finally {
              await folder.close();
            }
            state.used++;
            return true;
          } catch {
            healthy = false;
            await unlink(temp).catch(() => {});
            throw new RecognitionQuotaError();
          }
        });
        serial = task.then(
          () => {},
          () => {},
        );
        return task;
      },
      async close() {
        closed = true;
        await serial;
        await release();
      },
    };
  } catch {
    await release().catch(() => {});
    throw new RecognitionQuotaError();
  }
}
export type RecognitionQuota = Awaited<ReturnType<typeof openRecognitionQuota>>;
