export function boundedCache<T>(capacity: number, maxBytes = 8 * 1024 * 1024) {
  const entries = new Map<string, { value: T; until: number; bytes: number }>();
  let bytes = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) {
      bytes -= entry.bytes;
      entries.delete(key);
    }
  };
  return {
    get(key: string, now: number): T | undefined {
      const entry = entries.get(key);
      if (!entry) return;
      if (entry.until <= now) {
        remove(key);
        return;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T, until: number) {
      remove(key);
      const size = Buffer.byteLength(JSON.stringify(value));
      if (size > maxBytes) return;
      while (entries.size >= capacity || bytes + size > maxBytes)
        remove(entries.keys().next().value!);
      entries.set(key, { value, until, bytes: size });
      bytes += size;
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
  };
}
