import { put } from '@vercel/blob';
import { getServerSession } from 'next-auth';
import { cookies } from 'next/headers';
import { authOptions } from '@/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server';
import type { SessionFarm } from '@/types/next-auth';

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[photos/upload] BLOB_READ_WRITE_TOKEN is not configured');
    return NextResponse.json(
      { error: 'Photo uploads are not configured. Please contact your administrator.' },
      { status: 503 },
    );
  }

  // Resolve the active farm from the `active_farm_slug` cookie set by proxy.ts,
  // and verify it is one this user has access to. Falling back to `farms[0]`
  // (previous behaviour) would namespace blobs to the wrong tenant for any
  // user who belongs to more than one farm.
  const cookieStore = await cookies();
  const activeSlug = cookieStore.get('active_farm_slug')?.value;
  const farms = (session.user as { farms?: SessionFarm[] }).farms;
  const farm = activeSlug ? farms?.find((f) => f.slug === activeSlug) : undefined;
  if (!farm) {
    return NextResponse.json(
      { error: 'No active farm selected. Open a farm before uploading photos.' },
      { status: 400 },
    );
  }

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
    const blob = await put(`farm-photos/${farm.slug}/${Date.now()}-${safeName}`, file, { access: 'public' });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error('[photos/upload] Blob upload failed:', err);
    return NextResponse.json({ error: 'Photo upload failed. Please try again.' }, { status: 500 });
  }
}
