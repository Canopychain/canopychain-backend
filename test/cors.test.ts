import { afterEach, describe, expect, it } from 'vitest';

import { isAllowedOrigin } from '../src/cors.js';

describe('isAllowedOrigin', () => {
  afterEach(() => {
    delete process.env.CORS_ORIGINS;
  });

  it('allows the production frontend', () => {
    expect(isAllowedOrigin('https://canopychain-frontend.vercel.app')).toBe(true);
  });

  it('allows local dev', () => {
    expect(isAllowedOrigin('http://localhost:3001')).toBe(true);
  });

  it('allows a Vercel preview deployment by pattern', () => {
    expect(isAllowedOrigin('https://canopychain-frontend-qs1kkzfg5-canopychain.vercel.app')).toBe(
      true,
    );
  });

  it('rejects an unrelated origin', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
  });

  // The preview pattern is specific to this Vercel project on purpose —
  // a lookalike domain registered by someone else shouldn't pass just
  // because it resembles the real one.
  it('rejects a domain that only resembles the preview pattern', () => {
    expect(isAllowedOrigin('https://canopychain-frontend-evil-canopychain.vercel.app.evil.com')).toBe(
      false,
    );
  });

  it('allows an extra origin added via CORS_ORIGINS', () => {
    process.env.CORS_ORIGINS = 'https://staging.example.com, https://other.example.com';
    expect(isAllowedOrigin('https://staging.example.com')).toBe(true);
    expect(isAllowedOrigin('https://other.example.com')).toBe(true);
    expect(isAllowedOrigin('https://not-listed.example.com')).toBe(false);
  });
});
