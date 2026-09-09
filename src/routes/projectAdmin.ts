import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../db.js';
import { requireAdminSignature } from '../middleware/adminAuth.js';

const reviewBodySchema = z.object({
  reviewNote: z.string().max(2000).optional(),
});

// onChainId is a BigInt; Fastify's default JSON.stringify serializer
// throws on BigInt, so it has to go out as a string.
function serializeProject<T extends { onChainId: bigint }>(project: T) {
  return { ...project, onChainId: project.onChainId.toString() };
}

export async function projectAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/pending', { preHandler: requireAdminSignature }, async () => {
    const projects = await prisma.project.findMany({
      where: { approved: false, cancelled: false },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return projects.map(serializeProject);
  });

  // There's no on-chain "reject" — only "approve" — so approving a project
  // means an admin calling milestone-vault's approve_project directly
  // (mirrored back into `approved` by the indexer once that lands, not by
  // this endpoint). Rejecting, on the other hand, has no on-chain
  // counterpart at all: it just marks the project so it drops out of the
  // pending queue and is never sent for on-chain approval in the first
  // place.
  app.post(
    '/projects/:id/reject',
    { preHandler: requireAdminSignature },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = reviewBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
      }

      try {
        const project = await prisma.project.update({
          where: { id },
          data: { cancelled: true, reviewNote: parsed.data.reviewNote },
        });
        return serializeProject(project);
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    },
  );
}
