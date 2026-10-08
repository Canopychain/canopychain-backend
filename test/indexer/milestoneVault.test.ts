import { afterEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { handleMilestoneVaultEvent } from '../../src/indexer/handlers/milestoneVault.js';
import { fakeAddress, resetDb } from '../helpers/db.js';
import {
  addressScVal,
  i128ScVal,
  makeEvent,
  milestoneScVal,
  symbolScVal,
  u32ScVal,
  u64ScVal,
  vecScVal,
} from '../helpers/events.js';

const DAY = 24 * 60 * 60;

describe('handleMilestoneVaultEvent', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('creates a placeholder project, donor, and donation on a first deposit', async () => {
    const donor = fakeAddress('D');

    await handleMilestoneVaultEvent(
      makeEvent(
        [symbolScVal('deposit'), u64ScVal(0), addressScVal(donor)],
        vecScVal([i128ScVal(600), i128ScVal(600)]),
      ),
    );

    const project = await prisma.project.findUnique({ where: { onChainId: 0n } });
    expect(project?.totalDeposited).toBe('600');

    const donorRow = await prisma.donor.findUnique({ where: { address: donor } });
    expect(donorRow).not.toBeNull();

    const donation = await prisma.projectDonation.findUnique({
      where: { projectId_donorId: { projectId: project!.id, donorId: donorRow!.id } },
    });
    expect(donation?.amount).toBe('600');
  });

  it('accumulates a donor total across multiple deposits', async () => {
    const donor = fakeAddress('E');

    await handleMilestoneVaultEvent(
      makeEvent(
        [symbolScVal('deposit'), u64ScVal(1), addressScVal(donor)],
        vecScVal([i128ScVal(400), i128ScVal(400)]),
      ),
    );
    await handleMilestoneVaultEvent(
      makeEvent(
        [symbolScVal('deposit'), u64ScVal(1), addressScVal(donor)],
        vecScVal([i128ScVal(200), i128ScVal(600)]),
      ),
    );

    const project = await prisma.project.findUnique({ where: { onChainId: 1n } });
    const donorRow = await prisma.donor.findUnique({ where: { address: donor } });
    const donation = await prisma.projectDonation.findUnique({
      where: { projectId_donorId: { projectId: project!.id, donorId: donorRow!.id } },
    });

    expect(project?.totalDeposited).toBe('600');
    expect(donation?.amount).toBe('600');
  });

  it('marks the attested milestone and accumulates totalReleased on an attested event', async () => {
    const project = await prisma.project.create({
      data: {
        onChainId: 2n,
        operatorAddress: fakeAddress('F'),
        name: 'Plot',
        totalReleased: '0',
      },
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

    await handleMilestoneVaultEvent(
      makeEvent([symbolScVal('attested'), u64ScVal(2), u32ScVal(1)], i128ScVal(300)),
    );

    const milestone = await prisma.milestone.findUnique({
      where: { projectId_index: { projectId: project.id, index: 0 } },
    });
    expect(milestone?.status).toBe('ATTESTED');
    expect(milestone?.payoutAmount).toBe('300');

    const updatedProject = await prisma.project.findUnique({ where: { id: project.id } });
    expect(updatedProject?.totalReleased).toBe('300');
  });

  it('is a no-op for an attested event with no matching project', async () => {
    await expect(
      handleMilestoneVaultEvent(
        makeEvent([symbolScVal('attested'), u64ScVal(999), u32ScVal(1)], i128ScVal(300)),
      ),
    ).resolves.not.toThrow();
  });

  it('ignores event topics it does not handle', async () => {
    await expect(
      handleMilestoneVaultEvent(makeEvent([symbolScVal('pause'), u64ScVal(0)], i128ScVal(0))),
    ).resolves.not.toThrow();

    const project = await prisma.project.findUnique({ where: { onChainId: 0n } });
    expect(project).toBeNull();
  });

  it('creates milestone rows from a schedule event', async () => {
    const project = await prisma.project.create({
      data: { onChainId: 5n, operatorAddress: fakeAddress('G'), name: 'Scheduled Plot' },
    });

    await handleMilestoneVaultEvent(
      makeEvent(
        [symbolScVal('schedule'), u64ScVal(5)],
        vecScVal([
          milestoneScVal(9_900, 90 * DAY, 3_000),
          milestoneScVal(10_000, 180 * DAY, 7_000),
        ]),
      ),
    );

    const rows = await prisma.milestone.findMany({
      where: { projectId: project.id },
      orderBy: { index: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      index: 0,
      retentionFloorBps: 9_900,
      sustainSeconds: 90 * DAY,
      payoutBps: 3_000,
      status: 'PENDING',
    });
    expect(rows[1]).toMatchObject({
      index: 1,
      retentionFloorBps: 10_000,
      sustainSeconds: 180 * DAY,
      payoutBps: 7_000,
    });
  });

  it('replaces an earlier schedule rather than duplicating it', async () => {
    const project = await prisma.project.create({
      data: { onChainId: 6n, operatorAddress: fakeAddress('H'), name: 'Replanned Plot' },
    });

    const scheduleEvent = (milestones: ReturnType<typeof milestoneScVal>[]) =>
      handleMilestoneVaultEvent(
        makeEvent([symbolScVal('schedule'), u64ScVal(6)], vecScVal(milestones)),
      );

    await scheduleEvent([
      milestoneScVal(9_900, 90 * DAY, 5_000),
      milestoneScVal(9_900, 180 * DAY, 5_000),
    ]);
    // The contract allows reconfiguring until the first deposit, including
    // to a shorter schedule — the rows should match the latest one exactly.
    await scheduleEvent([milestoneScVal(9_500, 30 * DAY, 10_000)]);

    const rows = await prisma.milestone.findMany({ where: { projectId: project.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ retentionFloorBps: 9_500, sustainSeconds: 30 * DAY });
  });

  it('leaves an already-attested schedule alone', async () => {
    const project = await prisma.project.create({
      data: { onChainId: 7n, operatorAddress: fakeAddress('I'), name: 'Running Plot' },
    });
    await prisma.milestone.create({
      data: {
        projectId: project.id,
        index: 0,
        retentionFloorBps: 9_900,
        sustainSeconds: 90 * DAY,
        payoutBps: 10_000,
        status: 'ATTESTED',
      },
    });

    await handleMilestoneVaultEvent(
      makeEvent(
        [symbolScVal('schedule'), u64ScVal(7)],
        vecScVal([milestoneScVal(1, 1, 10_000)]),
      ),
    );

    const rows = await prisma.milestone.findMany({ where: { projectId: project.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ retentionFloorBps: 9_900, status: 'ATTESTED' });
  });

  it('creates a placeholder project when the schedule arrives before the register event', async () => {
    await handleMilestoneVaultEvent(
      makeEvent(
        [symbolScVal('schedule'), u64ScVal(8)],
        vecScVal([milestoneScVal(9_900, 90 * DAY, 10_000)]),
      ),
    );

    const project = await prisma.project.findUnique({ where: { onChainId: 8n } });
    expect(project).not.toBeNull();
    expect(await prisma.milestone.count({ where: { projectId: project!.id } })).toBe(1);
  });
});
