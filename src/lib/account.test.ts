import { describe, expect, it } from 'vitest'
import type { Person } from '../types'
import { closePosition, createAccount, invest, openPnl, portfolioValue } from './account'

const nasdaq: Person = { id: '1', screenName: 'nasdaq', name: 'NQ', avatarUrl: null }
const other: Person = { id: '2', screenName: 'other', name: 'Other', avatarUrl: null }

const order = {
  venue: 'stock' as const,
  symbol: 'NVDA',
  name: 'NVIDIA',
  label: 'NVDA',
  person: nasdaq,
  amount: 10_000,
  price: 100,
  now: 1,
}

describe('paper account', () => {
  it('opens a position and marks it', () => {
    const opened = invest(createAccount(), order)
    expect(opened.account.cash).toBe(90_000)
    expect(opened.account.positions).toHaveLength(1)
    expect(opened.account.positions[0]?.qty).toBe(100)
    expect(opened.fill.person.screenName).toBe('nasdaq')
    const prices = { 'stock:NVDA': 110 }
    expect(portfolioValue(opened.account, prices)).toBe(101_000)
    expect(openPnl(opened.account.positions[0]!, 110)).toBe(1_000)
  })

  it('averages a second buy for the same person', () => {
    const first = invest(createAccount(), order).account
    const second = invest(first, { ...order, amount: 5_000, price: 150, now: 2 }).account
    const position = second.positions[0]!
    expect(second.positions).toHaveLength(1)
    expect(position.qty).toBeCloseTo(100 + 5_000 / 150)
    expect(position.avgPrice).toBeCloseTo(112.5)
    expect(second.cash).toBe(85_000)
  })

  it('keeps a separate position for another person', () => {
    const first = invest(createAccount(), order).account
    const second = invest(first, { ...order, person: other, amount: 2_000, now: 2 }).account
    expect(second.positions).toHaveLength(2)
  })

  it('refuses cash you do not have and a missing person', () => {
    expect(() => invest(createAccount(), { ...order, amount: 100_001 })).toThrow(/cash/)
    expect(() =>
      invest(createAccount(), { ...order, person: { ...nasdaq, screenName: '  ' } }),
    ).toThrow(/person/)
  })

  it('closes at the mark and keeps the realized result', () => {
    const opened = invest(createAccount(), order).account
    const closed = closePosition(opened, opened.positions[0]!.id, 110, 3)
    expect(closed.account.positions).toHaveLength(0)
    expect(closed.account.cash).toBe(101_000)
    expect(closed.account.realized).toBe(1_000)
    expect(closed.fill.side).toBe('sell')
    expect(portfolioValue(closed.account, {})).toBe(101_000)
  })
})
