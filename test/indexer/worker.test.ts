import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../src/db.js';
import { resetDb } from '../helpers/db.js';

const getLatestLedgerSequence = vi.fn();
const getEvents = vi.fn();
const getHealth = vi.fn();

vi.mock('../../src/stellar/rpc.js', () => ({
  getLatestLedgerSequence: (...args: unknown[]) => getLatestLedgerSequence(...args),
  rpcServer: {
    getEvents: (...args: unknown[]) => getEvents(...args),
    getHealth: (...args: unknown[]) => getHealth(...args),
  },
}));

async function savedCheckpoint(): Promise<number | undefined> {
  const row = await prisma.indexerCheckpoint.findUnique({ where: { id: 'main' } });
  return row?.lastLedger;
}

describe('indexer checkpoint resume', () => {
  beforeEach(() => {
    vi.resetModules();
    getLatestLedgerSequence.mockReset();
    getEvents.mockReset();
    getHealth.mockReset();
    getHealth.mockResolvedValue({ oldestLedger: 100, latestLedger: 2000 });
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
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 501, endLedger: 1501 }),
    );
  });

  it('saves the checkpoint after each event rather than once per batch', async () => {
    await prisma.indexerCheckpoint.create({ data: { id: 'main', lastLedger: 500 } });
    const events = [{ ledger: 501 }, { ledger: 502 }];
    getEvents.mockResolvedValue({ events });
    getHealth.mockResolvedValue({ oldestLedger: 100, latestLedger: 502 });

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

  it('advances the checkpoint through a window with no events', async () => {
    await prisma.indexerCheckpoint.create({ data: { id: 'main', lastLedger: 500 } });
    getEvents.mockResolvedValue({ events: [] });
    const { pollOnce } = await import('../../src/indexer/worker.js');

    await pollOnce(vi.fn());

    expect(await savedCheckpoint()).toBe(1500);
  });

  it('never scans past the latest ledger', async () => {
    await prisma.indexerCheckpoint.create({ data: { id: 'main', lastLedger: 500 } });
    getHealth.mockResolvedValue({ oldestLedger: 100, latestLedger: 700 });
    getEvents.mockResolvedValue({ events: [] });
    const { pollOnce } = await import('../../src/indexer/worker.js');

    await pollOnce(vi.fn());

    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 501, endLedger: 701 }),
    );
    expect(await savedCheckpoint()).toBe(700);
  });

  it('does nothing once caught up with the latest ledger', async () => {
    await prisma.indexerCheckpoint.create({ data: { id: 'main', lastLedger: 2000 } });
    const { pollOnce } = await import('../../src/indexer/worker.js');

    await pollOnce(vi.fn());

    expect(getEvents).not.toHaveBeenCalled();
    expect(await savedCheckpoint()).toBe(2000);
  });

  it('resumes from the oldest retained ledger when the checkpoint has been pruned', async () => {
    await prisma.indexerCheckpoint.create({ data: { id: 'main', lastLedger: 500 } });
    getHealth.mockResolvedValue({ oldestLedger: 900, latestLedger: 5000 });
    getEvents.mockResolvedValue({ events: [] });
    const { pollOnce } = await import('../../src/indexer/worker.js');

    await pollOnce(vi.fn());

    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 900, endLedger: 1900 }),
    );
    expect(await savedCheckpoint()).toBe(1899);
  });

  it('stops at the last handled event when a poll hits the event limit', async () => {
    await prisma.indexerCheckpoint.create({ data: { id: 'main', lastLedger: 500 } });
    const { MAX_EVENTS_PER_POLL, pollOnce } = await import('../../src/indexer/worker.js');
    const events = Array.from({ length: MAX_EVENTS_PER_POLL }, () => ({ ledger: 600 }));
    getEvents.mockResolvedValue({ events });

    await pollOnce(vi.fn());

    expect(await savedCheckpoint()).toBe(600);
  });
});
