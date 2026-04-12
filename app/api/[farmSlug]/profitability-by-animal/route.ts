import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-options'
import { getPrismaForFarm } from '@/lib/farm-prisma'
import { getProfitabilityByAnimal } from '@/lib/server/profitability-by-animal'
import type { SessionFarm } from '@/types/next-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { farmSlug } = await params
  const farms = session.user?.farms as SessionFarm[] | undefined
  const farm = farms?.find((f) => f.slug === farmSlug)
  if (!farm) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const ADVANCED_TIERS = new Set(['advanced', 'enterprise'])
  if (!ADVANCED_TIERS.has(farm.tier)) {
    return NextResponse.json({ error: 'Advanced plan required' }, { status: 403 })
  }

  const prisma = await getPrismaForFarm(farmSlug)
  if (!prisma) {
    return NextResponse.json({ error: 'Farm not found' }, { status: 404 })
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
    const rows = await getProfitabilityByAnimal(prisma, dateRange)
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[profitability-by-animal] query failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
