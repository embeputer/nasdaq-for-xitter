import type { Person } from './book.ts'
import { getQuotes, type Listing } from './market.ts'
import { fetchActivity, loadDesks, sendRefund, type Desk, type IncomingPayment } from './money.ts'
import { REFUND_NOTE, resolveNote } from './resolve.ts'
import { store as openLedger, type PaymentRow, type Store } from './store.ts'

export type IngestSummary = { filled: number; refunded: number; pending: number; skipped: number }

type ActivityFn = (token: string, cursor: string | null) => Promise<{ payments: IncomingPayment[]; next: string | null }>
type RefundFn = (token: string, to: string, amountCents: number, paymentId: string) => Promise<void>

type Deps = {
  store: Store
  desks: Desk[]
  activity: ActivityFn
  resolve: (note: string) => Promise<Listing | null>
  quote: (id: string) => Promise<number | null>
  refund: RefundFn
  now: number
}

export async function runIngest(): Promise<IngestSummary> {
  return ingest({
    store: await openLedger(),
    desks: await loadDesks(),
    activity: fetchActivity,
    resolve: resolveNote,
    quote: async (id) => {
      const [quote] = await getQuotes([id])
      return quote && quote.price > 0 ? quote.price : null
    },
    refund: sendRefund,
    now: Date.now(),
  })
}

export async function ingest(deps: Deps): Promise<IngestSummary> {
  const summary: IngestSummary = { filled: 0, refunded: 0, pending: 0, skipped: 0 }
  const touched = new Set<string>()
  for (const desk of deps.desks) {
    const boot = `bootstrapped:${desk.screenName.toLowerCase()}`
    const ready = Boolean(await deps.store.meta(boot))
    const pages = await collect(desk.readToken, deps.activity, ready ? deps.store : null)
    if (!ready) {
      for (const payment of pages) {
        if (payment.direction !== 'received' || payment.reversed) continue
        const inserted = await deps.store.insertPayment(rowFrom(payment, desk.screenName, 'skipped', deps.now, 'history'))
        if (inserted) summary.skipped += 1
      }
      await deps.store.setMeta(boot, String(deps.now))
      continue
    }
    for (const payment of pages) {
      if (payment.direction !== 'received' || payment.reversed) continue
      touched.add(payment.id)
      count(summary, await settle(deps, desk, rowFrom(payment, desk.screenName, 'processing', deps.now, ''), payment.sender))
    }
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
  if (draft.note.trim() === REFUND_NOTE) return 'skipped'
  if ((await deps.store.takePayment(draft)) !== 'owned') return 'skipped'
  const listing = storedListing(draft.detail) ?? (await deps.resolve(draft.note))
  if (!listing) {
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

async function collect(token: string, activity: ActivityFn, known: Store | null): Promise<IncomingPayment[]> {
  const out: IncomingPayment[] = []
  let cursor: string | null = null
  for (let page = 0; page < 20; page += 1) {
    const next = await activity(token, cursor)
    let seen = false
    for (const payment of next.payments) {
      if (known && (await known.payment(payment.id))) seen = true
      else out.push(payment)
    }
    if (!next.next || (known && seen)) break
    cursor = next.next
  }
  return out
}

function count(summary: IngestSummary, key: keyof IngestSummary) {
  summary[key] += 1
}
