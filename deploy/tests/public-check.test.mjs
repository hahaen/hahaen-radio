import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { probePublicRelease } from '../scripts/public-check.mjs';
const servers = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
const html = '<script src="/radio/assets/app.js"></script>';
async function fixture(overrides = {}) {
  const calls = [];
  const routes = {
    '/radio/': html,
    '/radio/assets/app.js': 'console.log("ready")',
    '/radio/api/v1/health/ready': {
      status: 'ready',
      database: true,
      catalog: true,
      version: 'version-1',
    },
    '/radio/api/v1/catalog': {
      version: 'version-1',
      stationCount: 1,
      chunks: [{ index: 0, count: 1 }],
    },
    ...overrides,
  };
  const server = createServer((req, res) => {
    calls.push(req.url);
    const value = routes[req.url];
    res.statusCode = value === undefined ? 404 : 200;
    res.end(typeof value === 'string' ? value : JSON.stringify(value));
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { site: 'http://127.0.0.1:' + server.address().port + '/radio', calls };
}
it('checks the selected page, a real asset, readiness and the catalogue through HTTP', async () => {
  const f = await fixture();
  await probePublicRelease(f.site, html, new AbortController().signal);
  expect(f.calls).toHaveLength(4);
});
it('allows initial API publication before the first frontend exists', async () => {
  const f = await fixture({ '/radio/': undefined });
  await probePublicRelease(f.site, null, new AbortController().signal);
  expect(f.calls).toEqual(['/radio/api/v1/health/ready', '/radio/api/v1/catalog']);
});
it.each([
  { '/radio/': '<html>maintenance</html>' },
  { '/radio/assets/app.js': undefined },
  { '/radio/api/v1/health/ready': { status: 'ready', database: false, catalog: true } },
  { '/radio/api/v1/catalog': { version: 'other-version', stationCount: 1, chunks: [{}] } },
])('rejects a 200-only or incomplete release: %j', async (overrides) => {
  const f = await fixture(overrides);
  await expect(probePublicRelease(f.site, html, new AbortController().signal)).rejects.toThrow();
});
