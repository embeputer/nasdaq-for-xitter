import { describe, expect, it } from 'vitest'
import {
  ALLOWED_CRYPTO,
  isTokenizedEquityBase,
  mentionsMeme,
  mentionsRestrictedCoin,
  readCoinBook,
  spotListings,
  type CoinProduct,
} from './market.ts'

const products: CoinProduct[] = [
  { b: 'BTC', q: 'USDT', an: 'Bitcoin', tags: ['Payments', 'mining-zone'] },
  { b: 'ETH', q: 'USDT', an: 'Ethereum', tags: ['Layer1_Layer2'] },
  { b: 'SOL', q: 'USDT', an: 'Solana', tags: ['Layer1_Layer2', 'Seed'] },
  { b: 'BNB', q: 'USDT', an: 'BNB', tags: ['Layer1_Layer2'] },
  { b: 'XRP', q: 'USDT', an: 'XRP', tags: ['Payments'] },
  { b: 'ADA', q: 'USDT', an: 'Cardano', tags: ['Layer1_Layer2'] },
  { b: 'LTC', q: 'USDT', an: 'Litecoin', tags: ['Payments', 'mining-zone'] },
  { b: 'AVAX', q: 'USDT', an: 'Avalanche', tags: ['Layer1_Layer2'] },
  { b: 'LINK', q: 'USDT', an: 'Chainlink', tags: ['Defi'] },
  { b: 'PEPE', q: 'EUR', an: 'PEPE', tags: ['Meme', 'innovation-zone'] },
  { b: 'PEPE', q: 'USDT', an: 'Pepe', tags: ['Meme', 'innovation-zone'] },
  { b: 'WIF', q: 'EUR', an: 'WIF', tags: ['Meme'] },
  { b: 'DOGE', q: 'USDT', an: 'Dogecoin', tags: ['Meme', 'mining-zone'] },
  { b: 'SHIB', q: 'USDC', an: 'SHIBA INU', tags: ['Meme'] },
  { b: '1000SATS', q: 'USDT', an: '1000*SATS (Ordinals)', tags: ['Seed', 'Meme'] },
  { b: 'FLOKI', q: 'USDT', an: 'FLOKI', tags: ['Meme', 'Seed'] },
  { b: 'WIF', q: 'USDT', an: 'Dogwifhat', tags: ['Monitoring', 'Seed', 'Meme'] },
  { b: 'NEW', q: 'USDT', an: 'New Coin', tags: ['innovation-zone', 'Seed'] },
  { b: 'SUI', q: 'USDT', an: 'Sui', tags: ['Layer1_Layer2'] },
]

describe('restricted crypto allowlist', () => {
  it('only lists the allowed major coins and marks other Binance coins restricted', () => {
    expect([...ALLOWED_CRYPTO]).toEqual(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'LTC', 'AVAX', 'LINK'])
    const book = readCoinBook(products)
    expect(isTokenizedEquityBase('SHIB')).toBe(false)
    expect(book.memes.get('DOGE')).toBe('Dogecoin')
    expect(book.memes.get('PEPE')).toBe('PEPE')
    expect(book.memes.get('WIF')).toBe('Dogwifhat')
    expect(book.memes.get('SHIB')).toBe('SHIBA INU')
    expect(book.memes.get('FLOKI')).toBe('FLOKI')
    expect(book.memes.has('BTC')).toBe(false)
    expect(book.memes.has('SOL')).toBe(false)
    expect(book.memes.has('NEW')).toBe(false)
    const listed = spotListings(
      [
        { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT' },
        { symbol: 'ETHUSDC', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDC' },
        { symbol: 'SOLUSDT', status: 'TRADING', baseAsset: 'SOL', quoteAsset: 'USDT' },
        { symbol: 'BNBUSDT', status: 'TRADING', baseAsset: 'BNB', quoteAsset: 'USDT' },
        { symbol: 'XRPUSDT', status: 'TRADING', baseAsset: 'XRP', quoteAsset: 'USDT' },
        { symbol: 'ADAUSDT', status: 'TRADING', baseAsset: 'ADA', quoteAsset: 'USDT' },
        { symbol: 'LTCUSDT', status: 'TRADING', baseAsset: 'LTC', quoteAsset: 'USDT' },
        { symbol: 'AVAXUSDT', status: 'TRADING', baseAsset: 'AVAX', quoteAsset: 'USDT' },
        { symbol: 'LINKUSDT', status: 'TRADING', baseAsset: 'LINK', quoteAsset: 'USDT' },
        { symbol: 'SUIUSDT', status: 'TRADING', baseAsset: 'SUI', quoteAsset: 'USDT' },
        { symbol: 'NEWUSDT', status: 'TRADING', baseAsset: 'NEW', quoteAsset: 'USDT' },
        { symbol: 'DOGEUSDT', status: 'TRADING', baseAsset: 'DOGE', quoteAsset: 'USDT' },
        { symbol: 'DOGEUSDC', status: 'TRADING', baseAsset: 'DOGE', quoteAsset: 'USDC' },
        { symbol: 'PEPEUSDT', status: 'TRADING', baseAsset: 'PEPE', quoteAsset: 'USDT' },
        { symbol: 'SHIBUSDT', status: 'TRADING', baseAsset: 'SHIB', quoteAsset: 'USDT' },
        { symbol: 'SHIBUSDC', status: 'TRADING', baseAsset: 'SHIB', quoteAsset: 'USDC' },
        { symbol: '1000SATSUSDT', status: 'TRADING', baseAsset: '1000SATS', quoteAsset: 'USDT' },
        { symbol: '1000SATSUSDC', status: 'TRADING', baseAsset: '1000SATS', quoteAsset: 'USDC' },
        { symbol: 'FLOKIUSDT', status: 'TRADING', baseAsset: 'FLOKI', quoteAsset: 'USDT' },
        { symbol: 'AAPLBUSDT', status: 'TRADING', baseAsset: 'AAPLB', quoteAsset: 'USDT' },
        { symbol: 'BNBBUSD', status: 'TRADING', baseAsset: 'BNB', quoteAsset: 'BUSD' },
        { symbol: 'HALTUSDT', status: 'BREAK', baseAsset: 'HALT', quoteAsset: 'USDT' },
      ],
      book,
    )
    expect(listed.map((item) => item.symbol)).toEqual([
      'ADAUSDT',
      'AVAXUSDT',
      'BNBUSDT',
      'BTCUSDT',
      'LINKUSDT',
      'LTCUSDT',
      'SOLUSDT',
      'XRPUSDT',
    ])
    expect(listed.find((item) => item.symbol === 'BTCUSDT')?.name).toBe('Bitcoin')
    expect(mentionsMeme(book, 'DOGE')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'DOGE')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'dogeusdt')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'DOGE-USDC')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'Dogecoin')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'Pepe')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'Dogwifhat')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'please buy SHIBA INU today')).toBe(true)
    expect(mentionsRestrictedCoin(book, '1000SATS')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'FLOKI')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'SUI')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'NEW')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'New Coin')).toBe(true)
    expect(mentionsRestrictedCoin(book, 'BTC')).toBe(false)
    expect(mentionsRestrictedCoin(book, 'Bitcoin')).toBe(false)
    expect(mentionsRestrictedCoin(book, '$DOGE')).toBe(false)
    expect(mentionsRestrictedCoin(book, 'SOL')).toBe(false)
    expect(mentionsRestrictedCoin(book, 'LINK')).toBe(false)
    expect(mentionsRestrictedCoin(book, 'NVDA')).toBe(false)
  })
})
