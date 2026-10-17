import assert from 'node:assert/strict';
import { join } from 'node:path';
import { command, outputDirectory, revisionPattern, save } from './common.mjs';

assert.equal(process.version, 'v24.9.0');
const branch = process.env.HAEN_SOURCE_BRANCH;
assert(typeof branch === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch));
await command('git', ['check-ref-format', 'refs/heads/' + branch]);
const revision = await command('git', ['rev-parse', 'HEAD']);
assert(revisionPattern.test(revision));
assert.equal(revision, await command('git', ['rev-parse', 'refs/remotes/origin/' + branch]));
await save(join(await outputDirectory(), 'source.json'), { format: 1, branch, revision });
console.info(revision);
