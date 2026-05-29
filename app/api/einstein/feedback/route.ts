/**
 * POST /api/einstein/feedback — Phase L Wave 2B thumbs up/down on a RagQueryLog row.
 *
 * Body: { queryLogId: string, feedback: "up" | "down", note?: string, farmSlug: string }
 *
 * Auth: next-auth session + slug-aware, membership-gated Prisma resolution +
 * isPaidTier gate (mirrors /api/einstein/ask exactly).
 * Same export discipline — only runtime + POST below.
 *
 * Epic D1 (#488): the tenant is pinned via an EXPLICIT `farmSlug` from the
 * request body resolved through `getPrismaForSlugWithAuth`, NOT inferred from
 * the `Referer` header (the un-migrated remainder of #393). The membership
 * gate (session.user.farms) is enforced inside `getPrismaForSlugWithAuth`, so
 * a foreign slug cannot select another tenant.
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getPrismaForSlugWithAuth } from '@/lib/farm-prisma';
import { getFarmCreds } from '@/lib/meta-db';
import { isPaidTier } from '@/lib/tier';
import { publicHandler } from '@/lib/server/route';
import { routeError } from '@/lib/server/route/envelope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FeedbackBody {
  queryLogId: string;
  feedback: 'up' | 'down';
  note?: string;
  farmSlug: string;
}

function parseBody(raw: unknown): FeedbackBody | { error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: 'Request body must be a JSON object' };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.queryLogId !== 'string' || r.queryLogId.length === 0) {
    return { error: 'queryLogId must be a non-empty string' };
  }
  if (r.feedback !== 'up' && r.feedback !== 'down') {
    return { error: 'feedback must be "up" or "down"' };
  }
  if (typeof r.farmSlug !== 'string' || r.farmSlug.length === 0) {
    return { error: 'farmSlug must be a non-empty string' };
  }
  let note: string | undefined;
  if (r.note !== undefined) {
    if (typeof r.note !== 'string') return { error: 'note must be a string if present' };
    if (r.note.length > 2000) return { error: 'note must be ≤2000 characters' };
    note = r.note;
  }
  return { queryLogId: r.queryLogId, feedback: r.feedback, note, farmSlug: r.farmSlug };
}

/**
 * Wave H3 (#175) — wrapped in `publicHandler` for typed-error envelope on
 * unexpected throws + observability. Auth, slug-aware membership gate, tier
 * gate, and Prisma P2025 mapping are all preserved verbatim inside `handle`.
 */
export const POST = publicHandler({
  handle: async (req: NextRequest): Promise<Response> => {
    const session = await getServerSession(authOptions);
    if (!session) {
      // Issue #493 (Epic B) — fold the legacy `EINSTEIN_UNAUTHENTICATED`
      // (`{ code, message }`) onto the canonical ADR-0001 AUTH_REQUIRED
      // envelope (`{ error, message }`), mirroring the identical fold the
      // sibling `/api/einstein/ask` route shipped in #486 (Epic B4). 401
      // status is unchanged. Safe: the only consumer (EinsteinChat's
      // thumbs-up/down handler) treats feedback as fire-and-forget advisory
      // telemetry and never reads this response body or its code. The
      // remaining einstein-domain `jsonError` arms (tier/budget/retriever)
      // stay on the `{ code, message }` shape that EinsteinChat decodes.
      return routeError('AUTH_REQUIRED', 'Unauthorized', 401);
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonError('EINSTEIN_BAD_REQUEST', 'Request body must be valid JSON', 400);
    }

    const parsed = parseBody(rawBody);
    if ('error' in parsed) {
      return jsonError('EINSTEIN_BAD_REQUEST', parsed.error, 400);
    }

    // Tier gate (must be done before any tenant work).
    const creds = await getFarmCreds(parsed.farmSlug);
    if (!creds) {
      return jsonError('EINSTEIN_FARM_NOT_FOUND', `Farm ${parsed.farmSlug} not found`, 404);
    }
    if (!isPaidTier(creds.tier)) {
      return jsonError(
        'EINSTEIN_TIER_LOCKED',
        'Farm Einstein requires an Advanced or Consulting subscription.',
        403,
      );
    }

    // Auth the explicit body slug against the session (membership gate). A
    // foreign / non-member slug is rejected here before any tenant client is
    // handed back — tenant isolation is enforced by construction.
    const authed = await getPrismaForSlugWithAuth(session, parsed.farmSlug);
    if ('error' in authed) {
      return jsonError('EINSTEIN_FORBIDDEN', authed.error, authed.status);
    }
    const { prisma } = authed;

    try {
      const updated = await prisma.ragQueryLog.update({
        where: { id: parsed.queryLogId },
        data: { feedback: parsed.feedback, feedbackNote: parsed.note ?? null },
        select: { id: true },
      });
      return new Response(JSON.stringify({ success: true, id: updated.id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      // Prisma P2025 → row not found.
      const code =
        err && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === 'P2025'
          ? 'EINSTEIN_FEEDBACK_NOT_FOUND'
          : 'EINSTEIN_FEEDBACK_FAILED';
      const status = code === 'EINSTEIN_FEEDBACK_NOT_FOUND' ? 404 : 500;
      return jsonError(code, err instanceof Error ? err.message : 'feedback update failed', status);
    }
  },
});
