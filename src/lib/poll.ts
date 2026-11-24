export const CRYPTO_POLL_MS = 2_000
export const STOCK_POLL_MS = 10_000

export function quoteGroups(ids: string[]): { fast: string[]; slow: string[] } {
  const fast: string[] = []
  const slow: string[] = []
  for (const id of ids) {
    if (id.startsWith('crypto:') || id === 'launch:NOISE') fast.push(id)
    else slow.push(id)
  }
  return { fast, slow }
}

export function candlePollMs(venue: string | undefined, symbol?: string): number {
  if (venue === 'crypto' || symbol === 'NOISE') return CRYPTO_POLL_MS
  return STOCK_POLL_MS
}
