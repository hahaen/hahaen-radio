import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';
import { IncomingMessage, type ClientRequest } from 'node:http';
import { request } from 'node:https';
import { expect, it, vi } from 'vitest';
import { openPublicResponse } from './public-http.js';
vi.mock('node:https', () => ({ request: vi.fn() }));
it('never follows a credential-bearing POST redirect and rejects invalid outbound bodies before connecting', async () => {
  const incoming = new IncomingMessage(new Socket());
  incoming.statusCode = 302;
  incoming.headers = { location: 'https://different.example/' };
  const outgoing = new EventEmitter() as ClientRequest;
  outgoing.end = vi.fn(() => outgoing);
  vi.mocked(request).mockImplementation((...args) => {
    const callback = args.at(-1) as (response: IncomingMessage) => void;
    queueMicrotask(() => callback(incoming));
    return outgoing;
  });
  await expect(
    openPublicResponse('https://api.audd.io/', {
      method: 'POST',
      body: new Uint8Array([1, 2]),
      contentType: 'multipart/form-data; boundary=unit',
      resolver: async () => [{ address: '8.8.8.8', family: 4 }],
    }),
  ).rejects.toThrow('INVALID_RESPONSE');
  expect(request).toHaveBeenCalledOnce();
  expect(incoming.destroyed).toBe(true);
  await expect(
    openPublicResponse('https://api.audd.io/', { body: new Uint8Array([1]) }),
  ).rejects.toThrow('INVALID_RESPONSE');
  await expect(
    openPublicResponse('https://api.audd.io/', {
      method: 'POST',
      contentType: 'audio/mpeg',
      body: new Uint8Array(2 * 1024 * 1024 + 1),
    }),
  ).rejects.toThrow('INVALID_RESPONSE');
  expect(request).toHaveBeenCalledOnce();
});
