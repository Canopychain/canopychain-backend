import fastifyCors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { isAllowedOrigin } from './cors.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { gfwStatusRoutes } from './routes/gfwStatus.js';
import { donationRoutes } from './routes/donations.js';
import { projectAdminRoutes } from './routes/projectAdmin.js';
import { projectRegistrationRoutes } from './routes/projectRegistration.js';
import { projectRoutes } from './routes/projects.js';

export function buildServer() {
  // Shares the process-wide logger (see logger.ts) rather than building a
  // per-instance one: the test suite calls buildServer() dozens of times,
  // and each own-logger instance would spawn its own pino-pretty worker
  // thread. Passed as `loggerInstance`, not `logger` — the latter is for
  // a plain pino *options* object that Fastify builds its own logger
  // from; handing it an already-built instance there throws
  // FST_ERR_LOG_INVALID_LOGGER_CONFIG.
  const app = Fastify({ loggerInstance: logger }).withTypeProvider<ZodTypeProvider>();

  // Route schemas below are Zod schemas, not plain JSON Schema — these two
  // compilers are what let Fastify validate/serialize against them, and
  // are also what @fastify/swagger reads (via jsonSchemaTransform) to turn
  // those same schemas into the OpenAPI description served at /docs/json.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Route-schema validation failures land here instead of each handler
  // formatting its own 400 — this is what keeps the error body shape
  // (`{ error, details }`) the same as it was under the old hand-rolled
  // `zodSchema.safeParse()` checks now that the schema itself rejects
  // the request before the handler runs.
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      reply.code(400).send({ error: 'invalid_request', details: error.validation });
      return;
    }
    reply.send(error);
  });

  // Registered before every route plugin below, so every response —
  // including admin/registration POSTs — carries the right headers. No
  // origin at all (a server-to-server call, or curl) is allowed through
  // unconditionally; this only gates requests a *browser* sends with an
  // Origin header, which is exactly who CORS exists to restrict.
  app.register(fastifyCors, {
    origin: (origin, callback) => {
      callback(null, origin === undefined || isAllowedOrigin(origin));
    },
  });

  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Canopychain API',
        description:
          'REST API for Canopychain: donor-facing project browsing plus the operator ' +
          'registration and admin-review intake that back the on-chain project-registry ' +
          'and milestone-vault contracts.',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });
  app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  app.register(projectRoutes);
  app.register(projectRegistrationRoutes);
  app.register(projectAdminRoutes);
  app.register(gfwStatusRoutes);
  app.register(donationRoutes);

  return app;
}
