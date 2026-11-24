import { describe, expect, it } from 'vitest'
import { chartScaleAction } from './ChartPane.tsx'

describe('chart zoom', () => {
  it('fits the first candles for a symbol and keeps the range when they update', () => {
    expect(chartScaleAction(null, 'stock:SPY', 0)).toBe('wait')
    expect(chartScaleAction(null, 'stock:SPY', 12)).toBe('fit')
    expect(chartScaleAction('stock:SPY', 'stock:SPY', 13)).toBe('keep')
    expect(chartScaleAction('stock:SPY', 'stock:NVDA', 13)).toBe('fit')
  })
})
