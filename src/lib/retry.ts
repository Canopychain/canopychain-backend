export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests; defaults to actually sleeping. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Computes the delay before a retry attempt, using full-jitter exponential
 * backoff — capped at `maxDelayMs` so a flaky dependency can't stall the
 * caller for unbounded time, and randomized so many callers retrying at
 * once (e.g. every project in a poll batch hitting the same rate limit)
 * don't all retry in lockstep.
 *
 * `attempt` is 1-based: the delay before the *second* call overall.
 */
export function backoffDelayMs(
  attempt: number,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  random: () => number = Math.random,
): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  return Math.floor(random() * capped);
}

/**
 * Retries `operation` up to `maxAttempts` times on failure, with
 * full-jitter exponential backoff between attempts. Re-throws the last
 * error once attempts are exhausted.
 *
 * Only safe to use around idempotent operations — a network-level read,
 * or a write whose caller can tell from the result alone whether it
 * already happened. It is deliberately not used around a raw
 * transaction-submission call: retrying that blindly risks double-sending
 * a transaction that actually went through the first time.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) {
        break;
      }
      await sleep(backoffDelayMs(attempt, baseDelayMs, maxDelayMs, random));
    }
  }

  throw lastError;
}
