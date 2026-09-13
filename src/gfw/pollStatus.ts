/**
 * In-memory status for the GFW forest-cover poll worker. With a default
 * six-hour interval, a worker that's been silently failing since startup
 * looks identical from outside the process to one that's simply between
 * runs — this is what the `/gfw/status` route reports to tell the two apart.
 */
export interface GfwPollWorkerStatus {
  running: boolean;
  lastRunStartedAt: Date | null;
  lastRunCompletedAt: Date | null;
  lastRunSucceeded: boolean | null;
  lastError: string | null;
}

const status: GfwPollWorkerStatus = {
  running: false,
  lastRunStartedAt: null,
  lastRunCompletedAt: null,
  lastRunSucceeded: null,
  lastError: null,
};

export function getGfwPollWorkerStatus(): GfwPollWorkerStatus {
  return { ...status };
}

export function markPollWorkerStarted(): void {
  status.running = true;
}

export function markPollWorkerStopped(): void {
  status.running = false;
}

export function markPollRunStarted(): void {
  status.lastRunStartedAt = new Date();
}

export function markPollRunCompleted(err: unknown): void {
  status.lastRunCompletedAt = new Date();
  status.lastRunSucceeded = err === null;
  status.lastError = err === null ? null : err instanceof Error ? err.message : String(err);
}
