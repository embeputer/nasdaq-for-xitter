import type { Account, Fill, Person, Position, Venue } from '../types'

export const STARTING_CASH = 100_000

export class AccountError extends Error {}

export function createAccount(): Account {
  return { cash: STARTING_CASH, realized: 0, positions: [], fills: [] }
}

export function cents(value: number): number {
  return Math.round(value * 100) / 100
}

export function markKey(venue: Venue, symbol: string): string {
  return `${venue}:${symbol}`
}

export function marketValue(position: Position, price: number | undefined): number {
  const mark = price && price > 0 ? price : position.avgPrice
  return position.qty * mark
}

export function openPnl(position: Position, price: number | undefined): number {
  if (!price || price <= 0) return 0
  return position.qty * (price - position.avgPrice)
}

export function portfolioValue(account: Account, prices: Record<string, number>): number {
  const invested = account.positions.reduce(
    (sum, position) => sum + marketValue(position, prices[markKey(position.venue, position.symbol)]),
    0,
  )
  return account.cash + invested
}

type Order = {
  venue: Venue
  symbol: string
  name: string
  label: string
  person: Person
  amount: number
  price: number
  now?: number
}

export function invest(account: Account, order: Order): { account: Account; fill: Fill } {
  const amount = cents(order.amount)
  if (!Number.isFinite(amount) || amount < 1) throw new AccountError('Minimum is $1.')
  if (!Number.isFinite(order.price) || order.price <= 0) throw new AccountError('No price yet.')
  if (amount > account.cash + 0.001) throw new AccountError('That is more than your cash.')
  const screenName = order.person.screenName.trim().replace(/^@/, '')
  if (!screenName) throw new AccountError('Choose a person from Xitter.')
  const person = { ...order.person, screenName }
  const qty = amount / order.price
  const now = order.now ?? Date.now()
  const existing = account.positions.find(
    (position) =>
      position.venue === order.venue &&
      position.symbol === order.symbol &&
      position.person.screenName.toLowerCase() === screenName.toLowerCase(),
  )
  const positions = existing
    ? account.positions.map((position) => {
        if (position.id !== existing.id) return position
        const nextQty = position.qty + qty
        return {
          ...position,
          qty: nextQty,
          avgPrice: (position.qty * position.avgPrice + qty * order.price) / nextQty,
          name: order.name,
          label: order.label,
          person,
        }
      })
    : [
        ...account.positions,
        {
          id: crypto.randomUUID(),
          venue: order.venue,
          symbol: order.symbol,
          name: order.name,
          label: order.label,
          person,
          qty,
          avgPrice: order.price,
          openedAt: now,
        },
      ]
  const fill: Fill = {
    id: crypto.randomUUID(),
    time: now,
    venue: order.venue,
    symbol: order.symbol,
    name: order.name,
    label: order.label,
    person,
    side: 'buy',
    qty,
    price: order.price,
    notional: amount,
  }
  return {
    fill,
    account: {
      cash: cents(account.cash - amount),
      realized: account.realized,
      positions,
      fills: [fill, ...account.fills].slice(0, 40),
    },
  }
}

export function closePosition(
  account: Account,
  positionId: string,
  price: number,
  now = Date.now(),
): { account: Account; fill: Fill } {
  const position = account.positions.find((item) => item.id === positionId)
  if (!position) throw new AccountError('That position is already closed.')
  if (!Number.isFinite(price) || price <= 0) throw new AccountError('No price yet.')
  const notional = cents(position.qty * price)
  const fill: Fill = {
    id: crypto.randomUUID(),
    time: now,
    venue: position.venue,
    symbol: position.symbol,
    name: position.name,
    label: position.label,
    person: position.person,
    side: 'sell',
    qty: position.qty,
    price,
    notional,
  }
  return {
    fill,
    account: {
      cash: cents(account.cash + notional),
      realized: account.realized + position.qty * (price - position.avgPrice),
      positions: account.positions.filter((item) => item.id !== positionId),
      fills: [fill, ...account.fills].slice(0, 40),
    },
  }
}
