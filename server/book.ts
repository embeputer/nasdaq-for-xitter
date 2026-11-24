export type Venue = 'stock' | 'crypto' | 'perpetual' | 'launch'

export type Person = {
  id: string
  screenName: string
  name: string
  avatarUrl: string | null
}

export type Position = {
  id: string
  venue: Venue
  symbol: string
  name: string
  label: string
  person: Person
  qty: number
  avgPrice: number
  openedAt: number
}

export type Fill = {
  id: string
  time: number
  venue: Venue
  symbol: string
  name: string
  label: string
  person: Person
  side: 'buy' | 'sell'
  qty: number
  price: number
  notional: number
  realized: number
}

export type Order = {
  venue: Venue
  symbol: string
  name: string
  label: string
  person: Person
  amount: number
  price: number
  now?: number
}

export function positionId(venue: Venue, symbol: string, screenName: string): string {
  return `pos:${venue}:${symbol}:${screenName.toLowerCase()}`
}

export function samePerson(a: string, b: string): boolean {
  return a.trim().replace(/^@/, '').toLowerCase() === b.trim().replace(/^@/, '').toLowerCase()
}

export function fileBuy(positions: Position[], order: Order): { positions: Position[]; fill: Fill } {
  const amount = cents(order.amount)
  if (!(amount > 0)) throw new Error('Amount has to be more than zero.')
  if (!(order.price > 0)) throw new Error('No price yet.')
  const screenName = order.person.screenName.trim().replace(/^@/, '')
  if (!screenName) throw new Error('Choose a person.')
  const person = { ...order.person, screenName }
  const qty = amount / order.price
  const now = order.now ?? Date.now()
  const id = positionId(order.venue, order.symbol, screenName)
  const existing = positions.find((position) => position.id === id)
  const next = existing
    ? positions.map((position) => {
        if (position.id !== id) return position
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
        ...positions,
        {
          id,
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
    realized: 0,
  }
  return { positions: next, fill }
}

export function fileClose(
  positions: Position[],
  positionIdToClose: string,
  price: number,
  now = Date.now(),
): { positions: Position[]; fill: Fill } {
  const position = positions.find((item) => item.id === positionIdToClose)
  if (!position) throw new Error('That position is already closed.')
  if (!(price > 0)) throw new Error('No price yet.')
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
    realized: position.qty * (price - position.avgPrice),
  }
  return { positions: positions.filter((item) => item.id !== position.id), fill }
}

function cents(value: number): number {
  return Math.round(value * 100) / 100
}
