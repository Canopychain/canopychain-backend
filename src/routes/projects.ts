import type { FastifyInstance } from 'fastify';

import { prisma } from '../db.js';

// onChainId is a BigInt; Fastify's default JSON.stringify serializer (no
// response schema is defined yet) throws on BigInt, so it has to go out
// as a string.
function serializeProject<T extends { onChainId: bigint }>(project: T) {
  return { ...project, onChainId: project.onChainId.toString() };
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', async (request) => {
    const { name } = request.query as { name?: string };

    const projects = await prisma.project.findMany({
      where: {
        approved: true,
        ...(name ? { name: { contains: name, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return projects.map(serializeProject);
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
      ...serializeProject(profile),
      stats: {
        donorCount: donations.length,
        milestonesAttested: profile.milestones.filter((m) => m.status === 'ATTESTED').length,
        milestonesTotal: profile.milestones.length,
      },
    };
  });
}
