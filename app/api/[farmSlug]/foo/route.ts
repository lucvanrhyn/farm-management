import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import type { SessionFarm } from '@/types/next-auth';
import { getPrismaForFarm } from '@/lib/farm-prisma';
import { getFarmFooPayload } from '@/lib/server/foo';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { farmSlug } = await params;
  const accessible = (session.user?.farms as SessionFarm[] | undefined)?.some(
    (f) => f.slug === farmSlug,
  );
  if (!accessible) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });

  const payload = await getFarmFooPayload(prisma);
  return NextResponse.json(payload);
}
