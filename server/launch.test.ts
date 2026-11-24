import { describe, expect, it } from 'vitest'
import { memoryStore, type PaymentRow } from './store.ts'
import {
  applyShock,
  cleanLaunchSymbol,
  launchAmounts,
  launchCandles,
  nextShockDelay,
  noiseSeed,
  planBuy,
  planSell,
  planSpend,
  priceOf,
  rollShock,
  seedLaunch,
  shockLaunch,
} from './launch.ts'

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

  it('walks Noise at a random size and prints it onto the candles', () => {
    const sell = rollShock(() => 0)
    expect(sell).toEqual({ side: 'sell', giant: true, magnitude: 0.08 })
    const buy = rollShock(() => 0.99)
    expect(buy.side).toBe('buy')
    expect(buy.giant).toBe(false)
    expect(buy.magnitude).toBeCloseTo(0.023775)
    expect(nextShockDelay(() => 0)).toBe(5_000)
    expect(nextShockDelay(() => 1)).toBe(75_000)
    const seeded = noiseSeed(1_000)
    const shocked = applyShock(seeded, sell, 2_000)
    expect(shocked.cashCents).toBe(0)
    expect(shocked.supply).toBe(0)
    expect(priceOf(shocked)).toBeCloseTo(0.92)
    const candles = launchCandles(shocked, '1m')
    expect(candles).toHaveLength(1)
    expect(candles[0]).toMatchObject({ open: 1, high: 1, low: 0.92, close: 0.92 })
    const later = applyShock(shocked, { side: 'buy', magnitude: 0.5 }, 70_000)
    const next = launchCandles(later, '1m')
    expect(next).toHaveLength(2)
    expect(next[1]?.close).toBeCloseTo(1.38)
    const flat = planSell(later, 0, 0, 80_000)
    expect(priceOf(flat)).toBeCloseTo(1.38)
    expect(shockLaunch(seedLaunch({ id: '9', screenName: 'ada', name: 'Ada', avatarUrl: null }, 'NOISE', 'Noise', 100, 0, 1), 2, () => 0)).toBeNull()
  })

  it('seeds Noise without a holder and leaves a real NOISE launch alone', async () => {
    const ledger = memoryStore()
    await ledger.shockNoise(2_000, () => 0)
    expect(await ledger.positions()).toEqual([])
    expect((await ledger.launchCandles('NOISE', '1m'))[0]?.close).toBeCloseTo(0.92)
    const ada = { id: '9', screenName: 'ada', name: 'Ada', avatarUrl: null }
    const owned = memoryStore()
    const row: PaymentRow = {
      id: 'v',
      status: 'processing',
      amountCents: 5000,
      note: 'vault',
      desk: 'nasdaq',
      senderId: ada.id,
      senderName: ada.name,
      senderScreen: ada.screenName,
      avatarUrl: null,
      detail: '',
      updatedAt: 1,
    }
    await owned.creditVault(row, ada)
    const opened = await owned.openLaunch({
      person: ada,
      symbol: 'NOISE',
      name: 'Noise',
      liquidityCents: 1000,
      investCents: 0,
      now: 2,
    })
    expect(opened.ok).toBe(true)
    await owned.shockNoise(3_000, () => 0)
    expect((await owned.launchQuote('NOISE'))?.price).toBe(1)
    expect((await owned.launchQuote('NOISE'))?.creator).toBe('ada')
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
