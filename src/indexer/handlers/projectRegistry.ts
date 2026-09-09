import { scValToNative } from '@stellar/stellar-sdk';

import { prisma } from '../../db.js';
import type { ContractEvent } from '../worker.js';

/**
 * Handles both `register` and `approved` events from the project-registry
 * contract. `register` mirrors the project's on-chain id, operator, and
 * name into the database — the event carries only those three fields, not
 * the recipient/attestor addresses or the polygon, which arrive later
 * through the operator's project-registration intake endpoint and get
 * attached to this same row by `onChainId`. `approved` flips the row's
 * approved flag.
 */
export async function handleProjectRegistryEvent(event: ContractEvent): Promise<void> {
  const [topicSymbol, projectIdVal] = event.topic;
  const topic = scValToNative(topicSymbol) as string;
  const onChainId = BigInt(scValToNative(projectIdVal) as number | bigint | string);

  if (topic === 'register') {
    const [operatorVal, nameVal] = scValToNative(event.value) as [unknown, string];
    const operatorAddress = String(operatorVal);

    await prisma.project.upsert({
      where: { onChainId },
      create: { onChainId, operatorAddress, name: nameVal, approved: false },
      update: { operatorAddress, name: nameVal },
    });
    return;
  }

  if (topic === 'approved') {
    // updateMany (not update) so a stray "approved" seen without a prior
    // "register" — e.g. the indexer started mid-history — doesn't throw.
    await prisma.project.updateMany({
      where: { onChainId },
      data: { approved: true },
    });
  }
}
