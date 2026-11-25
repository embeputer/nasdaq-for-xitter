import { describe, expect, it } from 'vitest'
import { assetIcon } from './AssetMark.tsx'

describe('asset icons', () => {
  it('points coins at logo files and never gives stocks a company logo', () => {
    expect(assetIcon('stock', 'nvda')).toBeNull()
    expect(assetIcon('crypto', 'BTCUSDT')).toBe('https://assets.coincap.io/assets/icons/btc@2x.png')
    expect(assetIcon('crypto', '1000PEPEUSDT')).toBe('https://assets.coincap.io/assets/icons/pepe@2x.png')
    expect(assetIcon('launch', 'YAMS')).toBeNull()
    expect(assetIcon('crypto', '0xabc')).toBeNull()
  })
})