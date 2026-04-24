import { NextRequest, NextResponse } from 'next/server';
import { getFarmContextForSlug } from '@/lib/server/farm-context-slug';
import { getFarmSummary } from '@/lib/server/veld-score';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const summary = await getFarmSummary(ctx.prisma);
  return NextResponse.json(summary);
}
