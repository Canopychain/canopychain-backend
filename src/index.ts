// Must be the first import: every other module (transitively, db.ts) reads
// process.env at module-load time, so the environment has to be populated
// before anything else is imported.
import 'dotenv/config';

import { dispatchEvent } from './indexer/dispatch.js';
import { startIndexer } from './indexer/worker.js';
import { buildServer } from './server.js';

const port = Number(process.env.PORT ?? 3000);
const app = buildServer();

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

// Left unwrapped so a handler failure propagates: worker.ts's own catch
// logs it and, crucially, leaves the checkpoint unadvanced so the failed
// event gets retried on the next poll instead of silently skipped.
startIndexer(dispatchEvent);
