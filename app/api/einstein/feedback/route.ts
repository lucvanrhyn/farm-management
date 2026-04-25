/**
 * POST /api/einstein/feedback — Phase L Wave 2B thumbs up/down on a RagQueryLog row.
 *
 * Body: { queryLogId: string, feedback: "up" | "down", note?: string }
 *
 * Auth: next-auth session + isPaidTier gate (mirrors /ask route).
 * Same export discipline — only runtime + POST below.
 */

import { NextRequest } from 'next/server';
import { getFarmContext } from '@/lib/server/farm-context';
import { getFarmCreds } from '@/lib/meta-db';
import { isPaidTier } from '@/lib/tier';

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
  let note: string | undefined;
  if (r.note !== undefined) {
    if (typeof r.note !== 'string') return { error: 'note must be a string if present' };
    if (r.note.length > 2000) return { error: 'note must be ≤2000 characters' };
    note = r.note;
  }
  return { queryLogId: r.queryLogId, feedback: r.feedback, note };
}

export async function POST(req: NextRequest): Promise<Response> {
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

  const ctx = await getFarmContext(req);
  if (!ctx) {
    return jsonError('EINSTEIN_UNAUTHENTICATED', 'Sign in required', 401);
  }
  const { prisma, slug } = ctx;

  const creds = await getFarmCreds(slug);
  if (!creds) {
    return jsonError('EINSTEIN_FARM_NOT_FOUND', `Farm ${slug} not found`, 404);
  }
  if (!isPaidTier(creds.tier)) {
    return jsonError(
      'EINSTEIN_TIER_LOCKED',
      'Farm Einstein requires an Advanced or Consulting subscription.',
      403,
    );
  }

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
}
