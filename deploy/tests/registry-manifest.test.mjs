import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import https from 'node:https';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registryManifest } from '../scripts/registry-manifest.mjs';
it('requires authenticated HTTPS, a trusted hostname and the exact manifest digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'radio-manifest-'));
  let server;
  try {
    const key = join(root, 'key.pem'),
      cert = join(root, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost',
      ],
      { stdio: 'pipe' },
    );
    const body = Buffer.from(
      JSON.stringify({ schemaVersion: 2, config: { digest: 'sha256:' + 'a'.repeat(64) } }),
    );
    const digest = createHash('sha256').update(body).digest('hex'),
      auth = Buffer.from('test-identity:test-password').toString('base64');
    server = https.createServer(
      { key: await readFile(key), cert: await readFile(cert) },
      (request, response) => {
        if (request.headers.authorization !== 'Basic ' + auth) {
          response.writeHead(401);
          response.end();
          return;
        }
        expect(request.url).toMatch(/^\/v2\/radio\/api\/manifests\/sha256:/);
        response.writeHead(200, { 'Content-Type': 'application/vnd.oci.image.manifest.v1+json' });
        response.end(body);
      },
    );
    await new Promise((resolve) => server.listen(0, 'localhost', resolve));
    const host = 'localhost:' + server.address().port;
    await writeFile(join(root, 'config.json'), JSON.stringify({ auths: { [host]: { auth } } }), {
      mode: 0o600,
    });
    const reference = host + '/radio/api@sha256:' + digest;
    expect(await registryManifest(reference, root, cert)).toMatchObject({ schemaVersion: 2 });
    await expect(registryManifest(reference, root)).rejects.toThrow();
    await expect(
      registryManifest(host + '/radio/api@sha256:' + 'b'.repeat(64), root, cert),
    ).rejects.toThrow();
    await writeFile(
      join(root, 'config.json'),
      JSON.stringify({
        auths: { [host]: { auth: Buffer.from('wrong:identity').toString('base64') } },
      }),
    );
    await expect(registryManifest(reference, root, cert)).rejects.toThrow();
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
