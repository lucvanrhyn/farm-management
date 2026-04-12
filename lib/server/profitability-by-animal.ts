import { PrismaClient } from '@prisma/client'
import {
  calcProfitabilityByAnimal,
  AnimalProfitabilityRow,
} from '@/lib/calculators/profitability-per-animal'

export async function getProfitabilityByAnimal(
  prisma: PrismaClient,
  dateRange?: { from: string; to: string },
): Promise<AnimalProfitabilityRow[]> {
  const dateFilter = dateRange
    ? { gte: dateRange.from, lte: dateRange.to }
    : undefined

  const [transactions, animals] = await Promise.all([
    prisma.transaction.findMany({
      where: dateFilter ? { date: dateFilter } : {},
      select: { animalId: true, campId: true, type: true, amount: true },
    }),
    prisma.animal.findMany({
      where: { status: 'Active' },
      select: { animalId: true, name: true, category: true, currentCamp: true },
    }),
  ])

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
