export interface MilestoneDefinition {
  index: number;
  thresholdBps: number;
  status: 'PENDING' | 'ATTESTED';
}

export interface EvaluateMilestonesInput {
  /** A project's milestone schedule, mirroring milestone-vault's on-chain records. */
  milestones: MilestoneDefinition[];
  /** Running total forest-cover change since the project's baseline, in basis points. */
  cumulativeChangeBps: number;
}

export interface EvaluateMilestonesResult {
  /** The next pending milestone whose threshold has been reached, if any. */
  readyToAttest: MilestoneDefinition | null;
}

/**
 * Decides whether the next pending milestone in a project's schedule has
 * been reached, given the project's cumulative forest-cover change since
 * baseline.
 *
 * Milestones are evaluated strictly in order — only the lowest-index
 * pending milestone is ever a candidate, even if a later milestone's
 * threshold also happens to already be crossed, because the on-chain
 * vault only ever advances to the next tranche in its own schedule; there
 * is no way to attest milestone 2 before milestone 1.
 */
export function evaluateMilestones(input: EvaluateMilestonesInput): EvaluateMilestonesResult {
  const nextPending = input.milestones
    .slice()
    .sort((a, b) => a.index - b.index)
    .find((milestone) => milestone.status === 'PENDING');

  if (!nextPending) {
    return { readyToAttest: null };
  }

  if (input.cumulativeChangeBps >= nextPending.thresholdBps) {
    return { readyToAttest: nextPending };
  }

  return { readyToAttest: null };
}
