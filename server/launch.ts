import type { Person } from './book.ts'
import type { Candle, Interval, Listing, Quote } from './market.ts'

export type Launch = {
  symbol: string
  name: string
  label: string
  creator: Person
  cashCents: number
  // Shares still sitting in the pool. Spot is cash divided by this reserve.
  // Missing on launches opened before the curve; those infer it from cash and price.
  reserve?: number
  supply: number
  price: number
  prevPrice: number
  openedAt: number
  prints: { time: number; price: number }[]
  logo?: 'png' | 'jpg' | 'webp' | 'gif'
  logoRev?: number
}

export type LaunchFailure = {
  ok: false
  error: 'bad_symbol' | 'bad_name' | 'taken' | 'delisted' | 'restricted_user' | 'poor' | 'small' | 'bad_invest'
  message: string
}

const LAUNCH_MESSAGE: Record<LaunchFailure['error'], string> = {
  bad_symbol: 'Use 2 to 8 letters.',
  bad_name: 'Give it a name.',
  taken: 'That stock already exists.',
  delisted: 'That stock has been delisted.',
  restricted_user: 'Your account is restricted from launching stocks.',
  poor: "You don't have enough NQFX. Send Equicoins with the note vault.",
  small: 'Liquidity has to be at least $1.',
  bad_invest: 'Invest at least $1, or leave it blank.',
}

export function launchFailure(error: LaunchFailure['error']): LaunchFailure {
  return { ok: false, error, message: LAUNCH_MESSAGE[error] }
}

export function launchAmounts(
  liquidityCents: number,
  investCents: number,
): LaunchFailure | { liquidityCents: number; investCents: number } {
  if (!Number.isSafeInteger(liquidityCents) || liquidityCents < 100) return launchFailure('small')
  if (!Number.isSafeInteger(investCents) || investCents < 0 || (investCents > 0 && investCents < 100)) {
    return launchFailure('bad_invest')
  }
  return { liquidityCents, investCents }
}

export function cleanLaunchSymbol(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, '')
  const prefixed = trimmed.match(/^xit([A-Za-z]{2,8})$/i)
  const symbol = (prefixed?.[1] ?? trimmed).toUpperCase()
  if (!/^[A-Z]{2,8}$/.test(symbol)) return null
  return symbol
}

export function cleanLaunchName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim()
  const length = [...name].length
  if (length < 1 || length > 40) return null
  if (/[\u0000-\u001f]/.test(name)) return null
  return name
}

export function launchLabel(symbol: string): string {
  return `xit${symbol}`
}

export function priceOf(launch: { price: number }): number {
  return Number.isFinite(launch.price) && launch.price > 0 ? launch.price : 0
}

export function seedLaunch(
  person: Person,
  symbol: string,
  name: string,
  liquidityCents: number,
  investCents: number,
  now: number,
): Launch {
  return mintLaunch(person, symbol, name, liquidityCents, investCents, now).launch
}

// Liquidity is both sides of the pool, so the spot starts at $1. An invest is the first buy on that curve.
export function mintLaunch(
  person: Person,
  symbol: string,
  name: string,
  liquidityCents: number,
  investCents: number,
  now: number,
): { launch: Launch; qty: number; fillPrice: number } {
  const screenName = person.screenName.trim().replace(/^@/, '')
  const pool: Launch = {
    symbol,
    name,
    label: launchLabel(symbol),
    creator: { ...person, screenName },
    cashCents: liquidityCents,
    reserve: liquidityCents > 0 ? liquidityCents / 100 : 0,
    supply: 0,
    price: 1,
    prevPrice: 1,
    openedAt: now,
    prints: [{ time: now, price: 1 }],
  }
  if (!(investCents > 0)) return { launch: pool, qty: 0, fillPrice: 1 }
  const bought = planBuy(pool, investCents, now)
  if (!bought) return { launch: pool, qty: 0, fillPrice: 1 }
  return { launch: bought.launch, qty: bought.qty, fillPrice: bought.fillPrice }
}

// Constant product, the curve pump.fun and PumpSwap use: cash in the pool times shares in the pool stays fixed.
// A buy lifts the spot above the average fill. A sell walks that move back down and pays the cash the curve gives up.
function curveReserve(launch: Launch): number {
  if (launch.creator.id === NOISE_ID) return 0
  if (typeof launch.reserve === 'number') return launch.reserve > 0 && Number.isFinite(launch.reserve) ? launch.reserve : 0
  const price = priceOf(launch)
  if (!(price > 0) || !(launch.cashCents > 0)) return 0
  return launch.cashCents / 100 / price
}

export function quoteSell(launch: Launch, qty: number): { cents: number; fillPrice: number } | null {
  const price = priceOf(launch)
  if (!(price > 0) || !(qty > 0) || !Number.isFinite(qty)) return null
  const reserve = curveReserve(launch)
  const cents =
    reserve > 0 && launch.cashCents > 1
      ? Math.min(launch.cashCents - 1, Math.round((launch.cashCents * qty) / (reserve + qty)))
      : Math.min(launch.cashCents, Math.round(qty * price * 100))
  if (!Number.isSafeInteger(cents) || cents < 1) return null
  return { cents, fillPrice: cents / 100 / qty }
}

export function planBuy(
  launch: Launch,
  payCents: number,
  now: number,
): { launch: Launch; qty: number; fillPrice: number } | null {
  if (!Number.isSafeInteger(payCents) || payCents < 1) return null
  const price = priceOf(launch)
  if (!(price > 0)) return null
  const reserve = curveReserve(launch)
  if (!(reserve > 0) || !(launch.cashCents > 0)) {
    const qty = payCents / 100 / price
    if (!(qty > 0) || !Number.isFinite(qty)) return null
    return {
      qty,
      fillPrice: price,
      launch: {
        ...launch,
        cashCents: launch.cashCents + payCents,
        supply: launch.supply + qty,
        prevPrice: price,
        prints: pushPrint(launch.prints, now, price),
      },
    }
  }
  const nextReserve = (reserve * launch.cashCents) / (launch.cashCents + payCents)
  const qty = reserve - nextReserve
  const nextCash = launch.cashCents + payCents
  const nextPrice = nextCash / 100 / nextReserve
  if (!(qty > 0) || !Number.isFinite(qty) || !(nextPrice > 0) || !Number.isFinite(nextPrice)) return null
  return {
    qty,
    fillPrice: payCents / 100 / qty,
    launch: {
      ...launch,
      cashCents: nextCash,
      reserve: nextReserve,
      supply: launch.supply + qty,
      price: nextPrice,
      prevPrice: price,
      prints: pushPrint(launch.prints, now, nextPrice),
    },
  }
}

export function planSell(launch: Launch, qty: number, cents: number, now: number): Launch {
  const selling = qty > 0 && Number.isFinite(qty) ? qty : 0
  const reserve = curveReserve(launch)
  const fair = selling > 0 ? quoteSell(launch, selling) : null
  const requested = Number.isSafeInteger(cents) && cents > 0 ? cents : 0
  const taken = Math.min(launch.cashCents, fair ? Math.min(fair.cents, requested) : 0)
  const supply = Math.max(0, launch.supply - (taken > 0 || reserve <= 0 ? selling : 0))
  const dust = supply < 1e-8
  const moved = reserve > 0 && selling > 0 && taken > 0
  const nextReserve = moved ? reserve + selling : reserve
  const nextCash = launch.cashCents - taken
  const priced = moved && nextCash > 0 && nextReserve > 0 ? nextCash / 100 / nextReserve : launch.price
  const price = dust && reserve <= 0 && launch.creator.id !== NOISE_ID ? 1 : priced
  return {
    ...launch,
    cashCents: nextCash,
    reserve: reserve > 0 ? nextReserve : launch.reserve,
    supply: dust ? 0 : supply,
    price,
    prevPrice: launch.price > 0 ? launch.price : launch.prevPrice,
    prints: pushPrint(launch.prints, now, price),
  }
}

export function liquidityShares(spends: DeskSpend[], liquidityCents: number, investCents: number): DeskSpend[] {
  if (!Number.isSafeInteger(liquidityCents) || liquidityCents < 1) return []
  const invested = new Map(investShares(spends, investCents).map((spend) => [spend.desk, spend.cents]))
  return spends.flatMap((spend) => {
    const cents = spend.cents - (invested.get(spend.desk) ?? 0)
    return cents > 0 ? [{ desk: spend.desk, cents }] : []
  })
}

export function investShares(spends: DeskSpend[], investCents: number): DeskSpend[] {
  const total = spends.reduce((sum, spend) => sum + spend.cents, 0)
  if (!Number.isSafeInteger(investCents) || investCents < 1 || total < 1) return []
  const parts = spends.map((spend) => {
    const product = investCents * spend.cents
    return { desk: spend.desk, cents: Math.floor(product / total), remainder: product % total }
  })
  let left = investCents - parts.reduce((sum, part) => sum + part.cents, 0)
  const shares = [...parts].sort((a, b) => b.remainder - a.remainder || a.desk.localeCompare(b.desk))
  for (const part of shares) {
    if (left <= 0) break
    part.cents += 1
    left -= 1
  }
  return shares.filter((part) => part.cents > 0).map(({ desk, cents }) => ({ desk, cents }))
}

export type DeskSpend = { desk: string; cents: number }
export type SpendRecord = { key: string; desks: Record<string, number> }

export function planSpend(
  records: SpendRecord[],
  need: number,
): { spends: DeskSpend[]; next: { key: string; cents: number; desks: Record<string, number> }[] } | null {
  if (!Number.isSafeInteger(need) || need < 1) return null
  const piles: { key: string; desk: string; cents: number }[] = []
  for (const record of records) {
    for (const [desk, cents] of Object.entries(record.desks)) {
      if (Number.isSafeInteger(cents) && cents > 0) piles.push({ key: record.key, desk, cents })
    }
  }
  piles.sort((a, b) => b.cents - a.cents || a.desk.localeCompare(b.desk) || a.key.localeCompare(b.key))
  let left = need
  const taken = new Map<string, number>()
  const debit = new Map<string, Map<string, number>>()
  for (const pile of piles) {
    if (left <= 0) break
    const use = Math.min(pile.cents, left)
    taken.set(pile.desk, (taken.get(pile.desk) ?? 0) + use)
    const row = debit.get(pile.key) ?? new Map<string, number>()
    row.set(pile.desk, (row.get(pile.desk) ?? 0) + use)
    debit.set(pile.key, row)
    left -= use
  }
  if (left !== 0) return null
  const next = records.map((record) => {
    const row = debit.get(record.key)
    const desks = { ...record.desks }
    if (row) {
      for (const [desk, cents] of row) {
        const remain = (desks[desk] ?? 0) - cents
        if (remain > 0) desks[desk] = remain
        else delete desks[desk]
      }
    }
    const cents = Object.values(desks).reduce((sum, value) => sum + value, 0)
    return { key: record.key, cents, desks }
  })
  const spends = [...taken.entries()]
    .map(([desk, cents]) => ({ desk, cents }))
    .sort((a, b) => a.desk.localeCompare(b.desk))
  return { spends, next }
}

export function filterLaunchListings(listings: Listing[], query: string): Listing[] {
  const q = query.trim().toLowerCase()
  return listings
    .filter((hit) => hit.venue === 'launch' && (!q || `${hit.label} ${hit.name} ${hit.symbol}`.toLowerCase().includes(q)))
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
}

export function launchListing(launch: Launch): Listing {
  return {
    id: `launch:${launch.symbol}`,
    venue: 'launch',
    symbol: launch.symbol,
    label: launch.label,
    name: launch.name,
  }
}

export function launchQuote(launch: Launch, now: number): Quote | null {
  const price = priceOf(launch)
  if (!(price > 0)) return null
  const change = price - launch.prevPrice
  return {
    id: `launch:${launch.symbol}`,
    venue: 'launch',
    symbol: launch.symbol,
    name: launch.name,
    price,
    change,
    changePct: launch.prevPrice > 0 ? (change / launch.prevPrice) * 100 : 0,
    marketState: null,
    asOf: now,
    creator: launch.creator.screenName || undefined,
    logo: launch.logo ? `/api/logos/${launch.symbol}?v=${launch.logoRev ?? 1}` : undefined,
  }
}

const STEP: Record<Interval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '1d': 86400,
}

export function launchCandles(launch: Launch, interval: Interval): Candle[] {
  const step = STEP[interval]
  const buckets = new Map<number, Candle>()
  for (const print of launch.prints) {
    const sec = Math.floor(print.time / 1000)
    const bucket = Math.floor(sec / step) * step
    const bar = buckets.get(bucket)
    if (!bar) {
      buckets.set(bucket, { time: bucket, open: print.price, high: print.price, low: print.price, close: print.price })
      continue
    }
    bar.high = Math.max(bar.high, print.price)
    bar.low = Math.min(bar.low, print.price)
    bar.close = print.price
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time)
}

function pushPrint(prints: Launch['prints'], time: number, price: number, limit = 400): Launch['prints'] {
  const next = [...prints, { time, price }]
  return next.length > limit ? next.slice(next.length - limit) : next
}

export const NOISE_SYMBOL = 'NOISE'
export const NOISE_ID = 'noise'
const NOISE_FLOOR = 0.05

export function noiseSeed(now: number): Launch {
  return seedLaunch({ id: NOISE_ID, screenName: '', name: 'Noise', avatarUrl: null }, NOISE_SYMBOL, 'Noise', 0, 0, now)
}

export function nextShockDelay(rng: () => number): number {
  const unit = rng()
  return Math.round(5_000 + unit * unit * 70_000)
}

export function rollShock(rng: () => number): { side: 'buy' | 'sell'; giant: boolean; magnitude: number } {
  const side = rng() < 0.5 ? 'sell' : 'buy'
  const giant = rng() < 0.2
  const magnitude = giant ? 0.08 + rng() * 0.32 : 0.0015 + rng() * 0.0225
  return { side, giant, magnitude }
}

export function applyShock(launch: Launch, shock: { side: 'buy' | 'sell'; magnitude: number }, now: number): Launch {
  const price = priceOf(launch)
  const signed = shock.side === 'buy' ? shock.magnitude : -shock.magnitude
  const next = Math.max(NOISE_FLOOR, Math.round(price * (1 + signed) * 10_000) / 10_000)
  return {
    ...launch,
    price: next,
    prevPrice: price,
    prints: pushPrint(launch.prints, now, next, 2000),
  }
}

export function shockLaunch(existing: Launch | undefined, now: number, rng: () => number): Launch | null {
  if (existing && (existing.symbol !== NOISE_SYMBOL || existing.creator.id !== NOISE_ID)) return null
  return applyShock(existing ?? noiseSeed(now), rollShock(rng), now)
}
