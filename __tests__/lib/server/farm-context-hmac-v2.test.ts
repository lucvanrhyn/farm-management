/**
 * @vitest-environment node
 *
 * Wave 1 W1b — bind `role` (and a `v2` version byte) into the identity HMAC.
 *
 * Background
 * ----------
 * Pre-W1b, the HMAC payload was `(email, slug, sub)`. Role was stamped into
 * `x-session-role` outside the HMAC and consumed verbatim by handlers. The
 * primitive itself did not enforce role authenticity — `proxy.ts` mitigated
 * by overwriting `x-session-role` on matched paths, but a forged-role attack
 * vector existed at the primitive level.
 *
 * W1b changes:
 *   1. Payload becomes `v2\n<email>\n<slug>\n<sub>\n<role>`.
 *   2. `verifyIdentity` requires the leading `v2` version byte and the role.
 *   3. v1-format tokens are REJECTED (forces `NEXTAUTH_SECRET` rotation on
 *      deploy — see commit body).
 *
 * These tests pin the contract.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

const SECRET = 'test-nextauth-secret';
process.env.NEXTAUTH_SECRET = SECRET;

describe('signIdentity / verifyIdentity — v2 (role-bound, version-prefixed)', () => {
  it('round-trip: a v2 token signed with (email, slug, sub, role) verifies cleanly', async () => {
    const { signIdentity, verifyIdentity } = await import('@/lib/server/farm-context');
    const sig = signIdentity('alice@example.com', 'trio-b', 'user-1', 'ADMIN', SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(
      verifyIdentity('alice@example.com', 'trio-b', 'user-1', 'ADMIN', sig, SECRET),
    ).toBe(true);
  });

  it('FAILS verification when role is tampered (viewer → admin)', async () => {
    const { signIdentity, verifyIdentity } = await import('@/lib/server/farm-context');
    // Token was minted with role=VIEWER...
    const sig = signIdentity('alice@example.com', 'trio-b', 'user-1', 'VIEWER', SECRET);
    // ...attacker submits the same token claiming role=ADMIN.
    expect(
      verifyIdentity('alice@example.com', 'trio-b', 'user-1', 'ADMIN', sig, SECRET),
    ).toBe(false);
  });

  it('FAILS verification when email is tampered', async () => {
    const { signIdentity, verifyIdentity } = await import('@/lib/server/farm-context');
    const sig = signIdentity('alice@example.com', 'trio-b', 'user-1', 'ADMIN', SECRET);
    expect(
      verifyIdentity('mallory@example.com', 'trio-b', 'user-1', 'ADMIN', sig, SECRET),
    ).toBe(false);
  });

  it('FAILS verification when slug is tampered', async () => {
    const { signIdentity, verifyIdentity } = await import('@/lib/server/farm-context');
    const sig = signIdentity('alice@example.com', 'trio-b', 'user-1', 'ADMIN', SECRET);
    expect(
      verifyIdentity('alice@example.com', 'farm-b', 'user-1', 'ADMIN', sig, SECRET),
    ).toBe(false);
  });

  it('FAILS verification when sub is tampered', async () => {
    const { signIdentity, verifyIdentity } = await import('@/lib/server/farm-context');
    const sig = signIdentity('alice@example.com', 'trio-b', 'user-1', 'ADMIN', SECRET);
    expect(
      verifyIdentity('alice@example.com', 'trio-b', 'user-2', 'ADMIN', sig, SECRET),
    ).toBe(false);
  });

  it('REJECTS v1-format tokens (no role byte, no version prefix)', async () => {
    const { verifyIdentity } = await import('@/lib/server/farm-context');
    // A v1 signature: HMAC over `${email}\n${slug}\n${sub}` — no version, no role.
    const v1Sig = createHmac('sha256', SECRET)
      .update('alice@example.com\ntrio-b\nuser-1')
      .digest('hex');
    // Even when the verifier is given the "right" role, a v1 sig must NOT verify.
    expect(
      verifyIdentity('alice@example.com', 'trio-b', 'user-1', 'ADMIN', v1Sig, SECRET),
    ).toBe(false);
  });

  it('REJECTS a sig minted with a different secret', async () => {
    const { signIdentity, verifyIdentity } = await import('@/lib/server/farm-context');
    const sig = signIdentity('alice@example.com', 'trio-b', 'user-1', 'ADMIN', 'old-secret');
    expect(
      verifyIdentity('alice@example.com', 'trio-b', 'user-1', 'ADMIN', sig, 'new-secret'),
    ).toBe(false);
  });

  it('signature payload starts with the literal "v2\\n" version prefix', async () => {
    const { signIdentity } = await import('@/lib/server/farm-context');
    const expected = createHmac('sha256', SECRET)
      .update('v2\nalice@example.com\ntrio-b\nuser-1\nADMIN')
      .digest('hex');
    const actual = signIdentity('alice@example.com', 'trio-b', 'user-1', 'ADMIN', SECRET);
    expect(actual).toBe(expected);
  });
});
