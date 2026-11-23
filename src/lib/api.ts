import type { Candle, Fill, Instrument, Interval, Person, Position, Quote, Venue } from '../types'

export type Viewer = {
  screenName: string
  name: string
  avatarUrl: string | null
  admin: boolean
}

export type Book = {
  positions: Position[]
  fills: Fill[]
  desks: string[]
  durable: boolean
}

export async function fetchQuotes(ids: string[]): Promise<Quote[]> {
  if (!ids.length) return []
  const res = await fetch(`/api/quotes?ids=${encodeURIComponent(ids.join(','))}`)
  if (!res.ok) throw new Error('Could not load prices.')
  const body = (await res.json()) as { quotes?: Quote[] }
  return body.quotes ?? []
}

export async function fetchCandles(id: string, interval: Interval): Promise<Candle[]> {
  const res = await fetch(`/api/candles?id=${encodeURIComponent(id)}&interval=${interval}`)
  if (!res.ok) throw new Error('Could not load the chart.')
  const body = (await res.json()) as { candles?: Candle[] }
  return body.candles ?? []
}

export async function searchMarket(venue: Venue, query: string): Promise<Instrument[]> {
  const res = await fetch(`/api/search?venue=${venue}&q=${encodeURIComponent(query)}`)
  if (!res.ok) return []
  const body = (await res.json()) as { hits?: Instrument[] }
  return body.hits ?? []
}

export async function fetchBook(): Promise<Book> {
  const res = await fetch('/api/book')
  if (!res.ok) throw new Error('Could not load the book.')
  return (await res.json()) as Book
}

export async function fetchSession(): Promise<Viewer | null> {
  const res = await fetch('/api/session')
  if (!res.ok) return null
  const body = (await res.json()) as { user?: Viewer | null }
  return body.user ?? null
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' })
}

export async function openFor(id: string, amount: number, screenName: string): Promise<string> {
  const res = await fetch('/api/positions/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, amount, screenName }),
  })
  const body = (await res.json()) as { error?: string; screenName?: string }
  if (!res.ok) throw new Error(body.error === 'no_person' ? 'Choose a person from Xitter.' : 'Could not open that position.')
  return body.screenName ?? screenName
}

export async function closeFor(id: string): Promise<void> {
  const res = await fetch('/api/positions/close', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  if (!res.ok) throw new Error('Could not close that position.')
}

export async function searchPeople(query: string): Promise<{ people: Person[]; message: string | null }> {
  const res = await fetch(`/api/xitter/users?q=${encodeURIComponent(query)}`)
  const body = (await res.json()) as { people?: Person[]; message?: string }
  if (!res.ok) return { people: [], message: body.message ?? 'Xitter search failed.' }
  return { people: body.people ?? [], message: null }
}
