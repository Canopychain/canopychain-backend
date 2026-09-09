import { afterEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { buildServer } from '../../src/server.js';
import { fakeAddress, resetDb } from '../helpers/db.js';

describe('GET /projects', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('returns only approved projects, newest first', async () => {
    const app = buildServer();

    await prisma.project.create({
      data: { onChainId: 1n, operatorAddress: fakeAddress('A'), name: 'Unapproved', approved: false },
    });
    await prisma.project.create({
      data: { onChainId: 2n, operatorAddress: fakeAddress('B'), name: 'Approved', approved: true },
    });

    const response = await app.inject({ method: 'GET', url: '/projects' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Approved');
    expect(body[0].onChainId).toBe('2'); // serialized as a string, not a raw BigInt

    await app.close();
  });
});

describe('GET /projects/:id', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('404s for an id that does not exist', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/projects/00000000-0000-0000-0000-000000000000',
    });
    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('includes the milestone timeline and summary stats', async () => {
    const app = buildServer();

    const project = await prisma.project.create({
      data: { onChainId: 3n, operatorAddress: fakeAddress('C'), name: 'Impact Plot', approved: true },
    });
    await prisma.milestone.create({
      data: {
        projectId: project.id,
        index: 0,
        thresholdBps: 500,
        payoutBps: 3_000,
        status: 'ATTESTED',
      },
    });
    await prisma.milestone.create({
      data: { projectId: project.id, index: 1, thresholdBps: 1_000, payoutBps: 3_000 },
    });
    const donor = await prisma.donor.create({ data: { address: fakeAddress('D') } });
    await prisma.projectDonation.create({
      data: { projectId: project.id, donorId: donor.id, amount: '500' },
    });

    const response = await app.inject({ method: 'GET', url: `/projects/${project.id}` });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.onChainId).toBe('3');
    expect(body.milestones).toHaveLength(2);
    expect(body.milestones[0].index).toBe(0);
    expect(body.stats.donorCount).toBe(1);
    expect(body.stats.milestonesAttested).toBe(1);
    expect(body.stats.milestonesTotal).toBe(2);

    await app.close();
  });
});
