import { useEffect, useState } from 'react'
import type { Venue } from '../types'

export function assetIcon(venue: Venue, symbol: string): string | null {
  if (venue === 'stock') {
    const ticker = symbol.trim().toUpperCase()
    if (!/^[A-Z.]{1,10}$/.test(ticker)) return null
    return `https://financialmodelingprep.com/image-stock/${ticker}.png`
  }
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
  logo,
}: {
  venue: Venue
  symbol: string
  label: string
  logo?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [logo, venue, symbol])
  const src = failed ? null : logo || assetIcon(venue, symbol)
  const letter = (venue === 'launch' ? symbol : label || symbol).slice(0, 1)
  if (!src) return <span className="avatar-fallback">{letter}</span>
  return <img src={src} alt="" onError={() => setFailed(true)} />
}
