import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  Networks,
  scValToNative,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { Api } from '@stellar/stellar-sdk/rpc';

import { PROJECT_REGISTRY_CONTRACT_ID } from '../indexer/contracts.js';
import { withRetry } from '../lib/retry.js';
import { rpcServer } from './rpc.js';

const NETWORK_PASSPHRASE = process.env.SOROBAN_NETWORK_PASSPHRASE ?? Networks.TESTNET;

// project-registry's `ProjectNotFound` error code (see its README).
const PROJECT_NOT_FOUND = 'Error(Contract, #3)';

/** A project as project-registry stores it on-chain. */
export interface OnChainProject {
  operator: string;
  recipient: string;
  attestor: string;
  /** Hex-encoded SHA-256 of the project's polygon GeoJSON. */
  polygonHash: string;
  name: string;
  approved: boolean;
}

/**
 * Reads a project's registry entry by simulating `get_project`. Simulation
 * is read-only and never submitted, so the source account is a throwaway
 * keypair rather than one that has to exist or hold funds.
 *
 * Returns null if the registry has no project under `projectId`; throws on
 * any other failure, including the RPC being unreachable.
 */
export async function getOnChainProject(projectId: bigint): Promise<OnChainProject | null> {
  if (!PROJECT_REGISTRY_CONTRACT_ID) {
    throw new Error('PROJECT_REGISTRY_CONTRACT_ID is not set');
  }

  const source = new Account(Keypair.random().publicKey(), '0');
  const transaction = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(PROJECT_REGISTRY_CONTRACT_ID).call(
        'get_project',
        nativeToScVal(projectId, { type: 'u64' }),
      ),
    )
    .setTimeout(30)
    .build();

  const simulation = await withRetry(() => rpcServer.simulateTransaction(transaction));

  if (Api.isSimulationError(simulation)) {
    if (simulation.error.includes(PROJECT_NOT_FOUND)) {
      return null;
    }
    throw new Error(`get_project simulation failed: ${simulation.error}`);
  }
  if (!simulation.result) {
    throw new Error('get_project simulation returned no result');
  }

  const project = scValToNative(simulation.result.retval) as {
    operator: string;
    recipient: string;
    attestor: string;
    polygon_hash: Buffer;
    name: string;
    approved: boolean;
  };

  return {
    operator: project.operator,
    recipient: project.recipient,
    attestor: project.attestor,
    polygonHash: Buffer.from(project.polygon_hash).toString('hex'),
    name: project.name,
    approved: project.approved,
  };
}
