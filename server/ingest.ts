import type { Person } from './book.ts'
import { getQuotes, searchMarket, type Listing } from './market.ts'
import { ACTIVITY_LIMIT, fetchActivity, loadDesks, readWallet, sendRefund, type Desk, type IncomingPayment, type LikeDay } from './money.ts'
import { isDonationNote, isRefundNote, isVaultNote, resolveNote } from './resolve.ts'
import { store as openLedger, type PaymentRow, type Store } from './store.ts'

export type IngestSummary = { filled: number; refunded: number; pending: number; skipped: number; donated: number; vaulted: number }

type ActivityFn = (
  token: string,
  cursor: string | null,
) => Promise<{ payments: IncomingPayment[]; next: string | null; earnings?: LikeDay[] }>
type RefundFn = (token: string, to: string, amountCents: number, paymentId: string) => Promise<void>
type WalletFn = (token: string) => Promise<{ balanceCents: number } | null>

type Deps = {
  store: Store
  desks: Desk[]
  activity: ActivityFn
  resolve: (note: string) => Promise<Listing | null>
  quote: (id: string) => Promise<number | null>
  refund: RefundFn
  wallet?: WalletFn
  now: number
}

export async function runIngest(): Promise<IngestSummary> {
  const ledger = await openLedger()
  return ingest({
    store: ledger,
    desks: await loadDesks(),
    activity: fetchActivity,
    resolve: (note) => resolveNote(note, searchMarket, (symbol) => ledger.launchListing(symbol)),
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
    now: Date.now(),
  })
}

export async function ingest(deps: Deps): Promise<IngestSummary> {
  const summary: IngestSummary = { filled: 0, refunded: 0, pending: 0, skipped: 0, donated: 0, vaulted: 0 }
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
      await syncPadding(deps, desk, page.earnings, wallet)
      continue
    }
    for (const payment of page.payments) {
      if (payment.direction !== 'received' || payment.reversed) continue
      touched.add(payment.id)
      count(summary, await settle(deps, desk, rowFrom(payment, desk.screenName, 'processing', deps.now, ''), payment.sender))
    }
    await syncPadding(deps, desk, page.earnings, wallet)
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
  let listing = storedListing(draft.detail) ?? (await deps.resolve(draft.note))
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
  if (!listing || listing.venue === 'perpetual') {
    try {
      await deps.refund(desk.writeToken || desk.readToken, sender.screenName, draft.amountCents, draft.id)
      await deps.store.finishPayment({ ...draft, status: 'refunded', detail: 'refunded', updatedAt: deps.now })
      return 'refunded'
    } catch (error) {
      const reason = error instanceof Error && error.name === 'ReadOnlyToken' ? 'read_only' : 'refund_failed'
      await deps.store.finishPayment({ ...draft, status: 'pending_refund', detail: reason, updatedAt: deps.now })
      return 'pending'
    }
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
