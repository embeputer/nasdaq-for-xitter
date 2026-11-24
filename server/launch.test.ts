import { describe, expect, it } from 'vitest'
import { cleanLaunchSymbol, launchAmounts, planBuy, planSell, planSpend, priceOf, seedLaunch } from './launch.ts'

const ada = { id: '9', screenName: 'ada', name: 'Ada', avatarUrl: null }

describe('user stocks', () => {
  it('keeps liquidity in the fund and lifts 10% of the next buy', () => {
    const seeded = seedLaunch(ada, 'YAMS', 'Yams', 10_000, 10_000, 10)
    expect(seeded.label).toBe('xitYAMS')
    expect(seeded.cashCents).toBe(20_000)
    expect(seeded.supply).toBe(100)
    expect(priceOf(seeded)).toBe(1)
    expect(cleanLaunchSymbol('xitYAMS')).toBe('YAMS')
    expect(cleanLaunchSymbol('y')).toBeNull()
    const bought = planBuy(seeded, 10_000, 20)
    expect(bought).not.toBeNull()
    expect(bought?.qty).toBeCloseTo(90)
    expect(bought?.launch.cashCents).toBe(30_000)
    expect(bought?.launch.supply).toBeCloseTo(190)
    expect(priceOf(bought!.launch)).toBeCloseTo(20 / 19)
    const payout = Math.round(100 * priceOf(bought!.launch) * 100)
    const sold = planSell(bought!.launch, 100, payout, 30)
    expect(sold.supply).toBeCloseTo(90)
    expect(priceOf(sold)).toBeCloseTo(20 / 19)
    expect(sold.cashCents + payout).toBe(30_000)
  })

  it('quotes $1 with no shares until the first buy', () => {
    const seeded = seedLaunch(ada, 'YAMS', 'Yams', 10_000, 0, 10)
    expect(seeded.supply).toBe(0)
    expect(seeded.cashCents).toBe(10_000)
    expect(priceOf(seeded)).toBe(1)
    const bought = planBuy(seeded, 10_000, 20)
    expect(bought?.qty).toBeCloseTo(90)
    expect(bought?.launch.cashCents).toBe(20_000)
    expect(priceOf(bought!.launch)).toBeCloseTo(100 / 90)
    const payout = Math.round(bought!.qty * priceOf(bought!.launch) * 100)
    const sold = planSell(bought!.launch, bought!.qty, payout, 30)
    expect(sold.supply).toBe(0)
    expect(priceOf(sold)).toBe(1)
    expect(sold.cashCents).toBe(10_000)
  })

  it('rejects a fund under $1 and an invest under $1', () => {
    expect(launchAmounts(50, 0)).toMatchObject({ ok: false, error: 'small' })
    expect(launchAmounts(100, 50)).toMatchObject({ ok: false, error: 'bad_invest' })
    expect(launchAmounts(100, 0)).toEqual({ liquidityCents: 100, investCents: 0 })
    expect(launchAmounts(100, 100)).toEqual({ liquidityCents: 100, investCents: 100 })
  })

  it('spends the largest desk first', () => {
    const spent = planSpend(
      [
        { key: 'a', desks: { nyse: 200, nasdaq: 800 } },
        { key: 'b', desks: { nasdaq: 50 } },
      ],
      900,
    )
    expect(spent?.spends).toEqual([
      { desk: 'nasdaq', cents: 800 },
      { desk: 'nyse', cents: 100 },
    ])
    expect(spent?.next.find((row) => row.key === 'a')?.desks).toEqual({ nyse: 100 })
    expect(spent?.next.find((row) => row.key === 'b')?.desks).toEqual({ nasdaq: 50 })
    expect(planSpend([{ key: 'a', desks: { nasdaq: 50 } }], 100)).toBeNull()
  })
})
