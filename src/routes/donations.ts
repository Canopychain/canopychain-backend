import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../db.js';

const querySchema = z.object({
  // Stellar StrKey ed25519 public key: 'G' + 55 base32 (A-Z2-7) chars.
  donor: z
    .string()
    .regex(/^G[A-Z2-7]{55}$/),
});

// onChainId is a BigInt; Fastify's default JSON.stringify serializer
// throws on BigInt, so it has to go out as a string.
function serializeDonation<
  T extends { project: { onChainId: bigint } & Record<string, unknown> },
>(donation: T) {
  return {
    ...donation,
    project: { ...donation.project, onChainId: donation.project.onChainId.toString() },
  };
}

export async function donationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/donations', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const donations = await prisma.projectDonation.findMany({
      where: { donor: { address: parsed.data.donor } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        project: {
          select: {
            id: true,
            onChainId: true,
            name: true,
            approved: true,
            cancelled: true,
            totalDeposited: true,
            totalReleased: true,
          },
        },
      },
    });

    return donations.map(serializeDonation);
  });
}
