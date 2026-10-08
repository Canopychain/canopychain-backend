import { scValToNative } from '@stellar/stellar-sdk';

import { prisma } from '../../db.js';
import { logger } from '../../logger.js';
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

/** A milestone as it decodes out of the contract's event payload: a
 * `contracttype` struct keeps its Rust field names, and `u64` arrives as a
 * bigint while `u32` arrives as a number. */
type EmittedMilestone = {
  retention_floor_bps: number;
  sustain_seconds: bigint;
  payout_bps: number;
};

/**
 * The schedule event carries every tranche, so the milestone rows are built
 * from it directly rather than read back from the contract.
 *
 * Replacing the existing rows wholesale is safe because the contract only
 * allows reconfiguring a schedule while the project has no vault, a vault
 * only exists once someone has deposited, and attesting pays out of that
 * vault — so a second schedule event cannot arrive after an attestation.
 * The attested-row guard below is belt and braces against a replayed or
 * out-of-order event rather than something the contract permits.
 */
async function handleSchedule(event: ContractEvent): Promise<void> {
  const [, projectIdVal] = event.topic;
  const onChainId = scValToNative(projectIdVal) as bigint;
  const emitted = scValToNative(event.value) as EmittedMilestone[];

  const project = await ensureProject(onChainId);

  const attestedCount = await prisma.milestone.count({
    where: { projectId: project.id, status: 'ATTESTED' },
  });
  if (attestedCount > 0) {
    logger.warn(
      { projectId: project.id, onChainId: onChainId.toString() },
      'ignoring a schedule event for a project that already has attested milestones',
    );
    return;
  }

  const milestones = emitted.map((milestone, index) => {
    // sustain_seconds is u64 on-chain and Int in the database — 2^31
    // seconds is ~68 years, so rejecting is the honest response to a value
    // past it rather than truncating into a schedule that looks achievable
    // and isn't. See the schema comment on Milestone.sustainSeconds.
    if (milestone.sustain_seconds > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `schedule for project ${onChainId} has a sustain period beyond the supported range`,
      );
    }

    return {
      projectId: project.id,
      index,
      retentionFloorBps: milestone.retention_floor_bps,
      sustainSeconds: Number(milestone.sustain_seconds),
      payoutBps: milestone.payout_bps,
    };
  });

  await prisma.$transaction([
    prisma.milestone.deleteMany({ where: { projectId: project.id } }),
    prisma.milestone.createMany({ data: milestones }),
  ]);
}

export async function handleMilestoneVaultEvent(event: ContractEvent): Promise<void> {
  const [topicSymbol] = event.topic;
  const topic = scValToNative(topicSymbol) as string;

  switch (topic) {
    case 'deposit':
      await handleDeposit(event);
      break;
    case 'schedule':
      await handleSchedule(event);
      break;
    case 'attested':
      await handleAttested(event);
      break;
    default:
      // pause, unpause, attestor, cancelled, refund — still unhandled;
      // tracked as their own issues.
      break;
  }
}
