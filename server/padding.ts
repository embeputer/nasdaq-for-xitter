import { liquidityShares, type DeskSpend } from './launch.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function deskKey(name: string): string {
  return name.trim().replace(/^@/, '').toLowerCase()
}

export function paddingKey(desk: string): string {
  return `padding:${deskKey(desk)}`
}

export function paddingReadyKey(desk: string): string {
  return `padding-ready:${deskKey(desk)}`
}

export function likesKey(desk: string): string {
  return `likes:${deskKey(desk)}`
}

export function readCents(raw: string | undefined): number {
  if (!raw) return 0
  const cents = Number(raw)
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : 0
}

export function openingPadding(balanceCents: number, reservedCents: number): number {
  if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) return 0
  const reserved = Number.isSafeInteger(reservedCents) && reservedCents > 0 ? reservedCents : 0
  return Math.max(0, balanceCents - reserved)
}

export function parseLikes(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [day, cents] of Object.entries(parsed)) {
      if (!DAY.test(day) || typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents < 0) continue
      out[day] = cents
    }
    return out
  } catch {
    return {}
  }
}

export function likeDeltas(
  stored: Record<string, number>,
  rows: { day: string; cents: number }[],
): { next: Record<string, number>; add: number } {
  const next = { ...stored }
  let add = 0
  for (const row of rows) {
    if (!DAY.test(row.day) || !Number.isSafeInteger(row.cents) || row.cents < 0) continue
    const prev = next[row.day] ?? 0
    if (row.cents <= prev) continue
    add += row.cents - prev
    next[row.day] = row.cents
  }
  return { next, add }
}

export function setOpening(
  meta: Record<string, string>,
  desk: string,
  balanceCents: number,
  reserved: number,
  likes: Record<string, number>,
): boolean {
  const ready = paddingReadyKey(desk)
  if (meta[ready] === '1') return false
  meta[paddingKey(desk)] = String(openingPadding(balanceCents, reserved))
  meta[ready] = '1'
  meta[likesKey(desk)] = JSON.stringify(parseLikes(JSON.stringify(likes)))
  return true
}

export function addLikes(meta: Record<string, string>, desk: string, rows: { day: string; cents: number }[]): number {
  if (meta[paddingReadyKey(desk)] !== '1') return 0
  const { next, add } = likeDeltas(parseLikes(meta[likesKey(desk)]), rows)
  meta[likesKey(desk)] = JSON.stringify(next)
  if (add < 1) return 0
  const key = paddingKey(desk)
  meta[key] = String(readCents(meta[key]) + add)
  return add
}

export function addPadding(meta: Record<string, string>, desk: string, cents: number): boolean {
  if (!Number.isSafeInteger(cents) || cents < 1) return false
  if (meta[paddingReadyKey(desk)] !== '1') return false
  const key = paddingKey(desk)
  meta[key] = String(readCents(meta[key]) + cents)
  return true
}

export function creditLiquidity(
  meta: Record<string, string>,
  spends: DeskSpend[],
  liquidityCents: number,
  investCents: number,
): void {
  for (const share of liquidityShares(spends, liquidityCents, investCents)) addPadding(meta, share.desk, share.cents)
}

export function takePadding(meta: Record<string, string>, reserves: { desk: string; cents: number }[]): boolean {
  const next = { ...meta }
  for (const row of reserves) {
    const have = readCents(next[paddingKey(row.desk)])
    if (!Number.isSafeInteger(row.cents) || row.cents < 1 || row.cents > have) return false
  }
  for (const row of reserves) {
    const key = paddingKey(row.desk)
    next[key] = String(readCents(next[key]) - row.cents)
  }
  Object.assign(meta, next)
  return true
}

export function creditOnce(
  meta: Record<string, string>,
  onceKey: string,
  changes: { desk: string; cents: number }[],
): void {
  if (meta[onceKey]) return
  for (const row of changes) {
    if (!Number.isSafeInteger(row.cents) || row.cents < 1) continue
    const key = paddingKey(row.desk)
    meta[key] = String(readCents(meta[key]) + row.cents)
  }
  meta[onceKey] = '1'
}

export function reservedFor(
  desk: string,
  input: {
    vaults: { desks: Record<string, number> }[]
    positions: { venue: string; symbol: string; screenName: string }[]
    payments: { status: string; desk: string; detail: string; amountCents: number; screenName: string }[]
  },
): number {
  const key = deskKey(desk)
  let cents = 0
  for (const vault of input.vaults) {
    const pile = vault.desks[key] ?? 0
    if (Number.isSafeInteger(pile) && pile > 0) cents += pile
  }
  const open = new Set(input.positions.map((position) => `${position.venue}:${position.symbol}:${position.screenName.toLowerCase()}`))
  for (const row of input.payments) {
    if (row.status !== 'filled' || deskKey(row.desk) !== key) continue
    if (!open.has(`${row.detail}:${row.screenName.toLowerCase()}`)) continue
    if (Number.isSafeInteger(row.amountCents) && row.amountCents > 0) cents += row.amountCents
  }
  return cents
}

export type CoverShare = { desk: string; cents: number; own: number }

export function coverClose(input: {
  cents: number
  payments: { desk: string; amountCents: number; updatedAt: number; id: string }[]
  padding: Record<string, number>
  balances: Record<string, number> | null
  sendable: Set<string>
}): { shares: CoverShare[]; reserves: { desk: string; cents: number }[]; credit: { desk: string; cents: number }[] } | 'short' | 'no_account' {
  if (input.sendable.size === 0) return 'no_account'
  const own = new Map<string, number>()
  const ranked = input.payments.filter((row) => deskKey(row.desk) && Number.isSafeInteger(row.amountCents) && row.amountCents > 0)
  ranked.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
  for (const row of ranked) {
    const desk = deskKey(row.desk)
    own.set(desk, (own.get(desk) ?? 0) + row.amountCents)
  }
  const order: string[] = []
  const push = (desk: string) => {
    if (desk && !order.includes(desk)) order.push(desk)
  }
  push(ranked[0] ? deskKey(ranked[0].desk) : '')
  for (const desk of [...input.sendable].sort()) push(desk)
  for (const desk of [...own.keys()].sort()) push(desk)
  let need = input.cents
  const shares: CoverShare[] = []
  for (const desk of order) {
    if (!input.sendable.has(desk) || need <= 0) continue
    const owned = own.get(desk) ?? 0
    const free = Math.max(0, input.padding[desk] ?? 0)
    let room = owned + free
    if (input.balances) room = Math.min(room, Math.max(0, input.balances[desk] ?? 0))
    const take = Math.min(need, room)
    if (take <= 0) continue
    shares.push({ desk, cents: take, own: owned })
    need -= take
  }
  if (need > 0) return 'short'
  const reserves = shares.flatMap((share) => {
    const cents = share.cents - Math.min(share.cents, share.own)
    return cents > 0 ? [{ desk: share.desk, cents }] : []
  })
  const credit = shares.flatMap((share) => {
    const kept = share.own - Math.min(share.cents, share.own)
    return kept > 0 ? [{ desk: share.desk, cents: kept }] : []
  })
  return { shares, reserves, credit }
}
