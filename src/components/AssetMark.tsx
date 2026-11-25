import { useEffect, useState } from 'react'
import type { Venue } from '../types'
import { brandColor, brandLetter } from '../lib/brand'

export function assetIcon(venue: Venue, symbol: string): string | null {
  if (venue === 'crypto' || venue === 'perpetual') {
    if (symbol.toLowerCase().startsWith('0x')) return null
    const base = symbol
      .toUpperCase()
      .replace(/(USDT|USDC)$/, '')
      .replace(/^\d+/, '')
      .toLowerCase()
    if (!/^[a-z]{2,15}$/.test(base)) return null
    return `https://assets.coincap.io/assets/icons/${base}@2x.png`
  }
  return null
}

export function AssetMark({
  venue,
  symbol,
  label,
  name,
  logo,
}: {
  venue: Venue
  symbol: string
  label: string
  name?: string
  logo?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [logo, venue, symbol])
  // Stocks never show a real company logo: just a brand-colored circle with the first letter.
  if (venue === 'stock') {
    return (
      <span
        className="avatar-fallback avatar-brand"
        style={{ backgroundColor: brandColor(symbol) }}
        aria-hidden="true"
      >
        {brandLetter(name, label, symbol)}
      </span>
    )
  }
  const src = failed ? null : logo || assetIcon(venue, symbol)
  const letter = (venue === 'launch' ? symbol : label || symbol).slice(0, 1)
  if (!src) return <span className="avatar-fallback">{letter}</span>
  return <img src={src} alt="" onError={() => setFailed(true)} />
}
