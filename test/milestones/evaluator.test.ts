import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_OBSERVATION_GAP_SECONDS,
  evaluateMilestones,
  type MilestoneDefinition,
  type RetentionObservation,
} from '../../src/milestones/evaluator.js';

const DAY = 24 * 60 * 60;
const NOW = new Date('2026-06-01T00:00:00Z');

/** Hold 99% of baseline forest, proven over 90 then 180 days. */
function schedule(): MilestoneDefinition[] {
  return [
    { index: 0, retentionFloorBps: 9_900, sustainSeconds: 90 * DAY, status: 'PENDING' },
    { index: 1, retentionFloorBps: 9_900, sustainSeconds: 180 * DAY, status: 'PENDING' },
  ];
}

/** An observation `daysAgo` before NOW. */
function observation(daysAgo: number, retentionBps: number): RetentionObservation {
  return {
    retentionBps,
    checkedAt: new Date(NOW.getTime() - daysAgo * DAY * 1000),
  };
}

/** A clean daily run of checks at `retentionBps`, oldest `fromDaysAgo` back. */
function dailyRun(fromDaysAgo: number, retentionBps: number): RetentionObservation[] {
  return Array.from({ length: fromDaysAgo + 1 }, (_, i) => observation(fromDaysAgo - i, retentionBps));
}

function evaluate(
  observations: RetentionObservation[],
  milestones: MilestoneDefinition[] = schedule(),
) {
  return evaluateMilestones({ milestones, observations, now: NOW });
}

describe('evaluateMilestones', () => {
  it('is not ready with no observations at all', () => {
    const result = evaluate([]);
    expect(result.readyToAttest).toBeNull();
    expect(result.progress?.sustainedSeconds).toBe(0);
    expect(result.progress?.currentRetentionBps).toBeNull();
  });

  it('is not ready while retention sits below the floor', () => {
    const result = evaluate(dailyRun(120, 9_800));
    expect(result.readyToAttest).toBeNull();
    expect(result.progress?.currentRetentionBps).toBe(9_800);
    expect(result.progress?.sustainedSeconds).toBe(0);
  });

  it('is ready once the floor has been held for the sustain period', () => {
    const result = evaluate(dailyRun(120, 9_950));
    expect(result.readyToAttest?.index).toBe(0);
    expect(result.progress?.sustainedSeconds).toBe(120 * DAY);
  });

  it('is not ready when the floor is held but not yet long enough', () => {
    const result = evaluate(dailyRun(60, 9_950));
    expect(result.readyToAttest).toBeNull();
    expect(result.progress?.sustainedSeconds).toBe(60 * DAY);
    expect(result.progress?.ready).toBe(false);
  });

  it('treats retention exactly at the floor as holding', () => {
    const result = evaluate(dailyRun(120, 9_900));
    expect(result.readyToAttest?.index).toBe(0);
  });

  it('is ready when the sustain period is met exactly', () => {
    const result = evaluate(dailyRun(90, 9_950));
    expect(result.progress?.sustainedSeconds).toBe(90 * DAY);
    expect(result.readyToAttest?.index).toBe(0);
  });

  it('credits the run from its oldest passing check, not from before it', () => {
    // Nothing is known about the plot before the first check, so the
    // earliest defensible claim is "compliant since then".
    const result = evaluate(dailyRun(100, 9_950));
    expect(result.progress?.sustainedSince).toEqual(observation(100, 9_950).checkedAt);
  });

  it('resets the run when a check breaches the floor', () => {
    // 120 days of compliance, but a breach 10 days ago.
    const observations = [...dailyRun(120, 9_950), observation(10, 9_700)];
    const result = evaluate(observations);
    expect(result.readyToAttest).toBeNull();
  });

  it('counts only from recovery after a breach', () => {
    const observations = [
      ...dailyRun(200, 9_950).filter((o) => o.checkedAt < observation(30, 0).checkedAt),
      observation(30, 9_600), // breach
      ...Array.from({ length: 30 }, (_, i) => observation(29 - i, 9_950)),
    ];
    const result = evaluate(observations);
    // Only ~29 days since recovery, so milestone 0 (90 days) isn't earned.
    expect(result.readyToAttest).toBeNull();
    expect(result.progress?.sustainedSeconds).toBe(29 * DAY);
  });

  it('breaks the run when observations stop, rather than accruing unobserved credit', () => {
    // A long clean run that ended well over the gap tolerance ago — a poll
    // worker that died shouldn't keep earning the project credit.
    const stale = dailyRun(200, 9_950).filter(
      (o) => o.checkedAt.getTime() <= NOW.getTime() - 30 * DAY * 1000,
    );
    const result = evaluate(stale);
    expect(result.readyToAttest).toBeNull();
    expect(result.progress?.sustainedSeconds).toBe(0);
    // The value is still reported, so a caller can say why it didn't count.
    expect(result.progress?.currentRetentionBps).toBe(9_950);
  });

  it('breaks the run across an interior observation gap', () => {
    // Compliant 200→100 days ago and 20→0 days ago, with an 80-day hole in
    // the middle that nobody observed.
    const observations = [...dailyRun(200, 9_950).slice(0, 101), ...dailyRun(20, 9_950)];
    const result = evaluate(observations);
    expect(result.readyToAttest).toBeNull();
    expect(result.progress?.sustainedSeconds).toBe(20 * DAY);
  });

  it('tolerates gaps within the configured allowance', () => {
    // Checks every two days for 120 days — sparse, but within tolerance.
    const observations = Array.from({ length: 61 }, (_, i) => observation(i * 2, 9_950));
    const result = evaluateMilestones({
      milestones: schedule(),
      observations,
      now: NOW,
      maxObservationGapSeconds: DEFAULT_MAX_OBSERVATION_GAP_SECONDS,
    });
    expect(result.readyToAttest?.index).toBe(0);
  });

  it('only ever surfaces the lowest-index pending milestone', () => {
    // 200 days of compliance clears both milestones' sustain periods, but
    // the vault can only advance one tranche at a time.
    const result = evaluate(dailyRun(200, 9_950));
    expect(result.readyToAttest?.index).toBe(0);
  });

  it('moves on to the next milestone once the earlier one is attested', () => {
    const milestones = schedule();
    milestones[0].status = 'ATTESTED';
    const result = evaluate(dailyRun(200, 9_950), milestones);
    expect(result.readyToAttest?.index).toBe(1);
  });

  it('is not ready once every milestone is attested', () => {
    const milestones = schedule().map((m) => ({ ...m, status: 'ATTESTED' as const }));
    const result = evaluate(dailyRun(200, 9_950), milestones);
    expect(result.readyToAttest).toBeNull();
    expect(result.progress).toBeNull();
  });

  it('is not ready for an empty schedule', () => {
    const result = evaluate(dailyRun(200, 9_950), []);
    expect(result.readyToAttest).toBeNull();
    expect(result.progress).toBeNull();
  });

  it('does not require observations to be passed in order', () => {
    const shuffled = [observation(0, 9_950), observation(120, 9_950), observation(60, 9_950)];
    const result = evaluateMilestones({
      milestones: schedule(),
      observations: shuffled,
      now: NOW,
      // 60-day spacing, so widen the allowance past it for this case.
      maxObservationGapSeconds: 90 * DAY,
    });
    expect(result.readyToAttest?.index).toBe(0);
    expect(result.progress?.sustainedSeconds).toBe(120 * DAY);
  });

  it('applies a stricter floor on a later milestone independently', () => {
    const milestones: MilestoneDefinition[] = [
      { index: 0, retentionFloorBps: 9_900, sustainSeconds: 30 * DAY, status: 'ATTESTED' },
      { index: 1, retentionFloorBps: 10_000, sustainSeconds: 30 * DAY, status: 'PENDING' },
    ];
    // 9,950 cleared the first milestone's 99% floor but not the second's 100%.
    const result = evaluate(dailyRun(120, 9_950), milestones);
    expect(result.readyToAttest).toBeNull();
    expect(result.progress?.sustainedSeconds).toBe(0);
  });
});
