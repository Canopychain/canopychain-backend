import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '../db.js';

const polygonGeometrySchema = z.object({
  type: z.enum(['Polygon', 'MultiPolygon']),
  coordinates: z.array(z.any()),
});

const registrationSchema = z.object({
  onChainId: z.string().regex(/^\d+$/, 'must be a numeric project id'),
  recipientAddress: z.string().min(1),
  attestorAddress: z.string().min(1),
  polygonHash: z.string().min(1),
  polygonGeoJson: polygonGeometrySchema,
});

export const projectRegistrationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/projects/register',
    {
      schema: {
        summary: 'Attach off-chain registration details to a project',
        description:
          "Called by the operator right after their on-chain register() transaction " +
          "confirms — the on-chain event only carries the project's id, operator, and " +
          'name, so the recipient/attestor addresses and polygon are attached here instead.',
        body: registrationSchema,
      },
    },
    async (request, reply) => {
      const { onChainId, ...details } = request.body;

      // The indexer's project-registry "register" handler may not have
      // processed the on-chain event yet — this request can arrive first,
      // right after the operator's own register() transaction confirms.
      // `name` is a placeholder in that case, replaced once the event lands
      // (or already has, if it beat this request here).
      const project = await prisma.project.upsert({
        where: { onChainId: BigInt(onChainId) },
        create: {
          onChainId: BigInt(onChainId),
          operatorAddress: '',
          name: `Project ${onChainId}`,
          ...details,
        },
        update: details,
      });

      // onChainId is a BigInt; Fastify's default JSON.stringify serializer
      // throws on BigInt, so it has to go out as a string.
      return reply.code(201).send({ ...project, onChainId: project.onChainId.toString() });
    },
  );
};
