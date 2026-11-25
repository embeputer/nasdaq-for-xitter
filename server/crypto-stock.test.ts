import { describe, expect, it } from 'vitest'
import { isCryptoStock } from './market.ts'

describe('crypto stocks', () => {
  it('refuses coin trusts and crypto ETFs, and keeps companies', () => {
    const refused = [
      ['Grayscale Bitcoin Mini Trust (BTC)', 'BTC'],
      ['Grayscale Bitcoin Mini Trust ETF', 'BTC'],
      ['iShares Bitcoin Trust ETF Shares', 'IBIT'],
      ['iShares Ethereum Trust ETF Shares', 'ETHA'],
      ['Grayscale Bitcoin Trust (BTC)', 'GBTC'],
      ['ProShares Bitcoin ETF', 'BITO'],
      ['ARK 21Shares Bitcoin ETF', 'ARKB'],
      ['Dogecoin Trust', 'DOGE'],
      ['Solana Trust', 'SOL'],
      ['XRP Trust', 'XRP'],
      ['Bitwise Crypto Industry Innovators ETF', 'BITQ'],
      ['CoinShares Bitcoin Mining and Digital Power ETF', 'WGMI'],
    ]
    expect(refused.filter(([name, symbol]) => !isCryptoStock(name, symbol))).toEqual([])
    const kept = [
      ['Coinbase Global, Inc. Class A Common Stock', 'COIN'],
      ['Strategy Inc Common Stock Class A', 'MSTR'],
      ['MARA Holdings, Inc. Common Stock', 'MARA'],
      ['American Bitcoin Corp. Class A Common Stock', 'ABTC'],
      ['Bitcoin Infrastructure Acquisition Corp Ltd.', 'BIXI'],
      ['NVIDIA Corporation', 'NVDA'],
      ['Ethan Allen Interiors Inc. Common Stock', 'ETD'],
      ['Northern Trust Corporation', 'NTRS'],
      ['Oracle Corporation', 'ORCL'],
    ]
    expect(kept.filter(([name, symbol]) => isCryptoStock(name, symbol))).toEqual([])
  })
})
