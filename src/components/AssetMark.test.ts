import { describe, expect, it } from 'vitest'
import { assetIcon } from './AssetMark.tsx'

describe('asset icons', () => {
  it('points stocks and coins at logo files', () => {
    expect(assetIcon('stock', 'nvda')).toBe('https://financialmodelingprep.com/image-stock/NVDA.png')
    expect(assetIcon('crypto', 'BTCUSDT')).toBe('https://assets.coincap.io/assets/icons/btc@2x.png')
    expect(assetIcon('crypto', '1000PEPEUSDT')).toBe('https://assets.coincap.io/assets/icons/pepe@2x.png')
    expect(assetIcon('launch', 'YAMS')).toBeNull()
    expect(assetIcon('crypto', '0xabc')).toBeNull()
  })
})