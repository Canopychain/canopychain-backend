import type { FastifyReply, FastifyRequest } from 'fastify';

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

/**
 * Temporary stopgap gate for admin-only routes: a shared-secret header.
 * Replaced with real wallet-signature verification in the next commit —
 * this exists only so admin routes are never merged with no gate at all
 * in front of them, even for one commit.
 */
export async function requireAdminApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!ADMIN_API_KEY) {
    reply.code(503).send({ error: 'admin_auth_not_configured' });
    return;
  }

  if (request.headers['x-admin-api-key'] !== ADMIN_API_KEY) {
    reply.code(401).send({ error: 'unauthorized' });
  }
}
