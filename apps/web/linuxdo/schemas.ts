import {
  MAX_SCENE_STATIONS,
  SceneEntrySchema,
  SceneManifestSchema,
  StationSummarySchema,
  type SceneEntry,
} from '@haen/contracts';
import { z } from 'zod';

const snapshotHeader = z.strictObject({
  manifest: SceneManifestSchema.strict(),
  exportedAt: z.iso.datetime(),
  timezones: z.record(z.uuid(), StationSummarySchema.shape.timezone.unwrap()),
});

export const snapshotSchema = snapshotHeader
  .extend({
    stations: z.array(SceneEntrySchema).min(1).max(MAX_SCENE_STATIONS),
  })
  .refine(
    ({ manifest, stations }) =>
      manifest.stationCount === stations.length &&
      new Set(stations.map(([id]) => id)).size === stations.length,
    '目录条数或电台 ID 不一致',
  );

const packedSnapshotSchema = snapshotHeader
  .extend({
    layout: z.literal('columns-v1'),
    columns: z.array(z.array(z.unknown())).length(13),
    order: z.array(z.number().int().nonnegative()).min(1).max(MAX_SCENE_STATIONS),
  })
  .refine(
    ({ columns, order, manifest }) =>
      order.length === manifest.stationCount &&
      columns.every((column) => column.length === order.length) &&
      order.every((index) => index < order.length) &&
      new Set(order).size === order.length,
    '包内目录的列长度或原始顺序不一致',
  );

type Snapshot = z.infer<typeof snapshotSchema>;

// Group similar names and locations before writing each field as a separate column.
function compareStations(a: SceneEntry, b: SceneEntry) {
  for (const field of [2, 3, 4, 5, 1] as const) {
    const left = a[field] ?? '';
    const right = b[field] ?? '';
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}

export function packSnapshot({ stations, ...metadata }: Snapshot) {
  const order = stations.map((_, index) => index);
  order.sort((a, b) => compareStations(stations[a]!, stations[b]!));
  const columns = stations[0]!.map((_, field) => order.map((index) => stations[index]![field]));
  return { ...metadata, layout: 'columns-v1', columns, order };
}

export function unpackSnapshot(input: unknown): Snapshot {
  const { manifest, exportedAt, timezones, columns, order } = packedSnapshotSchema.parse(input);
  const stations = new Array<unknown[]>(order.length);
  for (const [row, index] of order.entries()) {
    stations[index] = columns.map((column) => column[row]);
  }
  return snapshotSchema.parse({ manifest, exportedAt, timezones, stations });
}

export const streamIndexSchema = z.array(
  z.strictObject({
    stationId: z.uuid(),
    endpoint: z.string().regex(/^station-[a-f\d-]{36}$/),
    candidate: z.boolean(),
  }),
);
