import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';

import type { ContractEvent } from '../../src/indexer/worker.js';

export function symbolScVal(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: 'symbol' });
}

export function stringScVal(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: 'string' });
}

export function u32ScVal(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: 'u32' });
}

export function u64ScVal(value: bigint | number): xdr.ScVal {
  return nativeToScVal(value, { type: 'u64' });
}

export function i128ScVal(value: bigint | number): xdr.ScVal {
  return nativeToScVal(value, { type: 'i128' });
}

export function addressScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

/** Builds a tuple/vec ScVal from already-built ScVals — for event data
 * payloads that carry more than one value, like `(amount, total_deposited)`. */
export function vecScVal(items: xdr.ScVal[]): xdr.ScVal {
  return xdr.ScVal.scvVec(items);
}

/** Builds a `Milestone` struct the way the contract encodes one — a map
 * keyed by the Rust field names, with each field's own on-chain type. */
export function milestoneScVal(
  retentionFloorBps: number,
  sustainSeconds: number | bigint,
  payoutBps: number,
): xdr.ScVal {
  return nativeToScVal(
    {
      retention_floor_bps: retentionFloorBps,
      sustain_seconds: BigInt(sustainSeconds),
      payout_bps: payoutBps,
    },
    {
      type: {
        retention_floor_bps: ['symbol', 'u32'],
        sustain_seconds: ['symbol', 'u64'],
        payout_bps: ['symbol', 'u32'],
      },
    },
  );
}

/**
 * Builds just enough of a getEvents() response entry to exercise the
 * indexer handlers: they only ever read `.topic` and `.value`. `topic` and
 * `value` are built from real ScVal constructors (not plain JS objects),
 * so these tests catch actual encode/decode mismatches rather than just
 * confirming a mock behaves the way we assumed it would.
 */
export function makeEvent(topic: xdr.ScVal[], value: xdr.ScVal): ContractEvent {
  return {
    id: '0000000001-0000000000',
    type: 'contract',
    ledger: 100,
    ledgerClosedAt: new Date().toISOString(),
    contractId: 'CTESTCONTRACTID',
    topic,
    value,
    inSuccessfulContractCall: true,
  } as unknown as ContractEvent;
}
