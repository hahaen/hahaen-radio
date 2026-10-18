import { describe, expect, it } from 'vitest';
import { normalizeStation, publicHttpsUrl } from './normalize.js';
const station = {
  stationuuid: '00000000-0000-4000-8000-000000000001',
  name: 'Jazz & News',
  countrycode: 'gb',
  tags: 'Jazz,Blues,Jazz',
  language: 'English',
  bitrate: 128,
  lastcheckok: 1,
  url: 'https://radio.example/live',
  url_resolved: 'https://radio.example/live#player',
  geo_lat: 0,
  geo_long: 0,
};
describe('directory normalization', () => {
  it('preserves stable identities, real zero coordinates and deduplicated streams', () => {
    const value = normalizeStation(station);
    expect(value).toMatchObject({
      id: station.stationuuid,
      countryCode: 'GB',
      latitude: 0,
      longitude: 0,
      locationPrecision: 'coordinates',
      genre: 'jazz',
      languages: ['en'],
      availability: 'available',
      city: null,
      timezone: null,
    });
    expect(value?.streams).toHaveLength(1);
    expect(value?.tags).toEqual(['jazz', 'blues']);
  });
  it('does not invent a city, time zone or partial coordinate pair', () => {
    expect(normalizeStation({ ...station, geo_lat: '', geo_long: 3, bitrate: 0 })).toMatchObject({
      latitude: null,
      longitude: null,
      locationPrecision: 'country',
      city: null,
      nearbyCity: null,
      timezone: null,
      bitrate: null,
    });
  });
  it('retains unavailable stations without turning insecure or credential-bearing URLs into streams', () => {
    const value = normalizeStation({
      ...station,
      url: 'http://radio.example/live',
      url_resolved: 'https://private:secret@radio.example/live',
    });
    expect(value?.availability).toBe('unavailable');
    expect(value?.streams).toEqual([]);
    expect(publicHttpsUrl('https://localhost/live')).toBeNull();
    expect(publicHttpsUrl('https://service.local/live')).toBeNull();
  });
  it('rejects invalid identity and empty names and keeps a failed upstream check unavailable', () => {
    expect(normalizeStation({ ...station, stationuuid: 'untrusted-id' })).toBeNull();
    expect(normalizeStation({ ...station, name: '\u0000' })).toBeNull();
    expect(normalizeStation({ ...station, lastcheckok: 0 })?.availability).toBe('unavailable');
  });
});

it('uses language codes and useful labels together without retaining malformed vocabulary', () => {
  expect(
    normalizeStation({
      ...station,
      languagecodes: 'eng,123',
      language: 'English,French,rock,https://radio.example',
    })?.languages,
  ).toEqual(['en', 'fr']);
});
it.each([
  ['chillout', 'electronic'],
  ['oldies', 'pop'],
  ['bossa nova', 'jazz'],
  ['salsa', 'world'],
  ['unclassified', 'general'],
])('classifies the explicit tag %s as %s', (tags, genre) => {
  expect(normalizeStation({ ...station, tags })?.genre).toBe(genre);
});
