import { createHash } from 'node:crypto'
import type { Person } from './book.ts'
import { readEnv, UA, XITTER_ORIGIN } from './env.ts'
import { REFUND_NOTE } from './resolve.ts'

export type Desk = {
  screenName: string
  readToken: string
  writeToken: string
}

export type IncomingPayment = {
  id: string
  amountCents: number
  note: string
  direction: 'received' | 'sent' | 'other'
  reversed: boolean
  sender: Person
}

type Spec = { token: string; write: string; fallback: string }

let deskCache: { at: number; desks: Desk[] } | null = null

export function deskSpecs(): Spec[] {
  return [
    { token: readEnv('XITTER_TOKEN'), write: readEnv('XITTER_WRITE_TOKEN'), fallback: 'nasdaq' },
    { token: readEnv('XITTER_NYSE_TOKEN'), write: readEnv('XITTER_NYSE_WRITE_TOKEN'), fallback: 'NYSE' },
  ].filter((spec) => spec.token)
}

export async function loadDesks(): Promise<Desk[]> {
  if (deskCache && Date.now() - deskCache.at < 60_000) return deskCache.desks
  const desks: Desk[] = []
  for (const spec of deskSpecs()) {
    let screenName = spec.fallback
    try {
      const who = await fetchMe(spec.token)
      if (who.screenName) screenName = who.screenName
    } catch {
      // keep the fallback name when the profile call fails
    }
    desks.push({ screenName, readToken: spec.token, writeToken: spec.write })
  }
  deskCache = { at: Date.now(), desks }
  return desks
}

export function clearDeskCache() {
  deskCache = null
}

const DEFAULT_ADMINS = ['nasdaq', 'nyse', 'ember', 'puppy']

export async function adminNames(): Promise<Set<string>> {
  const configured = readEnv('LARP_ADMINS')
  const names = (configured ? configured.split(',') : DEFAULT_ADMINS).map((name) => name.trim().toLowerCase()).filter(Boolean)
  return new Set(names.length ? names : DEFAULT_ADMINS)
}

export function idempotencyKey(paymentId: string): string {
  const raw = `refund-${paymentId.replace(/[^\w-]/g, '')}`
  if (/^[\w-]{8,64}$/.test(raw)) return raw
  return `refund-${createHash('sha256').update(paymentId).digest('hex').slice(0, 40)}`
}

export type LikeDay = { day: string; likes: number; cents: number }

export function parseActivity(body: unknown): { payments: IncomingPayment[]; next: string | null; earnings: LikeDay[] } {
  if (!body || typeof body !== 'object') return { payments: [], next: null, earnings: [] }
  const record = body as { data?: unknown; next_cursor?: unknown; earnings?: unknown }
  const rows = Array.isArray(record.data) ? record.data : []
  const next = typeof record.next_cursor === 'string' && record.next_cursor ? record.next_cursor : null
  return { payments: rows.flatMap(parsePayment), next, earnings: parseEarnings(record.earnings) }
}

function parseEarnings(value: unknown): LikeDay[] {
  if (!Array.isArray(value)) return []
  const out: LikeDay[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const day = typeof row.day === 'string' ? row.day : ''
    const cents = typeof row.cents === 'number' ? row.cents : Number(row.cents)
    const likes = typeof row.likes === 'number' ? row.likes : Number(row.likes)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(cents) || cents < 0) continue
    out.push({ day, likes: Number.isSafeInteger(likes) && likes >= 0 ? likes : 0, cents })
  }
  return out
}

export const ACTIVITY_LIMIT = 10

export async function fetchActivity(token: string, cursor: string | null): Promise<{ payments: IncomingPayment[]; next: string | null }> {
  const url = new URL('/api/v1/money/activity', XITTER_ORIGIN)
  url.searchParams.set('limit', String(ACTIVITY_LIMIT))
  if (cursor) url.searchParams.set('cursor', cursor)
  const res = await xitterFetch(token, url)
  if (!res.ok) throw new Error(`activity_${res.status}`)
  return parseActivity(await res.json())
}

export async function sendRefund(
  token: string,
  to: string,
  amountCents: number,
  paymentId: string,
  note = REFUND_NOTE,
): Promise<void> {
  if (!token) throw named('MissingWriteToken', 'missing_write_token')
  const res = await xitterFetch(token, new URL('/api/v1/money/send', XITTER_ORIGIN), {
    method: 'POST',
    body: JSON.stringify({
      to,
      amount_cents: amountCents,
      note,
      idempotency_key: idempotencyKey(paymentId),
    }),
  })
  if (res.status === 403) throw named('ReadOnlyToken', 'read_only')
  if (!res.ok && res.status !== 200) throw new Error(`refund_${res.status}`)
}

export async function transferLimit(token: string): Promise<number> {
  const wallet = await readWallet(token)
  return wallet.maxCents
}

export async function readWallet(token: string): Promise<{ balanceCents: number; maxCents: number }> {
  if (!token) throw named('MissingWriteToken', 'missing_write_token')
  const res = await xitterFetch(token, new URL('/api/v1/money', XITTER_ORIGIN))
  if (!res.ok) throw named('PayoutFailed', (await readXitterError(res)) || `wallet_${res.status}`)
  const body = (await res.json()) as { data?: { balance_cents?: unknown; max_transfer_cents?: unknown } }
  const balance = body.data?.balance_cents
  const max = body.data?.max_transfer_cents
  if (typeof balance !== 'number' || !Number.isSafeInteger(balance) || balance < 0) {
    throw named('PayoutFailed', 'Could not read the balance.')
  }
  if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1) throw named('PayoutFailed', 'Could not read the send limit.')
  return { balanceCents: balance, maxCents: max }
}

export async function sendPayout(token: string, to: string, amountCents: number, note: string, key: string): Promise<void> {
  if (!token) throw named('MissingWriteToken', 'missing_write_token')
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) throw named('BadAmount', 'bad_amount')
  const first = await postSend(token, to, amountCents, note, key)
  if (first.ok) return
  const message = await readXitterError(first)
  if (first.status === 403 && /only read/i.test(message)) throw named('ReadOnlyToken', message || 'read_only')
  if (first.status === 403 && /disclaimer/i.test(message)) {
    const accepted = await xitterFetch(token, new URL('/api/v1/money/disclaimer', XITTER_ORIGIN), {
      method: 'POST',
      body: '{}',
    })
    if (!accepted.ok) throw named('PayoutFailed', message || 'disclaimer')
    const second = await postSend(token, to, amountCents, note, key)
    if (second.ok) return
    const again = await readXitterError(second)
    if (second.status === 403 && /only read/i.test(again)) throw named('ReadOnlyToken', again || 'read_only')
    throw named('PayoutFailed', again || `send_${second.status}`)
  }
  throw named('PayoutFailed', message || `send_${first.status}`)
}

async function postSend(token: string, to: string, amountCents: number, note: string, key: string): Promise<Response> {
  return xitterFetch(token, new URL('/api/v1/money/send', XITTER_ORIGIN), {
    method: 'POST',
    body: JSON.stringify({ to, amount_cents: amountCents, note, idempotency_key: key }),
  })
}

async function readXitterError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string') {
      const text = body.error.trim()
      if (text.length > 0 && text.length <= 180 && !/xit_|bearer/i.test(text)) return text
    }
  } catch {
    // the body was not a JSON error
  }
  return ''
}

export async function fetchMe(token: string): Promise<Person> {
  const res = await xitterFetch(token, new URL('/api/v1/me', XITTER_ORIGIN))
  if (!res.ok) throw new Error(`me_${res.status}`)
  const person = personFrom((await res.json()) as unknown)
  if (!person) throw new Error('me_shape')
  return person
}

export async function findPerson(screenName: string): Promise<Person | null> {
  const token = readEnv('XITTER_TOKEN') || readEnv('XITTER_NYSE_TOKEN')
  if (!token) return null
  const handle = screenName.trim().replace(/^@/, '')
  if (!handle) return null
  const direct = await xitterFetch(token, new URL(`/api/v1/users/${encodeURIComponent(handle)}`, XITTER_ORIGIN))
  if (direct.ok) {
    const person = personFrom(await direct.json())
    if (person) return person
  }
  const url = new URL('/api/v1/search/users', XITTER_ORIGIN)
  url.searchParams.set('q', handle)
  url.searchParams.set('limit', '8')
  const searched = await xitterFetch(token, url)
  if (!searched.ok) return null
  const body = (await searched.json()) as { data?: unknown }
  const rows = Array.isArray(body.data) ? body.data : []
  for (const row of rows) {
    const person = personFrom(row)
    if (person && person.screenName.toLowerCase() === handle.toLowerCase()) return person
  }
  return null
}

export const MENTION_LIMIT = 10

export type MentionPost = { id: string; text: string; author: Person }

export function parseMentions(body: unknown): MentionPost[] {
  if (!body || typeof body !== 'object') return []
  const record = body as { data?: unknown }
  const rows = Array.isArray(record.data) ? record.data : []
  const out: MentionPost[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const id = text(item.id) || (typeof item.id === 'number' && Number.isSafeInteger(item.id) ? String(item.id) : '')
    const author = personFrom(item.author)
    if (!id || !author) continue
    const rawId = item.author && typeof item.author === 'object' ? (item.author as Record<string, unknown>).id : undefined
    if (typeof rawId === 'number' && Number.isSafeInteger(rawId)) author.id = String(rawId)
    out.push({ id, text: typeof item.text === 'string' ? item.text : '', author })
  }
  return out
}

export async function fetchMentions(token: string, desk: string): Promise<MentionPost[]> {
  const handle = desk.trim().replace(/^@/, '')
  if (!token || !handle) return []
  const url = new URL('/api/v1/search/posts', XITTER_ORIGIN)
  url.searchParams.set('q', `@${handle}`)
  url.searchParams.set('limit', String(MENTION_LIMIT))
  const res = await xitterFetch(token, url)
  if (!res.ok) throw new Error(`mentions_${res.status}`)
  return parseMentions(await res.json()).slice(0, MENTION_LIMIT)
}

export async function replyToPost(token: string, postId: string, text: string): Promise<void> {
  if (!token) throw named('ReadOnlyToken', 'missing_write_token')
  const res = await xitterFetch(token, new URL('/api/v1/posts', XITTER_ORIGIN), {
    method: 'POST',
    body: JSON.stringify({ text, reply_to: postId }),
  })
  if (res.status === 403) throw named('ReadOnlyToken', 'read_only')
  if (!res.ok) throw new Error(`reply_${res.status}`)
}

function parsePayment(row: unknown): IncomingPayment[] {
  if (!row || typeof row !== 'object') return []
  const record = row as Record<string, unknown>
  const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : ''
  const amount = record.amount_cents
  const amountCents = typeof amount === 'number' ? amount : Number(amount)
  if (!id || !Number.isSafeInteger(amountCents)) return []
  const direction = record.direction === 'received' || record.direction === 'sent' ? record.direction : 'other'
  const sender = personFrom(record.sender) ?? { id: '', screenName: '', name: '', avatarUrl: null }
  return [
    {
      id,
      amountCents,
      note: typeof record.note === 'string' ? record.note : '',
      direction,
      reversed: record.reversed === true,
      sender,
    },
  ]
}

function personFrom(value: unknown): Person | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const nested = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : record
  const screenName = text(nested.screen_name) || text(nested.screenName) || text(nested.username)
  if (!screenName) return null
  const avatar = text(nested.avatar_url) || text(nested.avatarUrl)
  return {
    id: text(nested.id) || screenName,
    screenName,
    name: text(nested.name) || screenName,
    avatarUrl: avatar ? (avatar.startsWith('http') ? avatar : `${XITTER_ORIGIN}${avatar}`) : null,
  }
}

async function xitterFetch(token: string, url: URL, init?: { method?: string; body?: string }): Promise<Response> {
  return fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': UA,
    },
    body: init?.body,
    signal: AbortSignal.timeout(12_000),
  })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function named(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}
