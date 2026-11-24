import { contractAddress, isContractAddress, searchMarket, type Listing, type Venue } from './market.ts'

export const REFUND_NOTE =
  'Sorry, i couldn\'t find that! Make sure you specify an available stock or crypto market. If donating, enter "donate" in the note.'

const PREVIOUS_REFUND_NOTES = [
  'Sorry, i couldn\'t find that! Make sure you specify an available stock, crypto, or perpetual market. If donating, enter "donate" in the note.',
]

export function isRefundNote(note: string): boolean {
  const text = note.trim()
  return text === REFUND_NOTE || PREVIOUS_REFUND_NOTES.includes(text)
}

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
  'perpetuals',
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

function noteWords(note: string): string[] {
  const text = note.trim()
  if (!text || isRefundNote(text)) return []
  const tokens = (text.match(/[A-Za-z][A-Za-z0-9._-]{0,23}/g) ?? []).map((token) => token.toLowerCase())
  return tokens.filter((token) => token.length >= 2 && !SKIP.has(token) && !COURTESY.has(token))
}

export function isDonationNote(note: string): boolean {
  const words = noteWords(note)
  return words.length > 0 && words.every((word) => DONATION.has(word))
}

/** A note whose only remaining word is "vault" stores the Equicoins as an NQFX balance. */
export function isVaultNote(note: string): boolean {
  const words = noteWords(note)
  return words.length > 0 && words.every((word) => word === 'vault')
}

/** Drop a perpetual order. A ticker that is not tied to that order still counts. */
function withoutPerps(text: string): string {
  return text
    .replace(/\b(?:perps?|perpetuals?)\s*[:=]\s*[A-Za-z0-9._-]{1,24}/gi, ' ')
    .replace(/\b[A-Za-z][\w.]{0,23}-PERP\b/gi, ' ')
    .replace(/\b(?:perps?|perpetuals?)\s+[A-Za-z][\w.]{0,23}\b/gi, ' ')
}

function launchQueries(text: string): NoteQuery[] {
  const out: NoteQuery[] = []
  for (const match of text.matchAll(/\bxit(?:\s*[:=]\s*|\s+)([A-Za-z]{2,8})\b/gi)) {
    out.push({ venue: 'launch', query: match[1].toUpperCase() })
  }
  for (const match of text.matchAll(/\bxit([A-Za-z]{2,8})\b/gi)) {
    out.push({ venue: 'launch', query: match[1].toUpperCase() })
  }
  return out
}

function stripLaunchTokens(text: string): string {
  return text
    .replace(/\bxit(?:\s*[:=]\s*|\s+)[A-Za-z]{2,8}\b/gi, ' ')
    .replace(/\bxit[A-Za-z]{2,8}\b/gi, ' ')
}

export function queriesFromNote(note: string): NoteQuery[] {
  const raw = note.trim()
  if (!raw || isRefundNote(raw)) return []
  const text = withoutPerps(raw)
  const launches = launchQueries(text)
  const rest = stripLaunchTokens(text)
  if (!rest.trim()) return dedupeQueries(launches)
  const address = contractAddress(rest)
  if (address && rest.toLowerCase() === address.toLowerCase()) return dedupeQueries([{ venue: 'crypto', query: address }, ...launches])
  if (!/\s/.test(rest)) {
    if (/^[A-Za-z][\w.]{0,23}$/.test(rest)) return dedupeQueries([...launches, { venue: null, query: rest }])
  }
  const out: NoteQuery[] = []
  for (const match of rest.matchAll(/\b(stock|crypto)\s*[:=]\s*([A-Za-z0-9._-]{1,24})/gi)) {
    const kind = match[1].toLowerCase()
    out.push({ venue: kind === 'stock' ? 'stock' : 'crypto', query: match[2] })
  }
  for (const match of rest.matchAll(/\$([A-Za-z][A-Za-z0-9._-]{0,14})/g)) {
    out.push({ venue: 'stock', query: match[1] })
  }
  if (!out.length) {
    for (const token of rest.match(/[A-Za-z][A-Za-z0-9._-]{0,23}/g) ?? []) {
      if (SKIP.has(token.toLowerCase()) || token.length < 2 || /-perp$/i.test(token)) continue
      out.push({ venue: null, query: token })
    }
  }
  if (address) out.unshift({ venue: 'crypto', query: address })
  return dedupeQueries([...launches, ...out])
}

function dedupeQueries(items: NoteQuery[]): NoteQuery[] {
  const seen = new Set<string>()
  return items
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

export async function resolveNote(
  note: string,
  search: Search = searchMarket,
  findLaunch: (symbol: string) => Promise<Listing | null> = async () => null,
): Promise<Listing | null> {
  for (const item of queriesFromNote(note)) {
    const found = item.venue === 'launch' ? await findLaunch(item.query) : await resolveQuery(item, search)
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
  const [stocks, cryptos] = await Promise.all([search('stock', item.query), search('crypto', item.query)])
  const stockHit = pickListing(stocks, item.query, 'stock')
  const cryptoHit = pickListing(cryptos, item.query, 'crypto')
  if (cryptoHit && isCryptoTicker(cryptoHit, item.query)) return cryptoHit
  const name = item.query.trim().toLowerCase()
  if (cryptoHit && cryptoHit.name.toLowerCase() === name && stockHit?.name.toLowerCase() !== name) return cryptoHit
  return stockHit ?? cryptoHit
}

function isCryptoTicker(hit: Listing, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q || hit.venue !== 'crypto') return false
  const label = hit.label.toLowerCase()
  const symbol = hit.symbol.toLowerCase()
  return label === q || symbol === q || symbol === `${q}usdt` || symbol === `${q}usdc`
}
