/**
 * DELETE /api/[farmSlug]/veld-assessments/[id] — delete a veld assessment
 * (ADMIN-only, Phase H.2 fresh-admin re-verified).
 *
 * Wave G6 (#170) — migrated onto `tenantWriteSlug`.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G6 spec):
 *   - 200 success shape unchanged.
 *   - 401 envelope migrates to the adapter's canonical
 *     `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - 403 (non-admin / stale-admin) and 404 (not-found) keep their bare-string
 *     `{ error: "<sentence>" }` envelopes — bespoke handler concerns.
 *   - Phase H.2 defence-in-depth `verifyFreshAdminRole(ctx.session.user.id, ctx.slug)`
 *     stays inline (variant signature differs from G5 routes — preserved verbatim).
 */
import { NextResponse } from 'next/server';

import { tenantWriteSlug } from '@/lib/server/route';
import { verifyFreshAdminRole } from '@/lib/auth';
import { revalidateObservationWrite } from '@/lib/server/revalidate';

export const DELETE = tenantWriteSlug<unknown, { farmSlug: string; id: string }>({
  revalidate: revalidateObservationWrite,
  handle: async (ctx, _body, _req, { id }) => {
    if (ctx.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
    if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      await ctx.prisma.veldAssessment.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
    }
  },
});
