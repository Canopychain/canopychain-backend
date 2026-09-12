import { Keypair } from '@stellar/stellar-sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { buildServer } from '../../src/server.js';
import { signAdminRequest } from '../helpers/adminAuth.js';
import { fakeAddress, resetDb } from '../helpers/db.js';

const adminKeypair = Keypair.random();

describe('admin project review', () => {
  beforeAll(() => {
    process.env.ADMIN_ADDRESS = adminKeypair.publicKey();
  });

  afterEach(async () => {
    await resetDb();
  });

  it('rejects an unsigned request with 401', async () => {
    const app = buildServer();

    const response = await app.inject({ method: 'GET', url: '/projects/pending' });
    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('allows a correctly signed admin request', async () => {
    const app = buildServer();
    const headers = signAdminRequest(adminKeypair, 'GET', '/projects/pending');

    const response = await app.inject({ method: 'GET', url: '/projects/pending', headers });
    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('lists only unapproved, non-cancelled projects', async () => {
    const app = buildServer();
    const headers = signAdminRequest(adminKeypair, 'GET', '/projects/pending');

    await prisma.project.create({
      data: { onChainId: 1n, operatorAddress: fakeAddress('A'), name: 'Pending', approved: false },
    });
    await prisma.project.create({
      data: { onChainId: 2n, operatorAddress: fakeAddress('B'), name: 'Approved', approved: true },
    });
    await prisma.project.create({
      data: {
        onChainId: 3n,
        operatorAddress: fakeAddress('C'),
        name: 'Rejected',
        approved: false,
        cancelled: true,
      },
    });

    const response = await app.inject({ method: 'GET', url: '/projects/pending', headers });
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Pending');

    await app.close();
  });

  it('rejects a pending project with a review note', async () => {
    const app = buildServer();

    const project = await prisma.project.create({
      data: { onChainId: 4n, operatorAddress: fakeAddress('D'), name: 'Bad Plot', approved: false },
    });
    const url = `/projects/${project.id}/reject`;
    const headers = signAdminRequest(adminKeypair, 'POST', url);

    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { reviewNote: 'Polygon overlaps a national park.' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().cancelled).toBe(true);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.cancelled).toBe(true);
    expect(stored?.reviewNote).toBe('Polygon overlaps a national park.');

    await app.close();
  });

  it('rejects a correctly signed request whose timestamp is stale', async () => {
    const app = buildServer();
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    const headers = signAdminRequest(adminKeypair, 'GET', '/projects/pending', sixMinutesAgo);

    const response = await app.inject({ method: 'GET', url: '/projects/pending', headers });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('stale_signature');

    await app.close();
  });

  it('rejects a signature for a different URL than the one requested', async () => {
    const app = buildServer();

    const project = await prisma.project.create({
      data: { onChainId: 5n, operatorAddress: fakeAddress('E'), name: 'Plot', approved: false },
    });
    const realUrl = `/projects/${project.id}/reject`;
    // Signed for a *different* project's reject endpoint.
    const headers = signAdminRequest(adminKeypair, 'POST', '/projects/other-id/reject');

    const response = await app.inject({ method: 'POST', url: realUrl, headers, payload: {} });
    expect(response.statusCode).toBe(401);

    await app.close();
  });
});
