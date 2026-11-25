import { samePerson, type Person, type Position } from './book.ts'
import { parseCommand, retrySkippedAmount, WITHDRAW_NOTE, withdrawKey } from './commands.ts'
import { getQuotes, isRestrictedCoin, searchMarket, spotBase, type Listing } from './market.ts'
import { isMarketRestricted, isUserRestricted } from './moderation.ts'
import { DISCLAIMER_NOTE, isCompliant } from './compliance.ts'
import {
  ACTIVITY_LIMIT,
  fetchActivity,
  fetchMentions,
  loadDesks,
  readWallet,
  replyToPost,
  sendPayout,
  sendRefund,
  type Desk,
  type IncomingPayment,
  type LikeDay,
  type MentionPost,
} from './money.ts'
import { deskKey } from './padding.ts'
import {
  isDonationNote,
  isRefundNote,
  isRestricted,
  isVaultNote,
  REFUND_NOTE,
  RESTRICTED_NOTE,
  RESTRICTED_STOCK_NOTE,
  RESTRICTED_USER_NOTE,
  resolveNote,
  type RestrictedHit,
} from './resolve.ts'
import { store as openLedger, type PaymentRow, type Store } from './store.ts'
import type { Mention } from './tag.ts'

export type IngestSummary = {
  filled: number
  refunded: number
  pending: number
  skipped: number
  donated: number
  vaulted: number
  tagged: number
}

type ActivityFn = (
  token: string,
  cursor: string | null,
) => Promise<{ payments: IncomingPayment[]; next: string | null; earnings?: LikeDay[] }>
type RefundFn = (token: string, to: string, amountCents: number, paymentId: string, note?: string) => Promise<void>
type WalletFn = (token: string) => Promise<{ balanceCents: number; maxCents?: number } | null>
type MentionFn = (token: string, desk: string) => Promise<MentionPost[]>
type ReplyFn = (token: string, postId: string, text: string) => Promise<void>
type PayFn = (token: string, to: string, amountCents: number, note: string, key: string) => Promise<void>

type Deps = {
  store: Store
  desks: Desk[]
  activity: ActivityFn
  resolve: (note: string) => Promise<Listing | RestrictedHit | null>
  quote: (id: string) => Promise<number | null>
  refund: RefundFn
  wallet?: WalletFn
  mentions?: MentionFn
  reply?: ReplyFn
  pay?: PayFn
  now: number
}

export async function runIngest(): Promise<IngestSummary> {
  const ledger = await openLedger()
  return ingest({
    store: ledger,
    desks: await loadDesks(),
    activity: fetchActivity,
    resolve: (note) =>
      resolveNote(
        note,
        searchMarket,
        (symbol) => ledger.launchListing(symbol),
        isRestrictedCoin,
        async (venue, symbol) => isMarketRestricted(await ledger.moderation(), venue, symbol),
      ),
    quote: async (id) => {
      const [quote] = await getQuotes([id])
      return quote && quote.price > 0 ? quote.price : null
    },
    refund: sendRefund,
    wallet: async (token) => {
      try {
        return await readWallet(token)
      } catch (error) {
        console.error('wallet', error instanceof Error ? error.message : 'failed')
        return null
      }
    },
    mentions: fetchMentions,
    reply: replyToPost,
    pay: sendPayout,
    now: Date.now(),
  })
}

export async function ingest(deps: Deps): Promise<IngestSummary> {
  const summary: IngestSummary = { filled: 0, refunded: 0, pending: 0, skipped: 0, donated: 0, vaulted: 0, tagged: 0 }
  const touched = new Set<string>()
  for (const desk of deps.desks) {
    const boot = `bootstrapped:${desk.screenName.toLowerCase()}`
    const ready = Boolean(await deps.store.meta(boot))
    const page = await collect(desk.readToken, deps.activity, ready ? deps.store : null)
    const wallet = (await deps.store.paddingReady(desk.screenName)) || !deps.wallet ? null : await deps.wallet(desk.readToken)
    if (!ready) {
      for (const payment of page.payments) {
        if (payment.direction !== 'received' || payment.reversed) continue
        const inserted = await deps.store.insertPayment(rowFrom(payment, desk.screenName, 'skipped', deps.now, 'history'))
        if (inserted) summary.skipped += 1
      }
      await deps.store.setMeta(boot, String(deps.now))
    } else {
      for (const payment of page.payments) {
        if (payment.direction !== 'received' || payment.reversed) continue
        touched.add(payment.id)
        count(summary, await settle(deps, desk, rowFrom(payment, desk.screenName, 'processing', deps.now, ''), payment.sender))
      }
    }
    await syncPadding(deps, desk, page.earnings, wallet)
    if (deps.mentions && deps.reply) summary.tagged += await settleMentions(deps, desk)
  }
  for (const pending of await deps.store.pendingPayments(deps.now)) {
    if (touched.has(pending.id)) continue
    const desk = deps.desks.find((item) => item.screenName.toLowerCase() === pending.desk.toLowerCase())
    if (!desk) continue
    const sender: Person = {
      id: pending.senderId || pending.senderScreen,
      screenName: pending.senderScreen,
      name: pending.senderName || pending.senderScreen,
      avatarUrl: pending.avatarUrl,
    }
    count(summary, await settle(deps, desk, { ...pending, status: 'processing', updatedAt: deps.now }, sender))
  }
  return summary
}

async function settle(deps: Deps, desk: Desk, draft: PaymentRow, sender: Person): Promise<keyof IngestSummary> {
  if (draft.amountCents < 1 || !sender.screenName) return 'skipped'
  if (sender.screenName.toLowerCase() === desk.screenName.toLowerCase()) return 'skipped'
  if (isRefundNote(draft.note)) return 'skipped'
  if ((await deps.store.takePayment(draft)) !== 'owned') return 'skipped'
  if (isDonationNote(draft.note)) {
    await deps.store.donatePayment({ ...draft, status: 'donated', detail: 'donation', updatedAt: deps.now })
    return 'donated'
  }
  if (isVaultNote(draft.note)) {
    await deps.store.creditVault({ ...draft, status: 'vaulted', detail: 'vault', updatedAt: deps.now }, sender)
    return 'vaulted'
  }
  const [mod, compliance] = await Promise.all([deps.store.moderation(), deps.store.compliance()])
  if (isUserRestricted(mod, sender.screenName)) {
    return refundPayment(deps, desk, draft, sender, RESTRICTED_USER_NOTE)
  }
  if (!isCompliant(compliance, sender.screenName)) {
    return refundPayment(deps, desk, draft, sender, DISCLAIMER_NOTE)
  }
  let listing = storedListing(draft.detail)
  let restricted = false
  let restrictedStock = false
  if (!listing || listing.venue === 'crypto' || listing.venue === 'stock') {
    try {
      const found = await deps.resolve(draft.note)
      if (isRestricted(found)) {
        restricted = true
        restrictedStock = !!found.stock
        listing = null
      } else if (!listing && found) listing = found
    } catch (error) {
      if (!listing) throw error
    }
  }
  if (listing && isMarketRestricted(mod, listing.venue, listing.symbol)) {
    restricted = true
    restrictedStock = listing.venue !== 'crypto'
    listing = null
  }
  if (listing?.venue === 'launch') {
    try {
      const bought = await deps.store.buyLaunch(draft, sender, listing.symbol, deps.now)
      if (bought === 'filled') return 'filled'
    } catch {
      await deps.store.finishPayment({ ...draft, status: 'pending_fill', detail: listing.id, updatedAt: deps.now })
      return 'pending'
    }
    listing = null
  }
  if (restricted || !listing || listing.venue === 'perpetual') {
    const note = restrictedStock ? RESTRICTED_STOCK_NOTE : restricted ? RESTRICTED_NOTE : REFUND_NOTE
    return refundPayment(deps, desk, draft, sender, note)
  }
  const price = await deps.quote(listing.id)
  if (!(price && price > 0)) {
    await deps.store.finishPayment({ ...draft, status: 'pending_fill', detail: listing.id, updatedAt: deps.now })
    return 'pending'
  }
  try {
    await deps.store.fillPayment(draft, {
      venue: listing.venue,
      symbol: listing.symbol,
      name: listing.name,
      label: listing.label,
      person: sender,
      amount: draft.amountCents / 100,
      price,
      now: deps.now,
    })
  } catch {
    await deps.store.finishPayment({ ...draft, status: 'pending_fill', detail: listing.id, updatedAt: deps.now })
    return 'pending'
  }
  return 'filled'
}

async function refundPayment(
  deps: Deps,
  desk: Desk,
  draft: PaymentRow,
  sender: Person,
  note: string,
): Promise<keyof IngestSummary> {
  try {
    await deps.refund(desk.writeToken || desk.readToken, sender.screenName, draft.amountCents, draft.id, note)
    await deps.store.finishPayment({
      ...draft,
      status: 'refunded',
      detail: note === REFUND_NOTE ? 'refunded' : note === DISCLAIMER_NOTE ? 'disclaimer' : 'restricted',
      updatedAt: deps.now,
    })
    return 'refunded'
  } catch (error) {
    const reason = error instanceof Error && error.name === 'ReadOnlyToken' ? 'read_only' : 'refund_failed'
    await deps.store.finishPayment({ ...draft, status: 'pending_refund', detail: reason, updatedAt: deps.now })
    return 'pending'
  }
}

function heldCrypto(positions: Position[], screenName: string, query: string): Position | null {
  const wanted = spotBase(query)
  const name = query.trim().toLowerCase()
  const hits = positions.filter((position) => {
    if (position.venue !== 'crypto' || !samePerson(position.person.screenName, screenName)) return false
    return spotBase(position.symbol) === wanted || position.label.toLowerCase() === name || position.name.toLowerCase() === name
  })
  return hits.find((position) => position.symbol.toUpperCase().endsWith('USDT')) ?? hits[0] ?? null
}

function heldStock(positions: Position[], screenName: string, query: string): Position | null {
  const wanted = query.trim().replace(/^[$#]/, '').replace(/^stock:/i, '').toUpperCase()
  const name = query.trim().toLowerCase().replace(/^[$#]/, '')
  return (
    positions.find((position) => {
      if (position.venue !== 'stock' || !samePerson(position.person.screenName, screenName)) return false
      return position.symbol.toUpperCase() === wanted || position.label.toUpperCase() === wanted || position.name.toLowerCase() === name
    }) ?? null
  )
}

function heldLaunch(positions: Position[], screenName: string, query: string): Position | null {
  const trimmed = query.trim()
  const prefixed = trimmed.match(/^xit(?:\s*[:=]\s*|\s+)?([A-Za-z]{2,8})$/i)
  const wanted = (prefixed?.[1] ?? trimmed.replace(/^launch:/i, '')).toUpperCase()
  const name = trimmed.toLowerCase()
  return (
    positions.find((position) => {
      if (position.venue !== 'launch' || !samePerson(position.person.screenName, screenName)) return false
      return position.symbol.toUpperCase() === wanted || position.label.toUpperCase() === `XIT${wanted}` || position.name.toLowerCase() === name
    }) ?? null
  )
}

function storedListing(detail: string): Listing | null {
  const split = detail.indexOf(':')
  if (split <= 0) return null
  const venue = detail.slice(0, split)
  const symbol = detail.slice(split + 1)
  if (venue === 'launch') {
    if (!/^[A-Z]{2,8}$/.test(symbol)) return null
    return { id: detail, venue, symbol, name: symbol, label: `xit${symbol}` }
  }
  if ((venue !== 'stock' && venue !== 'crypto' && venue !== 'perpetual') || !symbol) return null
  const label = venue === 'perpetual' ? `${symbol}-PERP` : symbol
  return { id: detail, venue, symbol, name: symbol, label }
}

function rowFrom(payment: IncomingPayment, desk: string, status: PaymentRow['status'], now: number, detail: string): PaymentRow {
  return {
    id: payment.id,
    status,
    amountCents: payment.amountCents,
    note: payment.note,
    desk,
    senderId: payment.sender.id,
    senderName: payment.sender.name,
    senderScreen: payment.sender.screenName,
    avatarUrl: payment.sender.avatarUrl,
    detail,
    updatedAt: now,
  }
}

async function collect(
  token: string,
  activity: ActivityFn,
  known: Store | null,
): Promise<{ payments: IncomingPayment[]; earnings: LikeDay[] }> {
  const next = await activity(token, null)
  const page = next.payments.slice(0, ACTIVITY_LIMIT)
  const earnings = next.earnings ?? []
  if (!known) return { payments: page, earnings }
  const out: IncomingPayment[] = []
  for (const payment of page) {
    if (await known.payment(payment.id)) continue
    out.push(payment)
  }
  return { payments: out, earnings }
}

async function syncPadding(deps: Deps, desk: Desk, earnings: LikeDay[], wallet: { balanceCents: number } | null) {
  if (!(await deps.store.paddingReady(desk.screenName)) && wallet) {
    const likes: Record<string, number> = {}
    for (const row of earnings) likes[row.day] = row.cents
    await deps.store.openPadding(desk.screenName, wallet.balanceCents, await deps.store.reservedCents(desk.screenName), likes)
  }
  if (await deps.store.paddingReady(desk.screenName)) await deps.store.applyLikes(desk.screenName, earnings)
}

function count(summary: IngestSummary, key: keyof IngestSummary) {
  summary[key] += 1
}

async function settleMentions(deps: Deps, desk: Desk): Promise<number> {
  const mentions = deps.mentions
  const reply = deps.reply
  if (!mentions || !reply) return 0
  let posts: MentionPost[] = []
  try {
    posts = (await mentions(desk.readToken, desk.screenName)).slice(0, 10)
  } catch (error) {
    console.error('mentions', error instanceof Error ? error.message : 'failed')
    return 0
  }
  const readyKey = `mentions-ready:${deskKey(desk.screenName)}`
  if (!(await deps.store.meta(readyKey))) {
    if (posts.length) await deps.store.seedMentions(posts.map((post) => skippedMention(post, desk.screenName, deps.now)))
    await deps.store.setMeta(readyKey, String(deps.now))
    return 0
  }
  let tagged = 0
  const seen = new Set<string>()
  let wallet: { balanceCents: number; maxCents?: number } | null | undefined
  const deskWallet = async () => {
    if (wallet !== undefined) return wallet
    if (!deps.wallet) {
      wallet = null
      return wallet
    }
    try {
      wallet = await deps.wallet(desk.readToken)
    } catch (error) {
      console.error('wallet', error instanceof Error ? error.message : 'failed')
      wallet = null
    }
    return wallet
  }
  for (const post of posts) {
    seen.add(post.id)
    try {
      tagged += await settlePost(deps, desk, post, reply, deskWallet)
    } catch (error) {
      console.error('mentions', error instanceof Error ? error.message : 'failed')
    }
  }
  for (const pending of await deps.store.openMentions()) {
    if (deskKey(pending.desk) !== deskKey(desk.screenName) || seen.has(pending.id)) continue
    try {
      tagged += await deliverMention(deps, desk, pending, reply, deskWallet)
    } catch (error) {
      console.error('mentions', error instanceof Error ? error.message : 'failed')
    }
  }
  return tagged
}

async function settlePost(
  deps: Deps,
  desk: Desk,
  post: MentionPost,
  reply: ReplyFn,
  deskWallet: () => Promise<{ balanceCents: number; maxCents?: number } | null>,
): Promise<number> {
  const existing = await deps.store.mention(post.id)
  if (existing?.status === 'done' || (existing?.status === 'skipped' && !retrySkippedAmount(post.text, desk.screenName))) return 0
  if (existing?.status === 'reply' || existing?.status === 'sending') return deliverMention(deps, desk, existing, reply, deskWallet)
  const screenName = post.author.screenName.trim().replace(/^@/, '')
  if (!screenName || samePerson(screenName, desk.screenName)) {
    await deps.store.seedMentions([skippedMention(post, desk.screenName, deps.now)])
    return 0
  }
  const command = parseCommand(post.text, desk.screenName)
  if (!command) {
    await deps.store.seedMentions([skippedMention(post, desk.screenName, deps.now)])
    return 0
  }
  let listing: Listing | null = null
  let price: number | null = null
  let restricted = false
  let restrictedStock = false
  if (command.kind !== 'withdraw') {
    let found: Listing | RestrictedHit | null = null
    try {
      found = await deps.resolve(command.query)
    } catch (error) {
      console.error('mentions', error instanceof Error ? error.message : 'failed')
      return 0
    }
    if (isRestricted(found)) {
      restrictedStock = !!found.stock
      if (command.kind === 'sell') {
        const positions = await deps.store.positions()
        const held = found.stock
          ? (heldStock(positions, screenName, command.query) ?? heldLaunch(positions, screenName, command.query))
          : heldCrypto(positions, screenName, command.query)
        if (held) listing = { id: `${held.venue}:${held.symbol}`, venue: held.venue, symbol: held.symbol, name: held.name, label: held.label }
        else restricted = true
      } else restricted = true
    } else if (found && found.venue !== 'perpetual') listing = found
    if (listing?.venue === 'launch') {
      const quote = await deps.store.launchQuote(listing.symbol)
      if (!quote) listing = null
      else price = quote.price
    } else if (listing) {
      try {
        price = await deps.quote(listing.id)
      } catch (error) {
        console.error('mentions', error instanceof Error ? error.message : 'failed')
        return 0
      }
      if (!(price && price > 0)) return 0
    }
  }
  let sendRoom: number | null = null
  if (command.kind === 'withdraw') {
    if (!desk.writeToken) sendRoom = -1
    else {
      const wallet = await deskWallet()
      if (!wallet) return 0
      const have = await deps.store.vaultDesk(screenName, desk.screenName)
      const reserved = await deps.store.reservedCents(desk.screenName)
      sendRoom = Math.max(0, wallet.balanceCents - reserved + have)
    }
  }
  const result = await deps.store.applyTag({
    post: { id: post.id, text: post.text, author: { ...post.author, screenName } },
    desk: desk.screenName,
    command,
    listing: listing ? { venue: listing.venue, symbol: listing.symbol, name: listing.name, label: listing.label } : null,
    price,
    sendRoom,
    restricted,
    restrictedStock,
    now: deps.now,
  })
  if (result.action === 'reply') {
    await sendReply(deps, desk, post.id, result.text, reply)
    return 1
  }
  if (result.action !== 'send') return 0
  const outcome = await sendWithdraw(deps, desk, post.id, result.cents, screenName, deskWallet)
  if (outcome.kind === 'pending') return 1
  await sendReply(deps, desk, post.id, outcome.kind === 'aborted' ? outcome.text : result.text, reply)
  return 1
}

async function deliverMention(
  deps: Deps,
  desk: Desk,
  mention: Mention,
  reply: ReplyFn,
  deskWallet: () => Promise<{ balanceCents: number; maxCents?: number } | null>,
): Promise<number> {
  if (mention.status === 'sending') {
    const screenName = mention.person?.screenName ?? ''
    if (!screenName) return 0
    const outcome = await sendWithdraw(deps, desk, mention.id, mention.cents, screenName, deskWallet)
    if (outcome.kind === 'pending') return 1
    await sendReply(deps, desk, mention.id, outcome.kind === 'aborted' ? outcome.text : mention.reply, reply)
    return 1
  }
  await sendReply(deps, desk, mention.id, mention.reply, reply)
  return 1
}

async function sendWithdraw(
  deps: Deps,
  desk: Desk,
  postId: string,
  cents: number,
  screenName: string,
  deskWallet: () => Promise<{ balanceCents: number; maxCents?: number } | null>,
): Promise<{ kind: 'sent' } | { kind: 'aborted'; text: string } | { kind: 'pending' }> {
  const pay = deps.pay
  if (!pay || cents < 1) return { kind: 'pending' }
  const wallet = await deskWallet()
  const max = wallet?.maxCents && wallet.maxCents > 0 ? wallet.maxCents : 100_000
  let sent = 0
  try {
    for (const [index, part] of chunkCents(cents, max).entries()) {
      await pay(desk.writeToken, screenName, part, WITHDRAW_NOTE, withdrawKey(postId, index))
      sent += 1
    }
    await deps.store.ackSend(postId)
    return { kind: 'sent' }
  } catch (error) {
    console.error('mentions', error instanceof Error ? error.message : 'failed')
    if (sent === 0 && error instanceof Error && (error.name === 'ReadOnlyToken' || error.name === 'MissingWriteToken')) {
      return { kind: 'aborted', text: await deps.store.abortWithdraw(postId) }
    }
    return { kind: 'pending' }
  }
}

async function sendReply(deps: Deps, desk: Desk, postId: string, text: string, reply: ReplyFn) {
  try {
    await reply(desk.writeToken, postId, text)
    await deps.store.completeMention(postId)
  } catch (error) {
    console.error('mentions', error instanceof Error ? error.message : 'failed')
  }
}

function skippedMention(post: MentionPost, desk: string, now: number): Mention {
  const screenName = post.author.screenName.trim().replace(/^@/, '')
  return {
    id: post.id,
    desk: deskKey(desk),
    status: 'skipped',
    reply: '',
    cents: 0,
    person: screenName ? { ...post.author, screenName } : null,
    updatedAt: now,
  }
}

function chunkCents(cents: number, max: number): number[] {
  const size = max > 0 ? max : 100_000
  const out: number[] = []
  let left = cents
  while (left > 0) {
    const part = Math.min(left, size)
    out.push(part)
    left -= part
  }
  return out
}
