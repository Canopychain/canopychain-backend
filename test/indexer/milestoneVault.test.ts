import { afterEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { handleMilestoneVaultEvent } from '../../src/indexer/handlers/milestoneVault.js';
import { fakeAddress, resetDb } from '../helpers/db.js';
import {
  addressScVal,
  i128ScVal,
  makeEvent,
  symbolScVal,
  u32ScVal,
  u64ScVal,
  vecScVal,
} from '../helpers/events.js';

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
      data: { projectId: project.id, index: 0, thresholdBps: 500, payoutBps: 3_000 },
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
      handleMilestoneVaultEvent(makeEvent([symbolScVal('schedule'), u64ScVal(0)], i128ScVal(0))),
    ).resolves.not.toThrow();

    const project = await prisma.project.findUnique({ where: { onChainId: 0n } });
    expect(project).toBeNull();
  });
});
