import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'https://github.com/linux-do/mapp-developer-guide.git';
const revision = '7792ce37b3e09684b9e3d918f968f2cbd79df3fb';
const directory = fileURLToPath(new URL('../../../.local/ldweb/', import.meta.url));
const sdk = join(directory, 'sdk');
const marker = join(sdk, '.revision');
if (existsSync(marker)) {
  if (readFileSync(marker, 'utf8') !== revision) {
    throw new Error('本地 SDK 版本不符，请移除 .local/ldweb/sdk 后重试。');
  }
  process.exit(0);
}

mkdirSync(directory, { recursive: true, mode: 0o700 });
const checkout = mkdtempSync(join(directory, 'checkout-'));
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { timeout: 90_000 });
try {
  git('init', '--quiet');
  git('fetch', '--quiet', '--depth', '1', repository, revision);
  if (git('rev-parse', 'FETCH_HEAD').toString().trim() !== revision) {
    throw new Error('无法核对 LINUX DO SDK 版本。');
  }
  git('checkout', '--quiet', '--detach', revision);
  const source = join(checkout, 'sdk');
  writeFileSync(join(source, '.revision'), revision);
  try {
    renameSync(source, sdk);
  } catch (error) {
    if (!existsSync(marker) || readFileSync(marker, 'utf8') !== revision) throw error;
  }
} finally {
  rmSync(checkout, { recursive: true, force: true });
}
