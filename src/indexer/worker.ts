import { getLatestLedgerSequence, rpcServer } from '../stellar/rpc.js';
import { WATCHED_CONTRACT_IDS } from './contracts.js';

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5000);

type GetEventsResult = Awaited<ReturnType<typeof rpcServer.getEvents>>;
export type ContractEvent = GetEventsResult['events'][number];
export type EventHandler = (event: ContractEvent) => Promise<void>;

// In-memory only for now — replaced with a DB-backed checkpoint in a later
// commit so the indexer can resume across restarts instead of always
// starting from "now".
let lastProcessedLedger: number | undefined;

async function pollOnce(handleEvent: EventHandler): Promise<void> {
  if (WATCHED_CONTRACT_IDS.length === 0) {
    return;
  }

  if (lastProcessedLedger === undefined) {
    lastProcessedLedger = await getLatestLedgerSequence();
    return;
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
    lastProcessedLedger = event.ledger;
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
