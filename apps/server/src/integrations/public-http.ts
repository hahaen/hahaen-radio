import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { getCACertificates } from 'node:tls';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';

export class RemoteRequestError extends Error {
  constructor(
    readonly code:
      | 'UNSAFE_URL'
      | 'DNS_FAILURE'
      | 'REQUEST_FAILED'
      | 'RESPONSE_TOO_LARGE'
      | 'INVALID_RESPONSE'
      | 'TIMEOUT',
    readonly status?: number,
  ) {
    super(code);
  }
}
export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function validateRemoteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RemoteRequestError('UNSAFE_URL');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    input.length > 4096 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !hostname ||
    hostname === 'localhost' ||
    /\.(localhost|local|internal)$/.test(hostname) ||
    (isIP(hostname) && !isPublicAddress(hostname))
  )
    throw new RemoteRequestError('UNSAFE_URL');
  return url;
}
export type AddressResolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
const resolveAddresses: AddressResolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });
export async function resolvePublicTarget(
  input: string,
  resolve: AddressResolver = resolveAddresses,
) {
  const url = validateRemoteUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolve(hostname).catch(() => {
        throw new RemoteRequestError('DNS_FAILURE');
      });
  if (
    !addresses.length ||
    addresses.some(
      (address) => ![4, 6].includes(address.family) || !isPublicAddress(address.address),
    )
  )
    throw new RemoteRequestError('UNSAFE_URL');
  return { url, address: addresses.find((address) => address.family === 4) ?? addresses[0]! };
}
export interface PublicResponse {
  status: number;
  headers: IncomingMessage['headers'];
  body: IncomingMessage;
  close(): void;
}
export interface PublicRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  allowedUrl?: (url: URL) => boolean;
  resolver?: AddressResolver;
  accept?: string;
  icyMetadata?: boolean;
  userAgent?: string;
}
const trust = [...getCACertificates('default'), ...getCACertificates('system')];
export async function openPublicResponse(
  input: string,
  options: PublicRequestOptions = {},
): Promise<PublicResponse> {
  const deadline = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  const timer = setTimeout(
    () => deadline.abort(new RemoteRequestError('TIMEOUT')),
    options.timeoutMs ?? 15000,
  );
  const clean = () => clearTimeout(timer);
  try {
    let target = input;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const parsed = validateRemoteUrl(target);
      if (options.allowedUrl && !options.allowedUrl(parsed))
        throw new RemoteRequestError('UNSAFE_URL');
      signal.throwIfAborted();
      const resolver = options.resolver ?? configuredResolver();
      const resolved = await new Promise<Awaited<ReturnType<typeof resolvePublicTarget>>>(
        (resolve, reject) => {
          const aborted = () => reject(signal.reason);
          signal.addEventListener('abort', aborted, { once: true });
          void resolvePublicTarget(target, resolver)
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', aborted));
        },
      );
      signal.throwIfAborted();
      const incoming = await new Promise<IncomingMessage>((resolve, reject) => {
        const outgoing = request(
          resolved.url,
          {
            signal,
            family: resolved.address.family,
            ca: trust,
            rejectUnauthorized: true,
            lookup: (_hostname, _lookupOptions, callback) =>
              callback(null, resolved.address.address, resolved.address.family),
            headers: {
              'user-agent': options.userAgent ?? 'HAEN/0.1',
              ...(options.icyMetadata ? { 'icy-metadata': '1' } : {}),
              accept: options.accept ?? 'application/json, text/plain, */*',
              'accept-encoding': 'identity',
            },
          },
          (response) => {
            response.on('error', () => {});
            resolve(response);
          },
        );
        outgoing.once('error', () =>
          reject(signal.aborted ? signal.reason : new RemoteRequestError('REQUEST_FAILED')),
        );
        outgoing.end();
      });
      if ([301, 302, 303, 307, 308].includes(incoming.statusCode ?? 0)) {
        const location = incoming.headers.location;
        incoming.destroy();
        if (!location || redirects === 3) throw new RemoteRequestError('INVALID_RESPONSE');
        target = new URL(location, resolved.url).toString();
        continue;
      }
      incoming.once('end', clean);
      incoming.once('close', clean);
      return {
        status: incoming.statusCode ?? 0,
        headers: incoming.headers,
        body: incoming,
        close() {
          incoming.destroy();
          clean();
        },
      };
    }
    throw new RemoteRequestError('INVALID_RESPONSE');
  } catch (error) {
    clean();
    throw error instanceof RemoteRequestError
      ? error
      : new RemoteRequestError(signal.aborted ? 'TIMEOUT' : 'REQUEST_FAILED');
  }
}
export async function readPublicText(
  input: string,
  options: PublicRequestOptions & { maxBytes?: number } = {},
): Promise<string> {
  const response = await openPublicResponse(input, options);
  try {
    if (response.status < 200 || response.status >= 300)
      throw new RemoteRequestError('INVALID_RESPONSE', response.status);
    const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    const contentLength = response.headers['content-length'];
    if (typeof contentLength === 'string' && Number(contentLength) > maxBytes)
      throw new RemoteRequestError('RESPONSE_TOO_LARGE');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      bytes += buffer.length;
      if (bytes > maxBytes) throw new RemoteRequestError('RESPONSE_TOO_LARGE');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    throw error instanceof RemoteRequestError ? error : new RemoteRequestError('REQUEST_FAILED');
  } finally {
    response.close();
  }
}
export async function readPublicJson(
  input: string,
  options: PublicRequestOptions & { maxBytes?: number } = {},
): Promise<unknown> {
  const text = await readPublicText(input, options);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RemoteRequestError('INVALID_RESPONSE');
  }
}

const dnsCache = new Map<
  string,
  { until: number; addresses: { address: string; family: number }[] }
>();
const DnsAnswerSchema = z.object({
  Status: z.literal(0),
  TC: z.literal(false).optional(),
  Answer: z
    .array(
      z.object({
        type: z.number().int(),
        TTL: z.number().int().nonnegative(),
        data: z.string().max(512),
      }),
    )
    .max(64)
    .default([]),
});
export function parseHttpsDnsAnswer(input: unknown, type: 1 | 28) {
  const result = DnsAnswerSchema.safeParse(input);
  if (!result.success) throw new RemoteRequestError('DNS_FAILURE');
  const addresses = result.data.Answer.flatMap((row) => {
    if (row.type !== type) return [];
    if (isIP(row.data) !== (type === 1 ? 4 : 6) || !isPublicAddress(row.data))
      throw new RemoteRequestError('DNS_FAILURE');
    return [{ address: row.data, family: type === 1 ? 4 : 6 }];
  });
  return { addresses, ttl: Math.min(30, ...result.data.Answer.map((row) => row.TTL)) };
}
function configuredResolver(): AddressResolver {
  const mode = process.env.REMOTE_DNS_MODE || 'system';
  if (!['system', 'https'].includes(mode))
    throw new Error('Invalid environment variables: REMOTE_DNS_MODE');
  return mode === 'https' ? resolveHttpsDns : resolveAddresses;
}
export const resolveHttpsDns: AddressResolver = async (hostname) => {
  const cached = dnsCache.get(hostname);
  if (cached && cached.until > Date.now()) return cached.addresses;
  const answers = await Promise.all(
    ([1, 28] as const).map(async (type) => {
      const url = new URL('https://cloudflare-dns.com/dns-query');
      url.search = new URLSearchParams({ name: hostname, type: String(type) }).toString();
      const result = await readPublicJson(url.toString(), {
        timeoutMs: 3000,
        maxBytes: 65536,
        accept: 'application/dns-json',
        resolver: async (name) => {
          if (name !== 'cloudflare-dns.com') throw new RemoteRequestError('DNS_FAILURE');
          return [{ address: '1.1.1.1', family: 4 }];
        },
        allowedUrl: (value) =>
          value.origin === 'https://cloudflare-dns.com' && value.pathname === '/dns-query',
      });
      return parseHttpsDnsAnswer(result, type);
    }),
  );
  const addresses = answers.flatMap((answer) => answer.addresses);
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address)))
    throw new RemoteRequestError('DNS_FAILURE');
  if (dnsCache.size >= 256) dnsCache.delete(dnsCache.keys().next().value!);
  dnsCache.set(hostname, {
    until: Date.now() + Math.min(...answers.map((answer) => answer.ttl)) * 1000,
    addresses,
  });
  return addresses;
};
