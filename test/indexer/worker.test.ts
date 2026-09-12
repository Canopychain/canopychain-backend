import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../src/db.js';
import { resetDb } from '../helpers/db.js';

const getLatestLedgerSequence = vi.fn();
const getEvents = vi.fn();

vi.mock('../../src/stellar/rpc.js', () => ({
  getLatestLedgerSequence: (...args: unknown[]) => getLatestLedgerSequence(...args),
  rpcServer: { getEvents: (...args: unknown[]) => getEvents(...args) },
}));

describe('indexer checkpoint resume', () => {
  beforeEach(() => {
    vi.resetModules();
    getLatestLedgerSequence.mockReset();
    getEvents.mockReset();
    process.env.PROJECT_REGISTRY_CONTRACT_ID = 'CONTRACT_A';
  });

  afterEach(async () => {
    delete process.env.PROJECT_REGISTRY_CONTRACT_ID;
    await resetDb();
  });

  it('on a first run with no saved checkpoint, seeds it at the current ledger without processing events', async () => {
    getLatestLedgerSequence.mockResolvedValue(1000);
    const handleEvent = vi.fn();
    const { pollOnce } = await import('../../src/indexer/worker.js');

    await pollOnce(handleEvent);

    expect(getEvents).not.toHaveBeenCalled();
    expect(handleEvent).not.toHaveBeenCalled();

    const row = await prisma.indexerCheckpoint.findUnique({ where: { id: 'main' } });
    expect(row?.lastLedger).toBe(1000);
  });

  it('resumes from a saved checkpoint instead of the latest ledger', async () => {
    await prisma.indexerCheckpoint.create({ data: { id: 'main', lastLedger: 500 } });
    getEvents.mockResolvedValue({ events: [] });
    const handleEvent = vi.fn();
    const { pollOnce } = await import('../../src/indexer/worker.js');

    await pollOnce(handleEvent);

    expect(getLatestLedgerSequence).not.toHaveBeenCalled();
    expect(getEvents).toHaveBeenCalledWith(expect.objectContaining({ startLedger: 501 }));
  });

  it('saves the checkpoint after each event rather than once per batch', async () => {
    await prisma.indexerCheckpoint.create({ data: { id: 'main', lastLedger: 500 } });
    const events = [{ ledger: 501 }, { ledger: 502 }];
    getEvents.mockResolvedValue({ events });

    const checkpointsSeenDuringHandling: (number | undefined)[] = [];
    const handleEvent = vi.fn(async () => {
      const row = await prisma.indexerCheckpoint.findUnique({ where: { id: 'main' } });
      checkpointsSeenDuringHandling.push(row?.lastLedger);
    });
    const { pollOnce } = await import('../../src/indexer/worker.js');

    await pollOnce(handleEvent);

    // While handling event N, the checkpoint still points at N-1's ledger
    // (or the starting point) — proof a mid-batch crash would only ever
    // redo the in-flight event, not the whole batch.
    expect(checkpointsSeenDuringHandling).toEqual([500, 501]);

    const row = await prisma.indexerCheckpoint.findUnique({ where: { id: 'main' } });
    expect(row?.lastLedger).toBe(502);
  });
});
