const GFW_API_BASE_URL = process.env.GFW_API_BASE_URL ?? 'https://data-api.globalforestwatch.org';
const GFW_API_KEY = process.env.GFW_API_KEY;

/** A GeoJSON polygon or multipolygon, as accepted by GFW's query endpoint. */
export interface GfwPolygonGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
}

export interface GfwQueryResult<T = Record<string, unknown>> {
  data: T[];
  status: string;
}

/**
 * Runs a SQL query against a Global Forest Watch dataset, scoped to a
 * custom polygon. This is a thin wrapper around GFW's own Data API
 * (https://data-api.globalforestwatch.org) — it doesn't know what any
 * particular dataset's columns mean, that's the forest-cover-change
 * calculator's job in a later commit.
 */
export async function queryDataset<T = Record<string, unknown>>(
  dataset: string,
  version: string,
  sql: string,
  geometry: GfwPolygonGeometry,
): Promise<GfwQueryResult<T>> {
  if (!GFW_API_KEY) {
    throw new Error('GFW_API_KEY is not set');
  }

  const response = await fetch(`${GFW_API_BASE_URL}/dataset/${dataset}/${version}/query/json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': GFW_API_KEY,
    },
    body: JSON.stringify({ sql, geometry }),
  });

  if (!response.ok) {
    throw new Error(`GFW query failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as GfwQueryResult<T>;
}
