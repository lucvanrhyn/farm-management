export interface AnimalProfitabilityInput {
  taggedTransactions: { animalId: string; type: string; amount: number }[]
  campTransactions: { campId: string; type: string; amount: number }[]
  animals: {
    animalId: string
    tagNumber: string
    name: string | null
    category: string
    currentCamp: string
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
  for (const animal of animals) {
    acc.set(animal.animalId, { income: 0, expenses: 0 })
  }

  for (const tx of taggedTransactions) {
    const entry = acc.get(tx.animalId)
    if (!entry) continue
    if (tx.type === 'income') {
      entry.income += tx.amount
    } else {
      entry.expenses += tx.amount
    }
  }

  const animalsByCamp = new Map<string, string[]>()
  for (const animal of animals) {
    const list = animalsByCamp.get(animal.currentCamp) ?? []
    list.push(animal.animalId)
    animalsByCamp.set(animal.currentCamp, list)
  }

  for (const tx of campTransactions) {
    if (tx.type !== 'expense') continue
    const campAnimals = animalsByCamp.get(tx.campId) ?? []
    if (campAnimals.length === 0) continue
    const share = tx.amount / campAnimals.length
    for (const animalId of campAnimals) {
      const entry = acc.get(animalId)
      if (entry) entry.expenses += share
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
