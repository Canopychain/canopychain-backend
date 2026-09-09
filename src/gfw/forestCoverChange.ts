export interface ForestCoverSample {
  /** Percentage (0-100) of the polygon's area currently classed as forest. */
  forestCoverPct: number;
  checkedAt: Date;
}

export interface ForestCoverChangeResult {
  /** Signed change in forest-cover percentage since the previous sample, in basis points. */
  changeBps: number;
  previous: ForestCoverSample | null;
  current: ForestCoverSample;
}

/**
 * Computes the change in a project's forest-cover percentage between its
 * previous satellite check and its current one, in basis points. Positive
 * means cover increased; negative means it decreased.
 *
 * Returns a zero change when there's no previous sample to compare
 * against — a project's first check establishes a baseline rather than
 * reporting a change.
 */
export function computeForestCoverChange(
  current: ForestCoverSample,
  previous: ForestCoverSample | null,
): ForestCoverChangeResult {
  if (!previous) {
    return { changeBps: 0, previous: null, current };
  }

  const deltaPct = current.forestCoverPct - previous.forestCoverPct;
  const changeBps = Math.round(deltaPct * 100);

  return { changeBps, previous, current };
}
