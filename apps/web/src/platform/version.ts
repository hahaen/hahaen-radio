import { applicationPath } from './paths';

export const buildVersion: string | null = import.meta.env.PROD
  ? import.meta.env.HAEN_WEB_BUILD_ID
  : null;
export const versionCheckInterval = 60_000;

export async function fetchVersion(signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = window.setTimeout(abort, 8000);
  try {
    const response = await fetch(applicationPath(`version.json?t=${Date.now()}`), {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Version unavailable');
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !('version' in data) ||
      typeof data.version !== 'string' ||
      !/^[a-f0-9]{32}$/.test(data.version)
    )
      throw new Error('Invalid version');
    return data.version;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function observeVersion(current: string, changed: (version: string) => void) {
  const controller = new AbortController();
  let pending = false;
  let lastCheck = -Infinity;
  const check = async () => {
    if (document.hidden || pending || Date.now() - lastCheck < 5000) return;
    lastCheck = Date.now();
    pending = true;
    try {
      const latest = await fetchVersion(controller.signal);
      if (!controller.signal.aborted && latest !== current) changed(latest);
    } catch {
      // Offline, maintenance and invalid responses must not interrupt listening.
    } finally {
      pending = false;
    }
  };
  const resume = () => void check();
  const timer = window.setInterval(resume, versionCheckInterval);
  window.addEventListener('focus', resume);
  window.addEventListener('online', resume);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', resume);
  resume();
  return () => {
    controller.abort();
    window.clearInterval(timer);
    window.removeEventListener('focus', resume);
    window.removeEventListener('online', resume);
    window.removeEventListener('pageshow', resume);
    document.removeEventListener('visibilitychange', resume);
  };
}

export function reloadVersion(version: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('_haen_update', version);
  window.location.replace(url.href);
}
