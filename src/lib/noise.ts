import type { Position } from '../types'

export const NOISE_SYMBOL = 'NOISE'
export const NOISE_QUOTE = 'launch:NOISE'
export const NOISE_HOUSE = 'house:NOISE'

export function noisePosition(): Position {
  return {
    id: NOISE_HOUSE,
    venue: 'launch',
    symbol: NOISE_SYMBOL,
    name: 'Noise',
    label: 'xitNOISE',
    person: { id: 'noise', screenName: '', name: 'Noise', avatarUrl: null },
    qty: 0,
    avgPrice: 0,
    openedAt: 0,
  }
}
