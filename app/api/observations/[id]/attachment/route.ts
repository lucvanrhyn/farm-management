import { NextRequest, NextResponse } from 'next/server';
import { getFarmContext } from '@/lib/server/farm-context';
import { revalidateObservationWrite } from '@/lib/server/revalidate';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getFarmContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { prisma, slug } = ctx;

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

    revalidateObservationWrite(slug);
    return NextResponse.json({ success: true, attachmentUrl: updated.attachmentUrl });
  } catch (err) {
    console.error('[observations/attachment PATCH] DB error:', err);
    return NextResponse.json({ error: 'Failed to update attachment' }, { status: 500 });
  }
}
