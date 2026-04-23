import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getPrismaWithAuth } from '@/lib/farm-prisma';
import { revalidateObservationWrite } from '@/lib/server/revalidate';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ('error' in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const { id } = await params;
  const body = await request.json();
  const { attachmentUrl } = body;

  if (typeof attachmentUrl !== 'string' || !attachmentUrl) {
    return NextResponse.json({ error: 'attachmentUrl must be a non-empty string' }, { status: 400 });
  }

  try {
    const existing = await prisma.observation.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const updated = await prisma.observation.update({
      where: { id },
      data: { attachmentUrl },
    });

    revalidateObservationWrite(db.slug);
    return NextResponse.json({ success: true, attachmentUrl: updated.attachmentUrl });
  } catch (err) {
    console.error('[observations/attachment PATCH] DB error:', err);
    return NextResponse.json({ error: 'Failed to update attachment' }, { status: 500 });
  }
}
