import { pino } from 'pino';

// pino-pretty runs its formatting on a separate worker thread; that's fine
// for a single long-running process but wasteful under the test suite, so
// it's skipped for NODE_ENV=test (which Vitest sets by default) as well as
// production, where structured JSON is what log aggregation wants anyway.
const USE_PRETTY_LOGS = !['production', 'test'].includes(process.env.NODE_ENV ?? '');

/**
 * The process-wide logger. Fastify is handed this same instance in
 * `buildServer`, so request logs and the background workers' logs share one
 * configuration and one output stream — the alternative was the poll worker
 * and indexer writing to `console` and silently ignoring `LOG_LEVEL`, which
 * is exactly backwards for the components nobody is watching live.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: USE_PRETTY_LOGS ? { target: 'pino-pretty' } : undefined,
});
