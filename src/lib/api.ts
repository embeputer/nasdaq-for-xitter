import type { Candle, Fill, Instrument, Interval, Person, Position, Quote, Venue } from '../types'

export type Viewer = {
  screenName: string
  name: string
  avatarUrl: string | null
  admin: boolean
  moderator: boolean
  compliant: boolean
}

export type ModerationLaunch = {
  symbol: string
  label: string
  name: string
  creator: string
  delisted: boolean
}

export type ModerationState = {
  delistedLaunches: string[]
  restrictedMarkets: string[]
  restrictedUsers: string[]
  launches: ModerationLaunch[]
}

export type ModerationKind = 'delist_launch' | 'restrict_market' | 'restrict_user'

export type Book = {
  positions: Position[]
  fills: Fill[]
  desks: string[]
  durable: boolean
  nqfxCents: number
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

export async function acceptDisclaimer(): Promise<Viewer | null> {
  const res = await fetch('/api/disclaimer', { method: 'POST' })
  if (!res.ok) throw new Error('Could not accept the disclaimer.')
  const body = (await res.json()) as { user?: Viewer | null }
  return body.user ?? null
}

export async function openFor(id: string, amount: number, screenName: string): Promise<string> {
  const res = await fetch('/api/positions/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, amount, screenName }),
  })
  const body = (await res.json()) as { error?: string; message?: string; screenName?: string }
  if (!res.ok) throw new Error(body.error === 'no_person' ? 'Choose a person from Xitter.' : body.message || 'Could not open that position.')
  return body.screenName ?? screenName
}

export async function fetchModeration(): Promise<ModerationState> {
  const res = await fetch('/api/moderation')
  const body = (await res.json().catch(() => ({}))) as Partial<ModerationState> & { message?: string }
  if (!res.ok) throw new Error(body.message || 'Could not load moderation controls.')
  return {
    delistedLaunches: body.delistedLaunches ?? [],
    restrictedMarkets: body.restrictedMarkets ?? [],
    restrictedUsers: body.restrictedUsers ?? [],
    launches: body.launches ?? [],
  }
}

export async function saveModeration(kind: ModerationKind, target: string, active: boolean): Promise<ModerationState> {
  const res = await fetch('/api/moderation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, target, active }),
  })
  const body = (await res.json().catch(() => ({}))) as Partial<ModerationState> & { message?: string }
  if (!res.ok) throw new Error(body.message || 'Could not update moderation.')
  return {
    delistedLaunches: body.delistedLaunches ?? [],
    restrictedMarkets: body.restrictedMarkets ?? [],
    restrictedUsers: body.restrictedUsers ?? [],
    launches: body.launches ?? [],
  }
}

export async function launchFor(
  symbol: string,
  name: string,
  liquidity: number,
  invest: number,
  logo?: Blob,
): Promise<string> {
  const res = await fetch('/api/launches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol, name, liquidity, invest }),
  })
  const body = (await res.json().catch(() => ({}))) as { message?: string; label?: string }
  if (!res.ok) throw new Error(body.message || 'Could not launch that stock.')
  const label = body.label ?? `xit${symbol.toUpperCase()}`
  if (!logo) return label
  try {
    await saveLogo(symbol, logo)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The logo did not save.'
    throw new Error(`${label} is live. ${reason} Open the chart and click the mark.`)
  }
  return label
}

export async function saveLogo(symbol: string, file: Blob): Promise<void> {
  const res = await fetch(`/api/logos/${encodeURIComponent(symbol.toUpperCase())}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
  const body = (await res.json().catch(() => ({}))) as { message?: string }
  if (!res.ok) throw new Error(body.message || 'Could not save that logo.')
}

export async function withdrawFor(amount: number): Promise<{ cents: number; screenName: string; short: boolean }> {
  const res = await fetch('/api/vault/withdraw', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount }),
  })
  const body = (await res.json().catch(() => ({}))) as { message?: string; cents?: number; screenName?: string; short?: boolean }
  if (!res.ok || typeof body.cents !== 'number' || !body.screenName) throw new Error(body.message || 'Could not withdraw.')
  return { cents: body.cents, screenName: body.screenName, short: body.short === true }
}

export async function saleFor(symbol: string, qty: number): Promise<number | null> {
  const res = await fetch(`/api/launches/${encodeURIComponent(symbol)}/sale?qty=${encodeURIComponent(String(qty))}`)
  if (!res.ok) return null
  const body = (await res.json().catch(() => ({}))) as { cents?: number }
  return typeof body.cents === 'number' && body.cents > 0 ? body.cents / 100 : null
}

export async function closeFor(id: string, cash = true): Promise<{ cash: boolean; cents?: number; screenName?: string }> {
  const res = await fetch('/api/positions/close', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, cash }),
  })
  const body = (await res.json().catch(() => ({}))) as { message?: string; cash?: boolean; cents?: number; screenName?: string }
  if (!res.ok) throw new Error(body.message || 'Could not close that position.')
  return { cash: body.cash !== false, cents: body.cents, screenName: body.screenName }
}

export async function searchPeople(query: string): Promise<{ people: Person[]; message: string | null }> {
  const res = await fetch(`/api/xitter/users?q=${encodeURIComponent(query)}`)
  const body = (await res.json()) as { people?: Person[]; message?: string }
  if (!res.ok) return { people: [], message: body.message ?? 'Xitter search failed.' }
  return { people: body.people ?? [], message: null }
}
