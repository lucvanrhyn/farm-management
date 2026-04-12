import { describe, it, expect } from 'vitest'
import { calcProfitabilityByAnimal } from '@/lib/calculators/profitability-per-animal'

const ANIMALS = [
  { animalId: 'B001', tagNumber: 'B001', name: 'Bessie', category: 'Cows', currentCamp: 'camp-1' },
  { animalId: 'B002', tagNumber: 'B002', name: null, category: 'Cows', currentCamp: 'camp-1' },
  { animalId: 'B003', tagNumber: 'B003', name: 'Bull', category: 'Bulls', currentCamp: 'camp-2' },
]

describe('calcProfitabilityByAnimal', () => {
  it('attributes direct income to the tagged animal', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [{ animalId: 'B001', type: 'income', amount: 5000 }],
      campTransactions: [],
      animals: ANIMALS,
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    expect(b001.income).toBe(5000)
    expect(b001.expenses).toBe(0)
    expect(b001.margin).toBe(5000)
  })

  it('splits camp expense evenly across animals in that camp', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [],
      campTransactions: [{ campId: 'camp-1', type: 'expense', amount: 1000 }],
      animals: ANIMALS,
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    const b002 = result.find(r => r.animalId === 'B002')!
    const b003 = result.find(r => r.animalId === 'B003')!
    expect(b001.expenses).toBeCloseTo(500)
    expect(b002.expenses).toBeCloseTo(500)
    expect(b003.expenses).toBe(0) // different camp
  })

  it('excludes camp income from pro-rata (income is not allocated)', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [],
      campTransactions: [{ campId: 'camp-1', type: 'income', amount: 9000 }],
      animals: ANIMALS,
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    expect(b001.income).toBe(0)
    expect(b001.expenses).toBe(0)
  })

  it('ignores camp expenses for camps with no animals', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [],
      campTransactions: [{ campId: 'empty-camp', type: 'expense', amount: 500 }],
      animals: ANIMALS,
    })
    const total = result.reduce((s, r) => s + r.expenses, 0)
    expect(total).toBe(0)
  })

  it('combines direct and allocated expenses correctly', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [{ animalId: 'B001', type: 'expense', amount: 200 }],
      campTransactions: [{ campId: 'camp-1', type: 'expense', amount: 400 }],
      animals: ANIMALS,
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    expect(b001.expenses).toBeCloseTo(400) // 200 direct + 200 allocated
  })

  it('sorts result by margin descending', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [
        { animalId: 'B003', type: 'income', amount: 9000 },
        { animalId: 'B001', type: 'income', amount: 1000 },
      ],
      campTransactions: [],
      animals: ANIMALS,
    })
    expect(result[0].animalId).toBe('B003')
    expect(result[1].animalId).toBe('B001')
  })

  it('returns all animals even those with zero transactions', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [],
      campTransactions: [],
      animals: ANIMALS,
    })
    expect(result).toHaveLength(3)
    result.forEach(r => {
      expect(r.income).toBe(0)
      expect(r.expenses).toBe(0)
      expect(r.margin).toBe(0)
    })
  })

  it('drops orphaned transactions for animals not in the animals array', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [{ animalId: 'UNKNOWN', type: 'income', amount: 9999 }],
      campTransactions: [],
      animals: ANIMALS,
    })
    expect(result).toHaveLength(3)
    const total = result.reduce((s, r) => s + r.income, 0)
    expect(total).toBe(0)
  })

  it('verifies both animals in same camp each receive half of camp expense', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [{ animalId: 'B001', type: 'expense', amount: 200 }],
      campTransactions: [{ campId: 'camp-1', type: 'expense', amount: 400 }],
      animals: ANIMALS,
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    const b002 = result.find(r => r.animalId === 'B002')!
    expect(b001.expenses).toBeCloseTo(400) // 200 direct + 200 allocated
    expect(b002.expenses).toBeCloseTo(200) // 200 allocated only
  })
})
