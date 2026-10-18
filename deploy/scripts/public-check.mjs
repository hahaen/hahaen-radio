import assert from 'node:assert/strict';

export async function probePublicRelease(site, expectedHtml, signal) {
  const active = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  const request = async (path) => {
    const response = await fetch(site + path, { redirect: 'error', signal: active });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error('Public release probe failed');
    }
    return response;
  };
  if (expectedHtml !== null) {
    const html = await (await request('/')).text();
    assert.equal(html.trim(), expectedHtml.trim(), 'Public page is not the selected release');
    const asset = /src="(\/radio\/assets\/[^"?#]+\.js)"/.exec(html)?.[1];
    assert(asset, 'Public page has no application asset');
    const resource = await request(asset.slice('/radio'.length));
    assert((await resource.arrayBuffer()).byteLength > 0, 'Public application asset is empty');
  }
  const ready = await (await request('/api/v1/health/ready')).json();
  assert(ready.status === 'ready' && ready.database === true && ready.catalog === true);
  const catalog = await (await request('/api/v1/catalog')).json();
  assert(typeof ready.version === 'string' && catalog.version === ready.version);
  assert(Number.isSafeInteger(catalog.stationCount) && catalog.stationCount > 0);
  assert(Array.isArray(catalog.chunks) && catalog.chunks.length > 0);
}
