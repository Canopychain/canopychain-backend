/** Two days. A streak is only as good as the observations behind it, so a
 * gap longer than this breaks it — see `evaluateMilestones`. Generous
 * enough to survive a restart or a per-project backoff at the default
 * six-hour poll interval, tight enough that a prolonged outage can't be
 * mistaken for a clean record. */
export const DEFAULT_MAX_OBSERVATION_GAP_SECONDS = 2 * 24 * 60 * 60;

export interface MilestoneDefinition {
  index: number;
  /** Share of baseline forest that must still be standing, in basis points. */
  retentionFloorBps: number;
  /** How long retention must have continuously held at or above the floor. */
  sustainSeconds: number;
  status: 'PENDING' | 'ATTESTED';
}

/** One recorded satellite check: how much of the baseline forest was still
 * standing, and when that was measured. */
export interface RetentionObservation {
  retentionBps: number;
  checkedAt: Date;
}

export interface EvaluateMilestonesInput {
  /** A project's milestone schedule, mirroring milestone-vault's on-chain records. */
  milestones: MilestoneDefinition[];
  /** The project's recorded checks, in any order — sorted internally. */
  observations: RetentionObservation[];
  now?: Date;
  maxObservationGapSeconds?: number;
}

export interface MilestoneProgress {
  milestone: MilestoneDefinition;
  /** Retention at the most recent check, or null if there are none yet. */
  currentRetentionBps: number | null;
  /** Start of the unbroken run of checks at or above the floor, or null. */
  sustainedSince: Date | null;
  sustainedSeconds: number;
  ready: boolean;
}

export interface EvaluateMilestonesResult {
  /** The next pending milestone whose floor has been held long enough, if any. */
  readyToAttest: MilestoneDefinition | null;
  /** Progress toward the next pending milestone, or null when the schedule
   * is complete — exposed so a caller can log or display *why* a milestone
   * is or isn't ready, rather than just the verdict. */
  progress: MilestoneProgress | null;
}

/**
 * Decides whether the next pending milestone in a project's schedule has
 * been earned: whether retention has held at or above its floor,
 * continuously, for at least its sustain period.
 *
 * Two rules do most of the work here:
 *
 * **Milestones are evaluated strictly in order.** Only the lowest-index
 * pending milestone is ever a candidate, because the on-chain vault only
 * advances to the next tranche in its own schedule — there is no way to
 * attest milestone 2 before milestone 1.
 *
 * **A streak is only as good as the observations behind it.** The run is
 * walked backwards from the newest check and broken by either a check
 * below the floor *or* a gap longer than `maxObservationGapSeconds`. That
 * second condition matters more than it looks: without it, a poll worker
 * that was down for a month would come back and claim a month of
 * unobserved compliance, and a project whose checks stopped entirely
 * would keep accruing credit forever. The same check also covers a stale
 * newest observation, since the first gap measured is the one between now
 * and the latest check.
 *
 * The run is credited from the oldest passing check in it, not from before
 * it: retention is only known at the moments it was measured, so the
 * earliest defensible claim is "observed compliant since that check".
 */
export function evaluateMilestones(input: EvaluateMilestonesInput): EvaluateMilestonesResult {
  const now = input.now ?? new Date();
  const maxGapMs =
    (input.maxObservationGapSeconds ?? DEFAULT_MAX_OBSERVATION_GAP_SECONDS) * 1000;

  const nextPending = input.milestones
    .slice()
    .sort((a, b) => a.index - b.index)
    .find((milestone) => milestone.status === 'PENDING');

  if (!nextPending) {
    return { readyToAttest: null, progress: null };
  }

  const newestFirst = input.observations
    .slice()
    .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());

  const currentRetentionBps = newestFirst[0]?.retentionBps ?? null;

  let sustainedSince: Date | null = null;
  let previousTime = now.getTime();
  for (const observation of newestFirst) {
    if (observation.retentionBps < nextPending.retentionFloorBps) {
      break;
    }
    if (previousTime - observation.checkedAt.getTime() > maxGapMs) {
      break;
    }
    sustainedSince = observation.checkedAt;
    previousTime = observation.checkedAt.getTime();
  }

  const sustainedSeconds =
    sustainedSince === null
      ? 0
      : Math.max(0, Math.floor((now.getTime() - sustainedSince.getTime()) / 1000));

  const ready = sustainedSince !== null && sustainedSeconds >= nextPending.sustainSeconds;

  return {
    readyToAttest: ready ? nextPending : null,
    progress: {
      milestone: nextPending,
      currentRetentionBps,
      sustainedSince,
      sustainedSeconds,
      ready,
    },
  };
}
