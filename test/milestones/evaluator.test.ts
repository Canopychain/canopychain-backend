import { describe, expect, it } from 'vitest';

import { evaluateMilestones, type MilestoneDefinition } from '../../src/milestones/evaluator.js';

function schedule(): MilestoneDefinition[] {
  return [
    { index: 0, thresholdBps: 500, status: 'PENDING' },
    { index: 1, thresholdBps: 1_000, status: 'PENDING' },
    { index: 2, thresholdBps: 2_000, status: 'PENDING' },
  ];
}

describe('evaluateMilestones', () => {
  it('is not ready when cumulative change is below the next threshold', () => {
    const result = evaluateMilestones({ milestones: schedule(), cumulativeChangeBps: 400 });
    expect(result.readyToAttest).toBeNull();
  });

  it('is ready when cumulative change meets the next threshold exactly', () => {
    const result = evaluateMilestones({ milestones: schedule(), cumulativeChangeBps: 500 });
    expect(result.readyToAttest?.index).toBe(0);
  });

  it('is ready when cumulative change exceeds the next threshold', () => {
    const result = evaluateMilestones({ milestones: schedule(), cumulativeChangeBps: 750 });
    expect(result.readyToAttest?.index).toBe(0);
  });

  it('only ever surfaces the lowest-index pending milestone, never a later one out of turn', () => {
    // Cumulative change is well past milestone 1's threshold, but milestone
    // 0 hasn't been attested yet, so it's still the only candidate.
    const result = evaluateMilestones({ milestones: schedule(), cumulativeChangeBps: 2_500 });
    expect(result.readyToAttest?.index).toBe(0);
  });

  it('moves on to the next pending milestone once earlier ones are attested', () => {
    const milestones = schedule();
    milestones[0].status = 'ATTESTED';

    const result = evaluateMilestones({ milestones, cumulativeChangeBps: 1_200 });
    expect(result.readyToAttest?.index).toBe(1);
  });

  it('is not ready once all milestones are attested', () => {
    const milestones = schedule().map((m) => ({ ...m, status: 'ATTESTED' as const }));
    const result = evaluateMilestones({ milestones, cumulativeChangeBps: 10_000 });
    expect(result.readyToAttest).toBeNull();
  });

  it('is not ready for an empty schedule', () => {
    const result = evaluateMilestones({ milestones: [], cumulativeChangeBps: 10_000 });
    expect(result.readyToAttest).toBeNull();
  });

  it('does not require milestones to be passed in index order', () => {
    const shuffled = [schedule()[2], schedule()[0], schedule()[1]];
    const result = evaluateMilestones({ milestones: shuffled, cumulativeChangeBps: 900 });
    expect(result.readyToAttest?.index).toBe(0);
  });
});
