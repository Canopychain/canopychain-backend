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

  it('filters by a case-insensitive, partial match on name', async () => {
    const app = buildServer();

    await prisma.project.create({
      data: { onChainId: 10n, operatorAddress: fakeAddress('E'), name: 'Amazon Reforestation', approved: true },
    });
    await prisma.project.create({
      data: { onChainId: 11n, operatorAddress: fakeAddress('F'), name: 'Congo Basin Watch', approved: true },
    });

    const response = await app.inject({ method: 'GET', url: '/projects?name=amazon' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Amazon Reforestation');

    await app.close();
  });

  it('excludes unapproved projects from a name-filtered search', async () => {
    const app = buildServer();

    await prisma.project.create({
      data: { onChainId: 12n, operatorAddress: fakeAddress('G'), name: 'Amazon Basin', approved: false },
    });

    const response = await app.inject({ method: 'GET', url: '/projects?name=amazon' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(0);

    await app.close();
  });

  it('returns an empty list when no project name matches', async () => {
    const app = buildServer();

    await prisma.project.create({
      data: { onChainId: 13n, operatorAddress: fakeAddress('H'), name: 'Amazon Basin', approved: true },
    });

    const response = await app.inject({ method: 'GET', url: '/projects?name=nonexistent' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(0);

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
        retentionFloorBps: 9_900,
        sustainSeconds: 90 * 24 * 60 * 60,
        payoutBps: 3_000,
        status: 'ATTESTED',
      },
    });
    await prisma.milestone.create({
      data: {
        projectId: project.id,
        index: 1,
        retentionFloorBps: 9_900,
        sustainSeconds: 180 * 24 * 60 * 60,
        payoutBps: 3_000,
      },
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

    // Milestone 0 is already attested, so progress points at milestone 1 —
    // and reports nothing measured against it yet rather than a zero that
    // would read as "0% standing".
    expect(body.nextMilestoneProgress).toEqual({
      index: 1,
      retentionFloorBps: 9_900,
      requiredSeconds: 180 * 24 * 60 * 60,
      currentRetentionBps: null,
      sustainedSeconds: 0,
      ready: false,
    });

    await app.close();
  });

  it('reports the run of checks behind the next pending milestone', async () => {
    const app = buildServer();

    const project = await prisma.project.create({
      data: { onChainId: 4n, operatorAddress: fakeAddress('G'), name: 'Holding Plot', approved: true },
    });
    await prisma.milestone.create({
      data: {
        projectId: project.id,
        index: 0,
        retentionFloorBps: 9_900,
        sustainSeconds: 90 * 24 * 60 * 60,
        payoutBps: 3_000,
      },
    });

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.forestCoverSnapshot.createMany({
      data: [
        { projectId: project.id, checkedAt: yesterday, forestCoverPct: 61, retentionBps: 9_920, changeBps: 0 },
        { projectId: project.id, checkedAt: hourAgo, forestCoverPct: 62, retentionBps: 9_950, changeBps: 30 },
      ],
    });

    const response = await app.inject({ method: 'GET', url: `/projects/${project.id}` });
    expect(response.statusCode).toBe(200);

    const { nextMilestoneProgress } = response.json();
    expect(nextMilestoneProgress.index).toBe(0);
    expect(nextMilestoneProgress.currentRetentionBps).toBe(9_950); // the newest check, not an average
    // Credited from the oldest check in the unbroken run, so roughly the
    // 25 hours since it — not the hour since the newest one.
    expect(nextMilestoneProgress.sustainedSeconds).toBeGreaterThan(24 * 60 * 60);
    expect(nextMilestoneProgress.sustainedSeconds).toBeLessThan(26 * 60 * 60);
    expect(nextMilestoneProgress.ready).toBe(false); // 25 hours is nowhere near 90 days

    await app.close();
  });

  it('restarts the clock once a check falls below the floor', async () => {
    const app = buildServer();

    const project = await prisma.project.create({
      data: { onChainId: 5n, operatorAddress: fakeAddress('H'), name: 'Cleared Plot', approved: true },
    });
    await prisma.milestone.create({
      data: {
        projectId: project.id,
        index: 0,
        retentionFloorBps: 9_900,
        sustainSeconds: 90 * 24 * 60 * 60,
        payoutBps: 3_000,
      },
    });
    await prisma.forestCoverSnapshot.createMany({
      data: [
        {
          projectId: project.id,
          checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
          forestCoverPct: 62,
          retentionBps: 9_950,
          changeBps: 0,
        },
        {
          projectId: project.id,
          checkedAt: new Date(Date.now() - 60 * 60 * 1000),
          forestCoverPct: 50,
          retentionBps: 8_000,
          changeBps: -1_200,
        },
      ],
    });

    const response = await app.inject({ method: 'GET', url: `/projects/${project.id}` });
    const { nextMilestoneProgress } = response.json();

    // The earlier compliant check doesn't survive the drop: a streak is
    // only the unbroken run ending at the newest observation.
    expect(nextMilestoneProgress.currentRetentionBps).toBe(8_000);
    expect(nextMilestoneProgress.sustainedSeconds).toBe(0);
    expect(nextMilestoneProgress.ready).toBe(false);

    await app.close();
  });

  it('omits progress once every milestone is attested', async () => {
    const app = buildServer();

    const project = await prisma.project.create({
      data: { onChainId: 6n, operatorAddress: fakeAddress('I'), name: 'Finished Plot', approved: true },
    });
    await prisma.milestone.create({
      data: {
        projectId: project.id,
        index: 0,
        retentionFloorBps: 9_900,
        sustainSeconds: 90 * 24 * 60 * 60,
        payoutBps: 10_000,
        status: 'ATTESTED',
      },
    });

    const response = await app.inject({ method: 'GET', url: `/projects/${project.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().nextMilestoneProgress).toBeNull();

    await app.close();
  });
});
