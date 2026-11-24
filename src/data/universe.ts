import type { Instrument, Venue } from '../types'

export const DEFAULT_INSTRUMENT: Instrument = {
  id: 'stock:NVDA',
  venue: 'stock',
  symbol: 'NVDA',
  label: 'NVDA',
  name: 'NVIDIA',
}

export function openOn(venue: Venue): Instrument {
  if (venue === 'crypto') {
    return { id: 'crypto:BTCUSDT', venue: 'crypto', symbol: 'BTCUSDT', label: 'BTC', name: 'Bitcoin' }
  }
  if (venue === 'perpetual') {
    return { id: 'perpetual:BTC', venue: 'perpetual', symbol: 'BTC', label: 'BTC-PERP', name: 'Bitcoin' }
  }
  return DEFAULT_INSTRUMENT
}

export const VENUE_LABEL: Record<Venue, string> = {
  stock: 'Stock',
  crypto: 'Crypto',
  perpetual: 'Perpetual',
  launch: 'UGS',
}
