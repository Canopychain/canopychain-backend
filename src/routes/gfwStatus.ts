import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { getGfwPollWorkerStatus } from '../gfw/pollStatus.js';

const gfwPollStatusSchema = z.object({
  running: z.boolean().describe("Whether the poll worker's interval is currently active."),
  lastRunStartedAt: z.date().nullable().describe('When the most recent pass started, or null if none has yet.'),
  lastRunCompletedAt: z.date().nullable().describe('When the most recent pass finished, or null if none has yet.'),
  lastRunSucceeded: z
    .boolean()
    .nullable()
    .describe('Whether the most recently completed pass finished without an uncaught error.'),
  lastError: z.string().nullable().describe('Error message from the last failed pass, if any.'),
});

export const gfwStatusRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/gfw/status',
    {
      schema: {
        summary: "Get the GFW poll worker's last-run status",
        response: { 200: gfwPollStatusSchema },
      },
    },
    async () => getGfwPollWorkerStatus(),
  );
};
