import { contractAddress, isContractAddress, searchMarket, type Listing, type Venue } from './market.ts'

export const REFUND_NOTE =
  'Sorry, i couldn\'t find that! Make sure you specify an available stock, crypto, or perpetual market. If donating, enter "donate" in the note.'

const DONATION = new Set([
  'donate',
  'donates',
  'donated',
  'donating',
  'donation',
  'donations',
  'tip',
  'tips',
  'tipping',
  'fund',
  'funds',
  'gift',
  'gifts',
  'charity',
  'charities',
  'contribute',
  'contribution',
  'contributions',
])

const COURTESY = new Set(['thanks', 'thank', 'thx', 'ty', 'you', 'your', 'this', 'just', 'here'])

const SKIP = new Set([
  'a',
  'an',
  'the',
  'for',
  'of',
  'me',
  'my',
  'some',
  'please',
  'market',
  'markets',
  'stock',
  'stocks',
  'crypto',
  'coin',
  'coins',
  'perp',
  'perps',
  'perpetual',
  'usd',
  'usdt',
  'usdc',
  'dollars',
  'dollar',
  'buy',
  'bought',
  'sell',
  'in',
  'on',
  'to',
  'and',
  'with',
  'eq',
  'equicoin',
  'equicoins',
])

export type NoteQuery = { venue: Venue | null; query: string }

type Search = (venue: Venue, query: string) => Promise<Listing[]>

export function isDonationNote(note: string): boolean {
  const text = note.trim()
  if (!text || text === REFUND_NOTE) return false
  const tokens = (text.match(/[A-Za-z][A-Za-z0-9._-]{0,23}/g) ?? []).map((token) => token.toLowerCase())
  const words = tokens.filter((token) => token.length >= 2 && !SKIP.has(token) && !COURTESY.has(token))
  return words.length > 0 && words.every((word) => DONATION.has(word))
}

export function queriesFromNote(note: string): NoteQuery[] {
  const text = note.trim()
  if (!text || text === REFUND_NOTE) return []
  const address = contractAddress(text)
  if (address && text.toLowerCase() === address.toLowerCase()) return [{ venue: 'crypto', query: address }]
  if (!/\s/.test(text)) {
    const perp = text.match(/^([A-Za-z][\w.]{0,23})-PERP$/i)
    if (perp) return [{ venue: 'perpetual', query: perp[1] }]
    if (/^[A-Za-z][\w.]{0,23}$/.test(text)) return [{ venue: null, query: text }]
  }
  const out: NoteQuery[] = []
  for (const match of text.matchAll(/\b(stock|crypto|perp|perpetual)\s*[:=]\s*([A-Za-z0-9._-]{1,24})/gi)) {
    const kind = match[1].toLowerCase()
    const venue: Venue = kind === 'stock' ? 'stock' : kind === 'crypto' ? 'crypto' : 'perpetual'
    out.push({ venue, query: match[2] })
  }
  for (const match of text.matchAll(/\$([A-Za-z][A-Za-z0-9._-]{0,14})/g)) {
    out.push({ venue: 'stock', query: match[1] })
  }
  for (const match of text.matchAll(/\b([A-Za-z][\w.]{0,16})-PERP\b/gi)) {
    out.push({ venue: 'perpetual', query: match[1] })
  }
  if (!out.length) {
    for (const token of text.match(/[A-Za-z][A-Za-z0-9._-]{0,23}/g) ?? []) {
      if (SKIP.has(token.toLowerCase()) || token.length < 2) continue
      out.push({ venue: null, query: token })
    }
  }
  if (address) out.unshift({ venue: 'crypto', query: address })
  const seen = new Set<string>()
  return out
    .filter((item) => {
      const key = `${item.venue ?? ''}:${item.query.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 4)
}

export function pickListing(hits: Listing[], query: string, venue: Venue | null): Listing | null {
  const q = query.trim().toLowerCase().replace(/-perp$/, '')
  if (!q) return null
  const pool = venue ? hits.filter((hit) => hit.venue === venue) : hits
  const exact = pool.find((hit) => {
    const symbol = hit.symbol.toLowerCase()
    const label = hit.label.toLowerCase()
    const name = hit.name.toLowerCase()
    return symbol === q || label === q || label === `${q}-perp` || name === q
  })
  if (exact) return exact
  if (!venue || venue === 'crypto') {
    const pair = pool.find((hit) => {
      if (hit.venue !== 'crypto') return false
      const symbol = hit.symbol.toLowerCase()
      return symbol === `${q}usdt` || symbol === `${q}usdc`
    })
    if (pair) return pair
  }
  if (q.length >= 4) {
    const named = pool.filter((hit) => hit.name.toLowerCase().split(/[\s,]+/)[0] === q)
    if (named.length === 1) return named[0] ?? null
    const shortest = Math.min(...named.map((hit) => hit.symbol.length))
    const best = named.filter((hit) => hit.symbol.length === shortest)
    if (best.length === 1) return best[0] ?? null
  }
  return null
}

export async function resolveNote(note: string, search: Search = searchMarket): Promise<Listing | null> {
  for (const item of queriesFromNote(note)) {
    const found = await resolveQuery(item, search)
    if (found) return found
  }
  return null
}

async function resolveQuery(item: NoteQuery, search: Search): Promise<Listing | null> {
  if (item.venue) {
    const hits = await search(item.venue, item.query)
    if (isContractAddress(item.query)) return hits[0] ?? null
    return pickListing(hits, item.query, item.venue)
  }
  if (/usdt$|usdc$/i.test(item.query)) {
    const hits = await search('crypto', item.query)
    return pickListing(hits, item.query, 'crypto')
  }
  const [stocks, cryptos, perps] = await Promise.all([
    search('stock', item.query),
    search('crypto', item.query),
    search('perpetual', item.query),
  ])
  const stockHit = pickListing(stocks, item.query, 'stock')
  const cryptoHit = pickListing(cryptos, item.query, 'crypto')
  const perpHit = pickListing(perps, item.query, 'perpetual')
  const name = item.query.trim().toLowerCase()
  if (cryptoHit && cryptoHit.name.toLowerCase() === name && stockHit?.name.toLowerCase() !== name) return cryptoHit
  return stockHit ?? cryptoHit ?? perpHit
}
