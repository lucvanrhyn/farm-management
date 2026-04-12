import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getFarmSubscription } from '@/lib/meta-db';

/**
 * GET /api/subscription/status?farm=<slug>
 * Returns the live subscription_status from the meta DB for a farm.
 * Used by /subscribe/complete to poll until the ITN is processed.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const farmSlug = searchParams.get('farm');

  if (!farmSlug) {
    return NextResponse.json({ error: 'Missing farm param' }, { status: 400 });
  }

  // Verify the user has access to this farm
  const hasFarm = session.user.farms.some((f) => f.slug === farmSlug);
  if (!hasFarm) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sub = await getFarmSubscription(farmSlug);
  return NextResponse.json({
    subscriptionStatus: sub?.subscriptionStatus ?? 'inactive',
  });
}
