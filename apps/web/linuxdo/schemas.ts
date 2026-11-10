import { z } from 'zod';

export const streamIndexSchema = z.array(
  z.strictObject({
    stationId: z.uuid(),
    catalogUrl: z.url({ protocol: /^https$/ }),
    endpoint: z.string().regex(/^station-[a-f\d-]{36}$/),
    candidate: z.boolean(),
  }),
);
