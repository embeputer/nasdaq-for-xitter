import { fileBuy, fileClose, samePerson, type Fill, type Person, type Position } from './book.ts'
import { REPLIES, retrySkippedAmount, type Command } from './commands.ts'
import { planBuy, planSell, planSpend, type Launch } from './launch.ts'
import type { Venue } from './market.ts'
import { coverClose, creditOnce, deskKey, takePadding } from './padding.ts'

export type Mention = {
  id: string
  desk: string
  status: 'skipped' | 'reply' | 'sending' | 'done'
  reply: string
  cents: number
  person: Person | null
  updatedAt: number
}

export type Score = { person: Person; cents: number }

export type Pay = {
  id: string
  status: string
  amountCents: number
  note: string
  desk: string
  senderId: string
  senderName: string
  senderScreen: string
  avatarUrl: string | null
  detail: string
  updatedAt: number
}

export type TradeDoc = {
  positions: Position[]
  fills: Fill[]
  payments: Record<string, Pay>
  vaults: Record<string, { person: Person; cents: number; desks: Record<string, number> }>
  launches: Record<string, Launch>
  mentions: Record<string, Mention>
  scores: Record<string, Score>
  meta: Record<string, string>
}

export type TagPost = { id: string; text: string; author: Person }

export type TagInput = {
  post: TagPost
  desk: string
  command: Command | null
  listing: { venue: Venue; symbol: string; name: string; label: string } | null
  price: number | null
  sendRoom: number | null
  now: number
}

export type TagResult = { action: 'idle' | 'wait' } | { action: 'reply'; text: string } | { action: 'send'; cents: number; text: string }

const SCORES_READY = 'scores-ready'

export function decideTag(doc: TradeDoc, input: TagInput): TagResult {
  const current = doc.mentions[input.post.id]
  if (current?.status === 'done' || (current?.status === 'skipped' && !retrySkippedAmount(input.post.text, input.desk))) {
    return { action: 'idle' }
  }
  if (current?.status === 'reply') return { action: 'reply', text: current.reply }
  if (current?.status === 'sending') return { action: 'send', cents: current.cents, text: current.reply }
  if (!input.command) {
    remember(doc, input, 'skipped', '', 0)
    return { action: 'idle' }
  }
  if (input.command.kind === 'withdraw') return withdraw(doc, input, input.command.cents)
  if (!input.listing || input.listing.venue === 'perpetual') return reply(doc, input, REPLIES.unresolved, 0)
  if (input.command.kind === 'sell') return sell(doc, input, input.listing)
  return buy(doc, input, input.listing, input.command.cents)
}

export function undoWithdraw(doc: TradeDoc, id: string, now: number): string {
  const mention = doc.mentions[id]
  if (!mention || mention.status !== 'sending' || !mention.person) return mention?.reply || REPLIES.short
  addVault(doc, mention.person, mention.desk, mention.cents)
  doc.mentions[id] = { ...mention, status: 'reply', reply: REPLIES.short, updatedAt: now }
  return REPLIES.short
}

export function ensureScores(doc: TradeDoc): void {
  if (doc.meta[SCORES_READY] === '1') return
  doc.scores = {}
  for (const fill of doc.fills) addScore(doc, fill)
  doc.meta[SCORES_READY] = '1'
}

export function addScore(doc: TradeDoc, fill: Fill): void {
  if (fill.side !== 'sell') return
  const cents = Math.round(fill.realized * 100)
  if (!Number.isSafeInteger(cents) || cents === 0) return
  const key = scoreKey(fill.person)
  const existing = doc.scores[key]
  doc.scores[key] = { person: existing?.person ?? fill.person, cents: (existing?.cents ?? 0) + cents }
}

function buy(doc: TradeDoc, input: TagInput, listing: NonNullable<TagInput['listing']>, cents: number): TagResult {
  const payId = `tag:${input.post.id}`
  if (doc.payments[payId]?.status === 'filled') return reply(doc, input, REPLIES.opened, cents)
  if (listing.venue === 'launch') {
    const launch = doc.launches[listing.symbol]
    const planned = launch ? planBuy(launch, cents, input.now) : null
    if (!launch || !planned) return reply(doc, input, REPLIES.unresolved, 0)
    if (!takeVault(doc, input.post.author, input.desk, cents)) return reply(doc, input, REPLIES.poor, 0)
    const bought = fileBuy(doc.positions, {
      venue: 'launch',
      symbol: listing.symbol,
      name: launch.name,
      label: launch.label,
      person: cleanPerson(input.post.author),
      amount: cents / 100,
      price: planned.fillPrice,
      now: input.now,
    })
    doc.launches[listing.symbol] = planned.launch
    doc.positions = bought.positions
    keepFill(doc, bought.fill)
    savePay(doc, input, payId, cents, `launch:${listing.symbol}`)
    return reply(doc, input, REPLIES.opened, cents)
  }
  if (!(input.price && input.price > 0)) return { action: 'wait' }
  if (!takeVault(doc, input.post.author, input.desk, cents)) return reply(doc, input, REPLIES.poor, 0)
  const bought = fileBuy(doc.positions, {
    venue: listing.venue,
    symbol: listing.symbol,
    name: listing.name,
    label: listing.label,
    person: cleanPerson(input.post.author),
    amount: cents / 100,
    price: input.price,
    now: input.now,
  })
  doc.positions = bought.positions
  keepFill(doc, bought.fill)
  savePay(doc, input, payId, cents, `${listing.venue}:${listing.symbol}`)
  return reply(doc, input, REPLIES.opened, cents)
}

function sell(doc: TradeDoc, input: TagInput, listing: NonNullable<TagInput['listing']>): TagResult {
  if (!(input.price && input.price > 0)) return { action: 'wait' }
  const position = doc.positions.find(
    (item) => item.venue === listing.venue && item.symbol === listing.symbol && samePerson(item.person.screenName, input.post.author.screenName),
  )
  if (!position) return reply(doc, input, REPLIES.missing, 0)
  const cents = Math.round(position.qty * input.price * 100)
  if (!Number.isSafeInteger(cents) || cents < 1) return reply(doc, input, REPLIES.short, 0)
  const paid = principalPayments(doc, position)
  const padding = paddingOf(doc)
  const sendable = new Set<string>([deskKey(input.desk), ...paid.map((row) => deskKey(row.desk)), ...Object.keys(padding)])
  const plan = coverClose({
    cents,
    payments: paid.map((row) => ({ desk: row.desk, amountCents: row.amountCents, updatedAt: row.updatedAt, id: row.id })),
    padding,
    balances: null,
    sendable,
  })
  if (plan === 'short' || plan === 'no_account') return reply(doc, input, REPLIES.short, 0)
  if (!takePadding(doc.meta, plan.reserves)) return reply(doc, input, REPLIES.short, 0)
  creditOnce(doc.meta, `pad:tag:${input.post.id}`, plan.credit)
  addVault(doc, input.post.author, input.desk, cents)
  const closed = fileClose(doc.positions, position.id, input.price, input.now)
  doc.positions = closed.positions
  ensureScores(doc)
  keepFill(doc, closed.fill)
  addScore(doc, closed.fill)
  if (position.venue === 'launch') {
    const launch = doc.launches[position.symbol]
    if (launch) doc.launches[position.symbol] = planSell(launch, position.qty, cents, input.now)
  }
  return reply(doc, input, REPLIES.closed, cents)
}

function withdraw(doc: TradeDoc, input: TagInput, cents: number): TagResult {
  const have = vaultHave(doc, input.post.author, input.desk)
  if (have < cents) return reply(doc, input, REPLIES.poor, 0)
  if (input.sendRoom === null || input.sendRoom < cents) return reply(doc, input, REPLIES.short, 0)
  if (!takeVault(doc, input.post.author, input.desk, cents)) return reply(doc, input, REPLIES.poor, 0)
  doc.mentions[input.post.id] = mention(input, 'sending', REPLIES.withdrawn, cents)
  return { action: 'send', cents, text: REPLIES.withdrawn }
}

function reply(doc: TradeDoc, input: TagInput, text: string, cents: number): TagResult {
  doc.mentions[input.post.id] = mention(input, 'reply', text, cents)
  return { action: 'reply', text }
}

function remember(doc: TradeDoc, input: TagInput, status: Mention['status'], text: string, cents: number) {
  if (doc.mentions[input.post.id]) return
  doc.mentions[input.post.id] = mention(input, status, text, cents)
}

function mention(input: TagInput, status: Mention['status'], text: string, cents: number): Mention {
  return {
    id: input.post.id,
    desk: deskKey(input.desk),
    status,
    reply: text,
    cents,
    person: input.post.author.screenName ? cleanPerson(input.post.author) : null,
    updatedAt: input.now,
  }
}

function savePay(doc: TradeDoc, input: TagInput, id: string, cents: number, detail: string) {
  const person = cleanPerson(input.post.author)
  doc.payments[id] = {
    id,
    status: 'filled',
    amountCents: cents,
    note: input.post.text.slice(0, 140),
    desk: deskKey(input.desk),
    senderId: person.id,
    senderName: person.name,
    senderScreen: person.screenName,
    avatarUrl: person.avatarUrl,
    detail,
    updatedAt: input.now,
  }
}

function keepFill(doc: TradeDoc, fill: Fill) {
  doc.fills = [fill, ...doc.fills.filter((item) => item.id !== fill.id)].slice(0, 400)
}

function principalPayments(doc: TradeDoc, position: Position): Pay[] {
  const detail = `${position.venue}:${position.symbol}`
  return Object.values(doc.payments).filter(
    (row) => row.status === 'filled' && row.detail === detail && samePerson(row.senderScreen, position.person.screenName),
  )
}

function paddingOf(doc: TradeDoc): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(doc.meta)) {
    if (!key.startsWith('padding:') || key.startsWith('padding-ready:')) continue
    const cents = Number(value)
    if (Number.isSafeInteger(cents) && cents >= 0) out[key.slice('padding:'.length)] = cents
  }
  return out
}

export function deskVault(doc: TradeDoc, screenName: string, desk: string): number {
  return vaultHave(doc, { id: '', screenName, name: screenName, avatarUrl: null }, desk)
}

function vaultHave(doc: TradeDoc, person: Person, desk: string): number {
  const name = person.screenName.trim().replace(/^@/, '').toLowerCase()
  const key = deskKey(desk)
  return Object.values(doc.vaults).reduce(
    (sum, vault) => (vault.person.screenName.toLowerCase() === name ? sum + (vault.desks[key] ?? 0) : sum),
    0,
  )
}

function takeVault(doc: TradeDoc, person: Person, desk: string, cents: number): boolean {
  const name = person.screenName.trim().replace(/^@/, '').toLowerCase()
  const key = deskKey(desk)
  const records = Object.entries(doc.vaults)
    .filter(([, vault]) => vault.person.screenName.toLowerCase() === name && (vault.desks[key] ?? 0) > 0)
    .map(([id, vault]) => ({ key: id, desks: { [key]: vault.desks[key] ?? 0 } }))
  const spent = planSpend(records, cents)
  if (!spent) return false
  for (const row of spent.next) {
    const existing = doc.vaults[row.key]
    if (!existing) continue
    const desks = { ...existing.desks }
    if ((row.desks[key] ?? 0) > 0) desks[key] = row.desks[key] ?? 0
    else delete desks[key]
    doc.vaults[row.key] = { ...existing, person: cleanPerson(person), cents: sumDesks(desks), desks }
  }
  return true
}

function addVault(doc: TradeDoc, person: Person, desk: string, cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 1) return
  const clean = cleanPerson(person)
  const key = vaultKey(doc, clean)
  const existing = doc.vaults[key] ?? { person: clean, cents: 0, desks: {} }
  const deskName = deskKey(desk)
  const desks = { ...existing.desks, [deskName]: (existing.desks[deskName] ?? 0) + cents }
  doc.vaults[key] = { person: clean, cents: sumDesks(desks), desks }
}

function vaultKey(doc: TradeDoc, person: Person): string {
  const name = person.screenName.toLowerCase()
  const found = Object.entries(doc.vaults).find(([, vault]) => vault.person.screenName.toLowerCase() === name)
  return found?.[0] ?? (person.id || name)
}

function sumDesks(desks: Record<string, number>): number {
  return Object.values(desks).reduce((sum, value) => sum + value, 0)
}

function cleanPerson(person: Person): Person {
  const screenName = person.screenName.trim().replace(/^@/, '')
  return { ...person, screenName }
}

function scoreKey(person: Person): string {
  return person.id || person.screenName.trim().replace(/^@/, '').toLowerCase()
}
