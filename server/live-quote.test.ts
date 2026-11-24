import { describe, expect, it } from 'vitest'
import { stockMark } from './market.ts'

const session = { regular: { start: 1_000, end: 2_000 } }
const meta = {
  regularMarketPrice: 165.05,
  fulldayPrice: 156,
  fulldayChange: -9.05,
  fulldayChangePercent: -5.483,
  chartPreviousClose: 160,
  regularMarketChangePercent: 3.1,
  currentTradingPeriod: session,
}

describe('stock mark', () => {
  it('uses the extended price before the open and after the close', () => {
    expect(stockMark(meta, 999 * 1000)).toEqual({ price: 156, change: -9.05, changePct: -5.483 })
    expect(stockMark(meta, 2_000 * 1000)).toEqual({ price: 156, change: -9.05, changePct: -5.483 })
  })

  it('uses the regular price while the session is open', () => {
    const open = stockMark(meta, 1_000 * 1000)
    expect(open?.price).toBe(165.05)
    expect(open?.change).toBeCloseTo(5.05)
    expect(open?.changePct).toBe(3.1)
    expect(stockMark(meta, 1_500 * 1000)?.price).toBe(165.05)
  })

  it('falls back to the regular price only when the extended price is missing', () => {
    expect(stockMark({ ...meta, fulldayPrice: undefined }, 999 * 1000)?.price).toBe(165.05)
    expect(stockMark({ ...meta, currentTradingPeriod: undefined }, 999 * 1000)?.price).toBe(156)
  })
})
