import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '../db.js';
import { getOnChainProject } from '../stellar/projectRegistry.js';

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
          'Called by the operator right after their on-chain register() transaction ' +
          "confirms — the on-chain event only carries the project's id, operator, and " +
          'name, so the recipient/attestor addresses and polygon are attached here instead. ' +
          "Every field is checked against the project's project-registry entry, and the " +
          'polygon must hash to its on-chain polygon_hash; anything else is rejected with 422.',
        body: registrationSchema,
      },
    },
    async (request, reply) => {
      const { onChainId, ...details } = request.body;

      // Unauthenticated by design (the operator's wallet already signed the
      // on-chain register), so nothing here is trusted on its own: every
      // field must match what the registry recorded for this project.
      let onChain;
      try {
        onChain = await getOnChainProject(BigInt(onChainId));
      } catch (err) {
        request.log.error({ err, onChainId }, 'failed to read project from project-registry');
        return reply.code(502).send({ error: 'registry_unavailable' });
      }
      if (!onChain) {
        return reply.code(404).send({ error: 'project_not_found' });
      }

      // Same construction as the frontend's hashPolygon: SHA-256 over
      // JSON.stringify of the { type, coordinates } geometry.
      const geometryHash = createHash('sha256')
        .update(JSON.stringify(details.polygonGeoJson))
        .digest('hex');

      if (
        details.recipientAddress !== onChain.recipient ||
        details.attestorAddress !== onChain.attestor ||
        details.polygonHash.toLowerCase() !== onChain.polygonHash ||
        geometryHash !== onChain.polygonHash
      ) {
        return reply.code(422).send({ error: 'details_do_not_match_registry' });
      }

      // The indexer's project-registry "register" handler may not have
      // processed the on-chain event yet — this request can arrive first,
      // right after the operator's own register() transaction confirms —
      // so the row is created here from the registry entry if needed.
      const project = await prisma.project.upsert({
        where: { onChainId: BigInt(onChainId) },
        create: {
          onChainId: BigInt(onChainId),
          operatorAddress: onChain.operator,
          name: onChain.name,
          ...details,
          polygonHash: onChain.polygonHash,
        },
        update: { ...details, polygonHash: onChain.polygonHash },
      });

      // onChainId is a BigInt; Fastify's default JSON.stringify serializer
      // throws on BigInt, so it has to go out as a string.
      return reply.code(201).send({ ...project, onChainId: project.onChainId.toString() });
    },
  );
};
