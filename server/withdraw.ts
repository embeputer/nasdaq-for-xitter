import { WITHDRAW_NOTE, withdrawKey } from './commands.ts'
import type { Desk } from './money.ts'
import { deskKey } from './padding.ts'
import type { Store } from './store.ts'
import { cashMarker, type CashTransfer } from './tag.ts'
import type { Person } from './book.ts'

const POOR = 'Withdraw at least $1.'
const OVER = "You don't have that much Cash."
const SHORT = "The NQFX fund can't cover that withdrawal. Your Cash is still there."
const BAD = 'A withdrawal is already on file, but the record is unreadable.'
const WALLET = 'Could not read the desk wallet. Nothing was withdrawn.'
const PENDING = 'The withdrawal did not finish. Withdraw again and it will not send twice.'

export type WithdrawResult =
  | { ok: true; cents: number; screenName: string; short: boolean }
  | { ok: false; status: number; error: string; message: string }

export async function withdrawCash(input: {
  ledger: Store
  person: Person
  desks: Desk[]
  wallet: (desk: Desk) => Promise<{ balanceCents: number; maxCents: number }>
  pay: (desk: Desk, to: string, cents: number, note: string, key: string) => Promise<void>
  cents: number
  now: number
}): Promise<WithdrawResult> {
  const name = input.person.screenName.trim().replace(/^@/, '')
  const pending = await input.ledger.meta(cashMarker(name))
  const rooms: { desk: string; room: number; maxCents: number }[] = []
  if (!pending) {
    for (const desk of input.desks) {
      if (!desk.writeToken) {
        rooms.push({ desk: desk.screenName, room: -1, maxCents: 0 })
        continue
      }
      try {
        const have = await input.ledger.vaultDesk(name, desk.screenName)
        const reserved = await input.ledger.reservedCents(desk.screenName)
        const wallet = await input.wallet(desk)
        rooms.push({
          desk: desk.screenName,
          room: Math.max(0, wallet.balanceCents - reserved + have),
          maxCents: wallet.maxCents,
        })
      } catch (error) {
        console.error('withdraw', desk.screenName, error instanceof Error ? error.message : 'failed')
        return { ok: false, status: 502, error: 'wallet', message: WALLET }
      }
    }
  }
  const claim = await input.ledger.placeCash(input.person, rooms, input.cents, input.now)
  if (claim.action !== 'send') {
    if (claim.action === 'poor') return { ok: false, status: 409, error: 'poor', message: POOR }
    if (claim.action === 'over') return { ok: false, status: 409, error: 'over', message: OVER }
    if (claim.action === 'short') return { ok: false, status: 409, error: 'short', message: SHORT }
    return { ok: false, status: 409, error: 'bad_marker', message: BAD }
  }
  let sentCents = 0
  for (const transfer of claim.transfers) {
    const desk = input.desks.find((item) => deskKey(item.screenName) === transfer.desk)
    if (!desk?.writeToken) {
      if (transfer.sent > 0) return { ok: false, status: 502, error: 'payout_failed', message: PENDING }
      await input.ledger.releaseCash(name)
      return sentCents > 0 ? done(input.ledger, name, sentCents) : { ok: false, status: 409, error: 'short', message: SHORT }
    }
    const outcome = await sendTransfer(input, desk, name, transfer)
    if (outcome === 'sent') {
      sentCents += transfer.cents
      continue
    }
    if (outcome === 'restored') {
      return sentCents > 0 ? done(input.ledger, name, sentCents) : { ok: false, status: 409, error: 'short', message: SHORT }
    }
    return { ok: false, status: 502, error: 'payout_failed', message: PENDING }
  }
  return done(input.ledger, name, sentCents)
}

async function done(ledger: Store, name: string, cents: number): Promise<WithdrawResult> {
  const left = await ledger.vaultCents(name)
  return { ok: true, cents, screenName: name, short: left > 0 }
}

async function sendTransfer(
  input: {
    ledger: Store
    pay: (desk: Desk, to: string, cents: number, note: string, key: string) => Promise<void>
  },
  desk: Desk,
  name: string,
  transfer: CashTransfer,
): Promise<'sent' | 'restored' | 'pending'> {
  let sent = transfer.sent
  try {
    for (let part = transfer.sent; part < transfer.parts.length; part += 1) {
      await input.pay(desk, name, transfer.parts[part] ?? 0, WITHDRAW_NOTE, withdrawKey(transfer.id, part))
      await input.ledger.noteCash(name, transfer.id)
      sent = part + 1
    }
    return 'sent'
  } catch (error) {
    console.error('withdraw', desk.screenName, error instanceof Error ? error.message : 'failed')
    const kind = error instanceof Error ? error.name : ''
    if (sent === 0 && (kind === 'ReadOnlyToken' || kind === 'MissingWriteToken')) {
      await input.ledger.releaseCash(name)
      return 'restored'
    }
    return 'pending'
  }
}
