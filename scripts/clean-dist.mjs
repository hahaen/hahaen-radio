import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Set([resolve(root, 'apps/server'), resolve(root, 'packages/contracts')]);
if (!allowed.has(process.cwd())) throw new Error('Unsupported build directory');
await rm(resolve(process.cwd(), 'dist'), { recursive: true, force: true });
