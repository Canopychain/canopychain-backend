import { StrKey } from '@stellar/stellar-sdk';

import { prisma } from '../../src/db.js';

/** Truncates every table. Call between tests so fixtures never leak across them. */
export async function resetDb(): Promise<void> {
  await prisma.forestCoverSnapshot.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.projectDonation.deleteMany();
  await prisma.project.deleteMany();
  await prisma.donor.deleteMany();
  await prisma.indexerCheckpoint.deleteMany();
}

/**
 * A real, checksum-valid Stellar G-address derived deterministically from
 * `distinguishingChar`, so distinct fixtures get distinct addresses. It has
 * to be properly encoded rather than a repeated character: the SDK's
 * Address parser validates the checksum and rejects anything else.
 */
export function fakeAddress(distinguishingChar: string): string {
  const seed = Buffer.alloc(32, distinguishingChar.toUpperCase().charCodeAt(0));
  return StrKey.encodeEd25519PublicKey(seed);
}
