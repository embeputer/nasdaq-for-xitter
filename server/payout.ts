import { createHash } from 'node:crypto'
import { samePerson, type Position } from './book.ts'
import type { PaymentRow } from './store.ts'

export type PayTransfer = {
  desk: string
  cents: number
  note: string
  key: string
}

// Frozen before the first send. A retry pays this plan again: Xitter keeps the
// first payment for a repeated idempotency key and does not apply a new amount.
export type PayPlan = {
  qty: number
  price: number
  cents: number
  transfers: PayTransfer[]
}

export type CloseError = { ok: false; status: number; error: string; message: string }

const KEY = /^[\w-]{8,64}$/
const TAIL = ' - paid out by Nasdaq for Xitter'

export function payoutCents(qty: number, price: number): number | null {
  if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0) return null
  const cents = Math.round(qty * price * 100)
  if (!Number.isSafeInteger(cents) || cents < 1) return null
  return cents
}

export function closeNote(label: string): string {
  const clean = label.replace(/\s+/g, ' ').trim() || 'a position'
  const room = 140 - TAIL.length
  const head = [...`Closed ${clean}`].slice(0, Math.max(0, room)).join('')
  return `${head}${TAIL}`
}

// The cents and the chunk index are part of the key. The same close retries
// with the same key; a different amount is a different payment.
export function closeKey(positionId: string, openedAt: number, desk: string, cents: number, part: number): string {
  const digest = createHash('sha256').update(`${positionId}\n${openedAt}\n${desk}\n${cents}\n${part}`).digest('hex').slice(0, 40)
  return `close-${digest}`
}

export function payoutMarker(position: Position): string {
  return `payout:${position.id}:${position.openedAt}`
}

export function planPayout(input: {
  position: Position
  price: number
  payments: PaymentRow[]
  desks: { screenName: string; canSend: boolean; maxCents: number }[]
}): { ok: true; plan: PayPlan } | CloseError {
  const cents = payoutCents(input.position.qty, input.price)
  if (cents === null) {
    return { ok: false, status: 400, error: 'too_small', message: "This position is worth less than 1¢, so it can't be paid out." }
  }
  const weights = new Map<string, number>()
  const labels = new Map<string, string>()
  const detail = `${input.position.venue}:${input.position.symbol}`
  for (const row of input.payments) {
    if (row.status !== 'filled' || row.detail !== detail) continue
    if (!samePerson(row.senderScreen, input.position.person.screenName)) continue
    if (!Number.isSafeInteger(row.amountCents) || row.amountCents < 1) continue
    const key = deskKey(row.desk)
    if (!key) continue
    weights.set(key, (weights.get(key) ?? 0) + row.amountCents)
    if (!labels.has(key)) labels.set(key, row.desk.trim().replace(/^@/, ''))
  }
  if (weights.size === 0) {
    return {
      ok: false,
      status: 409,
      error: 'no_desk',
      message: "No Equicoins were paid in for this position, so it can't be closed for cash.",
    }
  }
  const shares = allocate(cents, weights)
  if (!shares) {
    return { ok: false, status: 409, error: 'too_large', message: "This position is too large to pay out in one close. The position is still open." }
  }
  const note = closeNote(input.position.label)
  const transfers: PayTransfer[] = []
  for (const share of shares) {
    const desk = input.desks.find((item) => deskKey(item.screenName) === share.desk)
    const label = desk?.screenName || labels.get(share.desk) || share.desk
    if (!desk?.canSend) {
      return {
        ok: false,
        status: 502,
        error: 'no_account',
        message: `@${label} can't send Equicoins right now. The position is still open.`,
      }
    }
    if (!Number.isSafeInteger(desk.maxCents) || desk.maxCents < 1) {
      return {
        ok: false,
        status: 502,
        error: 'payout_failed',
        message: `Couldn't see how much @${label} can send. The position is still open.`,
      }
    }
    const parts = chunk(share.cents, desk.maxCents)
    if (!parts) {
      return {
        ok: false,
        status: 409,
        error: 'too_large',
        message: "This position is too large to pay out in one close. The position is still open.",
      }
    }
    parts.forEach((part, index) => {
      transfers.push({
        desk: share.desk,
        cents: part,
        note,
        key: closeKey(input.position.id, input.position.openedAt, share.desk, part, index),
      })
    })
  }
  return { ok: true, plan: { qty: input.position.qty, price: input.price, cents, transfers } }
}

export function readPayout(raw: string | null): PayPlan | 'bad' | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'bad'
  }
  if (!parsed || typeof parsed !== 'object') return 'bad'
  const record = parsed as Record<string, unknown>
  const { qty, price, cents } = record
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) return 'bad'
  if (typeof price !== 'number' || !(price > 0) || !Number.isFinite(price)) return 'bad'
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents < 1) return 'bad'
  if (!Array.isArray(record.transfers) || record.transfers.length === 0 || record.transfers.length > 100) return 'bad'
  const transfers: PayTransfer[] = []
  let sum = 0
  for (const item of record.transfers) {
    if (!item || typeof item !== 'object') return 'bad'
    const row = item as Record<string, unknown>
    if (typeof row.desk !== 'string' || !deskKey(row.desk)) return 'bad'
    if (typeof row.cents !== 'number' || !Number.isSafeInteger(row.cents) || row.cents < 1) return 'bad'
    if (typeof row.note !== 'string' || [...row.note].length === 0 || [...row.note].length > 140) return 'bad'
    if (typeof row.key !== 'string' || !KEY.test(row.key)) return 'bad'
    sum += row.cents
    transfers.push({ desk: row.desk, cents: row.cents, note: row.note, key: row.key })
  }
  if (sum !== cents) return 'bad'
  return { qty, price, cents, transfers }
}

function allocate(total: number, weights: Map<string, number>): { desk: string; cents: number }[] | null {
  const entries = [...weights.entries()].filter(([, weight]) => weight > 0)
  const sum = entries.reduce((totalWeight, [, weight]) => totalWeight + weight, 0)
  if (!entries.length || !Number.isSafeInteger(sum) || sum < 1) return null
  const parts = entries.map(([desk, weight]) => {
    const product = total * weight
    if (!Number.isSafeInteger(product)) return null
    return { desk, cents: Math.floor(product / sum), remainder: product % sum }
  })
  if (parts.some((part) => part === null)) return null
  const shares = parts as { desk: string; cents: number; remainder: number }[]
  let left = total - shares.reduce((taken, part) => taken + part.cents, 0)
  if (!Number.isSafeInteger(left) || left < 0) return null
  shares.sort((a, b) => b.remainder - a.remainder || a.desk.localeCompare(b.desk))
  for (const part of shares) {
    if (left <= 0) break
    part.cents += 1
    left -= 1
  }
  if (left !== 0) return null
  return shares.filter((part) => part.cents > 0).map(({ desk, cents }) => ({ desk, cents }))
}

function chunk(total: number, max: number): number[] | null {
  const parts: number[] = []
  let left = total
  while (left > 0) {
    if (parts.length === 100) return null
    const next = Math.min(max, left)
    parts.push(next)
    left -= next
  }
  return parts
}

function deskKey(name: string): string {
  return name.trim().replace(/^@/, '').toLowerCase()
}
