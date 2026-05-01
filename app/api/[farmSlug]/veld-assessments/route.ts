import { NextRequest, NextResponse } from 'next/server';
import { getFarmContextForSlug } from '@/lib/server/farm-context-slug';
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const campId = url.searchParams.get('campId');
  const rows = await ctx.prisma.veldAssessment.findMany({
    where: campId ? { campId } : undefined,
    orderBy: { assessmentDate: 'desc' },
    take: 500,
  });
  return NextResponse.json({ assessments: rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { prisma, role, session } = ctx;
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.campId || typeof body.campId !== 'string') {
    return NextResponse.json({ error: 'campId required' }, { status: 400 });
  }
  if (!isValidDate(body.assessmentDate)) {
    return NextResponse.json({ error: 'assessmentDate must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!body.assessor || typeof body.assessor !== 'string') {
    return NextResponse.json({ error: 'assessor required' }, { status: 400 });
  }
  if (
    typeof body.palatableSpeciesPct !== 'number' ||
    body.palatableSpeciesPct < 0 ||
    body.palatableSpeciesPct > 100
  ) {
    return NextResponse.json({ error: 'palatableSpeciesPct must be 0..100' }, { status: 400 });
  }
  if (
    typeof body.bareGroundPct !== 'number' ||
    body.bareGroundPct < 0 ||
    body.bareGroundPct > 100
  ) {
    return NextResponse.json({ error: 'bareGroundPct must be 0..100' }, { status: 400 });
  }
  if (!isValidLevel(body.erosionLevel)) {
    return NextResponse.json({ error: 'erosionLevel must be 0|1|2' }, { status: 400 });
  }
  if (!isValidLevel(body.bushEncroachmentLevel)) {
    return NextResponse.json({ error: 'bushEncroachmentLevel must be 0|1|2' }, { status: 400 });
  }

  // Phase A of #28: campId is no longer globally unique (composite UNIQUE on
  // species+campId). findFirst is single-species-safe; Phase B will scope by species.
  const camp = await prisma.camp.findFirst({ where: { campId: body.campId }, select: { campId: true } });
  if (!camp) return NextResponse.json({ error: 'Camp not found' }, { status: 404 });

  const settings = await prisma.farmSettings.findUnique({
    where: { id: 'singleton' },
    select: { biomeType: true },
  });
  const biome = (settings?.biomeType ?? 'mixedveld') as BiomeType;

  const veldScore = calcVeldScore({
    palatableSpeciesPct: body.palatableSpeciesPct,
    bareGroundPct: body.bareGroundPct,
    erosionLevel: body.erosionLevel,
    bushEncroachmentLevel: body.bushEncroachmentLevel,
  });
  const { haPerLsu } = calcGrazingCapacity(biome, veldScore);

  const created = await prisma.veldAssessment.create({
    data: {
      campId: body.campId,
      assessmentDate: body.assessmentDate,
      assessor: body.assessor.slice(0, 100),
      palatableSpeciesPct: body.palatableSpeciesPct,
      bareGroundPct: body.bareGroundPct,
      erosionLevel: body.erosionLevel,
      bushEncroachmentLevel: body.bushEncroachmentLevel,
      veldScore,
      biomeAtAssessment: biome,
      haPerLsu,
      notes: body.notes?.slice(0, 2000),
      createdBy: session.user?.email ?? null,
    },
  });
  revalidateObservationWrite(farmSlug);
  return NextResponse.json({ assessment: created }, { status: 201 });
}
