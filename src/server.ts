import Fastify from 'fastify';

import { prisma } from './db.js';
import { projectAdminRoutes } from './routes/projectAdmin.js';
import { projectRegistrationRoutes } from './routes/projectRegistration.js';
import { projectRoutes } from './routes/projects.js';

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  app.register(projectRoutes);
  app.register(projectRegistrationRoutes);
  app.register(projectAdminRoutes);

  return app;
}
