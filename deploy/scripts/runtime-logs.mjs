import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';

export function assertRuntimeLogImage(image) {
  assert.equal(image.Config?.Labels?.['io.haen.runtime-log'], 'private-jsonl-v1');
}
export function runtimeLogProbe(service, revision, event, since = 0, directory = '/var/log/haen') {
  assert(['api', 'jobs'].includes(service));
  assert(/^[a-f0-9]{40}$/.test(revision));
  assert(['request_completed', 'scheduler_started'].includes(event));
  assert(Number.isSafeInteger(since) && since >= 0 && isAbsolute(directory));
  return `import assert from 'node:assert/strict';
import {lstatSync,readdirSync,readFileSync} from 'node:fs';
const root=${JSON.stringify(directory)};
const dir=lstatSync(root);
assert(dir.isDirectory() && !dir.isSymbolicLink() && dir.uid===process.getuid() && (dir.mode & 0o777)===0o700);
let found=false;
for(const name of readdirSync(root).sort().reverse()) {
  assert(/^haen-\\d{13}-[a-f0-9]{12}\\.jsonl$/.test(name));
  const path=root+'/'+name, stat=lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink===1 && stat.uid===process.getuid() && (stat.mode & 0o777)===0o600 && stat.size<=10*1024*1024);
  const rows=readFileSync(path,'utf8').trim().split('\\n').filter(Boolean).map(line=>JSON.parse(line));
  if(rows.some(row=>row.service===${JSON.stringify(service)} && row.revision===${JSON.stringify(revision)} && row.event===${JSON.stringify(event)} && Date.parse(row.time)>=${since})) {found=true;break;}
}
assert(found);
console.info('ready');`;
}
