import { z } from 'zod';
import { CatalogManifestSchema, StationSummarySchema } from './catalog.js';

export const MAX_SCENE_STATIONS = 200000;

export const StationPreviewSchema = StationSummarySchema.omit({
  tags: true,
  timezone: true,
  timezoneSource: true,
});
export type StationPreview = z.infer<typeof StationPreviewSchema>;
const fields = StationPreviewSchema.shape;
// Tuple order is versioned by the scene endpoint; optional detail fields are fetched by ID.
export const SceneEntrySchema = z.tuple([
  fields.id,
  fields.name,
  fields.countryCode,
  fields.region,
  fields.city,
  fields.nearbyCity,
  fields.latitude,
  fields.longitude,
  fields.locationPrecision,
  fields.genre,
  fields.languages,
  fields.bitrate,
  fields.availability,
]);
export type SceneEntry = z.infer<typeof SceneEntrySchema>;
export const SceneManifestSchema = CatalogManifestSchema.extend({
  format: z.literal(1),
  restrictionsRevision: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SceneManifest = z.infer<typeof SceneManifestSchema>;
export const SceneChunkSchema = z.object({
  format: z.literal(1),
  version: z.uuid(),
  index: z.number().int().nonnegative(),
  restrictionsRevision: z.string().regex(/^[a-f0-9]{64}$/),
  entries: z.array(SceneEntrySchema).max(1000),
});
export type SceneChunk = z.infer<typeof SceneChunkSchema>;
export function encodeSceneEntry(station: StationPreview): SceneEntry {
  return [
    station.id,
    station.name,
    station.countryCode,
    station.region,
    station.city,
    station.nearbyCity,
    station.latitude,
    station.longitude,
    station.locationPrecision,
    station.genre,
    station.languages,
    station.bitrate,
    station.availability,
  ];
}
export function decodeSceneEntry(entry: SceneEntry): StationPreview {
  const [
    id,
    name,
    countryCode,
    region,
    city,
    nearbyCity,
    latitude,
    longitude,
    locationPrecision,
    genre,
    languages,
    bitrate,
    availability,
  ] = entry;
  return {
    id,
    name,
    countryCode,
    region,
    city,
    nearbyCity,
    latitude,
    longitude,
    locationPrecision,
    genre,
    languages,
    bitrate,
    availability,
  };
}
