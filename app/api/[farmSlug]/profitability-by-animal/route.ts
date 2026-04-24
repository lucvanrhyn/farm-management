import { NextRequest, NextResponse } from 'next/server'
import { getFarmContextForSlug } from '@/lib/server/farm-context-slug'
import { getFarmCreds } from '@/lib/meta-db'
import { getProfitabilityByAnimal } from '@/lib/server/profitability-by-animal'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params
  const ctx = await getFarmContextForSlug(farmSlug, req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Read tier from meta-db — the fast-path synthesised session only carries
  // role, not tier, so we can't rely on session.user.farms[*].tier here.
  const creds = await getFarmCreds(farmSlug)
  if (!creds) return NextResponse.json({ error: 'Farm not found' }, { status: 404 })
  const ADVANCED_TIERS = new Set(['advanced', 'enterprise', 'consulting'])
  if (!ADVANCED_TIERS.has(creds.tier)) {
    return NextResponse.json({ error: 'Advanced plan required' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  let dateRange: { from: string; to: string } | undefined
  if (fromParam && toParam) {
    const fromDate = new Date(fromParam)
    const toDate = new Date(toParam)
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date params' }, { status: 400 })
    }
    dateRange = { from: fromParam, to: toParam }
  }

  try {
    const rows = await getProfitabilityByAnimal(ctx.prisma, dateRange)
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[profitability-by-animal] query failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
