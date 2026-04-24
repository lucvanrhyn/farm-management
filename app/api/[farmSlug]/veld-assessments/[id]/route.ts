import { NextRequest, NextResponse } from 'next/server';
import { getFarmContextForSlug } from '@/lib/server/farm-context-slug';
import { verifyFreshAdminRole } from '@/lib/auth';
import { revalidateObservationWrite } from '@/lib/server/revalidate';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; id: string }> },
) {
  const { farmSlug, id } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await prisma.veldAssessment.delete({ where: { id } });
    revalidateObservationWrite(farmSlug);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
  }
}
