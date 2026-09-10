import { afterEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { buildServer } from '../../src/server.js';
import { fakeAddress, resetDb } from '../helpers/db.js';

describe('GET /donations', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('400s for a malformed donor address', async () => {
    const app = buildServer();

    const response = await app.inject({ method: 'GET', url: '/donations?donor=not-an-address' });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('returns only the given donor’s donations, newest first, with project info', async () => {
    const app = buildServer();

    const donorAddress = fakeAddress('A');
    const otherDonorAddress = fakeAddress('B');
    const donor = await prisma.donor.create({ data: { address: donorAddress } });
    const otherDonor = await prisma.donor.create({ data: { address: otherDonorAddress } });

    const project = await prisma.project.create({
      data: {
        onChainId: 1n,
        operatorAddress: fakeAddress('C'),
        name: 'Kakamega Forest Restoration',
        approved: true,
        totalDeposited: '900',
      },
    });

    await prisma.projectDonation.create({
      data: { projectId: project.id, donorId: donor.id, amount: '600' },
    });
    await prisma.projectDonation.create({
      data: { projectId: project.id, donorId: otherDonor.id, amount: '300' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/donations?donor=${donorAddress}`,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].amount).toBe('600');
    expect(body[0].project.name).toBe('Kakamega Forest Restoration');
    expect(body[0].project.onChainId).toBe('1'); // serialized as a string, not a raw BigInt

    await app.close();
  });

  it('returns an empty list for a donor with no donations', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: `/donations?donor=${fakeAddress('D')}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);

    await app.close();
  });
});
