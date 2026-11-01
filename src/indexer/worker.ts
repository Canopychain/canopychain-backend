import { logger } from '../logger.js';
import { getLatestLedgerSequence, rpcServer } from '../stellar/rpc.js';
import { getCheckpoint, saveCheckpoint } from './checkpoint.js';
import { WATCHED_CONTRACT_IDS } from './contracts.js';

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5000);

// Ledgers scanned per poll. Well under the RPC's own per-request scan cap
// (10,000 ledgers on the public testnet RPC), so the window passed as
// endLedger is always the window the RPC actually scanned. At ~5s per
// ledger, one poll every 5s catches up a week's backlog in minutes.
export const SCAN_WINDOW_LEDGERS = 1000;
export const MAX_EVENTS_PER_POLL = 1000;

type GetEventsResult = Awaited<ReturnType<typeof rpcServer.getEvents>>;
export type ContractEvent = GetEventsResult['events'][number];
export type EventHandler = (event: ContractEvent) => Promise<void>;

// Cached in memory during the process lifetime so every poll doesn't hit
// the DB just to read the starting point; the source of truth is always
// the `indexer_checkpoints` row. It holds the last ledger fully scanned,
// written after every processed event and again once a window is done.
let lastProcessedLedger: number | undefined;

/** Exported so tests can drive a single poll iteration directly, rather
 * than going through startIndexer's setInterval. */
export async function pollOnce(handleEvent: EventHandler): Promise<void> {
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

  const { oldestLedger, latestLedger } = await rpcServer.getHealth();

  let startLedger = lastProcessedLedger + 1;
  if (startLedger < oldestLedger) {
    // The RPC has already pruned these ledgers, and getEvents rejects a
    // startLedger outside its retention window, so waiting can't help:
    // resume from the oldest ledger it still holds.
    logger.warn(
      { checkpoint: lastProcessedLedger, oldestLedger },
      'indexer checkpoint is older than the RPC retention window; events in the gap were skipped',
    );
    startLedger = oldestLedger;
  }
  if (startLedger > latestLedger) {
    return;
  }

  // endLedger is exclusive.
  const endLedger = Math.min(startLedger + SCAN_WINDOW_LEDGERS, latestLedger + 1);

  const { events } = await rpcServer.getEvents({
    startLedger,
    endLedger,
    limit: MAX_EVENTS_PER_POLL,
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

  if (events.length < MAX_EVENTS_PER_POLL) {
    // Every event in the window was handled, so the whole window is done.
    // Advancing here even when it held no events is what keeps a quiet
    // contract from leaving the checkpoint behind the retention window.
    lastProcessedLedger = endLedger - 1;
    await saveCheckpoint(lastProcessedLedger);
  } else {
    // More events may remain in the window; resume after the last one.
    logger.warn({ startLedger, endLedger }, 'indexer hit its per-poll event limit');
  }
}

/** Starts polling for contract events on an interval. Returns a stop function. */
export function startIndexer(handleEvent: EventHandler): () => void {
  const interval = setInterval(() => {
    pollOnce(handleEvent).catch((err: unknown) => {
      logger.error({ err }, 'indexer poll failed');
    });
  }, POLL_INTERVAL_MS);

  return () => clearInterval(interval);
}
