import { describe, expect, it } from 'vitest';

import { computeForestCoverChange, type ForestCoverSample } from '../../src/gfw/forestCoverChange.js';

function sample(forestCoverPct: number, checkedAt = new Date('2026-01-01')): ForestCoverSample {
  return { forestCoverPct, checkedAt };
}

describe('computeForestCoverChange', () => {
  it('reports zero change with no previous sample', () => {
    const result = computeForestCoverChange(sample(42), null);
    expect(result.changeBps).toBe(0);
    expect(result.previous).toBeNull();
  });

  it('reports a positive change when cover increases', () => {
    const result = computeForestCoverChange(sample(45), sample(40));
    expect(result.changeBps).toBe(500); // +5.00 percentage points
  });

  it('reports a negative change when cover decreases', () => {
    const result = computeForestCoverChange(sample(38), sample(40));
    expect(result.changeBps).toBe(-200); // -2.00 percentage points
  });

  it('reports zero change when cover is unchanged', () => {
    const result = computeForestCoverChange(sample(40), sample(40));
    expect(result.changeBps).toBe(0);
  });

  it('rounds fractional percentage-point changes to the nearest bps', () => {
    const result = computeForestCoverChange(sample(40.017), sample(40));
    expect(result.changeBps).toBe(2); // 0.017pp -> 1.7bps -> rounds to 2
  });

  it('carries the current and previous samples through unchanged', () => {
    const previous = sample(40, new Date('2026-01-01'));
    const current = sample(41, new Date('2026-02-01'));
    const result = computeForestCoverChange(current, previous);
    expect(result.previous).toBe(previous);
    expect(result.current).toBe(current);
  });
});
