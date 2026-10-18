import { describe, expect, it, vi } from 'vitest';
import { testStation } from '../testing/stations';
import { createStationCollection, pickStation } from './collection';
describe('shared exploration candidates', () => {
  it('combines query and dimensions without dropping unlocated stations or treating an empty choice as all', () => {
    const first = {
      ...testStation(1),
      name: 'Café Jazz',
      countryCode: 'FR',
      genre: 'jazz' as const,
      languages: ['fr', 'en'],
      bitrate: 192,
      latitude: null,
      longitude: null,
    };
    const second = {
      ...testStation(2),
      countryCode: 'JP',
      genre: 'pop' as const,
      languages: ['ja'],
      bitrate: null,
    };
    const collection = createStationCollection([
      first,
      second,
      { ...first, id: testStation(3).id, availability: 'blocked' },
    ]);
    expect(
      collection.filter({
        q: 'cafe 法国',
        genres: ['jazz', 'pop'],
        languages: ['fr'],
        minBitrate: 192,
      }),
    ).toEqual([first]);
    expect(collection.filter({ q: '', genres: [] })).toEqual([]);
    expect(collection.filter({ q: '', languages: [] })).toEqual([]);
    expect(collection.filter({ q: '', minBitrate: 320 })).toEqual([]);
    expect(collection.filter({ q: '' })).toHaveLength(2);
  });
  it.each(['中国', 'China', 'cN'])('includes Taiwan stations when searching %s', (q) => {
    const mainland = { ...testStation(1), countryCode: 'CN', city: '北京' };
    const taiwan = { ...testStation(2), countryCode: 'TW', city: '台北' };
    const collection = createStationCollection([
      mainland,
      taiwan,
      { ...testStation(3), countryCode: 'JP' },
      { ...testStation(4), countryCode: null },
      { ...taiwan, id: testStation(5).id, availability: 'blocked' },
    ]);
    expect(collection.filter({ q })).toEqual([mainland, taiwan]);
    expect(collection.filter({ q: `${q} 台北` })).toEqual([taiwan]);
    expect(collection.filter({ q, languages: [] })).toEqual([]);
    expect(collection.filter({ q: '台湾' })).toEqual([taiwan]);
    expect(collection.filter({ q: 'Taiwan' })).toEqual([taiwan]);
    expect(collection.filter({ q: 'TW' })).toEqual([taiwan]);
  });
  it('draws from all current candidates while respecting failed station exclusions', () => {
    const stations = [testStation(1), testStation(2), testStation(3)];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      expect(pickStation(stations, [stations[0]!.id])?.id).toBe(stations[2]!.id);
      expect(
        pickStation(
          stations,
          stations.map((s) => s.id),
        ),
      ).toBeNull();
    } finally {
      random.mockRestore();
    }
  });
});
