import type { Keypair } from '@stellar/stellar-sdk';

import { sep53Hash } from '../../src/middleware/adminAuth.js';

/** Builds the three headers requireAdminSignature expects, signed for one
 * specific method+url pair — mirrors exactly what the middleware verifies,
 * including the SEP-53 message-signing hash a real wallet applies. */
export function signAdminRequest(
  keypair: Keypair,
  method: string,
  url: string,
  timestampMs: number = Date.now(),
): Record<string, string> {
  const timestamp = timestampMs.toString();
  const payload = `${method}:${url}:${timestamp}`;
  // sign() returns a Uint8Array, not a Buffer — calling .toString('base64')
  // on it straight would give comma-separated digits, not base64.
  const signature = Buffer.from(keypair.sign(sep53Hash(payload))).toString('base64');

  return {
    'x-admin-address': keypair.publicKey(),
    'x-admin-signature': signature,
    'x-admin-timestamp': timestamp,
  };
}
