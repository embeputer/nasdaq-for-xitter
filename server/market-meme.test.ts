import { describe, expect, it } from 'vitest'
import { isTokenizedEquityBase, mentionsMeme, readCoinBook, spotListings, type CoinProduct } from './market.ts'

const products: CoinProduct[] = [
  { b: 'BTC', q: 'USDT', an: 'Bitcoin', tags: ['Payments', 'mining-zone'] },
  { b: 'SOL', q: 'USDT', an: 'Solana', tags: ['Layer1_Layer2', 'Seed'] },
  { b: 'PEPE', q: 'EUR', an: 'PEPE', tags: ['Meme', 'innovation-zone'] },
  { b: 'PEPE', q: 'USDT', an: 'Pepe', tags: ['Meme', 'innovation-zone'] },
  { b: 'WIF', q: 'EUR', an: 'WIF', tags: ['Meme'] },
  { b: 'DOGE', q: 'USDT', an: 'Dogecoin', tags: ['Meme', 'mining-zone'] },
  { b: 'SHIB', q: 'USDC', an: 'SHIBA INU', tags: ['Meme'] },
  { b: '1000SATS', q: 'USDT', an: '1000*SATS (Ordinals)', tags: ['Seed', 'Meme'] },
  { b: 'FLOKI', q: 'USDT', an: 'FLOKI', tags: ['Meme', 'Seed'] },
  { b: 'WIF', q: 'USDT', an: 'Dogwifhat', tags: ['Monitoring', 'Seed', 'Meme'] },
  { b: 'NEW', q: 'USDT', an: 'New Coin', tags: ['innovation-zone', 'Seed'] },
]

describe('meme coins', () => {
  it('drops a Binance Meme tag from both quotes and keeps everything else', () => {
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
        { symbol: 'SOLUSDT', status: 'TRADING', baseAsset: 'SOL', quoteAsset: 'USDT' },
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
    expect(listed.map((item) => item.symbol)).toEqual(['BTCUSDT', 'NEWUSDT', 'SOLUSDT'])
    expect(listed.find((item) => item.symbol === 'BTCUSDT')?.name).toBe('Bitcoin')
    expect(mentionsMeme(book, 'DOGE')).toBe(true)
    expect(mentionsMeme(book, 'dogeusdt')).toBe(true)
    expect(mentionsMeme(book, 'DOGE-USDC')).toBe(true)
    expect(mentionsMeme(book, 'Dogecoin')).toBe(true)
    expect(mentionsMeme(book, 'Pepe')).toBe(true)
    expect(mentionsMeme(book, 'Dogwifhat')).toBe(true)
    expect(mentionsMeme(book, 'please buy SHIBA INU today')).toBe(true)
    expect(mentionsMeme(book, '1000SATS')).toBe(true)
    expect(mentionsMeme(book, 'FLOKI')).toBe(true)
    expect(mentionsMeme(book, 'BTC')).toBe(false)
    expect(mentionsMeme(book, 'Bitcoin')).toBe(false)
    expect(mentionsMeme(book, '$DOGE')).toBe(false)
    expect(mentionsMeme(book, 'SOL')).toBe(false)
    expect(mentionsMeme(book, 'NEW')).toBe(false)
  })
})
