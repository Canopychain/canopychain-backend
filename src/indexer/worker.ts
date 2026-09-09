import { getLatestLedgerSequence, rpcServer } from '../stellar/rpc.js';
import { getCheckpoint, saveCheckpoint } from './checkpoint.js';
import { WATCHED_CONTRACT_IDS } from './contracts.js';

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5000);

type GetEventsResult = Awaited<ReturnType<typeof rpcServer.getEvents>>;
export type ContractEvent = GetEventsResult['events'][number];
export type EventHandler = (event: ContractEvent) => Promise<void>;

// Cached in memory during the process lifetime so every poll doesn't hit
// the DB just to read the starting point; the source of truth is always
// the `indexer_checkpoints` row, written after every processed event.
let lastProcessedLedger: number | undefined;

async function pollOnce(handleEvent: EventHandler): Promise<void> {
  if (WATCHED_CONTRACT_IDS.length === 0) {
    return;
  }

  if (lastProcessedLedger === undefined) {
    const saved = await getCheckpoint();
    if (saved !== undefined) {
      lastProcessedLedger = saved;
    } else {
      // Never run before: start from "now" rather than backfilling the
      // contract's entire history.
      lastProcessedLedger = await getLatestLedgerSequence();
      await saveCheckpoint(lastProcessedLedger);
      return;
    }
  }

  const { events } = await rpcServer.getEvents({
    startLedger: lastProcessedLedger + 1,
    filters: [
      {
        type: 'contract',
        contractIds: WATCHED_CONTRACT_IDS,
      },
    ],
  });

  for (const event of events) {
    await handleEvent(event);
    // Saved per-event, not once per batch: several handlers apply relative
    // deltas (balance -= accrued, etc.), so replaying an already-applied
    // event after a crash would double-count it. Checkpointing after each
    // one bounds the damage to "at most the in-flight event" on a crash.
    lastProcessedLedger = event.ledger;
    await saveCheckpoint(lastProcessedLedger);
  }
}

/** Starts polling for contract events on an interval. Returns a stop function. */
export function startIndexer(handleEvent: EventHandler): () => void {
  const interval = setInterval(() => {
    pollOnce(handleEvent).catch((err: unknown) => {
      console.error('indexer poll failed', err);
    });
  }, POLL_INTERVAL_MS);

  return () => clearInterval(interval);
}
