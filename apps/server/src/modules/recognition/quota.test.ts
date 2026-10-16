import { mkdtemp, readFile, writeFile, chmod, rm, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readRecognitionConfig, type RecognitionConfig } from '../../config/recognition.js';
import { openRecognitionQuota } from './quota.js';
async function environment() {
  const directory = await mkdtemp(join(tmpdir(), 'haen-recognition-'));
  await chmod(directory, 0o700);
  const config: RecognitionConfig = {
    enabled: true,
    token: 'unit-only-token',
    limit: 2,
    budgetId: 'unit-budget',
    statePath: join(directory, 'quota.json'),
  };
  return { directory, config, clean: () => rm(directory, { recursive: true, force: true }) };
}
it('requires an explicit allowance and private absolute state path only when recognition is enabled', () => {
  expect(readRecognitionConfig({})).toEqual({ enabled: false });
  expect(readRecognitionConfig({ AUDD_API_TOKEN: 'unit-only-token' })).toEqual({ enabled: false });
  expect(() => readRecognitionConfig({ RECOGNITION_ENABLED: 'yes' })).toThrow(
    'RECOGNITION_ENABLED',
  );
  expect(() => readRecognitionConfig({ RECOGNITION_ENABLED: 'true' })).toThrow('AUDD_API_TOKEN');
  expect(() =>
    readRecognitionConfig({
      RECOGNITION_ENABLED: 'true',
      AUDD_API_TOKEN: 'secret-test-value',
      RECOGNITION_REQUEST_LIMIT: '0',
      RECOGNITION_BUDGET_ID: 'x',
      RECOGNITION_STATE_PATH: 'quota.json',
    }),
  ).toThrow('RECOGNITION_REQUEST_LIMIT');
  try {
    readRecognitionConfig({ RECOGNITION_ENABLED: 'true', AUDD_API_TOKEN: 'secret-test-value' });
  } catch (error) {
    expect(String(error)).not.toContain('secret-test-value');
  }
});
it('atomically reserves a fixed allowance, serializes concurrent callers and preserves exhaustion across restarts', async () => {
  const env = await environment();
  let quota;
  try {
    quota = await openRecognitionQuota(env.config, true);
    expect(await Promise.all(Array.from({ length: 5 }, () => quota!.reserve()))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(quota.exhausted).toBe(true);
    const saved = await readFile(env.config.statePath, 'utf8');
    expect(saved).not.toContain(env.config.token);
    expect(JSON.parse(saved).used).toBe(2);
    await quota.close();
    quota = await openRecognitionQuota(env.config);
    expect(quota.exhausted).toBe(true);
    expect(await quota.reserve()).toBe(false);
    await quota.close();
    await expect(openRecognitionQuota(env.config, true)).rejects.toThrow(
      'Recognition quota unavailable',
    );
    expect(await readFile(env.config.statePath, 'utf8')).toBe(saved);
  } finally {
    await quota?.close();
    await env.clean();
  }
});
it('fails closed on a missing, corrupt, public, mismatched or concurrently owned allowance', async () => {
  const env = await environment();
  try {
    await expect(openRecognitionQuota(env.config)).rejects.toThrow('Recognition quota unavailable');
    const quota = await openRecognitionQuota(env.config, true);
    try {
      await expect(openRecognitionQuota(env.config)).rejects.toThrow(
        'Recognition quota unavailable',
      );
    } finally {
      await quota.close();
    }
    await expect(openRecognitionQuota({ ...env.config, limit: 3 })).rejects.toThrow(
      'Recognition quota unavailable',
    );
    await expect(
      openRecognitionQuota({ ...env.config, token: 'different-unit-token' }),
    ).rejects.toThrow('Recognition quota unavailable');
    const alias = join(env.directory, 'alias.json');
    await symlink(env.config.statePath, alias);
    await expect(openRecognitionQuota({ ...env.config, statePath: alias })).rejects.toThrow(
      'Recognition quota unavailable',
    );
    await chmod(env.config.statePath, 0o644);
    await expect(openRecognitionQuota(env.config)).rejects.toThrow('Recognition quota unavailable');
    await chmod(env.config.statePath, 0o600);
    await writeFile(env.config.statePath, '{}');
    await expect(openRecognitionQuota(env.config)).rejects.toThrow('Recognition quota unavailable');
    await writeFile(env.config.statePath + '.lock', 'unit-crashed-owner', { mode: 0o600 });
    await expect(openRecognitionQuota(env.config)).rejects.toThrow('Recognition quota unavailable');
    expect(await readFile(env.config.statePath + '.lock', 'utf8')).toBe('unit-crashed-owner');
    await unlink(env.config.statePath + '.lock');
  } finally {
    await env.clean();
  }
});
