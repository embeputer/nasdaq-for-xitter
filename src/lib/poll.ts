export const CRYPTO_POLL_MS = 2_000
export const STOCK_POLL_MS = 10_000

export function quoteGroups(ids: string[]): { crypto: string[]; other: string[] } {
  const crypto: string[] = []
  const other: string[] = []
  for (const id of ids) {
    if (id.startsWith('crypto:')) crypto.push(id)
    else other.push(id)
  }
  return { crypto, other }
}

export function candlePollMs(venue: string | undefined): number {
  return venue === 'crypto' ? CRYPTO_POLL_MS : STOCK_POLL_MS
}
