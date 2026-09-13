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

import { prisma } from './db.js';
import { gfwStatusRoutes } from './routes/gfwStatus.js';
import { projectAdminRoutes } from './routes/projectAdmin.js';
import { projectRegistrationRoutes } from './routes/projectRegistration.js';
import { projectRoutes } from './routes/projects.js';

// pino-pretty runs its formatting on a separate worker thread; spawning
// one per Fastify instance is fine for a single long-running process, but
// the test suite calls buildServer() dozens of times, so it's skipped for
// NODE_ENV=test (which Vitest sets by default) as well as production.
const USE_PRETTY_LOGS = !['production', 'test'].includes(process.env.NODE_ENV ?? '');

export function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Structured JSON otherwise (production: for log aggregation; test:
      // to avoid the worker-thread overhead above) — pino-pretty is a
      // devDependency on purpose, since the production image never needs it.
      transport: USE_PRETTY_LOGS ? { target: 'pino-pretty' } : undefined,
    },
  }).withTypeProvider<ZodTypeProvider>();

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

  return app;
}
