import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '../db.js';

// onChainId is a BigInt; the response schemas below type it as a string
// (Prisma's BigInt has no JSON representation of its own), so it has to be
// converted before the zod serializer sees it.
function serializeProject<T extends { onChainId: bigint; polygonGeoJson: unknown }>(
  project: T,
) {
  return {
    ...project,
    onChainId: project.onChainId.toString(),
    // prisma types a Json? column as any json value, including scalars, but
    // registration validates this as a geojson geometry before it's stored.
    polygonGeoJson: project.polygonGeoJson as Record<string, unknown> | null,
  };
}

export const projectSchema = z.object({
  id: z.string(),
  onChainId: z.string().describe('The on-chain project id, shared by project-registry and milestone-vault.'),
  operatorAddress: z.string(),
  recipientAddress: z.string().nullable(),
  attestorAddress: z.string().nullable(),
  name: z.string(),
  polygonGeoJson: z.record(z.string(), z.any()).nullable(),
  polygonHash: z.string().nullable(),
  approved: z.boolean(),
  cancelled: z.boolean(),
  reviewNote: z.string().nullable(),
  totalDeposited: z.string().describe('i128 decimal string, mirrored from milestone-vault.'),
  totalReleased: z.string().describe('i128 decimal string, mirrored from milestone-vault.'),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const milestoneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  index: z.number().int(),
  thresholdBps: z.number().int(),
  payoutBps: z.number().int(),
  status: z.enum(['PENDING', 'ATTESTED']),
  attestedAt: z.date().nullable(),
  payoutAmount: z.string().nullable(),
  createdAt: z.date(),
});

const projectDetailSchema = projectSchema.extend({
  milestones: z.array(milestoneSchema),
  stats: z.object({
    donorCount: z.number().int(),
    milestonesAttested: z.number().int(),
    milestonesTotal: z.number().int(),
  }),
});

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/projects',
    {
      schema: {
        summary: 'List approved projects',
        querystring: z.object({
          name: z.string().optional().describe('Case-insensitive substring match on project name.'),
        }),
        response: { 200: z.array(projectSchema) },
      },
    },
    async (request) => {
      const { name } = request.query;

      const projects = await prisma.project.findMany({
        where: {
          approved: true,
          ...(name ? { name: { contains: name, mode: 'insensitive' as const } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      return projects.map(serializeProject);
    },
  );

  app.get(
    '/projects/:id',
    {
      schema: {
        summary: 'Get a project, with donation/milestone stats',
        params: z.object({ id: z.string() }),
        response: {
          200: projectDetailSchema,
          404: z.object({ error: z.literal('not_found') }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

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
    },
  );
};
