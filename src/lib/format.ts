import type { Venue } from '../types'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatUsd(value: number, signed = false): string {
  if (!Number.isFinite(value)) return '—'
  const text = usd.format(Math.abs(value))
  if (value < 0) return `−${text}`
  if (signed && value > 0) return `+${text}`
  return text
}

export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const text = `${Math.abs(value).toFixed(2)}%`
  if (value < 0) return `−${text}`
  if (value > 0) return `+${text}`
  return text
}

export function formatPrice(value: number, venue: Venue): string {
  if (!Number.isFinite(value)) return '—'
  const digits = venue === 'stock' || value >= 1 ? 2 : value >= 0.01 ? 4 : 6
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const digits = value >= 100 ? 2 : value >= 1 ? 4 : 6
  return value.toLocaleString('en-US', { maximumFractionDigits: digits })
}

export function formatClock(time: number): string {
  return new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function pnlClass(value: number): string {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return ''
}

export function marketNote(state: string | null, venue: Venue): string | null {
  if (venue !== 'stock' || !state || state === 'REGULAR') return null
  if (state === 'PRE' || state === 'PREPRE') return 'Premarket. The fill uses the last price.'
  if (state === 'POST' || state === 'POSTPOST') return 'After hours. The fill uses the last price.'
  if (state === 'CLOSED') return 'The equity market is closed. The fill uses the last price.'
  return null
}
