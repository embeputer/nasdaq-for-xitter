export type Venue = 'stock' | 'crypto' | 'perpetual' | 'launch'
export type Interval = '1m' | '5m' | '15m' | '1h' | '1d'

export type Quote = {
  id: string
  venue: Venue
  symbol: string
  name: string
  price: number
  change: number
  changePct: number
  marketState: string | null
  asOf: number
  creator?: string
  logo?: string
}

export type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export type Listing = {
  id: string
  venue: Venue
  symbol: string
  label: string
  name: string
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const YAHOO = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']
let yahooHost = 0

const cache = new Map<string, { at: number; body: unknown }>()

function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.body as T)
  return load().then((body) => {
    cache.set(key, { at: Date.now(), body })
    return body
  })
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let index = 0
  async function worker() {
    while (index < items.length) {
      const current = index
      index += 1
      out[current] = await fn(items[current])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

const EVM_ADDRESS = /0x[a-fA-F0-9]{40}/
const SOL_ADDRESS = /(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?=$|[^1-9A-HJ-NP-Za-km-z])/

export function contractAddress(text: string): string | null {
  const evm = text.match(EVM_ADDRESS)
  if (evm) return evm[0].toLowerCase()
  const sol = text.match(SOL_ADDRESS)
  return sol?.[1] ?? null
}

export function isContractAddress(value: string): boolean {
  const text = value.trim()
  const found = contractAddress(text)
  return !!found && (found === text || found === text.toLowerCase())
}

export function parseId(id: string): { venue: Venue; symbol: string } | null {
  const split = id.indexOf(':')
  if (split <= 0) return null
  const venue = id.slice(0, split)
  const symbol = id.slice(split + 1).trim()
  if (!symbol || symbol.length > 68) return null
  if (venue !== 'stock' && venue !== 'crypto' && venue !== 'perpetual' && venue !== 'launch') return null
  if (venue === 'launch') {
    const upper = symbol.toUpperCase()
    if (!/^[A-Z]{2,8}$/.test(upper)) return null
    return { venue, symbol: upper }
  }
  if (venue === 'crypto' && isContractAddress(symbol)) {
    const address = contractAddress(symbol)
    return address ? { venue, symbol: address } : null
  }
  if (venue === 'perpetual') {
    if (!/^[\w.:-]{1,32}$/.test(symbol)) return null
    return { venue, symbol }
  }
  const upper = symbol.toUpperCase()
  if (!/^[A-Z0-9._=-]{1,24}$/.test(upper)) return null
  return { venue, symbol: upper }
}

type CnbcQuote = {
  symbol?: string
  name?: string
  last?: string
  change?: string
  change_pct?: string
  currencyCode?: string
}

type SparkMeta = {
  shortName?: string
  currency?: string
  regularMarketPrice?: number
  chartPreviousClose?: number
  regularMarketChangePercent?: number
  fulldayPrice?: number
  fulldayChange?: number
  fulldayChangePercent?: number
  currentTradingPeriod?: { regular?: { start?: number; end?: number } }
  marketState?: string
}

async function yahooFetch(pathname: string, params: Record<string, string>): Promise<Response> {
  const path = `${pathname}?${new URLSearchParams(params).toString()}`
  const order = yahooHost === 0 ? [0, 1] : [1, 0]
  let last = 0
  for (const index of order) {
    const res = await fetch(YAHOO[index] + path, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      yahooHost = index
      return res
    }
    last = res.status
    await res.body?.cancel().catch(() => undefined)
  }
  throw new Error(`Yahoo ${last || 'unreachable'}`)
}

// Outside the regular session, regularMarketPrice is the last close and does not tick.
// fulldayPrice is the latest pre-market or after-hours trade.
export function stockMark(meta: SparkMeta, now: number): { price: number; change: number; changePct: number } | null {
  const regular = meta.regularMarketPrice
  if (typeof regular !== 'number' || !Number.isFinite(regular)) return null
  const session = meta.currentTradingPeriod?.regular
  const start = session?.start
  const end = session?.end
  const open = typeof start === 'number' && typeof end === 'number' && now >= start * 1000 && now < end * 1000
  const full = meta.fulldayPrice
  const extended = !open && typeof full === 'number' && Number.isFinite(full) && full > 0
  const price = extended ? full : regular
  const previous = meta.chartPreviousClose
  const change =
    extended && typeof meta.fulldayChange === 'number' && Number.isFinite(meta.fulldayChange)
      ? meta.fulldayChange
      : previous != null && previous !== 0
        ? price - previous
        : 0
  const changePct =
    extended && typeof meta.fulldayChangePercent === 'number' && Number.isFinite(meta.fulldayChangePercent)
      ? meta.fulldayChangePercent
      : (meta.regularMarketChangePercent ?? (previous != null && previous !== 0 ? (change / previous) * 100 : 0))
  return { price, change, changePct }
}

function toQuote(symbol: string, meta: SparkMeta, now: number): Quote | null {
  const mark = stockMark(meta, now)
  if (!mark) return null
  const { price, change, changePct } = mark
  return {
    id: `stock:${symbol}`,
    venue: 'stock',
    symbol,
    name: meta.shortName || symbol,
    price,
    change,
    changePct,
    marketState: meta.marketState ?? null,
    asOf: now,
  }
}

async function sparkQuotes(symbols: string[]): Promise<Quote[]> {
  const res = await yahooFetch('/v7/finance/spark', {
    symbols: symbols.join(','),
    range: '1d',
    interval: '1d',
  })
  const body = (await res.json()) as {
    spark?: { result?: Array<{ symbol?: string; response?: Array<{ meta?: SparkMeta }> }> }
  }
  const now = Date.now()
  return (body.spark?.result ?? []).flatMap((item) => {
    const meta = item.response?.[0]?.meta
    const symbol = item.symbol?.toUpperCase()
    if (!meta || !symbol) return []
    const quote = toQuote(symbol, meta, now)
    if (!quote) return []
    rememberCurrency(symbol, meta.currency)
    return [quote]
  })
}

function cnbcNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').trim()
  if (!cleaned || cleaned.toUpperCase() === 'UNCH') return 0
  const parsed = Number(cleaned.replace(/^\+/, ''))
  return Number.isFinite(parsed) ? parsed : null
}

async function cnbcQuotes(symbols: string[]): Promise<Quote[]> {
  const url = new URL('https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol')
  url.searchParams.set('symbols', symbols.join('|'))
  url.searchParams.set('requestMethod', 'itv')
  url.searchParams.set('noCache', '1')
  url.searchParams.set('partnerId', '2')
  url.searchParams.set('fund', '1')
  url.searchParams.set('exthrs', '1')
  url.searchParams.set('output', 'json')
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`CNBC quotes ${res.status}`)
  const body = (await res.json()) as {
    FormattedQuoteResult?: { FormattedQuote?: CnbcQuote | CnbcQuote[] }
  }
  const rows = body.FormattedQuoteResult?.FormattedQuote
  const list = Array.isArray(rows) ? rows : rows ? [rows] : []
  const wanted = new Set(symbols)
  const now = Date.now()
  return list.flatMap((row) => {
    const symbol = row.symbol?.toUpperCase()
    const price = cnbcNum(row.last)
    if (!symbol || !wanted.has(symbol) || price == null || price <= 0) return []
    rememberCurrency(symbol, row.currencyCode)
    return [
      {
        id: `stock:${symbol}`,
        venue: 'stock' as const,
        symbol,
        name: row.name || symbol,
        price,
        change: cnbcNum(row.change) ?? 0,
        changePct: cnbcNum(row.change_pct) ?? 0,
        marketState: null,
        asOf: now,
      },
    ]
  })
}

async function equityQuotes(symbols: string[]): Promise<Quote[]> {
  if (!symbols.length) return []
  return cached(`eq:${symbols.slice().sort().join(',')}`, 8000, async () => {
    const bySymbol = new Map<string, Quote>()
    try {
      for (const quote of await sparkQuotes(symbols)) bySymbol.set(quote.symbol, quote)
    } catch {
      // Spark is down on both hosts. One CNBC batch covers the book.
    }
    const missing = symbols.filter((symbol) => !bySymbol.has(symbol))
    if (missing.length) {
      try {
        for (const quote of await cnbcQuotes(missing)) bySymbol.set(quote.symbol, quote)
      } catch {
        // Leave the book as whatever spark returned.
      }
    }
    const raw = symbols.flatMap((symbol) => {
      const quote = bySymbol.get(symbol)
      return quote ? [quote] : []
    })
    const quotes: Quote[] = []
    for (const quote of raw) {
      const next = await inDollars(quote)
      if (next) quotes.push(next)
    }
    if (!quotes.length) throw new Error('Equity quotes empty')
    return quotes
  })
}

type DayTicker = {
  symbol: string
  lastPrice: string
  priceChange: string
  priceChangePercent: string
}

async function bookTickers(base: string, symbols: string[], venue: 'crypto' | 'perpetual'): Promise<Quote[]> {
  if (!symbols.length) return []
  return cached(`${venue}:${symbols.slice().sort().join(',')}`, 2000, async () => {
    const rows = await fetchTickers(base, symbols)
    const now = Date.now()
    return rows.flatMap((row) => {
      const price = Number(row.lastPrice)
      if (!Number.isFinite(price)) return []
      return [
        {
          id: `${venue}:${row.symbol}`,
          venue,
          symbol: row.symbol,
          name: row.symbol.replace(/(USDT|USDC)$/, ''),
          price,
          change: Number(row.priceChange) || 0,
          changePct: Number(row.priceChangePercent) || 0,
          marketState: null,
          asOf: now,
        },
      ]
    })
  })
}

async function fetchTickers(base: string, symbols: string[]): Promise<DayTicker[]> {
  const wanted = new Set(symbols)
  const url = new URL(base)
  url.searchParams.set('symbols', JSON.stringify(symbols))
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (res.ok) {
    const body = (await res.json()) as DayTicker | DayTicker[]
    const rows = Array.isArray(body) ? body : [body]
    return rows.filter((row) => wanted.has(row.symbol))
  }
  if (res.status === 400 && symbols.length > 1) {
    const rows = await mapPool(symbols, 6, (symbol) => oneTicker(base, symbol))
    return rows.filter((row): row is DayTicker => !!row)
  }
  if (res.status === 400) return []
  throw new Error(`Ticker ${res.status}`)
}

async function oneTicker(base: string, symbol: string): Promise<DayTicker | null> {
  const url = new URL(base)
  url.searchParams.set('symbol', symbol)
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) return null
  return (await res.json()) as DayTicker
}

export async function getQuotes(ids: string[]): Promise<Quote[]> {
  const parsed = ids.map(parseId).filter((item): item is { venue: Venue; symbol: string } => !!item)
  const stocks = parsed.filter((item) => item.venue === 'stock').map((item) => item.symbol)
  const crypto = parsed.filter((item) => item.venue === 'crypto').map((item) => item.symbol)
  const perps = parsed.filter((item) => item.venue === 'perpetual').map((item) => item.symbol)
  const contracts = crypto.filter((symbol) => isContractAddress(symbol))
  const pairs = crypto.filter((symbol) => !isContractAddress(symbol))
  const [equity, spot, chain, futures] = await Promise.all([
    equityQuotes(stocks).catch(() => []),
    bookTickers('https://api.binance.com/api/v3/ticker/24hr', pairs, 'crypto').catch(() => []),
    contractQuotes(contracts).catch(() => []),
    hyperliquidQuotes(perps).catch(() => []),
  ])
  return [...equity, ...spot, ...chain, ...futures]
}

const RANGES: Record<Interval, { interval: string; range: string; binance: string }> = {
  '1m': { interval: '1m', range: '1d', binance: '1m' },
  '5m': { interval: '5m', range: '5d', binance: '5m' },
  '15m': { interval: '15m', range: '5d', binance: '15m' },
  '1h': { interval: '60m', range: '1mo', binance: '1h' },
  '1d': { interval: '1d', range: '1y', binance: '1d' },
}

export function isInterval(value: string): value is Interval {
  return value === '1m' || value === '5m' || value === '15m' || value === '1h' || value === '1d'
}

export async function getCandles(id: string, interval: Interval): Promise<Candle[]> {
  const parsed = parseId(id)
  if (!parsed) return []
  return cached(`c:${id}:${interval}`, interval === '1m' ? 5000 : 15000, async () => {
    if (parsed.venue === 'stock') return stockCandles(parsed.symbol, interval)
    if (parsed.venue === 'perpetual') return hyperliquidCandles(parsed.symbol, interval)
    if (isContractAddress(parsed.symbol)) return []
    return bookCandles('https://api.binance.com/api/v3/klines', parsed.symbol, RANGES[interval].binance)
  })
}

function dedupeCandles(candles: Candle[]): Candle[] {
  const out: Candle[] = []
  for (const bar of candles) {
    const prev = out[out.length - 1]
    if (prev && prev.time === bar.time) out[out.length - 1] = bar
    else if (!prev || bar.time > prev.time) out.push(bar)
  }
  return out
}

const MIN_BARS: Record<Interval, number> = {
  '1m': 30,
  '5m': 40,
  '15m': 20,
  '1h': 20,
  '1d': 60,
}

async function stockCandles(symbol: string, interval: Interval): Promise<Candle[]> {
  let bars: Candle[] = []
  try {
    const yahoo = await yahooCandles(symbol, interval)
    // A short Yahoo payload is usually a rate-limit stub. CNBC has the session.
    if (yahoo.length >= MIN_BARS[interval]) bars = yahoo
  } catch {
    // Both Yahoo hosts refused the chart.
  }
  if (!bars.length) bars = await cnbcCandles(symbol, interval)
  return pricedCandles(symbol, bars)
}

async function yahooCandles(symbol: string, interval: Interval): Promise<Candle[]> {
  const spec = RANGES[interval]
  const res = await yahooFetch(`/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    interval: spec.interval,
    range: spec.range,
    includePrePost: 'true',
  })
  const body = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[]
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>
            high?: Array<number | null>
            low?: Array<number | null>
            close?: Array<number | null>
          }>
        }
      }>
    }
  }
  const result = body.chart?.result?.[0]
  const times = result?.timestamp ?? []
  const quote = result?.indicators?.quote?.[0]
  if (!quote) return []
  const candles: Candle[] = []
  for (let i = 0; i < times.length; i += 1) {
    const open = quote.open?.[i]
    const high = quote.high?.[i]
    const low = quote.low?.[i]
    const close = quote.close?.[i]
    if (open == null || high == null || low == null || close == null) continue
    candles.push({ time: times[i], open, high, low, close })
  }
  return dedupeCandles(candles)
}

type CnbcBar = {
  open?: string
  high?: string
  low?: string
  close?: string
  tradeTimeinMills?: string | number
}

async function cnbcChart(symbol: string, range: string): Promise<Candle[]> {
  const url = `https://ts-api.cnbc.com/harmony/app/charts/${range}.json?symbol=${encodeURIComponent(symbol)}`
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`CNBC chart ${res.status}`)
  const body = (await res.json()) as { barData?: { priceBars?: CnbcBar[] } }
  return dedupeCandles(
    (body.barData?.priceBars ?? []).flatMap((bar) => {
      const time = Math.floor(Number(bar.tradeTimeinMills) / 1000)
      const open = Number(bar.open)
      const high = Number(bar.high)
      const low = Number(bar.low)
      const close = Number(bar.close)
      if (![time, open, high, low, close].every(Number.isFinite)) return []
      return [{ time, open, high, low, close }]
    }),
  )
}

function groupBars(bars: Candle[], size: number): Candle[] {
  const out: Candle[] = []
  let bucket: Candle[] = []
  const flush = () => {
    if (!bucket.length) return
    out.push({
      time: bucket[0].time,
      open: bucket[0].open,
      high: Math.max(...bucket.map((bar) => bar.high)),
      low: Math.min(...bucket.map((bar) => bar.low)),
      close: bucket[bucket.length - 1].close,
    })
    bucket = []
  }
  for (const bar of bars) {
    const prev = bucket[bucket.length - 1]
    if (bucket.length >= size || (prev && bar.time - prev.time > 900)) flush()
    bucket.push(bar)
  }
  flush()
  return out
}

function todayFromIntraday(bars: Candle[]): Candle | null {
  if (!bars.length) return null
  const last = bars[bars.length - 1]
  const et = new Date((last.time - 5 * 3600) * 1000)
  const time = Math.floor(Date.UTC(et.getUTCFullYear(), et.getUTCMonth(), et.getUTCDate(), 5) / 1000)
  return {
    time,
    open: bars[0].open,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    close: last.close,
  }
}

async function cnbcCandles(symbol: string, interval: Interval): Promise<Candle[]> {
  if (interval === '1m') return cnbcChart(symbol, '1D')
  if (interval === '5m') return cnbcChart(symbol, '5D')
  if (interval === '15m') return groupBars(await cnbcChart(symbol, '5D'), 3)
  if (interval === '1h') return groupBars(await cnbcChart(symbol, '5D'), 12)
  const daily = await cnbcChart(symbol, '1Y')
  const today = todayFromIntraday(await cnbcChart(symbol, '1D'))
  if (!today) return daily
  const prev = daily[daily.length - 1]
  if (prev && today.time <= prev.time) return daily
  return dedupeCandles([...daily, today])
}

async function bookCandles(base: string, symbol: string, interval: string): Promise<Candle[]> {
  const url = new URL(base)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('interval', interval)
  url.searchParams.set('limit', '300')
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Klines ${res.status}`)
  const rows = (await res.json()) as unknown[][]
  return dedupeCandles(
    rows.flatMap((row) => {
      const time = Math.floor(Number(row[0]) / 1000)
      const open = Number(row[1])
      const high = Number(row[2])
      const low = Number(row[3])
      const close = Number(row[4])
      if (![time, open, high, low, close].every(Number.isFinite)) return []
      return [{ time, open, high, low, close }]
    }),
  )
}

function rememberCurrency(symbol: string, currency: string | undefined) {
  const code = currency?.trim().toUpperCase()
  if (!code) return
  cache.set(`ccy:${symbol}`, { at: Date.now(), body: code })
}

async function cnbcCurrency(symbol: string): Promise<string> {
  const url = new URL('https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol')
  url.searchParams.set('symbols', symbol)
  url.searchParams.set('requestMethod', 'itv')
  url.searchParams.set('noCache', '1')
  url.searchParams.set('partnerId', '2')
  url.searchParams.set('output', 'json')
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`CNBC currency ${res.status}`)
  const body = (await res.json()) as { FormattedQuoteResult?: { FormattedQuote?: CnbcQuote | CnbcQuote[] } }
  const rows = body.FormattedQuoteResult?.FormattedQuote
  const row = Array.isArray(rows) ? rows[0] : rows
  return row?.currencyCode?.trim().toUpperCase() ?? ''
}

async function stockCurrency(symbol: string): Promise<string> {
  return cached(`ccy:${symbol}`, 300000, async () => {
    const code = await cnbcCurrency(symbol).catch(() => '')
    if (code) return code
    return symbol.includes('.') ? 'UNKNOWN' : 'USD'
  })
}

async function fxLast(symbol: string): Promise<number> {
  return cached(`fx:${symbol}`, 30000, async () => {
    const url = new URL('https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol')
    url.searchParams.set('symbols', symbol)
    url.searchParams.set('requestMethod', 'itv')
    url.searchParams.set('noCache', '1')
    url.searchParams.set('partnerId', '2')
    url.searchParams.set('output', 'json')
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`FX ${res.status}`)
    const body = (await res.json()) as { FormattedQuoteResult?: { FormattedQuote?: CnbcQuote | CnbcQuote[] } }
    const rows = body.FormattedQuoteResult?.FormattedQuote
    const row = Array.isArray(rows) ? rows[0] : rows
    const last = cnbcNum(row?.last)
    if (last == null || last <= 0) throw new Error(`FX ${symbol}`)
    return last
  })
}

async function usdPer(currency: string): Promise<number> {
  if (currency === 'USD') return 1
  if (currency === 'GBP' || currency === 'GBX') {
    const gbp = await fxLast('GBPUSD=')
    return currency === 'GBP' ? gbp : gbp / 100
  }
  return fxLast(`${currency}USD=`)
}

async function inDollars(quote: Quote): Promise<Quote | null> {
  const currency = await stockCurrency(quote.symbol)
  if (currency === 'USD') return quote
  if (currency === 'UNKNOWN') return null
  const rate = await usdPer(currency)
  return { ...quote, price: quote.price * rate, change: quote.change * rate }
}

async function pricedCandles(symbol: string, bars: Candle[]): Promise<Candle[]> {
  if (!bars.length) return bars
  const currency = await stockCurrency(symbol)
  if (currency === 'USD') return bars
  if (currency === 'UNKNOWN') return []
  const rate = await usdPer(currency)
  return bars.map((bar) => ({
    time: bar.time,
    open: bar.open * rate,
    high: bar.high * rate,
    low: bar.low * rate,
    close: bar.close * rate,
  }))
}

type HlCoin = { name: string; mark: number; prev: number }

async function hyperliquidBook(): Promise<HlCoin[]> {
  return cached('hl:book', 2000, async () => {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Hyperliquid ${res.status}`)
    const body = (await res.json()) as [
      { universe?: Array<{ name?: string }> },
      Array<{ markPx?: string; midPx?: string; prevDayPx?: string }>,
    ]
    const universe = body[0]?.universe ?? []
    const ctxs = body[1] ?? []
    return universe.flatMap((asset, index) => {
      const name = asset.name?.trim()
      const ctx = ctxs[index]
      const mark = Number(ctx?.midPx ?? ctx?.markPx)
      const prev = Number(ctx?.prevDayPx)
      if (!name || !Number.isFinite(mark) || mark <= 0) return []
      return [{ name, mark, prev: Number.isFinite(prev) && prev > 0 ? prev : mark }]
    })
  })
}

async function hyperliquidQuotes(symbols: string[]): Promise<Quote[]> {
  if (!symbols.length) return []
  const wanted = new Set(symbols)
  const now = Date.now()
  return (await hyperliquidBook()).flatMap((coin) => {
    if (!wanted.has(coin.name)) return []
    const change = coin.mark - coin.prev
    return [
      {
        id: `perpetual:${coin.name}`,
        venue: 'perpetual' as const,
        symbol: coin.name,
        name: coin.name,
        price: coin.mark,
        change,
        changePct: coin.prev ? (change / coin.prev) * 100 : 0,
        marketState: null,
        asOf: now,
      },
    ]
  })
}

const HL_WINDOW: Record<Interval, number> = {
  '1m': 24 * 60 * 60 * 1000,
  '5m': 5 * 24 * 60 * 60 * 1000,
  '15m': 14 * 24 * 60 * 60 * 1000,
  '1h': 60 * 24 * 60 * 60 * 1000,
  '1d': 365 * 24 * 60 * 60 * 1000,
}

async function hyperliquidCandles(coin: string, interval: Interval): Promise<Candle[]> {
  const end = Date.now()
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: { coin, interval, startTime: end - HL_WINDOW[interval], endTime: end },
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Hyperliquid candles ${res.status}`)
  const rows = (await res.json()) as Array<{ t?: number; o?: string; h?: string; l?: string; c?: string }>
  return dedupeCandles(
    rows.flatMap((row) => {
      const time = Math.floor(Number(row.t) / 1000)
      const open = Number(row.o)
      const high = Number(row.h)
      const low = Number(row.l)
      const close = Number(row.c)
      if (![time, open, high, low, close].every(Number.isFinite)) return []
      return [{ time, open, high, low, close }]
    }),
  )
}

function listing(venue: Venue, symbol: string, name: string, label = symbol): Listing {
  return { id: `${venue}:${symbol}`, venue, symbol, label, name }
}

// Tokenized equities sit on the same spot book as coins.
// bStocks append B (AAPLB), xStocks append X (AAPLX), Ondo appends ON (AAPLON).
// These bases are coins that only share the ending.
const COINS_WITH_EQUITY_SUFFIX = new Set([
  'ADX',
  'ARB',
  'AUCTION',
  'AVAX',
  'BB',
  'BEAMX',
  'BNB',
  'CFX',
  'CKB',
  'CVX',
  'DGB',
  'DYDX',
  'FLUX',
  'FRAX',
  'GMX',
  'IMX',
  'IOTX',
  'OKB',
  'POLYX',
  'PUNDIX',
  'SHIB',
  'SNX',
  'STRAX',
  'STX',
  'TRB',
  'TRX',
  'YB',
  'ZRX',
])

export function isTokenizedEquityBase(base: string): boolean {
  const asset = base.trim().toUpperCase()
  if (!asset || COINS_WITH_EQUITY_SUFFIX.has(asset)) return false
  return /^[A-Z]{1,5}(?:B|X|ON)$/.test(asset)
}

async function coinNames(): Promise<Map<string, string>> {
  const res = await fetch('https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=true', {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return new Map()
  const body = (await res.json()) as { data?: Array<{ b?: string; q?: string; an?: string }> }
  const names = new Map<string, string>()
  for (const row of body.data ?? []) {
    if (row.q !== 'USDT' || !row.b || !row.an) continue
    const name = row.an.trim()
    if (!name || name.toUpperCase() === row.b.toUpperCase()) continue
    names.set(row.b.toUpperCase(), name)
  }
  return names
}

async function spotCatalog(): Promise<Listing[]> {
  return cached('catalog:spot', 60 * 60 * 1000, async () => {
    const [res, names] = await Promise.all([
      fetch('https://api.binance.com/api/v3/exchangeInfo', { signal: AbortSignal.timeout(20000) }),
      coinNames().catch(() => new Map<string, string>()),
    ])
    if (!res.ok) throw new Error(`Binance info ${res.status}`)
    const body = (await res.json()) as {
      symbols?: Array<{ symbol?: string; status?: string; baseAsset?: string; quoteAsset?: string }>
    }
    return (body.symbols ?? [])
      .flatMap((row) => {
        if (row.status !== 'TRADING' || !row.symbol || !row.baseAsset) return []
        if (row.quoteAsset !== 'USDT' && row.quoteAsset !== 'USDC') return []
        if (isTokenizedEquityBase(row.baseAsset)) return []
        const label = row.quoteAsset === 'USDC' ? `${row.baseAsset}-USDC` : row.baseAsset
        const name = names.get(row.baseAsset.toUpperCase()) || row.baseAsset
        return [listing('crypto', row.symbol, name, label)]
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  })
}

type DexPair = {
  priceUsd?: string
  liquidity?: { usd?: number }
  priceChange?: { h24?: number }
  baseToken?: { address?: string; name?: string; symbol?: string }
}

async function contractHit(address: string): Promise<{ address: string; label: string; name: string; price: number; changePct: number } | null> {
  return cached(`ca:${address}`, 10_000, async () => {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { pairs?: DexPair[] }
    const best = (body.pairs ?? [])
      .filter((pair) => {
        const token = pair.baseToken?.address ?? ''
        const same = address.startsWith('0x') ? token.toLowerCase() === address : token === address
        const price = Number(pair.priceUsd)
        return same && Number.isFinite(price) && price > 0
      })
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
    const token = best?.baseToken
    const price = Number(best?.priceUsd)
    if (!token?.symbol || !Number.isFinite(price)) return null
    return {
      address,
      label: token.symbol.toUpperCase(),
      name: token.name?.trim() || token.symbol.toUpperCase(),
      price,
      changePct: Number(best?.priceChange?.h24) || 0,
    }
  })
}

async function contractQuotes(addresses: string[]): Promise<Quote[]> {
  const now = Date.now()
  const rows = await mapPool(addresses, 4, (address) => contractHit(address))
  return rows.flatMap((row) => {
    if (!row) return []
    return [
      {
        id: `crypto:${row.address}`,
        venue: 'crypto' as const,
        symbol: row.address,
        name: row.name,
        price: row.price,
        change: (row.price * row.changePct) / 100,
        changePct: row.changePct,
        marketState: null,
        asOf: now,
      },
    ]
  })
}

async function searchYahoo(query: string): Promise<Listing[]> {
  const res = await yahooFetch('/v1/finance/search', { q: query, quotesCount: '10', newsCount: '0' })
  const body = (await res.json()) as {
    quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; quoteType?: string }>
  }
  return (body.quotes ?? []).flatMap((row) => {
    if (row.quoteType !== 'EQUITY' && row.quoteType !== 'ETF') return []
    const symbol = row.symbol?.toUpperCase()
    if (!symbol || !/^[A-Z0-9._=-]{1,24}$/.test(symbol)) return []
    return [listing('stock', symbol, row.shortname || row.longname || symbol)]
  })
}

async function searchNasdaq(query: string): Promise<Listing[]> {
  const url = new URL('https://api.nasdaq.com/api/autocomplete/slookup/10')
  url.searchParams.set('search', query)
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Nasdaq search ${res.status}`)
  const body = (await res.json()) as { data?: Array<{ symbol?: string; name?: string; asset?: string }> }
  return (body.data ?? []).flatMap((row) => {
    if (row.asset && row.asset !== 'STOCKS' && row.asset !== 'ETF') return []
    const symbol = row.symbol?.toUpperCase()
    if (!symbol || !/^[A-Z0-9.-]{1,12}$/.test(symbol)) return []
    return [listing('stock', symbol, row.name || symbol)]
  })
}

const FIGI_US = new Set(['UN', 'UA', 'UF', 'UP', 'UQ', 'UR', 'US', 'UW', 'VF', 'UV', 'VJ', 'VK', 'VL'])
const FIGI_SUFFIX: Record<string, string> = {
  NO: '.OL',
  LN: '.L',
  GY: '.DE',
  GR: '.DE',
  FP: '.PA',
  NA: '.AS',
  BB: '.BR',
  SM: '.MC',
  IM: '.MI',
  SW: '.SW',
  DC: '.CO',
  FH: '.HE',
  CT: '.TO',
  JT: '.T',
  HK: '.HK',
  AU: '.AX',
  SJ: '.JO',
  NZ: '.NZ',
  SP: '.SI',
  KP: '.KS',
  TT: '.TW',
  IN: '.NS',
  PL: '.LS',
  AV: '.VI',
  PW: '.WA',
}

async function searchFigi(query: string): Promise<Listing[]> {
  const res = await fetch('https://api.openfigi.com/v3/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`FIGI ${res.status}`)
  const body = (await res.json()) as {
    data?: Array<{ ticker?: string; exchCode?: string; name?: string; securityType?: string }>
  }
  const kinds = new Set(['Common Stock', 'ADR', 'ETF', 'REIT', 'GDR', 'CDI'])
  const hits: Listing[] = []
  const seen = new Set<string>()
  for (const row of body.data ?? []) {
    if (!row.securityType || !kinds.has(row.securityType)) continue
    const ticker = row.ticker?.toUpperCase().replace('/', '-')
    if (!ticker || !/^[A-Z0-9-]{1,8}$/.test(ticker)) continue
    if (ticker.length > 4 && /(EUR|USD|GBP|GBX|NOK|CHF|JPY)$/.test(ticker)) continue
    const exch = row.exchCode ?? ''
    const symbol = FIGI_US.has(exch) ? ticker : FIGI_SUFFIX[exch] ? `${ticker}${FIGI_SUFFIX[exch]}` : null
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    hits.push(listing('stock', symbol, row.name || symbol))
  }
  const needle = query.toLowerCase()
  hits.sort((a, b) => {
    const as = a.name.toLowerCase().includes(needle) ? 0 : 1
    const bs = b.name.toLowerCase().includes(needle) ? 0 : 1
    return as - bs || a.symbol.length - b.symbol.length
  })
  return hits.slice(0, 8)
}

function dedupeListings(rows: Listing[]): Listing[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

async function stockSearch(query: string): Promise<Listing[]> {
  const [yahoo, nasdaq] = await Promise.all([
    searchYahoo(query).catch(() => [] as Listing[]),
    searchNasdaq(query).catch(() => [] as Listing[]),
  ])
  const first = dedupeListings([...yahoo, ...nasdaq])
  const needle = query.toLowerCase()
  const covered = first.some(
    (row) => row.name.toLowerCase().includes(needle) || row.symbol.toLowerCase().startsWith(needle),
  )
  if (first.length >= 6 && covered) return first.slice(0, 12)
  const figi = await searchFigi(query).catch(() => [] as Listing[])
  return dedupeListings([...first, ...figi]).slice(0, 12)
}

function rankListing(item: Listing, needle: string): number {
  const label = item.label.toLowerCase()
  const symbol = item.symbol.toLowerCase()
  const name = item.name.toLowerCase()
  if (!needle) return 0
  if (label === needle || symbol === needle || name === needle) return 0
  if (label.startsWith(needle) || symbol.startsWith(needle) || name.startsWith(needle)) return 1
  return 2
}

export async function searchMarket(venue: Venue, query: string): Promise<Listing[]> {
  const raw = query.trim()
  if (venue === 'crypto' && isContractAddress(raw)) {
    const address = contractAddress(raw)
    if (!address) return []
    const hit = await contractHit(address).catch(() => null)
    return hit ? [listing('crypto', hit.address, hit.name, hit.label)] : []
  }
  const q = raw.slice(0, 40)
  if (venue === 'stock') {
    if (q.length < 1) return []
    return cached(`search:stock:${q.toLowerCase()}`, 30000, () => stockSearch(q))
  }
  if (venue !== 'crypto') return []
  const catalog = await spotCatalog()
  const needle = q.toLowerCase().replace(/-perp$/, '')
  return catalog
    .filter((item) => {
      if (!needle) return true
      return `${item.label} ${item.name} ${item.symbol}`.toLowerCase().includes(needle)
    })
    .sort((a, b) => rankListing(a, needle) - rankListing(b, needle) || a.label.localeCompare(b.label))
    .slice(0, needle ? 40 : catalog.length)
}
