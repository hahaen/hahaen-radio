import { encodeSceneEntry } from '@haen/contracts';
import type { StationDetail } from '@haen/contracts';
export function testStation(index: number): StationDetail {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `Test radio ${index}`,
    countryCode: 'GB',
    region: null,
    city: null,
    nearbyCity: null,
    latitude: null,
    longitude: null,
    locationPrecision: 'country',
    timezone: null,
    timezoneSource: null,
    genre: 'jazz',
    tags: ['jazz'],
    languages: ['en'],
    bitrate: 128,
    availability: 'available',
    homepage: null,
    streams: [
      {
        id: String(index).padStart(24, '0'),
        url: `https://media.example/${index}.mp3`,
        codec: 'MP3',
        bitrate: 128,
        hls: false,
        analysis: 'unknown',
      },
    ],
  };
}

export function testScene(stations: StationDetail[]) {
  const manifest = {
    format: 1 as const,
    version: '90000000-0000-4000-8000-000000000001',
    restrictionsRevision: 'a'.repeat(64),
    createdAt: '2026-10-17T00:00:00.000Z',
    stationCount: stations.length,
    playableCount: stations.filter((station) => station.availability === 'available').length,
    countryCount: new Set(stations.map((station) => station.countryCode).filter(Boolean)).size,
    genres: [],
    languages: [],
    chunks: [{ index: 0, count: stations.length }],
  };
  const chunk = {
    format: 1 as const,
    version: manifest.version,
    index: 0,
    restrictionsRevision: manifest.restrictionsRevision,
    entries: stations.map(encodeSceneEntry),
  };
  return { manifest, chunk };
}
