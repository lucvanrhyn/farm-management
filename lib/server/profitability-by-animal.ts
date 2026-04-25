import type { PrismaClient, Prisma } from '@prisma/client'
import {
  calcProfitabilityByAnimal,
  AnimalProfitabilityRow,
} from '@/lib/calculators/profitability-per-animal'

// Multi-tenancy is enforced at the connection level: each farm has its own Turso
// database, and `prisma` is already scoped to the correct farm via getPrismaForFarm().
// No additional farmId column filter is needed.
export async function getProfitabilityByAnimal(
  prisma: PrismaClient,
  dateRange?: { from: string; to: string },
): Promise<AnimalProfitabilityRow[]> {
  const txWhere: Prisma.TransactionWhereInput = dateRange
    ? { date: { gte: dateRange.from, lte: dateRange.to } }
    : {}

  const [transactions, animals] = await Promise.all([
    prisma.transaction.findMany({
      where: txWhere,
      select: { animalId: true, campId: true, type: true, amount: true },
    }),
    // cross-species by design: profitability-per-animal spans every species.
    prisma.animal.findMany({
      where: { status: 'Active' },
      select: { animalId: true, name: true, category: true, currentCamp: true },
    }),
  ])

  // amounts are expected to be positive; negative amounts (corrections/reversals) will
  // invert the allocation math — callers should validate before passing to this function
  const taggedTransactions = transactions
    .filter((t) => t.animalId != null)
    .map((t) => ({
      animalId: t.animalId!,
      type: t.type.toLowerCase(),
      amount: t.amount,
    }))

  const campTransactions = transactions
    .filter((t) => t.campId != null && t.animalId == null)
    .map((t) => ({
      campId: t.campId!,
      type: t.type.toLowerCase(),
      amount: t.amount,
    }))

  const animalInputs = animals.map((a) => ({
    animalId: a.animalId,
    // animalId is the business tag (e.g. "B042"); there is no separate tagNumber field on Animal
    tagNumber: a.animalId,
    name: a.name,
    category: a.category,
    currentCamp: a.currentCamp,
  }))

  return calcProfitabilityByAnimal({
    taggedTransactions,
    campTransactions,
    animals: animalInputs,
  })
}
