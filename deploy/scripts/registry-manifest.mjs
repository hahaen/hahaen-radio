import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import https from 'node:https';
import { imageReference } from './release/common.mjs';

export async function registryManifest(reference, authDirectory, caFile) {
  imageReference(reference);
  const [repository, digest] = reference.split('@');
  const slash = repository.indexOf('/'),
    host = repository.slice(0, slash);
  const auth = JSON.parse(await readFile(join(authDirectory, 'config.json'), 'utf8'));
  assert(/^[A-Za-z0-9+/]{8,16384}={0,2}$/.test(auth.auths?.[host]?.auth));
  let ca;
  if (caFile) {
    const stat = await lstat(caFile);
    assert(
      stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o022) === 0 && stat.size <= 65536,
    );
    ca = await readFile(caFile);
  }
  const bytes = await new Promise((resolve, reject) => {
    const fail = () => reject(Error('Authenticated HTTPS manifest verification failed'));
    const request = https.get(
      'https://' + host + '/v2/' + repository.slice(slash + 1) + '/manifests/' + digest,
      {
        ...(ca ? { ca } : {}),
        rejectUnauthorized: true,
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: 'Basic ' + auth.auths[host].auth,
          Accept:
            'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          fail();
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) response.destroy(Error('Manifest limit'));
          else chunks.push(chunk);
        });
        response.once('error', fail);
        response.once('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    request.setTimeout(30000, () => request.destroy(Error('Manifest timeout')));
    request.once('error', fail);
  });
  assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'), digest);
  return JSON.parse(bytes.toString('utf8'));
}
