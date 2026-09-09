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
 * A syntactically valid-looking (not checksum-valid) Stellar G-address —
 * matches the `^G[A-Z2-7]{55}$` shape a real address takes, without
 * needing a real keypair. `distinguishingChar` must be one letter (A-Z) so
 * distinct fixtures produce distinct addresses.
 */
export function fakeAddress(distinguishingChar: string): string {
  return `G${distinguishingChar.toUpperCase().repeat(55)}`;
}
