import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import type { SessionFarm } from '@/types/next-auth';
import { getPrismaForFarm } from '@/lib/farm-prisma';
import { revalidateObservationWrite } from '@/lib/server/revalidate';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ farmSlug: string; id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { farmSlug, id } = await params;
  const farm = (session.user?.farms as SessionFarm[] | undefined)?.find((f) => f.slug === farmSlug);
  if (!farm) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (farm.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
  try {
    await prisma.veldAssessment.delete({ where: { id } });
    revalidateObservationWrite(farmSlug);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
  }
}
