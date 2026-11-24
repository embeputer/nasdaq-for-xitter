import { fileClose } from './book.ts'
import type { Desk } from './money.ts'
import { deskKey } from './padding.ts'
import { payoutMarker, planPayout, readPayout, type CloseError, type PayPlan } from './payout.ts'
import type { Store } from './store.ts'

export type CashResult = { ok: true; cents: number; screenName: string } | CloseError

export async function cashOut(input: {
  ledger: Store
  id: string
  price: number
  desks: Desk[]
  limit: (desk: Desk) => Promise<number>
  balance?: (desk: Desk) => Promise<number>
  pay: (desk: Desk, to: string, cents: number, note: string, key: string) => Promise<void>
}): Promise<CashResult> {
  const position = (await input.ledger.positions()).find((item) => item.id === input.id)
  if (!position) return { ok: false, status: 404, error: 'not_found', message: 'That position is already closed.' }
  const markerKey = payoutMarker(position)
  const marked = readPayout(await input.ledger.meta(markerKey))
  if (marked === 'bad') {
    return {
      ok: false,
      status: 409,
      error: 'bad_marker',
      message: 'The payout record for this position is unreadable. An admin can close it without cash.',
    }
  }
  let plan: PayPlan
  if (marked) {
    if (!Object.is(marked.qty, position.qty)) {
      return {
        ok: false,
        status: 409,
        error: 'payout_mismatch',
        message: 'This position changed after a payout started. An admin can close it without cash.',
      }
    }
    plan = marked
  } else {
    const payments = await input.ledger.payments()
    const padding: Record<string, number> = {}
    for (const desk of input.desks) padding[deskKey(desk.screenName)] = await input.ledger.paddingCents(desk.screenName)
    let balances: Record<string, number> | null = null
    if (input.balance) {
      balances = {}
      for (const desk of input.desks) {
        try {
          balances[deskKey(desk.screenName)] = await input.balance(desk)
        } catch (error) {
          return { ok: false, status: 502, error: 'payout_failed', message: payMessage(desk.screenName, error) }
        }
      }
    }
    const preview = planPayout({
      position,
      price: input.price,
      payments,
      padding,
      balances,
      desks: input.desks.map((desk) => ({
        screenName: desk.screenName,
        canSend: Boolean(desk.writeToken),
        maxCents: Number.MAX_SAFE_INTEGER,
      })),
    })
    if (!preview.ok) return preview
    const limits = new Map<string, number>()
    for (const transfer of preview.plan.transfers) {
      if (limits.has(transfer.desk)) continue
      const desk = findDesk(input.desks, transfer.desk)
      if (!desk?.writeToken) {
        return { ok: false, status: 502, error: 'no_account', message: payMessage(transfer.desk, missingToken()) }
      }
      try {
        limits.set(transfer.desk, await input.limit(desk))
      } catch (error) {
        return { ok: false, status: 502, error: 'payout_failed', message: payMessage(desk.screenName, error) }
      }
    }
    const planned = planPayout({
      position,
      price: input.price,
      payments,
      padding,
      balances,
      desks: input.desks.map((desk) => ({
        screenName: desk.screenName,
        canSend: Boolean(desk.writeToken),
        maxCents: limits.get(deskKey(desk.screenName)) ?? 0,
      })),
    })
    if (!planned.ok) return planned
    // Freeze the cents and keys before sending. The gain is reserved in the
    // same edit. A retry of this close pays the same plan and does not reserve again.
    const held = await input.ledger.holdPayout(markerKey, planned.plan)
    if (held === 'short') {
      return {
        ok: false,
        status: 409,
        error: 'short_fund',
        message: "The padding fund can't cover this close. The position is still open.",
      }
    }
    if (held === 'saved') {
      const stored = readPayout(await input.ledger.meta(markerKey))
      if (!stored || stored === 'bad') {
        return {
          ok: false,
          status: 409,
          error: 'bad_marker',
          message: 'The payout record for this position is unreadable. An admin can close it without cash.',
        }
      }
      plan = stored
    } else {
      plan = planned.plan
    }
  }
  const to = position.person.screenName.trim().replace(/^@/, '')
  for (const transfer of plan.transfers) {
    const desk = findDesk(input.desks, transfer.desk)
    if (!desk?.writeToken) {
      return { ok: false, status: 502, error: 'no_account', message: payMessage(transfer.desk, missingToken()) }
    }
    try {
      await input.pay(desk, to, transfer.cents, transfer.note, transfer.key)
    } catch (error) {
      console.error('payout', desk.screenName, error instanceof Error ? error.message : 'failed')
      return { ok: false, status: 502, error: 'payout_failed', message: payMessage(desk.screenName, error) }
    }
  }
  if (plan.credit.length > 0) await input.ledger.creditPadding(`pad:${markerKey}`, plan.credit)
  try {
    await input.ledger.updateBook((positions) => {
      const current = positions.find((item) => item.id === position.id)
      if (!current) throw new Error('closed')
      if (!Object.is(current.qty, plan.qty)) throw new Error('grew')
      return fileClose(positions, position.id, plan.price)
    })
  } catch (error) {
    const still = (await input.ledger.positions()).find((item) => item.id === position.id)
    if (!still) return { ok: true, cents: plan.cents, screenName: to }
    if (!Object.is(still.qty, plan.qty)) {
      return {
        ok: false,
        status: 409,
        error: 'payout_mismatch',
        message: 'This position changed after a payout started. An admin can close it without cash.',
      }
    }
    console.error('payout book', error instanceof Error ? error.message : 'failed')
    return {
      ok: false,
      status: 502,
      error: 'book',
      message: 'The Equicoins were sent, but the position is still open. Close it again and it will not pay twice.',
    }
  }
  return { ok: true, cents: plan.cents, screenName: to }
}

function findDesk(desks: Desk[], name: string): Desk | undefined {
  const key = deskKey(name)
  return desks.find((desk) => deskKey(desk.screenName) === key)
}

function missingToken(): Error {
  const error = new Error('missing_write_token')
  error.name = 'MissingWriteToken'
  return error
}

function payMessage(screen: string, error: unknown): string {
  const handle = `@${screen.replace(/^@/, '')}`
  const text = error instanceof Error ? error.message.trim() : ''
  if (error instanceof Error && (error.name === 'MissingWriteToken' || error.name === 'ReadOnlyToken')) {
    return `${handle} can't send Equicoins right now. The position is still open.`
  }
  if (/enough money/i.test(text)) return `${handle} doesn't have enough Equicoins to pay this out. The position is still open.`
  if (/disclaimer/i.test(text)) return `${handle} hasn't accepted Equicoins yet. The position is still open.`
  if (text && text.length <= 160 && !/xit_|bearer|token/i.test(text) && !/^(send|limit)_\d+$/.test(text)) {
    return `${text} The position is still open.`
  }
  return `Couldn't pay this out from ${handle}. The position is still open.`
}
