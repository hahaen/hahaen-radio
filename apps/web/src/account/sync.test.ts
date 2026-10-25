import { describe, expect, it } from 'vitest';
import { emptyCollection } from '@haen/contracts';
import { mergeCollection } from './sync';
const a = { id: '00000000-0000-4000-8000-000000000001', name: 'A', countryCode: null, savedAt: 1 };
const b = { ...a, id: '00000000-0000-4000-8000-000000000002', name: 'B' };
describe('account collection merge', () => {
  it('keeps pin changes independent of collection edits and accepts older snapshots', () => {
    const base = emptyCollection();
    const remote = { ...base, pinned: true, favorites: [a] };
    expect(mergeCollection(base, base, remote)).toEqual(remote);
    expect(mergeCollection({ ...base, pinned: true }, { ...base, pinned: false }, remote)).toEqual({
      ...remote,
      pinned: false,
    });
    expect(mergeCollection(base, { ...base, pinned: true }, { ...base, history: [b] })).toEqual({
      ...base,
      history: [b],
      pinned: true,
    });
  });
  it('preserves remote additions and local removals, including response-loss retry', () => {
    const base = { ...emptyCollection(), favorites: [a] };
    const local = emptyCollection();
    const remote = { ...emptyCollection(), favorites: [a, b] };
    const merged = mergeCollection(base, local, remote);
    expect(merged.favorites).toEqual([b]);
    expect(mergeCollection(base, local, merged)).toEqual(merged);
  });
  it('does not resurrect untouched remote deletions and keeps the most recent play', () => {
    const base = { ...emptyCollection(), favorites: [a], history: [a] };
    const local = { ...base, history: [{ ...a, savedAt: 2 }] };
    const remote = { ...emptyCollection(), history: [{ ...a, savedAt: 3 }, b] };
    const merged = mergeCollection(base, local, remote);
    expect(merged.favorites).toEqual([]);
    expect(merged.history[0]!.savedAt).toBe(3);
    expect(mergeCollection(base, { ...local, history: [] }, remote).history).toEqual([b]);
  });
});
