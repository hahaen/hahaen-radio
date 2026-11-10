import { applicationPath } from '../platform/paths.js';

type ReadMapAsset = (path: string, signal?: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>;
let read: ReadMapAsset | undefined;
let fallback: string | undefined;

export function configurePackagedMapAssets(loader: ReadMapAsset, fallbackUrl: string) {
  read = loader;
  fallback = fallbackUrl;
}

export function mapFallbackUrl() {
  return fallback ?? applicationPath('geography/world.svg');
}

export const requestMapAsset: typeof fetch = async (input, options) => {
  if (!read) return fetch(input, options);
  if (typeof input !== 'string' || !input.startsWith(applicationPath('geography/')))
    throw new Error('Unexpected map asset');
  const path = input.slice(applicationPath('geography/').length).split('?')[0];
  const bytes = await read('geography/' + path, options?.signal ?? undefined);
  options?.signal?.throwIfAborted();
  return new Response(bytes, {
    headers: { 'content-type': path === 'relief.jpg' ? 'image/jpeg' : 'application/json' },
  });
};
