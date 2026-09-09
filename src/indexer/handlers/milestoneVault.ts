import { scValToNative } from '@stellar/stellar-sdk';

import { prisma } from '../../db.js';
import type { ContractEvent } from '../worker.js';

async function ensureDonor(address: string) {
  return prisma.donor.upsert({
    where: { address },
    create: { address },
    update: {},
  });
}

async function ensureProject(onChainId: bigint) {
  return prisma.project.upsert({
    where: { onChainId },
    // A deposit can arrive before the matching project-registry "register"
    // event has been processed — e.g. the indexer started mid-history.
    // Placeholder name until (if) a "register" event fills in the real
    // one; `update: {}` makes sure we never clobber it once it does.
    create: { onChainId, operatorAddress: '', name: `Project ${onChainId}` },
    update: {},
  });
}

/**
 * Deposit's payload carries the call's own amount plus the vault's new
 * running total, so `totalDeposited` is set directly from the event. The
 * per-donor total isn't in the payload the same way — only this one
 * deposit's amount is — so it's accumulated by reading the donor's prior
 * total and adding to it, the same read-modify-write shape donation-vault's
 * withdraw/cancel handlers use for fields the event doesn't fully determine.
 */
async function handleDeposit(event: ContractEvent): Promise<void> {
  const [, projectIdVal, donorVal] = event.topic;
  const onChainId = scValToNative(projectIdVal) as bigint;
  const donorAddress = (scValToNative(donorVal) as { toString(): string }).toString();

  const [amountVal, totalDepositedVal] = scValToNative(event.value) as [bigint, bigint];

  const [donor, project] = await Promise.all([
    ensureDonor(donorAddress),
    ensureProject(onChainId),
  ]);

  const existingDonation = await prisma.projectDonation.findUnique({
    where: { projectId_donorId: { projectId: project.id, donorId: donor.id } },
  });
  const newDonationTotal = (existingDonation ? BigInt(existingDonation.amount) : 0n) + amountVal;

  await prisma.$transaction([
    prisma.projectDonation.upsert({
      where: { projectId_donorId: { projectId: project.id, donorId: donor.id } },
      create: { projectId: project.id, donorId: donor.id, amount: newDonationTotal.toString() },
      update: { amount: newDonationTotal.toString() },
    }),
    prisma.project.update({
      where: { id: project.id },
      data: { totalDeposited: totalDepositedVal.toString() },
    }),
  ]);
}

/**
 * Attested's payload is just the tranche payout, so — like withdraw on
 * donation-vault — `totalReleased` is accumulated rather than set
 * outright. `milestonesCompleted` in the topic is the new count after
 * this attestation, so the milestone that was just attested is at
 * `milestonesCompleted - 1`.
 */
async function handleAttested(event: ContractEvent): Promise<void> {
  const [, projectIdVal, milestonesCompletedVal] = event.topic;
  const onChainId = scValToNative(projectIdVal) as bigint;
  const milestonesCompleted = scValToNative(milestonesCompletedVal) as number;
  const payout = scValToNative(event.value) as bigint;

  const project = await prisma.project.findUnique({ where: { onChainId } });
  if (!project) return;

  const attestedIndex = milestonesCompleted - 1;

  await prisma.$transaction([
    prisma.milestone.updateMany({
      where: { projectId: project.id, index: attestedIndex },
      data: { status: 'ATTESTED', attestedAt: new Date(), payoutAmount: payout.toString() },
    }),
    prisma.project.update({
      where: { id: project.id },
      data: { totalReleased: (BigInt(project.totalReleased) + payout).toString() },
    }),
  ]);
}

export async function handleMilestoneVaultEvent(event: ContractEvent): Promise<void> {
  const [topicSymbol] = event.topic;
  const topic = scValToNative(topicSymbol) as string;

  switch (topic) {
    case 'deposit':
      await handleDeposit(event);
      break;
    case 'attested':
      await handleAttested(event);
      break;
    default:
      // schedule, pause, unpause, attestor, cancelled, refund —
      // deliberately unhandled for now: none of them are needed for the
      // donor-facing explorer or milestone timeline yet.
      break;
  }
}
