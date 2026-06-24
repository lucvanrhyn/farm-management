/**
 * Ledger category string for the "Animal Purchases" reconciliation rule. When an
 * animal's `purchasePrice` column is set, its tagged purchase-expense transactions
 * (category === ANIMAL_PURCHASES_CATEGORY) are skipped so the opening cost is not
 * double-charged (CONTEXT.md "Purchase-price reconciliation — column-wins").
 */
export const ANIMAL_PURCHASES_CATEGORY = 'Animal Purchases'

export interface AnimalProfitabilityInput {
  taggedTransactions: { animalId: string; type: string; amount: number; category: string }[]
  campTransactions: { campId: string; type: string; amount: number }[]
  animals: {
    animalId: string
    tagNumber: string
    name: string | null
    category: string
    currentCamp: string
    /**
     * Animal.purchasePrice — when set, this is the animal's opening cost and the
     * column WINS over summing its tagged "Animal Purchases" expense tx (never
     * both, else the purchase is double-charged). Null/undefined for home-bred
     * animals falls back to the tagged-transaction sum (today's behaviour).
     */
    purchasePrice?: number | null
    /**
     * Whether the animal is currently on the farm (status === "Active"). Camp-tagged
     * expenses (feed/lick/dip) are split across the camp's ACTIVE animals only — a
     * sold/deceased/culled animal must not dilute the share borne by current animals
     * nor be charged costs incurred after it left. Defaults to active when omitted
     * (the Active-only callers pass an all-active roster, so behaviour is unchanged).
     */
    active?: boolean
  }[]
}

export interface AnimalProfitabilityRow {
  animalId: string
  tagNumber: string
  name: string | null
  category: string
  income: number
  expenses: number
  margin: number
}

export function calcProfitabilityByAnimal(
  input: AnimalProfitabilityInput,
): AnimalProfitabilityRow[] {
  const { taggedTransactions, campTransactions, animals } = input

  const acc = new Map<string, { income: number; expenses: number }>()
  // Animals whose purchasePrice column is set: their opening cost comes from the
  // column, and their tagged "Animal Purchases" expense tx are SKIPPED below so
  // the purchase is not double-charged (column-wins reconciliation).
  const purchasePriceByAnimal = new Map<string, number>()
  for (const animal of animals) {
    const opening =
      animal.purchasePrice != null && Number.isFinite(animal.purchasePrice)
        ? animal.purchasePrice
        : 0
    if (opening !== 0 || animal.purchasePrice != null) {
      purchasePriceByAnimal.set(animal.animalId, animal.purchasePrice ?? 0)
    }
    acc.set(animal.animalId, { income: 0, expenses: opening })
  }

  for (const tx of taggedTransactions) {
    const entry = acc.get(tx.animalId)
    if (!entry) continue
    if (tx.type !== 'income' && tx.type !== 'expense') continue
    // Column-wins: when this animal's purchasePrice column is set, drop its
    // tagged "Animal Purchases" expense so the acquisition is counted once.
    if (
      tx.type === 'expense' &&
      tx.category === ANIMAL_PURCHASES_CATEGORY &&
      purchasePriceByAnimal.has(tx.animalId)
    ) {
      continue
    }
    acc.set(
      tx.animalId,
      tx.type === 'income'
        ? { ...entry, income: entry.income + tx.amount }
        : { ...entry, expenses: entry.expenses + tx.amount },
    )
  }

  // Camp-tagged expenses are split across the camp's ACTIVE animals only. A
  // disposed animal (active === false) keeps its last currentCamp but must not
  // dilute the share borne by animals still on the farm, nor be charged costs
  // incurred after it left. Omitted active flag = active (Active-only callers).
  const animalsByCamp = new Map<string, string[]>()
  for (const animal of animals) {
    if (animal.active === false) continue
    animalsByCamp.set(
      animal.currentCamp,
      [...(animalsByCamp.get(animal.currentCamp) ?? []), animal.animalId],
    )
  }

  for (const tx of campTransactions) {
    if (tx.type !== 'expense') continue
    const campAnimals = animalsByCamp.get(tx.campId) ?? []
    if (campAnimals.length === 0) continue
    const share = tx.amount / campAnimals.length
    for (const animalId of campAnimals) {
      const entry = acc.get(animalId)
      if (entry) acc.set(animalId, { ...entry, expenses: entry.expenses + share })
    }
  }

  return animals
    .map((animal) => {
      const entry = acc.get(animal.animalId) ?? { income: 0, expenses: 0 }
      return {
        animalId: animal.animalId,
        tagNumber: animal.tagNumber,
        name: animal.name,
        category: animal.category,
        income: entry.income,
        expenses: entry.expenses,
        margin: entry.income - entry.expenses,
      }
    })
    .sort((a, b) => b.margin - a.margin)
}
