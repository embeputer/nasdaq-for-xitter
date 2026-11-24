export type Venue = 'stock' | 'crypto' | 'perpetual' | 'launch'

export type Interval = '1m' | '5m' | '15m' | '1h' | '1d'

export type Instrument = {
  id: string
  venue: Venue
  symbol: string
  label: string
  name: string
}

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
}

export type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
}

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
  realized?: number
}

export type Account = {
  cash: number
  realized: number
  positions: Position[]
  fills: Fill[]
}
