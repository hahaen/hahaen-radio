import {
  MAX_SCENE_STATIONS,
  SceneEntrySchema,
  SceneManifestSchema,
  StationSummarySchema,
} from '@haen/contracts';
import { z } from 'zod';

export const snapshotSchema = z
  .strictObject({
    manifest: SceneManifestSchema.strict(),
    exportedAt: z.iso.datetime(),
    stations: z.array(SceneEntrySchema).min(1).max(MAX_SCENE_STATIONS),
    timezones: z.record(z.uuid(), StationSummarySchema.shape.timezone.unwrap()),
  })
  .refine(
    ({ manifest, stations }) =>
      manifest.stationCount === stations.length &&
      new Set(stations.map(([id]) => id)).size === stations.length,
    '目录条数或电台 ID 不一致',
  );

export const streamIndexSchema = z.array(
  z.strictObject({
    stationId: z.uuid(),
    endpoint: z.string().regex(/^station-[a-f\d-]{36}$/),
    candidate: z.boolean(),
  }),
);
