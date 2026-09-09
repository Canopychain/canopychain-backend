import { afterEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { handleProjectRegistryEvent } from '../../src/indexer/handlers/projectRegistry.js';
import { fakeAddress, resetDb } from '../helpers/db.js';
import { addressScVal, makeEvent, stringScVal, symbolScVal, u64ScVal, vecScVal } from '../helpers/events.js';

describe('handleProjectRegistryEvent', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('creates an unapproved project on a register event', async () => {
    const operator = fakeAddress('A');

    await handleProjectRegistryEvent(
      makeEvent(
        [symbolScVal('register'), u64ScVal(0)],
        vecScVal([addressScVal(operator), stringScVal('Kakamega Forest Restoration')]),
      ),
    );

    const project = await prisma.project.findUnique({ where: { onChainId: 0n } });
    expect(project?.name).toBe('Kakamega Forest Restoration');
    expect(project?.operatorAddress).toBe(operator);
    expect(project?.approved).toBe(false);
  });

  it('marks an existing project approved on an approved event', async () => {
    const operator = fakeAddress('B');
    await prisma.project.create({
      data: { onChainId: 1n, operatorAddress: operator, name: 'Plot' },
    });

    await handleProjectRegistryEvent(
      makeEvent([symbolScVal('approved'), u64ScVal(1)], stringScVal('')),
    );

    const project = await prisma.project.findUnique({ where: { onChainId: 1n } });
    expect(project?.approved).toBe(true);
  });

  it('is a no-op for an approved event with no matching project', async () => {
    // Should not throw even though no project row exists for this id —
    // updateMany (not update) is exactly for this case.
    await expect(
      handleProjectRegistryEvent(makeEvent([symbolScVal('approved'), u64ScVal(999)], stringScVal(''))),
    ).resolves.not.toThrow();

    const project = await prisma.project.findUnique({ where: { onChainId: 999n } });
    expect(project).toBeNull();
  });
});
