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
      taggedTransactions: [{ animalId: 'B001', type: 'income', amount: 5000, category: 'Livestock Sales' }],
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

  it('splits camp expense across ACTIVE animals only — a disposed animal does not dilute the share', () => {
    // Regression: the disposed-inclusive view passes Sold/Deceased/Culled animals
    // (which keep their last currentCamp) into the calc. They must NOT take a share
    // of camp-tagged costs, nor reduce the share borne by animals still on the farm.
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [],
      campTransactions: [{ campId: 'camp-1', type: 'expense', amount: 1000 }],
      animals: [
        { animalId: 'A1', tagNumber: 'A1', name: null, category: 'Cows', currentCamp: 'camp-1', active: true },
        { animalId: 'A2', tagNumber: 'A2', name: null, category: 'Cows', currentCamp: 'camp-1', active: false },
      ],
    })
    const a1 = result.find(r => r.animalId === 'A1')!
    const a2 = result.find(r => r.animalId === 'A2')!
    expect(a1.expenses).toBeCloseTo(1000) // sole active animal bears the full camp cost
    expect(a2.expenses).toBe(0) // disposed: not charged camp costs incurred after it left
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
      taggedTransactions: [{ animalId: 'B001', type: 'expense', amount: 200, category: 'Feed' }],
      campTransactions: [{ campId: 'camp-1', type: 'expense', amount: 400 }],
      animals: ANIMALS,
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    expect(b001.expenses).toBeCloseTo(400) // 200 direct + 200 allocated
  })

  it('sorts result by margin descending', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [
        { animalId: 'B003', type: 'income', amount: 9000, category: 'Livestock Sales' },
        { animalId: 'B001', type: 'income', amount: 1000, category: 'Livestock Sales' },
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
      taggedTransactions: [{ animalId: 'UNKNOWN', type: 'income', amount: 9999, category: 'Livestock Sales' }],
      campTransactions: [],
      animals: ANIMALS,
    })
    expect(result).toHaveLength(3)
    const total = result.reduce((s, r) => s + r.income, 0)
    expect(total).toBe(0)
  })

  it('verifies both animals in same camp each receive half of camp expense', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [{ animalId: 'B001', type: 'expense', amount: 200, category: 'Feed' }],
      campTransactions: [{ campId: 'camp-1', type: 'expense', amount: 400 }],
      animals: ANIMALS,
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    const b002 = result.find(r => r.animalId === 'B002')!
    expect(b001.expenses).toBeCloseTo(400) // 200 direct + 200 allocated
    expect(b002.expenses).toBeCloseTo(200) // 200 allocated only
  })
})

describe('calcProfitabilityByAnimal — purchasePrice reconciliation (column-wins)', () => {
  it('uses the purchasePrice column as opening cost and SKIPS the tagged "Animal Purchases" tx (no double-count)', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [
        // The ledger purchase event for B001; should be skipped because the column wins.
        { animalId: 'B001', type: 'expense', amount: 8000, category: 'Animal Purchases' },
      ],
      campTransactions: [],
      animals: [
        { animalId: 'B001', tagNumber: 'B001', name: 'Bought', category: 'Cows', currentCamp: 'camp-1', purchasePrice: 9000 },
      ],
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    // Column wins: opening cost = 9000, the 8000 tagged purchase is NOT also charged.
    expect(b001.expenses).toBe(9000)
  })

  it('still charges non-purchase tagged expenses when the purchasePrice column is set', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [
        { animalId: 'B001', type: 'expense', amount: 8000, category: 'Animal Purchases' }, // skipped
        { animalId: 'B001', type: 'expense', amount: 500, category: 'Vet' }, // kept
        { animalId: 'B001', type: 'income', amount: 12000, category: 'Livestock Sales' }, // kept
      ],
      campTransactions: [],
      animals: [
        { animalId: 'B001', tagNumber: 'B001', name: 'Bought', category: 'Cows', currentCamp: 'camp-1', purchasePrice: 9000 },
      ],
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    expect(b001.expenses).toBe(9500) // 9000 column + 500 vet (purchase tx skipped)
    expect(b001.income).toBe(12000)
    expect(b001.margin).toBe(2500)
  })

  it('falls back to summing tagged "Animal Purchases" tx when purchasePrice is null (home-bred animal)', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [
        { animalId: 'B001', type: 'expense', amount: 8000, category: 'Animal Purchases' },
      ],
      campTransactions: [],
      animals: [
        { animalId: 'B001', tagNumber: 'B001', name: 'HomeBred', category: 'Cows', currentCamp: 'camp-1', purchasePrice: null },
      ],
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    // No column -> the tagged purchase IS charged (today's behaviour).
    expect(b001.expenses).toBe(8000)
  })

  it('treats a purchasePrice of 0 as an explicit column win (skips the tagged purchase, charges 0)', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [
        { animalId: 'B001', type: 'expense', amount: 8000, category: 'Animal Purchases' },
      ],
      campTransactions: [],
      animals: [
        { animalId: 'B001', tagNumber: 'B001', name: 'Gift', category: 'Cows', currentCamp: 'camp-1', purchasePrice: 0 },
      ],
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    expect(b001.expenses).toBe(0)
  })

  it('omitting purchasePrice (undefined) behaves like home-bred fallback', () => {
    const result = calcProfitabilityByAnimal({
      taggedTransactions: [
        { animalId: 'B001', type: 'expense', amount: 8000, category: 'Animal Purchases' },
      ],
      campTransactions: [],
      animals: [
        { animalId: 'B001', tagNumber: 'B001', name: 'NoCol', category: 'Cows', currentCamp: 'camp-1' },
      ],
    })
    const b001 = result.find(r => r.animalId === 'B001')!
    expect(b001.expenses).toBe(8000)
  })
})
