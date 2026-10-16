import { z } from 'zod';
import type { StationDetail } from '@haen/contracts';

const timezones = new Set<string>();
const timezone = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    if (timezones.has(value)) return true;
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
      if (timezones.size < 1024) timezones.add(value);
      return true;
    } catch {
      return false;
    }
  });
export const PlaceSchema = z.object({
  id: z.number().int().positive().max(4294967295),
  name: z.string().min(1).max(255),
  asciiName: z.string().min(1).max(255),
  aliases: z.string().max(8192),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone,
});
export type Place = z.infer<typeof PlaceSchema>;
export const MAX_PLACE_BYTES = 50 * 1024 * 1024;
export function parseGeoNames(text: string): Place[] {
  if (Buffer.byteLength(text) > MAX_PLACE_BYTES) throw new Error('PLACES_FILE_TOO_LARGE');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length || lines.length > 100000) throw new Error('PLACES_INVALID_SIZE');
  const ids = new Set<number>();
  return lines.map((line) => {
    const fields = line.split('\t');
    if (fields.length !== 19 || fields[6] !== 'P') throw new Error('PLACES_INVALID_RECORD');
    const place = PlaceSchema.parse({
      id: Number(fields[0]),
      name: fields[1],
      asciiName: fields[2],
      aliases: fields[3],
      countryCode: fields[8],
      latitude: Number(fields[4]),
      longitude: Number(fields[5]),
      timezone: fields[17],
    });
    if (!fields[4]?.trim() || !fields[5]?.trim() || ids.has(place.id))
      throw new Error('PLACES_INVALID_RECORD');
    ids.add(place.id);
    return place;
  });
}
const rad = Math.PI / 180;
export function distanceKm(
  a: Pick<Place, 'latitude' | 'longitude'>,
  b: Pick<Place, 'latitude' | 'longitude'>,
) {
  const lat = (b.latitude - a.latitude) * rad,
    lon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(lon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
const wrap = (longitude: number) => ((((longitude + 180) % 360) + 360) % 360) - 180;
export function createPlaceEnricher(places: readonly Place[]) {
  const grid = new Map<string, Place[]>();
  const key = (country: string, lat: number, lon: number) => `${country}:${lat}:${lon}`;
  for (const place of places) {
    const cell = key(
      place.countryCode,
      Math.floor(place.latitude),
      Math.floor(wrap(place.longitude)),
    );
    const bucket = grid.get(cell) ?? [];
    bucket.push(place);
    grid.set(cell, bucket);
  }
  return (station: StationDetail): StationDetail => {
    if (
      station.locationPrecision !== 'coordinates' ||
      !station.countryCode ||
      station.latitude === null ||
      station.longitude === null
    )
      return station;
    const point = { latitude: station.latitude, longitude: station.longitude };
    const latitudeRadius = 20 / 110;
    const furthestLatitude = Math.min(90, Math.abs(point.latitude) + latitudeRadius);
    const longitudeRadius =
      furthestLatitude === 90 ? 180 : Math.min(180, 20 / (110 * Math.cos(furthestLatitude * rad)));
    const nearby: { place: Place; distance: number }[] = [];
    const visited = new Set<string>();
    for (
      let lat = Math.floor(Math.max(-90, point.latitude - latitudeRadius));
      lat <= Math.floor(Math.min(90, point.latitude + latitudeRadius));
      lat++
    ) {
      for (
        let lon = Math.floor(point.longitude - longitudeRadius);
        lon <= Math.floor(point.longitude + longitudeRadius);
        lon++
      ) {
        const cell = key(station.countryCode, lat, Math.floor(wrap(lon)));
        if (visited.has(cell)) continue;
        visited.add(cell);
        for (const place of grid.get(cell) ?? []) {
          const distance = distanceKm(point, place);
          if (distance <= 20) nearby.push({ place, distance });
        }
      }
    }
    nearby.sort((a, b) => a.distance - b.distance || a.place.id - b.place.id);
    const nearest = nearby[0];
    if (!nearest) return station;
    // A point near a settlement is not evidence that the station is inside its city boundary.
    const reliableTime =
      nearest.distance <= 0.1 &&
      nearby.every((value) => value.place.timezone === nearest.place.timezone);
    return {
      ...station,
      nearbyCity: station.city ? null : nearest.place.name,
      timezone: reliableTime ? nearest.place.timezone : station.timezone,
      timezoneSource: reliableTime ? 'geonames' : station.timezoneSource,
    };
  };
}
