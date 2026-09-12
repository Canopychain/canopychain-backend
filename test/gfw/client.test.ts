import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GfwPolygonGeometry } from '../../src/gfw/client.js';

vi.mock('../../src/lib/retry.js', () => ({
  withRetry: (operation: () => Promise<unknown>) => operation(),
}));

const geometry: GfwPolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ],
  ],
};

describe('queryDataset', () => {
  const originalApiKey = process.env.GFW_API_KEY;
  const originalBaseUrl = process.env.GFW_API_BASE_URL;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalApiKey === undefined) {
      delete process.env.GFW_API_KEY;
    } else {
      process.env.GFW_API_KEY = originalApiKey;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.GFW_API_BASE_URL;
    } else {
      process.env.GFW_API_BASE_URL = originalBaseUrl;
    }
  });

  it('throws without ever calling fetch when GFW_API_KEY is not set', async () => {
    delete process.env.GFW_API_KEY;
    const { queryDataset } = await import('../../src/gfw/client.js');

    await expect(queryDataset('umd_tree_cover_loss', 'v1', 'SELECT 1', geometry)).rejects.toThrow(
      'GFW_API_KEY is not set',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the SQL and geometry to the dataset endpoint with the API key header', async () => {
    process.env.GFW_API_KEY = 'test-key-123';
    process.env.GFW_API_BASE_URL = 'https://gfw.example';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ area: 42 }], status: 'success' }),
    });
    const { queryDataset } = await import('../../src/gfw/client.js');

    const result = await queryDataset('umd_tree_cover_loss', 'v1', 'SELECT 1', geometry);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gfw.example/dataset/umd_tree_cover_loss/v1/query/json');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-api-key': 'test-key-123',
    });
    expect(JSON.parse(init.body)).toEqual({ sql: 'SELECT 1', geometry });
    expect(result).toEqual({ data: [{ area: 42 }], status: 'success' });
  });

  it('throws an error that includes the status and body when the response is not ok', async () => {
    process.env.GFW_API_KEY = 'test-key-123';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });
    const { queryDataset } = await import('../../src/gfw/client.js');

    await expect(queryDataset('umd_tree_cover_loss', 'v1', 'SELECT 1', geometry)).rejects.toThrow(
      /429.*rate limited/,
    );
  });
});
