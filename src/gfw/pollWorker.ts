import { prisma } from '../db.js';
import { queryDataset, type GfwPolygonGeometry } from './client.js';
import { computeForestCoverChange, type ForestCoverSample } from './forestCoverChange.js';

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
async function fetchForestCoverPct(polygon: GfwPolygonGeometry): Promise<number> {
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

  if (totalAreaHa <= 0) {
    return 0;
  }

  const standingForestHa = Math.max(baselineForestHa - lossHa, 0);
  return (standingForestHa / totalAreaHa) * 100;
}

async function pollProject(project: {
  id: string;
  polygonGeoJson: unknown;
}): Promise<void> {
  const previousSnapshot = await prisma.forestCoverSnapshot.findFirst({
    where: { projectId: project.id },
    orderBy: { checkedAt: 'desc' },
  });

  const forestCoverPct = await fetchForestCoverPct(project.polygonGeoJson as GfwPolygonGeometry);
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
      changeBps,
    },
  });
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
      console.error(`GFW poll failed for project ${project.id}`, err);

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
  const interval = setInterval(() => {
    pollOnce().catch((err: unknown) => {
      console.error('forest-cover poll failed', err);
    });
  }, POLL_INTERVAL_MS);

  return () => clearInterval(interval);
}
