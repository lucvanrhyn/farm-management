/**
 * GET  /api/[farmSlug]/veld-assessments — list veld assessments (optional `?campId=` filter).
 * POST /api/[farmSlug]/veld-assessments — create a veld assessment (ADMIN-or-MANAGER, NO fresh-admin gate).
 *
 * Wave G6 (#170) — migrated onto `tenantReadSlug` / `tenantWriteSlug`.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G6 spec):
 *   - 200/201 success shapes unchanged.
 *   - 401 envelope migrates to the adapter's canonical
 *     `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - 403 (non-admin/manager), 400 (validation, 8 distinct branches),
 *     404 (camp not found) keep their bare-string `{ error: "<sentence>" }`
 *     envelopes — these are bespoke handler concerns.
 *
 * NOTE: POST allows BOTH `ADMIN` and `MANAGER` and intentionally DOES NOT
 * call `verifyFreshAdminRole` — the fresh-admin defence-in-depth check is
 * scoped to admin-only mutations elsewhere in this slice. Preserve verbatim.
 */
import { NextResponse } from 'next/server';

import { tenantReadSlug, tenantWriteSlug } from '@/lib/server/route';
import { calcVeldScore, calcGrazingCapacity, type BiomeType } from '@/lib/calculators/veld-score';
import { revalidateObservationWrite } from '@/lib/server/revalidate';

interface PostBody {
  campId: string;
  assessmentDate: string;
  assessor: string;
  palatableSpeciesPct: number;
  bareGroundPct: number;
  erosionLevel: number;
  bushEncroachmentLevel: number;
  notes?: string;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function isValidLevel(n: unknown): n is 0 | 1 | 2 {
  return n === 0 || n === 1 || n === 2;
}

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req) => {
    const url = new URL(req.url);
    const campId = url.searchParams.get('campId');
    const rows = await ctx.prisma.veldAssessment.findMany({
      where: campId ? { campId } : undefined,
      orderBy: { assessmentDate: 'desc' },
      take: 500,
    });
    return NextResponse.json({ assessments: rows });
  },
});

export const POST = tenantWriteSlug<unknown, { farmSlug: string }>({
  revalidate: revalidateObservationWrite,
  handle: async (ctx, body) => {
    if (ctx.role !== 'ADMIN' && ctx.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const input = (body ?? {}) as Partial<PostBody>;

    if (!input.campId || typeof input.campId !== 'string') {
      return NextResponse.json({ error: 'campId required' }, { status: 400 });
    }
    if (typeof input.assessmentDate !== 'string' || !isValidDate(input.assessmentDate)) {
      return NextResponse.json({ error: 'assessmentDate must be YYYY-MM-DD' }, { status: 400 });
    }
    if (!input.assessor || typeof input.assessor !== 'string') {
      return NextResponse.json({ error: 'assessor required' }, { status: 400 });
    }
    if (
      typeof input.palatableSpeciesPct !== 'number' ||
      input.palatableSpeciesPct < 0 ||
      input.palatableSpeciesPct > 100
    ) {
      return NextResponse.json({ error: 'palatableSpeciesPct must be 0..100' }, { status: 400 });
    }
    if (
      typeof input.bareGroundPct !== 'number' ||
      input.bareGroundPct < 0 ||
      input.bareGroundPct > 100
    ) {
      return NextResponse.json({ error: 'bareGroundPct must be 0..100' }, { status: 400 });
    }
    if (!isValidLevel(input.erosionLevel)) {
      return NextResponse.json({ error: 'erosionLevel must be 0|1|2' }, { status: 400 });
    }
    if (!isValidLevel(input.bushEncroachmentLevel)) {
      return NextResponse.json({ error: 'bushEncroachmentLevel must be 0|1|2' }, { status: 400 });
    }

    // Phase A of #28: campId is no longer globally unique (composite UNIQUE on
    // species+campId). findFirst is single-species-safe; Phase B will scope by species.
    const camp = await ctx.prisma.camp.findFirst({
      where: { campId: input.campId },
      select: { campId: true },
    });
    if (!camp) return NextResponse.json({ error: 'Camp not found' }, { status: 404 });

    const settings = await ctx.prisma.farmSettings.findUnique({
      where: { id: 'singleton' },
      select: { biomeType: true },
    });
    const biome = (settings?.biomeType ?? 'mixedveld') as BiomeType;

    const veldScore = calcVeldScore({
      palatableSpeciesPct: input.palatableSpeciesPct,
      bareGroundPct: input.bareGroundPct,
      erosionLevel: input.erosionLevel,
      bushEncroachmentLevel: input.bushEncroachmentLevel,
    });
    const { haPerLsu } = calcGrazingCapacity(biome, veldScore);

    const created = await ctx.prisma.veldAssessment.create({
      data: {
        campId: input.campId,
        assessmentDate: input.assessmentDate,
        assessor: input.assessor.slice(0, 100),
        palatableSpeciesPct: input.palatableSpeciesPct,
        bareGroundPct: input.bareGroundPct,
        erosionLevel: input.erosionLevel,
        bushEncroachmentLevel: input.bushEncroachmentLevel,
        veldScore,
        biomeAtAssessment: biome,
        haPerLsu,
        notes: input.notes?.slice(0, 2000),
        createdBy: ctx.session.user?.email ?? null,
      },
    });
    return NextResponse.json({ assessment: created }, { status: 201 });
  },
});
