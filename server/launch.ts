import type { Person } from './book.ts'
import type { Candle, Interval, Listing, Quote } from './market.ts'

export type Launch = {
  symbol: string
  name: string
  label: string
  creator: Person
  cashCents: number
  supply: number
  price: number
  prevPrice: number
  openedAt: number
  prints: { time: number; price: number }[]
}

export type LaunchFailure = {
  ok: false
  error: 'bad_symbol' | 'bad_name' | 'taken' | 'poor' | 'small' | 'bad_invest'
  message: string
}

const LAUNCH_MESSAGE: Record<LaunchFailure['error'], string> = {
  bad_symbol: 'Use 2 to 8 letters.',
  bad_name: 'Give it a name.',
  taken: 'That stock already exists.',
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

// 10% of a later buy stays in the pool and lifts the price. The rest mints shares at the old price.
const LIFT = 10

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
  const screenName = person.screenName.trim().replace(/^@/, '')
  return {
    symbol,
    name,
    label: launchLabel(symbol),
    creator: { ...person, screenName },
    cashCents: liquidityCents + investCents,
    supply: investCents / 100,
    price: 1,
    prevPrice: 1,
    openedAt: now,
    prints: [{ time: now, price: 1 }],
  }
}

export function planBuy(
  launch: Launch,
  payCents: number,
  now: number,
): { launch: Launch; qty: number; fillPrice: number } | null {
  if (!Number.isSafeInteger(payCents) || payCents < 1) return null
  const price = priceOf(launch)
  if (!(price > 0)) return null
  const liftCents = Math.min(payCents - 1, Math.max(0, Math.round(payCents / LIFT)))
  const mintCents = payCents - liftCents
  const qty = mintCents / 100 / price
  if (!(qty > 0) || !Number.isFinite(qty)) return null
  const fillPrice = payCents / 100 / qty
  const cashCents = launch.cashCents + payCents
  const supply = launch.supply + qty
  const navCents = Math.round(price * launch.supply * 100) + payCents
  const nextPrice = navCents / 100 / supply
  if (!(nextPrice > 0) || !Number.isFinite(nextPrice)) return null
  return {
    qty,
    fillPrice,
    launch: {
      ...launch,
      cashCents,
      supply,
      price: nextPrice,
      prevPrice: price,
      prints: pushPrint(launch.prints, now, nextPrice),
    },
  }
}

export function planSell(launch: Launch, qty: number, cents: number, now: number): Launch {
  const taken = Number.isSafeInteger(cents) && cents > 0 ? Math.min(cents, launch.cashCents) : 0
  const supply = Math.max(0, launch.supply - (qty > 0 && Number.isFinite(qty) ? qty : 0))
  const dust = supply < 1e-8
  const price = dust ? 1 : launch.price
  return {
    ...launch,
    cashCents: launch.cashCents - taken,
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

function pushPrint(prints: Launch['prints'], time: number, price: number): Launch['prints'] {
  const next = [...prints, { time, price }]
  return next.length > 400 ? next.slice(next.length - 400) : next
}
