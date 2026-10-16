import { describe, expect, it, vi } from 'vitest';
import {
  isPublicAddress,
  parseHttpsDnsAnswer,
  resolvePublicTarget,
  validateRemoteUrl,
} from './public-http.js';
describe('public network boundary', () => {
  it('blocks loopback, private, link-local, mapped IPv4 and reserved networks', () => {
    for (const value of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '2001:db8::1',
    ])
      expect(isPublicAddress(value), value).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('rejects insecure protocols, credentials and obfuscated private literals before DNS', () => {
    for (const value of [
      'http://public.example/',
      'file:///etc/passwd',
      'https://user:password@public.example/',
      'https://localhost/',
      'https://localhost./',
      'https://127.1/',
      'https://0x7f000001/',
      'https://[::ffff:7f00:1]/',
    ])
      expect(() => validateRemoteUrl(value)).toThrow('UNSAFE_URL');
  });
  it('validates encrypted DNS results, refuses truncated/private answers and respects short TTLs', () => {
    expect(
      parseHttpsDnsAnswer(
        { Status: 0, TC: false, Answer: [{ type: 1, TTL: 5, data: '8.8.8.8' }] },
        1,
      ),
    ).toEqual({ addresses: [{ address: '8.8.8.8', family: 4 }], ttl: 5 });
    for (const result of [
      { Status: 2 },
      { Status: 0, TC: true },
      { Status: 0, Answer: [{ type: 1, TTL: 5, data: '127.0.0.1' }] },
      { Status: 0, Answer: [{ type: 1, TTL: 5, data: 'invalid' }] },
    ])
      expect(() => parseHttpsDnsAnswer(result, 1)).toThrow('DNS_FAILURE');
  });
  it('requires every DNS answer to be public and returns the validated address for connection pinning', async () => {
    const resolve = vi.fn(async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(resolvePublicTarget('https://radio.example/live', resolve)).rejects.toThrow(
      'UNSAFE_URL',
    );
    const target = await resolvePublicTarget('https://radio.example/live', async () => [
      { address: '8.8.8.8', family: 4 },
    ]);
    expect(target.address).toEqual({ address: '8.8.8.8', family: 4 });
    expect(target.url.hostname).toBe('radio.example');
    await expect(resolvePublicTarget('https://radio.example/live', async () => [])).rejects.toThrow(
      'UNSAFE_URL',
    );
  });
});
