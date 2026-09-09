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

  app.get('/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        milestones: { orderBy: { index: 'asc' } },
        donations: { select: { donorId: true } },
      },
    });

    if (!project) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const { donations, ...profile } = project;

    return {
      ...profile,
      stats: {
        donorCount: donations.length,
        milestonesAttested: profile.milestones.filter((m) => m.status === 'ATTESTED').length,
        milestonesTotal: profile.milestones.length,
      },
    };
  });
}
