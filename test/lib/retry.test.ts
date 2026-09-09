import { describe, expect, it, vi } from 'vitest';

import { backoffDelayMs, withRetry } from '../../src/lib/retry.js';

describe('backoffDelayMs', () => {
  it('scales exponentially with attempt number, before jitter', () => {
    const noJitter = () => 1; // random() = 1 -> delay = full capped value
    expect(backoffDelayMs(1, 100, 10_000, noJitter)).toBe(100);
    expect(backoffDelayMs(2, 100, 10_000, noJitter)).toBe(200);
    expect(backoffDelayMs(3, 100, 10_000, noJitter)).toBe(400);
  });

  it('caps at maxDelayMs regardless of attempt number', () => {
    const noJitter = () => 1;
    expect(backoffDelayMs(20, 100, 5_000, noJitter)).toBe(5_000);
  });

  it('scales the delay down by the random factor (full jitter)', () => {
    const halfJitter = () => 0.5;
    expect(backoffDelayMs(1, 100, 10_000, halfJitter)).toBe(50);
  });

  it('never returns a negative delay', () => {
    const zeroJitter = () => 0;
    expect(backoffDelayMs(1, 100, 10_000, zeroJitter)).toBe(0);
  });
});

describe('withRetry', () => {
  it('returns the result on the first success without retrying', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withRetry(operation, { sleep });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries on failure and succeeds once the operation recovers', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withRetry(operation, { sleep, maxAttempts: 3 });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('throws the last error once attempts are exhausted', async () => {
    const error = new Error('persistent failure');
    const operation = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(operation, { sleep, maxAttempts: 3 })).rejects.toThrow(
      'persistent failure',
    );
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('never sleeps between attempts when maxAttempts is 1', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('fail'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(operation, { sleep, maxAttempts: 1 })).rejects.toThrow('fail');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
