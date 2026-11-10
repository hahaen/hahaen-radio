import { z } from 'zod';

export const genre = z.enum([
  'general',
  'pop',
  'news',
  'rock',
  'electronic',
  'world',
  'religious',
  'classical',
  'jazz',
  'folk',
  'hiphop',
]);

export const stationEntry = z.tuple([
  z.uuid(),
  z.string().min(1).max(512),
  z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  z.string().max(255).nullable(),
  z.string().max(255).nullable(),
  z.string().max(255).nullable(),
  z.number().min(-90).max(90).nullable(),
  z.number().min(-180).max(180).nullable(),
  z.enum(['coordinates', 'country', 'unknown']),
  genre,
  z.array(z.string().min(1).max(64)).max(32),
  z.number().int().min(1).max(10000).nullable(),
  z.enum(['available', 'unavailable', 'blocked', 'unknown']),
]);

export const snapshotSchema = z
  .strictObject({
    format: z.literal(1),
    version: z.uuid(),
    restrictionsRevision: z.string().regex(/^[a-f\d]{64}$/),
    exportedAt: z.iso.datetime(),
    stationCount: z.number().int().positive().max(200000),
    stations: z.array(stationEntry).min(1).max(200000),
  })
  .refine(
    ({ stationCount, stations }) =>
      stationCount === stations.length && new Set(stations.map(([id]) => id)).size === stationCount,
    '目录条数或电台 ID 不一致',
  );

export const streamIndexSchema = z.array(
  z.strictObject({
    stationId: z.uuid(),
    endpoint: z.string().regex(/^station-[a-f\d-]{36}$/),
    candidate: z.boolean(),
  }),
);
