import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { evaluateMilestones } from '../milestones/evaluator.js';
import { MAX_OBSERVATION_GAP_SECONDS, observationWindowStart } from '../milestones/window.js';
import { submitAttestation } from '../stellar/attestationSubmitter.js';
import { queryDataset, type GfwPolygonGeometry } from './client.js';
import { computeForestCoverChange, type ForestCoverSample } from './forestCoverChange.js';
import {
  markPollRunCompleted,
  markPollRunStarted,
  markPollWorkerStarted,
  markPollWorkerStopped,
} from './pollStatus.js';

const POLL_INTERVAL_MS = Number(process.env.GFW_POLL_INTERVAL_MS ?? 6 * 60 * 60 * 1000); // 6h default — satellite layers don't refresh faster than that

// A project whose polygon can never succeed at GFW (malformed geometry, an
// area the dataset doesn't cover) would otherwise be retried in full on
// every pass, forever. Doubling the skip period per consecutive failure —
// capped here — keeps such a project from burning retry budget and API
// quota while the rest of the batch keeps its normal cadence.
const MAX_BACKOFF_MS = Number(process.env.GFW_MAX_BACKOFF_MS ?? 7 * 24 * 60 * 60 * 1000); // 7 days

const FOREST_CANOPY_DENSITY_THRESHOLD = 30;
const TREE_COVER_LOSS_DATASET = 'umd_tree_cover_loss';
const TREE_COVER_LOSS_VERSION = 'v1.11';
const TREE_COVER_DENSITY_DATASET = 'umd_tree_cover_density_2000';
const TREE_COVER_DENSITY_VERSION = 'v1.8';

/**
 * Estimates the percentage of a project's polygon currently classed as
 * forest, using GFW's baseline year-2000 canopy-density layer minus
 * cumulative tree-cover loss recorded since. This can only trend toward
 * "less forest" over time — GFW's free, near-real-time data tracks loss,
 * not regrowth — so on its own it measures "how much of the original
 * forest still stands," not confirmed reforestation gain. That's the
 * honest MVP proxy described in the project's own scope; a production
 * system would need a canopy-height or biomass dataset this integration
 * doesn't reach for.
 */
type ForestCoverMeasurement = {
  /** Standing forest as a share of the whole polygon, for display. */
  forestCoverPct: number;
  /** Standing forest as a share of the *baseline* forest, in basis points —
   * what a milestone's retention floor is actually compared against. */
  retentionBps: number;
};

async function fetchForestCoverMeasurement(
  polygon: GfwPolygonGeometry,
): Promise<ForestCoverMeasurement> {
  const [totalAreaResult, baselineForestResult, lossSinceBaselineResult] = await Promise.all([
    queryDataset<{ area__ha: number }>(
      TREE_COVER_DENSITY_DATASET,
      TREE_COVER_DENSITY_VERSION,
      'SELECT SUM(area__ha) AS area__ha FROM results',
      polygon,
    ),
    queryDataset<{ area__ha: number }>(
      TREE_COVER_DENSITY_DATASET,
      TREE_COVER_DENSITY_VERSION,
      `SELECT SUM(area__ha) AS area__ha FROM results WHERE umd_tree_cover_density_2000__threshold >= ${FOREST_CANOPY_DENSITY_THRESHOLD}`,
      polygon,
    ),
    queryDataset<{ area__ha: number }>(
      TREE_COVER_LOSS_DATASET,
      TREE_COVER_LOSS_VERSION,
      `SELECT SUM(area__ha) AS area__ha FROM results WHERE umd_tree_cover_density_2000__threshold >= ${FOREST_CANOPY_DENSITY_THRESHOLD}`,
      polygon,
    ),
  ]);

  const totalAreaHa = totalAreaResult.data[0]?.area__ha ?? 0;
  const baselineForestHa = baselineForestResult.data[0]?.area__ha ?? 0;
  const lossHa = lossSinceBaselineResult.data[0]?.area__ha ?? 0;

  const standingForestHa = Math.max(baselineForestHa - lossHa, 0);

  return {
    forestCoverPct: totalAreaHa > 0 ? (standingForestHa / totalAreaHa) * 100 : 0,
    // A plot with no baseline forest records 0 rather than a vacuous 100%.
    // "All of nothing is still standing" would clear a 99% retention floor
    // on a bare plot, which is exactly the kind of milestone that releases
    // money for nothing.
    retentionBps:
      baselineForestHa > 0 ? Math.round((standingForestHa / baselineForestHa) * 10_000) : 0,
  };
}

/**
 * Evaluates a project's schedule against its recorded checks and, when the
 * next pending milestone has been earned, attests it on-chain.
 *
 * Marking the milestone attested locally as soon as the transaction
 * finalises is deliberate rather than waiting for the indexer to mirror
 * the event: otherwise the next poll would still see the milestone
 * `PENDING` and submit a second attestation, which the vault would apply
 * to the *following* tranche — releasing it early. A crash in the window
 * between the transaction finalising and this write would still allow
 * that, which is why the submitter waits for finalisation rather than
 * firing and forgetting; closing the window completely needs a read of
 * the vault's own `milestones_completed` before submitting.
 */
async function evaluateAndAttest(project: { id: string; onChainId: bigint }): Promise<void> {
  const milestones = await prisma.milestone.findMany({
    where: { projectId: project.id },
    orderBy: { index: 'asc' },
  });

  if (milestones.length === 0) {
    return;
  }

  const windowStart = observationWindowStart(
    Math.max(...milestones.map((m) => m.sustainSeconds)),
  );

  const observations = await prisma.forestCoverSnapshot.findMany({
    where: { projectId: project.id, checkedAt: { gte: windowStart } },
    orderBy: { checkedAt: 'desc' },
    select: { retentionBps: true, checkedAt: true },
  });

  const { readyToAttest, progress } = evaluateMilestones({
    milestones: milestones.map((milestone) => ({
      index: milestone.index,
      retentionFloorBps: milestone.retentionFloorBps,
      sustainSeconds: milestone.sustainSeconds,
      status: milestone.status,
    })),
    observations,
    maxObservationGapSeconds: MAX_OBSERVATION_GAP_SECONDS,
  });

  if (!readyToAttest) {
    if (progress) {
      logger.debug(
        {
          projectId: project.id,
          milestoneIndex: progress.milestone.index,
          currentRetentionBps: progress.currentRetentionBps,
          sustainedSeconds: progress.sustainedSeconds,
          requiredSeconds: progress.milestone.sustainSeconds,
        },
        'milestone not yet earned',
      );
    }
    return;
  }

  const payoutAmount = await submitAttestation(project.onChainId);

  await prisma.milestone.updateMany({
    where: { projectId: project.id, index: readyToAttest.index, status: 'PENDING' },
    data: { status: 'ATTESTED', attestedAt: new Date(), payoutAmount },
  });

  logger.info(
    {
      projectId: project.id,
      milestoneIndex: readyToAttest.index,
      retentionFloorBps: readyToAttest.retentionFloorBps,
      sustainedSeconds: progress?.sustainedSeconds,
      payoutAmount,
    },
    'milestone attested and tranche released',
  );
}

async function pollProject(project: {
  id: string;
  onChainId: bigint;
  polygonGeoJson: unknown;
}): Promise<void> {
  const previousSnapshot = await prisma.forestCoverSnapshot.findFirst({
    where: { projectId: project.id },
    orderBy: { checkedAt: 'desc' },
  });

  const { forestCoverPct, retentionBps } = await fetchForestCoverMeasurement(
    project.polygonGeoJson as GfwPolygonGeometry,
  );
  const current: ForestCoverSample = { forestCoverPct, checkedAt: new Date() };
  const previous: ForestCoverSample | null = previousSnapshot
    ? { forestCoverPct: previousSnapshot.forestCoverPct, checkedAt: previousSnapshot.checkedAt }
    : null;

  const { changeBps } = computeForestCoverChange(current, previous);

  await prisma.forestCoverSnapshot.create({
    data: {
      projectId: project.id,
      checkedAt: current.checkedAt,
      forestCoverPct,
      retentionBps,
      changeBps,
    },
  });

  await evaluateAndAttest(project);
}

async function pollOnce(): Promise<void> {
  const now = new Date();
  const activeProjects = await prisma.project.findMany({
    where: {
      approved: true,
      cancelled: false,
      OR: [{ gfwNextPollAt: null }, { gfwNextPollAt: { lte: now } }],
    },
  });

  for (const project of activeProjects) {
    try {
      await pollProject(project);
      if (project.gfwConsecutiveFailures > 0) {
        await prisma.project.update({
          where: { id: project.id },
          data: { gfwConsecutiveFailures: 0, gfwNextPollAt: null },
        });
      }
    } catch (err) {
      logger.error({ err, projectId: project.id }, 'GFW poll failed for project');

      const consecutiveFailures = project.gfwConsecutiveFailures + 1;
      const backoffMs = Math.min(POLL_INTERVAL_MS * 2 ** (consecutiveFailures - 1), MAX_BACKOFF_MS);
      await prisma.project.update({
        where: { id: project.id },
        data: {
          gfwConsecutiveFailures: consecutiveFailures,
          gfwNextPollAt: new Date(Date.now() + backoffMs),
        },
      });
    }
  }
}

/** Starts polling active projects against GFW on an interval. Returns a stop function. */
export function startForestCoverPolling(): () => void {
  markPollWorkerStarted();

  const interval = setInterval(() => {
    markPollRunStarted();
    pollOnce()
      .then(() => markPollRunCompleted(null))
      .catch((err: unknown) => {
        logger.error({ err }, 'forest-cover poll failed');
        markPollRunCompleted(err);
      });
  }, POLL_INTERVAL_MS);

  return () => {
    clearInterval(interval);
    markPollWorkerStopped();
  };
}
