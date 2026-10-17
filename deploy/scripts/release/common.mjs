import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, open, link, unlink, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

export const roles = ['web', 'server', 'migration'];
export const revisionPattern = /^[a-f0-9]{40}$/;
export const idPattern = /^sha256:[a-f0-9]{64}$/;
export const repositoryPattern = /^[a-z0-9][a-z0-9.:-]*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;
export function imageReference(value) {
  assert(typeof value === 'string' && value.length <= 512);
  const parts = value.split('@');
  assert.equal(parts.length, 2);
  const [repository, digest] = parts;
  assert(repositoryPattern.test(repository) && idPattern.test(digest));
  return value;
}
export function registryFor(prefix) {
  assert(typeof prefix === 'string' && prefix.length <= 240 && repositoryPattern.test(prefix));
  const host = prefix.split('/')[0];
  assert(host.includes('.') || host.includes(':') || host === 'localhost');
  return host;
}
export function platform(value) {
  assert(['linux/amd64', 'linux/arm64'].includes(value));
  return value;
}
export async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o700);
  assert(!process.getuid || stat.uid === process.getuid());
  return path;
}
export async function outputDirectory() {
  const relative = '.local/archive/release-pipeline';
  assert.equal(await command('git', ['ls-files', '--', relative]), '');
  const exclude = resolve(await command('git', ['rev-parse', '--git-path', 'info/exclude']));
  let text = '';
  try {
    const stat = await lstat(exclude);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
    assert(!process.getuid || stat.uid === process.getuid());
    text = await readFile(exclude, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const pattern = '/' + relative + '/';
  if (!text.split('\n').includes(pattern))
    await appendFile(exclude, '\n' + pattern + '\n', { mode: 0o600 });
  return privateDirectory(resolve(relative));
}
export async function save(path, value) {
  const pending = path + '.pending-' + randomBytes(6).toString('hex');
  const handle = await open(pending, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Publish only complete metadata and never overwrite an earlier receipt.
    await link(pending, path);
  } finally {
    await unlink(pending);
  }
}
export async function load(path) {
  const stat = await lstat(path);
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      (stat.mode & 0o777) === 0o600 &&
      stat.size < 1024 * 1024,
  );
  assert(!process.getuid || stat.uid === process.getuid());
  return JSON.parse(await readFile(path, 'utf8'));
}
// Child output can include SQL, connection data or credentials. Only callers' fixed events are public.
export async function command(
  executable,
  args,
  { signal, capture = true, timeout = 120000, env = process.env } = {},
) {
  signal?.throwIfAborted();
  const overflow = new AbortController();
  const active = AbortSignal.any([
    overflow.signal,
    AbortSignal.timeout(timeout),
    ...(signal ? [signal] : []),
  ]);
  const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], signal: active });
  let output = '';
  let tooLarge = false;
  child.stderr?.resume();
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    if (!capture) return;
    if (Buffer.byteLength(output) + Buffer.byteLength(chunk) > 4 * 1024 * 1024) {
      tooLarge = true;
      overflow.abort();
    } else output += chunk.toString();
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const failed = new Promise((_, reject) =>
    child.once('error', () => reject(Error('Release tool failed'))),
  );
  try {
    assert.equal(await Promise.race([closed, failed]), 0);
    active.throwIfAborted();
    assert(!tooLarge);
    return output.trim();
  } catch {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    await closed;
    clearTimeout(timer);
    throw Error('Release tool failed');
  }
}
export async function localEngine(run) {
  assert(!process.env.DOCKER_CONTEXT);
  assert(!process.env.DOCKER_HOST || process.env.DOCKER_HOST === 'unix:///var/run/docker.sock');
  if (!process.env.DOCKER_HOST) {
    const context = JSON.parse(await run(['context', 'inspect']));
    assert(
      context.length === 1 && context[0].Endpoints.docker.Host === 'unix:///var/run/docker.sock',
    );
  }
  const info = JSON.parse(await run(['info', '--format', '{{json .}}']));
  assert.equal(info.OSType, 'linux');
  const insecure = info.RegistryConfig?.InsecureRegistryCIDRs;
  assert(
    Array.isArray(insecure) &&
      insecure.every((value) => ['127.0.0.0/8', '::1/128'].includes(value)),
  );
  assert(
    Object.values(info.RegistryConfig.IndexConfigs ?? {}).every((value) => value.Secure !== false),
  );
  const architecture = { x86_64: 'amd64', amd64: 'amd64', aarch64: 'arm64', arm64: 'arm64' }[
    info.Architecture
  ];
  assert(architecture);
  return 'linux/' + architecture;
}
export function docker(signal, env = process.env) {
  const safeEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !/^(RADIO_|DB_|AUDD_|RECOGNITION_|HAEN_)|PASSWORD|TOKEN|SECRET/i.test(key),
    ),
  );
  return (args, options = {}) =>
    command('docker', args, { ...options, env: safeEnv, signal: options.signal ?? signal });
}
export function validateBuild(value) {
  assert(value?.format === 1 && revisionPattern.test(value.revision));
  registryFor(value.repository);
  platform(value.platform);
  assert(/^[a-f0-9]{12}$/.test(value.run));
  for (const role of roles) {
    assert(idPattern.test(value.images?.[role]?.id));
    assert.equal(
      value.images[role].tag,
      `${value.repository}/${role}:${value.revision}-${value.run}`,
    );
  }
  assert(
    Array.isArray(value.migrations) &&
      value.migrations.length > 0 &&
      value.migrations.length < 1000,
  );
  for (const migration of value.migrations)
    assert(
      /^\d{4}_[a-z0-9_]+\.sql$/.test(migration.file) && /^[a-f0-9]{64}$/.test(migration.sha256),
    );
  return value;
}
