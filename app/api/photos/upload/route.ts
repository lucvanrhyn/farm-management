import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { getFarmContext } from '@/lib/server/farm-context';
import { logger } from '@/lib/logger';

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    logger.error('[photos/upload] BLOB_READ_WRITE_TOKEN is not configured');
    return NextResponse.json(
      { error: 'Photo uploads are not configured. Please contact your administrator.' },
      { status: 503 },
    );
  }

  // `ctx.slug` is the active farm slug (signed from the cookie by proxy.ts,
  // or resolved via the legacy getServerSession path). Access to it was
  // already verified by farm-context.ts.
  const { slug } = ctx;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large (max 4MB)' }, { status: 413 });
  }

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Only image files are allowed (JPEG, PNG, WebP, HEIC).' }, { status: 415 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    const blob = await put(`farm-photos/${slug}/${Date.now()}-${safeName}`, file, { access: 'public' });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    logger.error('[photos/upload] Blob upload failed', err);
    return NextResponse.json({ error: 'Photo upload failed. Please try again.' }, { status: 500 });
  }
}
