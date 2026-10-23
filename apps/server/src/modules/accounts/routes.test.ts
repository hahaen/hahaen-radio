import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyCollection } from '@haen/contracts';
import { buildApp } from '../../app.js';
import { readEnvironment } from '../../config/environment.js';
import { memoryAccountRepository } from '../../testing/account-repository.js';
import { createAccountService } from './service.js';
const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((app) => app.close()));
});
function setup(production = false) {
  const data = memoryAccountRepository();
  const app = buildApp(
    readEnvironment({ NODE_ENV: production ? 'production' : 'test' }),
    false,
    undefined,
    { accounts: createAccountService(data.repository) },
  );
  opened.push(app);
  return { app, ...data };
}
const headers = { 'x-haen-request': '1' };
const credentials = () => ({
  username: 'listener_alpha',
  password: randomBytes(24).toString('base64url'),
});
const cookieOf = (value: string | string[] | number | undefined) => String(value).split(';')[0]!;
describe('account routes', () => {
  it.each(['favorites', 'history'] as const)(
    'serializes nonempty %s after saving and reading the account library',
    async (kind) => {
      const { app } = setup();
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/account/login',
        headers,
        payload: credentials(),
      });
      const userId = login.json().user.id;
      const authenticated = { ...headers, cookie: cookieOf(login.headers['set-cookie']) };
      const item = {
        id: 'ABCDEFAB-1234-4567-89AB-ABCDEFABCDEF',
        name: '同步电台',
        countryCode: 'CN',
        savedAt: 1,
      };
      const saved = await app.inject({
        method: 'POST',
        url: '/api/v1/account/library',
        headers: authenticated,
        payload: { userId, revision: 0, collection: { ...emptyCollection(), [kind]: [item] } },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().collection[kind]).toEqual([{ ...item, id: item.id.toLowerCase() }]);
      const restored = await app.inject({
        url: '/api/v1/account/library?userId=' + userId,
        headers: authenticated,
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toEqual(saved.json());
    },
  );
  it('keeps guest access, registers a hashed account, rotates sessions, scopes collections and logs out', async () => {
    const { app, users, sessions } = setup(true);
    expect((await app.inject('/api/v1/account/session')).json()).toEqual({ user: null });
    const input = credentials();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/account/login',
      headers,
      payload: { ...input, username: 'Listener_Alpha' },
    });
    expect(registered.statusCode).toBe(200);
    expect(registered.headers['set-cookie']).toContain(
      'HttpOnly; SameSite=Lax; Max-Age=2592000; Secure',
    );
    expect(registered.headers['cache-control']).toBe('no-store');
    const user = registered.json().user as { id: string; username: string };
    expect(user.username).toBe('listener_alpha');
    expect(users.get(user.id)!.passwordHash).not.toContain(input.password);
    expect(registered.body).not.toContain('passwordHash');
    const cookie = cookieOf(registered.headers['set-cookie']);
    expect([...sessions.keys()][0]).not.toBe(cookie.split('=')[1]);
    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/account/library',
      headers: { ...headers, cookie },
      payload: { userId: user.id, revision: 0, collection: emptyCollection() },
    });
    expect(saved.json().revision).toBe(1);
    const stale = await app.inject({
      method: 'POST',
      url: '/api/v1/account/library',
      headers: { ...headers, cookie },
      payload: { userId: user.id, revision: 0, collection: emptyCollection() },
    });
    expect(stale.statusCode).toBe(409);
    expect(
      (
        await app.inject({
          url: '/api/v1/account/library?userId=00000000-0000-4000-8000-000000000001',
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/account/login',
      headers: { ...headers, cookie },
      payload: input,
    });
    expect(login.statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/account/session', headers: { cookie } })).json().user,
    ).toBeNull();
    const nextCookie = cookieOf(login.headers['set-cookie']);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/account/logout',
          headers: { ...headers, cookie: nextCookie },
          payload: { userId: user.id },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/account/session', headers: { cookie: nextCookie } })).json()
        .user,
    ).toBeNull();
  });
  it.each([6, 128])('registers and signs in with a %i-character password', async (length) => {
    const { app, users } = setup();
    const input = { ...credentials(), password: randomBytes(length / 2).toString('hex') };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/account/login',
        headers,
        payload: input,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().user.username).toBe(input.username);
    }
    expect(users.size).toBe(1);
  });
  it.each([5, 129])(
    'rejects a %i-character password before creating an account',
    async (length) => {
      const { app, users } = setup();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/account/login',
        headers,
        payload: {
          ...credentials(),
          password: randomBytes(length).toString('hex').slice(0, length),
        },
      });
      expect(response.statusCode).toBe(400);
      expect(users.size).toBe(0);
    },
  );
  it('rejects CSRF, invalid fields, reserved accounts, bad credentials and expired sessions', async () => {
    const { app, sessions } = setup();
    const input = credentials();
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/account/login', payload: input }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/account/login',
          headers: { ...headers, 'sec-fetch-site': 'cross-site' },
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/account/login',
          headers,
          payload: { ...input, password: 'short' },
        })
      ).statusCode,
    ).toBe(400);
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/account/login',
      headers,
      payload: input,
    });
    for (const username of [
      'test',
      'TEST123',
      'admin',
      'Administrator',
      'root',
      'system',
      'support',
    ]) {
      const blocked = await app.inject({
        method: 'POST',
        url: '/api/v1/account/login',
        headers,
        payload: { ...input, username },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().code).toBe('ACCOUNT_RESERVED');
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/account/login',
          headers,
          payload: { ...input, password: randomBytes(24).toString('hex') },
        })
      ).statusCode,
    ).toBe(401);
    for (const session of sessions.values()) session.expiresAt = new Date(0);
    const cookie = cookieOf(registered.headers['set-cookie']);
    expect(
      (
        await app.inject({
          url: '/api/v1/account/library?userId=' + registered.json().user.id,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
    for (let index = 0; index < 11; index++)
      await app.inject({
        method: 'POST',
        url: '/api/v1/account/login',
        headers,
        payload: { ...input, username: 'admin' },
      });
    const limited = await app.inject({
      method: 'POST',
      url: '/api/v1/account/login',
      headers,
      payload: { ...input, username: 'admin' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('900');
  });
  it('does not create duplicate users or accept a competing password during concurrent auto-registration', async () => {
    const data = memoryAccountRepository();
    const service = createAccountService(data.repository);
    const first = credentials();
    const second = { ...first, password: randomBytes(24).toString('hex') };
    const result = await Promise.allSettled([
      service.authenticate(first, '127.0.0.1'),
      service.authenticate(second, '127.0.0.1'),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(data.users.size).toBe(1);
    const winner = result.find((item) => item.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('No account created');
    const other = await service.authenticate(
      { ...credentials(), username: 'another_listener' },
      '127.0.0.1',
    );
    await expect(service.read(other.user, winner.value.user.id)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      service.save(other.user, winner.value.user.id, {
        revision: 0,
        collection: emptyCollection(),
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
