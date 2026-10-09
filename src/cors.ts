/**
 * Which browser origins may call this API directly. Needed because
 * several frontend pages fetch client-side rather than through Next.js's
 * own server (see `canopychain-frontend`'s `MilestoneTimeline`, the
 * donor dashboard, the admin pages, and the operator registration form)
 * — those requests come from the browser, so without CORS headers the
 * browser blocks the response before the page ever sees it, regardless
 * of whether the API call itself succeeded.
 *
 * The production frontend and local dev are fixed; Vercel preview
 * deployments get a fresh, randomly-suffixed subdomain per build
 * (`canopychain-frontend-<hash>-canopychain.vercel.app`), so those are
 * matched by pattern rather than listed individually.
 */
const DEFAULT_ALLOWED_ORIGINS: (string | RegExp)[] = [
  'http://localhost:3001',
  'https://canopychain-frontend.vercel.app',
  /^https:\/\/canopychain-frontend-[a-z0-9]+-canopychain\.vercel\.app$/,
];

/** Extra exact origins from `CORS_ORIGINS` (comma-separated), for a fork
 * or a renamed Vercel project that the defaults above won't match. */
function extraOriginsFromEnv(): string[] {
  const raw = process.env.CORS_ORIGINS ?? '';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function isAllowedOrigin(origin: string): boolean {
  const allowed = [...DEFAULT_ALLOWED_ORIGINS, ...extraOriginsFromEnv()];
  return allowed.some((entry) =>
    typeof entry === 'string' ? entry === origin : entry.test(origin),
  );
}
