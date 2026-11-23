import { describe, expect, it } from 'vitest'
import { isTokenizedEquityBase } from './market.ts'

describe('tokenized equity bases', () => {
  it('drops bStocks, xStocks, and Ondo stock tokens', () => {
    const bases = ['AAPLB', 'TSLAB', 'NVDAB', 'ANTB', 'BBB', 'MUB', 'QNTB', 'SPCXB', 'AAPLX', 'TSLAX', 'AAPLON']
    expect(bases.filter((base) => !isTokenizedEquityBase(base))).toEqual([])
  })

  it('keeps coins that only share the suffix', () => {
    const bases = [
      'BTC',
      'ETH',
      'SOL',
      'QNT',
      'PENGU',
      'ONDO',
      'DOGE',
      'ARB',
      'BB',
      'BNB',
      'CKB',
      'DGB',
      'SHIB',
      'TRB',
      'YB',
      'OKB',
      'ADX',
      'AVAX',
      'BEAMX',
      'CFX',
      'CVX',
      'DYDX',
      'FLUX',
      'FRAX',
      'GMX',
      'IMX',
      'IOTX',
      'POLYX',
      'PUNDIX',
      'SNX',
      'STRAX',
      'STX',
      'TRX',
      'ZRX',
      'AUCTION',
    ]
    expect(bases.filter((base) => isTokenizedEquityBase(base))).toEqual([])
  })
})
