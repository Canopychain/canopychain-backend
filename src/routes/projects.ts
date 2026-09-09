import type { FastifyInstance } from 'fastify';

import { prisma } from '../db.js';

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', async () => {
    return prisma.project.findMany({
      where: { approved: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
}
