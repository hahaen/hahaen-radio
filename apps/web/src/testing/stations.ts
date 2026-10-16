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
