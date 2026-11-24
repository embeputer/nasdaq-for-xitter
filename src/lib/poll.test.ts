import { describe, expect, it } from 'vitest'
import { CRYPTO_POLL_MS, STOCK_POLL_MS, candlePollMs, quoteGroups } from './poll.ts'

describe('quote polls', () => {
  it('refreshes crypto every 2 seconds and stocks every 10', () => {
    expect(CRYPTO_POLL_MS).toBe(2_000)
    expect(STOCK_POLL_MS).toBe(10_000)
    expect(quoteGroups(['crypto:BTCUSDT', 'stock:NVDA', 'launch:YAMS', 'launch:NOISE', 'crypto:ETHUSDT'])).toEqual({
      fast: ['crypto:BTCUSDT', 'launch:NOISE', 'crypto:ETHUSDT'],
      slow: ['stock:NVDA', 'launch:YAMS'],
    })
    expect(candlePollMs('crypto')).toBe(2_000)
    expect(candlePollMs('stock')).toBe(10_000)
    expect(candlePollMs('launch', 'YAMS')).toBe(10_000)
    expect(candlePollMs('launch', 'NOISE')).toBe(2_000)
  })
})
