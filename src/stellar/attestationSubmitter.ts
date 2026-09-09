import {
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  Networks,
  scValToNative,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { withRetry } from '../lib/retry.js';
import { rpcServer } from './rpc.js';

const MILESTONE_VAULT_CONTRACT_ID = process.env.MILESTONE_VAULT_CONTRACT_ID;
const ATTESTOR_SECRET_KEY = process.env.ATTESTOR_SECRET_KEY;
const NETWORK_PASSPHRASE = process.env.SOROBAN_NETWORK_PASSPHRASE ?? Networks.TESTNET;

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 20;

/**
 * Signs and submits an `attest_milestone(project_id)` call on the
 * milestone-vault contract, using the backend's configured attestor key.
 * This is the one place a private key touches the backend — the
 * semi-trusted-attestor design (a backend service computes the milestone
 * condition and a trusted key attests it on-chain) is the accepted MVP
 * tradeoff described in the project's own architecture notes, since
 * Soroban has no mature decentralized oracle network to do this
 * trustlessly today.
 *
 * Returns the tranche payout released by the call, as a decimal string
 * (avoiding precision loss on the contract's i128 values). Throws if the
 * transaction fails or doesn't finalize within a reasonable number of
 * polls.
 */
export async function submitAttestation(projectId: bigint): Promise<string> {
  if (!MILESTONE_VAULT_CONTRACT_ID) {
    throw new Error('MILESTONE_VAULT_CONTRACT_ID is not set');
  }
  if (!ATTESTOR_SECRET_KEY) {
    throw new Error('ATTESTOR_SECRET_KEY is not set');
  }

  const attestorKeypair = Keypair.fromSecret(ATTESTOR_SECRET_KEY);
  const contract = new Contract(MILESTONE_VAULT_CONTRACT_ID);

  // Fetching the account and simulating the call are both read-only — safe
  // to retry on a transient RPC failure with no risk of double-submitting
  // anything.
  const account = await withRetry(() => rpcServer.getAccount(attestorKeypair.publicKey()));

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('attest_milestone', nativeToScVal(projectId, { type: 'u64' })))
    .setTimeout(30)
    .build();

  const prepared = await withRetry(() => rpcServer.prepareTransaction(transaction));
  prepared.sign(attestorKeypair);

  // Deliberately not retried: if the network drops the response after the
  // node has already accepted the transaction, resending would submit a
  // second `attest_milestone` call and double-attest the project. A
  // send-level failure here has to surface to the caller instead.
  const sendResult = await rpcServer.sendTransaction(prepared);
  if (sendResult.status !== 'PENDING') {
    throw new Error(`attest_milestone submission was rejected: ${sendResult.status}`);
  }

  return pollForPayout(sendResult.hash);
}

async function pollForPayout(hash: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    // Checking the status of an already-submitted transaction is
    // read-only, so a transient failure here is always safe to retry.
    const result = await withRetry(() => rpcServer.getTransaction(hash));

    if (result.status === 'SUCCESS') {
      return result.returnValue ? scValToNative(result.returnValue).toString() : '0';
    }

    if (result.status === 'FAILED') {
      throw new Error(`attest_milestone transaction failed: ${hash}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`attest_milestone transaction did not finalize in time: ${hash}`);
}
