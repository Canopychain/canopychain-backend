import { startIndexer } from './indexer/worker.js';
import { buildServer } from './server.js';

const port = Number(process.env.PORT ?? 3000);
const app = buildServer();

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

// Handlers for each event type land in upcoming commits; for now this just
// confirms events are actually flowing from the RPC node.
startIndexer(async (event) => {
  app.log.info({ event }, 'received contract event');
});
