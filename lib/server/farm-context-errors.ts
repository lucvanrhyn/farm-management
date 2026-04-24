/**
 * Phase G (P6.5) — typed error classifier for `getFarmContextForSlug`.
 *
 * The consolidated helper returns `null` for every auth failure (no session,
 * wrong-farm, farm-not-found) because routes that only need the standard
 * 401/403 envelope don't care about the distinction. A handful of routes
 * (Phase K map layers, farm-settings) predate the helper and emit typed
 * error codes the UI maps to actionable copy. Keep them working by offering
 * a single shared classifier that re-probes the session once after a null
 * return — cost is one extra meta-db hit on the error path only.
 *
 * This module is the ONLY place that still reaches for `getServerSession` +
 * `authOptions` after Phase G on routes under `[farmSlug]/**`. The coverage
 * test in `__tests__/api/session-consolidation-coverage.test.ts` scans for
 * that pair in the route.ts file itself — importing the classifier keeps the
 * route clean.
 */

import type { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';

export type FarmContextFailureCode =
  | 'AUTH_REQUIRED'
  | 'CROSS_TENANT_FORBIDDEN';

export interface FarmContextFailure {
  readonly code: FarmContextFailureCode;
  readonly status: 401 | 403;
}

/**
 * Classify a `getFarmContextForSlug` null return. Call this only on the
 * error path; the success path should never reach the classifier.
 *
 * @param _req  reserved for future fast-path classification via signed headers
 */
export async function classifyFarmContextFailure(
  _req?: NextRequest,
): Promise<FarmContextFailure> {
  const session = await getServerSession(authOptions);
  if (!session) return { code: 'AUTH_REQUIRED', status: 401 };
  return { code: 'CROSS_TENANT_FORBIDDEN', status: 403 };
}
