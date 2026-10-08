import { DEFAULT_MAX_OBSERVATION_GAP_SECONDS } from './evaluator.js';

/**
 * How long a hole in a project's check history can be before it stops
 * counting as continuous compliance. Overridable because it only makes
 * sense relative to the poll interval: shorten the interval for a demo and
 * this wants shortening with it.
 */
export const MAX_OBSERVATION_GAP_SECONDS = Number(
  process.env.GFW_MAX_OBSERVATION_GAP_SECONDS ?? DEFAULT_MAX_OBSERVATION_GAP_SECONDS,
);

/**
 * The oldest check that can still affect a verdict, given the longest
 * sustain period in a project's schedule. Nothing before it can change
 * whether a milestone is earned, so both the poll worker and the project
 * endpoint bound their history queries by it rather than loading every
 * snapshot a long-running project has ever recorded.
 *
 * A streak longer than this window reports its `sustainedSeconds` as the
 * window length — already past every milestone's requirement, so this can
 * understate the figure displayed, never the readiness decision.
 */
export function observationWindowStart(longestSustainSeconds: number, now = new Date()): Date {
  return new Date(now.getTime() - (longestSustainSeconds + MAX_OBSERVATION_GAP_SECONDS) * 1000);
}
