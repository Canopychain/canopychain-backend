import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../src/db.js';
import { buildServer } from '../../src/server.js';
import { getOnChainProject } from '../../src/stellar/projectRegistry.js';
import { fakeAddress, resetDb } from '../helpers/db.js';

vi.mock('../../src/stellar/projectRegistry.js', () => ({
  getOnChainProject: vi.fn(),
}));

const mockGetOnChainProject = vi.mocked(getOnChainProject);

const OPERATOR = fakeAddress('O');
const RECIPIENT = fakeAddress('R');
const ATTESTOR = fakeAddress('T');
const POLYGON = {
  type: 'Polygon',
  coordinates: [
    [
      [36.8, -1.3],
      [36.9, -1.3],
      [36.9, -1.2],
      [36.8, -1.3],
    ],
  ],
};
const POLYGON_HASH = createHash('sha256').update(JSON.stringify(POLYGON)).digest('hex');

const ON_CHAIN_PROJECT = {
  operator: OPERATOR,
  recipient: RECIPIENT,
  attestor: ATTESTOR,
  polygonHash: POLYGON_HASH,
  name: 'Mau Forest Plot 4',
  approved: false,
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    onChainId: '7',
    recipientAddress: RECIPIENT,
    attestorAddress: ATTESTOR,
    polygonHash: POLYGON_HASH,
    polygonGeoJson: POLYGON,
    ...overrides,
  };
}

async function register(body: Record<string, unknown>) {
  const app = buildServer();
  const response = await app.inject({ method: 'POST', url: '/projects/register', payload: body });
  await app.close();
  return response;
}

describe('POST /projects/register', () => {
  beforeEach(() => {
    mockGetOnChainProject.mockReset();
    mockGetOnChainProject.mockResolvedValue(ON_CHAIN_PROJECT);
  });

  afterEach(async () => {
    await resetDb();
  });

  it('stores details that match the registry, taking operator and name from it', async () => {
    const response = await register(validBody());

    expect(response.statusCode).toBe(201);
    expect(mockGetOnChainProject).toHaveBeenCalledWith(7n);

    const project = await prisma.project.findUniqueOrThrow({ where: { onChainId: 7n } });
    expect(project).toMatchObject({
      operatorAddress: OPERATOR,
      name: 'Mau Forest Plot 4',
      recipientAddress: RECIPIENT,
      attestorAddress: ATTESTOR,
      polygonHash: POLYGON_HASH,
      polygonGeoJson: POLYGON,
    });
  });

  it('accepts an identical resubmission, so the operator can retry', async () => {
    expect((await register(validBody())).statusCode).toBe(201);
    expect((await register(validBody())).statusCode).toBe(201);
  });

  it.each([
    ['recipient', { recipientAddress: fakeAddress('X') }],
    ['attestor', { attestorAddress: fakeAddress('X') }],
    ['polygon hash', { polygonHash: 'ab'.repeat(32) }],
  ])('rejects a %s that differs from the registry', async (_field, override) => {
    const response = await register(validBody(override));

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'details_do_not_match_registry' });
    expect(await prisma.project.count()).toBe(0);
  });

  it('rejects a polygon that does not hash to the on-chain polygon_hash', async () => {
    const otherPolygon = {
      ...POLYGON,
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    };

    const response = await register(validBody({ polygonGeoJson: otherPolygon }));

    expect(response.statusCode).toBe(422);
  });

  it('cannot overwrite an existing project with different details', async () => {
    await register(validBody());

    const swappedPolygon = {
      ...POLYGON,
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    const response = await register(
      validBody({
        recipientAddress: fakeAddress('X'),
        polygonGeoJson: swappedPolygon,
        polygonHash: createHash('sha256').update(JSON.stringify(swappedPolygon)).digest('hex'),
      }),
    );

    expect(response.statusCode).toBe(422);
    const project = await prisma.project.findUniqueOrThrow({ where: { onChainId: 7n } });
    expect(project.recipientAddress).toBe(RECIPIENT);
    expect(project.polygonGeoJson).toEqual(POLYGON);
  });

  it('returns 404 for a project id the registry does not have', async () => {
    mockGetOnChainProject.mockResolvedValue(null);

    const response = await register(validBody());

    expect(response.statusCode).toBe(404);
    expect(await prisma.project.count()).toBe(0);
  });

  it('returns 502 when the registry cannot be read', async () => {
    mockGetOnChainProject.mockRejectedValue(new Error('rpc down'));

    const response = await register(validBody());

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'registry_unavailable' });
  });
});
