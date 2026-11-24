import { describe, expect, it } from 'vitest'
import { cashOut } from './close.ts'
import type { Desk } from './money.ts'
import { closeNote, planPayout, payoutMarker, readPayout } from './payout.ts'
import { REFUND_NOTE } from './resolve.ts'
import { memoryStore, type PaymentRow } from './store.ts'
import type { Position } from './book.ts'

const person = { id: '9', screenName: 'ada', name: 'Ada', avatarUrl: null }
const nasdaq: Desk = { screenName: 'nasdaq', readToken: 'read', writeToken: 'write' }
const nyse: Desk = { screenName: 'NYSE', readToken: 'read', writeToken: 'write' }

function row(id: string, desk: string, amountCents: number, screen = 'ada'): PaymentRow {
  return {
    id,
    status: 'processing',
    amountCents,
    note: 'NVDA',
    desk,
    senderId: person.id,
    senderName: person.name,
    senderScreen: screen,
    avatarUrl: null,
    detail: '',
    updatedAt: 1,
  }
}

function order(amount: number, price: number, now: number) {
  return { venue: 'stock' as const, symbol: 'NVDA', name: 'NVIDIA', label: 'NVDA', person, amount, price, now }
}

async function fund(ledger: ReturnType<typeof memoryStore>, nasdaqCents: number, nyseCents?: number) {
  await ledger.openPadding('nasdaq', nasdaqCents, 0, {})
  if (nyseCents !== undefined) await ledger.openPadding('NYSE', nyseCents, 0, {})
}

describe('payout plan', () => {
  const position: Position = {
    id: 'pos:stock:NVDA:ada',
    venue: 'stock',
    symbol: 'NVDA',
    name: 'NVIDIA',
    label: 'NVDA',
    person,
    qty: 1.5,
    avgPrice: 10,
    openedAt: 5,
  }

  it('pays the earliest desk, then the other desk padding', () => {
    const payments = [
      { ...row('1', 'nasdaq', 1000), status: 'filled' as const, detail: 'stock:NVDA' },
      { ...row('2', 'NYSE', 500), status: 'filled' as const, detail: 'stock:NVDA' },
      { ...row('3', 'nasdaq', 100), status: 'skipped' as const, detail: 'stock:NVDA' },
      { ...row('4', 'nasdaq', 100, 'bob'), status: 'filled' as const, detail: 'stock:NVDA' },
    ]
    const desks = [
      { screenName: 'nasdaq', canSend: true, maxCents: 100_000 },
      { screenName: 'NYSE', canSend: true, maxCents: 100_000 },
    ]
    const planned = planPayout({
      position,
      price: 20,
      payments,
      padding: { nasdaq: 100, nyse: 5000 },
      balances: null,
      desks,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.cents).toBe(3000)
    expect(planned.plan.transfers.map((transfer) => [transfer.desk, transfer.cents])).toEqual([
      ['nasdaq', 1100],
      ['nyse', 1900],
    ])
    expect(planned.plan.reserves).toEqual([
      { desk: 'nasdaq', cents: 100 },
      { desk: 'nyse', cents: 1400 },
    ])
    expect(planned.plan.credit).toEqual([])
    expect(planned.plan.transfers.every((transfer) => transfer.note.length <= 140 && transfer.note !== REFUND_NOTE)).toBe(true)
    expect(new Set(planned.plan.transfers.map((transfer) => transfer.key)).size).toBe(2)
    const saved = readPayout(JSON.stringify(planned.plan))
    expect(saved !== 'bad' && saved?.cents).toBe(3000)

    const covered = planPayout({
      position,
      price: 20,
      payments,
      padding: { nasdaq: 10_000, nyse: 5000 },
      balances: null,
      desks,
    })
    expect(covered.ok).toBe(true)
    if (!covered.ok) return
    expect(covered.plan.transfers.map((transfer) => [transfer.desk, transfer.cents])).toEqual([['nasdaq', 3000]])
    expect(covered.plan.reserves).toEqual([{ desk: 'nasdaq', cents: 2000 }])
  })

  it('breaks a payout into the send limit', () => {
    const planned = planPayout({
      position: { ...position, qty: 250, avgPrice: 10 },
      price: 10,
      payments: [{ ...row('1', 'nasdaq', 250_000), status: 'filled', detail: 'stock:NVDA' }],
      padding: {},
      balances: null,
      desks: [{ screenName: 'nasdaq', canSend: true, maxCents: 100_000 }],
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.transfers.map((transfer) => transfer.cents)).toEqual([100_000, 100_000, 50_000])
  })

  it('refuses a position nobody paid for', () => {
    const planned = planPayout({
      position,
      price: 20,
      payments: [],
      padding: {},
      balances: null,
      desks: [{ screenName: 'nasdaq', canSend: true, maxCents: 100_000 }],
    })
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.error).toBe('no_desk')
  })

  it('keeps the note inside the Equicoin limit', () => {
    const note = closeNote(`0x${'a'.repeat(80)}`)
    expect([...note].length).toBeLessThanOrEqual(140)
    expect(note).not.toBe(REFUND_NOTE)
    expect(readPayout(null)).toBeNull()
    expect(readPayout('nope')).toBe('bad')
  })
})

describe('cash out', () => {
  it('sends the current value once, then closes the book', async () => {
    const ledger = memoryStore()
    await ledger.fillPayment(row('1', 'nasdaq', 1000), order(10, 10, 5))
    await fund(ledger, 1000)
    const paid: { cents: number; key: string; to: string }[] = []
    const run = (price: number) =>
      cashOut({
        ledger,
        id: 'pos:stock:NVDA:ada',
        price,
        desks: [nasdaq],
        limit: async () => 100_000,
        pay: async (_desk, to, cents, _note, key) => {
          paid.push({ cents, key, to })
        },
      })
    const first = await run(12)
    expect(first).toMatchObject({ ok: true, cents: 1200, screenName: 'ada' })
    expect(paid).toEqual([{ cents: 1200, key: paid[0]!.key, to: 'ada' }])
    expect(await ledger.positions()).toHaveLength(0)
    const fills = await ledger.fills(5)
    expect(fills[0]?.side).toBe('sell')
    expect(fills[0]?.price).toBe(12)
    expect(await ledger.paddingCents('nasdaq')).toBe(800)
    const second = await run(99)
    expect(second.ok).toBe(false)
    expect(paid).toHaveLength(1)
  })

  it('leaves the position open when the send fails, and a retry pays the same amount', async () => {
    const ledger = memoryStore()
    await ledger.fillPayment(row('1', 'nasdaq', 1000), order(10, 10, 5))
    await fund(ledger, 1000)
    const position = (await ledger.positions())[0]!
    let fail = true
    const paid: { cents: number; key: string }[] = []
    const run = (price: number) =>
      cashOut({
        ledger,
        id: position.id,
        price,
        desks: [nasdaq],
        limit: async () => 100_000,
        pay: async (_desk, _to, cents, _note, key) => {
          paid.push({ cents, key })
          if (fail) throw new Error("You don't have enough money for that.")
        },
      })
    const failed = await run(12)
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.message).toContain("doesn't have enough")
    expect(failed.message).toContain('still open')
    expect(await ledger.positions()).toHaveLength(1)
    expect(await ledger.meta(payoutMarker(position))).toContain('"cents":1200')
    fail = false
    const retried = await run(40)
    expect(retried).toMatchObject({ ok: true, cents: 1200 })
    expect(paid.map((item) => item.cents)).toEqual([1200, 1200])
    expect(paid[1]?.key).toBe(paid[0]?.key)
    expect((await ledger.fills(5))[0]?.price).toBe(12)
    expect(await ledger.paddingCents('nasdaq')).toBe(800)
  })

  it('does not pay again when the position changed after a payout started', async () => {
    const ledger = memoryStore()
    await ledger.fillPayment(row('1', 'nasdaq', 1000), order(10, 10, 5))
    await fund(ledger, 1000)
    const position = (await ledger.positions())[0]!
    let calls = 0
    const run = () =>
      cashOut({
        ledger,
        id: position.id,
        price: 12,
        desks: [nasdaq],
        limit: async () => 100_000,
        pay: async () => {
          calls += 1
          throw new Error('nope')
        },
      })
    expect((await run()).ok).toBe(false)
    await ledger.updateBook((positions) => ({ positions: positions.map((item) => ({ ...item, qty: item.qty + 1 })), fill: null }))
    const again = await run()
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.error).toBe('payout_mismatch')
    expect(calls).toBe(1)
    expect(await ledger.positions()).toHaveLength(1)
  })

  it('does not send when nobody paid or the desk cannot', async () => {
    const ledger = memoryStore()
    await ledger.updateBook(() => ({
      positions: [
        {
          id: 'pos:stock:NVDA:ada',
          venue: 'stock' as const,
          symbol: 'NVDA',
          name: 'NVIDIA',
          label: 'NVDA',
          person,
          qty: 1,
          avgPrice: 10,
          openedAt: 5,
        },
      ],
      fill: null,
    }))
    let calls = 0
    const unpaid = await cashOut({
      ledger,
      id: 'pos:stock:NVDA:ada',
      price: 12,
      desks: [nasdaq],
      limit: async () => 100_000,
      pay: async () => {
        calls += 1
      },
    })
    expect(unpaid.ok).toBe(false)
    if (unpaid.ok) return
    expect(unpaid.error).toBe('no_desk')
    await ledger.fillPayment(row('1', 'nasdaq', 1000), order(10, 10, 6))
    const mute = await cashOut({
      ledger,
      id: 'pos:stock:NVDA:ada',
      price: 12,
      desks: [{ ...nasdaq, writeToken: '' }],
      limit: async () => 100_000,
      pay: async () => {
        calls += 1
      },
    })
    expect(mute.ok).toBe(false)
    if (mute.ok) return
    expect(mute.error).toBe('no_account')
    expect(calls).toBe(0)
    expect(await ledger.positions()).toHaveLength(1)
  })

  it('does not record a payout when the send limit cannot be read', async () => {
    const ledger = memoryStore()
    await ledger.fillPayment(row('1', 'nasdaq', 1000), order(10, 10, 5))
    await fund(ledger, 1000)
    const position = (await ledger.positions())[0]!
    const result = await cashOut({
      ledger,
      id: position.id,
      price: 12,
      desks: [nasdaq],
      limit: async () => {
        throw new Error('limit_503')
      },
      pay: async () => {
        throw new Error('should not send')
      },
    })
    expect(result.ok).toBe(false)
    expect(await ledger.meta(payoutMarker(position))).toBeNull()
    expect(await ledger.paddingCents('nasdaq')).toBe(1000)
    expect(await ledger.positions()).toHaveLength(1)
  })

  it('does not close a position that grew while the payout was sending', async () => {
    const ledger = memoryStore()
    await ledger.fillPayment(row('1', 'nasdaq', 1000), order(10, 10, 5))
    await fund(ledger, 1000)
    const result = await cashOut({
      ledger,
      id: 'pos:stock:NVDA:ada',
      price: 12,
      desks: [nasdaq],
      limit: async () => 100_000,
      pay: async () => {
        await ledger.updateBook((positions) => ({
          positions: positions.map((item) => ({ ...item, qty: item.qty + 1 })),
          fill: null,
        }))
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('payout_mismatch')
    expect((await ledger.positions())[0]?.qty).toBeGreaterThan(1)
  })

  it('retries the same keys when the second desk fails', async () => {
    const ledger = memoryStore()
    await ledger.fillPayment(row('1', 'nasdaq', 1000), order(10, 10, 5))
    await ledger.fillPayment(row('2', 'NYSE', 500), order(5, 10, 6))
    await fund(ledger, 0, 2000)
    const keys: string[] = []
    let attempts = 0
    const run = () =>
      cashOut({
        ledger,
        id: 'pos:stock:NVDA:ada',
        price: 20,
        desks: [nasdaq, nyse],
        limit: async () => 100_000,
        pay: async (_desk, _to, _cents, _note, key) => {
          attempts += 1
          keys.push(key)
          if (attempts === 2) throw new Error('nope')
        },
      })
    expect((await run()).ok).toBe(false)
    expect(await ledger.positions()).toHaveLength(1)
    const done = await run()
    expect(done).toMatchObject({ ok: true, cents: 3000 })
    expect(keys.slice(2)).toEqual(keys.slice(0, 2))
    expect(await ledger.positions()).toHaveLength(0)
    expect(await ledger.paddingCents('nyse')).toBe(500)
  })

  it('leaves the position open when the padding fund cannot cover the gain', async () => {
    const ledger = memoryStore()
    await ledger.fillPayment(row('1', 'nasdaq', 1000), order(10, 10, 5))
    await fund(ledger, 0)
    const position = (await ledger.positions())[0]!
    let calls = 0
    const result = await cashOut({
      ledger,
      id: position.id,
      price: 50,
      desks: [nasdaq],
      limit: async () => 100_000,
      pay: async () => {
        calls += 1
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('short_fund')
    expect(calls).toBe(0)
    expect(await ledger.meta(payoutMarker(position))).toBeNull()
    expect(await ledger.paddingCents('nasdaq')).toBe(0)
    expect(await ledger.positions()).toHaveLength(1)
  })

  it('returns unused principal to the padding fund after the send', async () => {
    const ledger = memoryStore()
    await ledger.fillPayment(row('1', 'nasdaq', 1000), order(10, 10, 5))
    await fund(ledger, 0)
    const result = await cashOut({
      ledger,
      id: 'pos:stock:NVDA:ada',
      price: 8,
      desks: [nasdaq],
      limit: async () => 100_000,
      pay: async () => undefined,
    })
    expect(result).toMatchObject({ ok: true, cents: 800, screenName: 'ada' })
    expect(await ledger.paddingCents('nasdaq')).toBe(200)
    expect(await ledger.positions()).toHaveLength(0)
  })

  it('does not reserve padding when the live balance cannot be read', async () => {
    const ledger = memoryStore()
    await ledger.fillPayment(row('1', 'nasdaq', 1000), order(10, 10, 5))
    await fund(ledger, 1000)
    const position = (await ledger.positions())[0]!
    const result = await cashOut({
      ledger,
      id: position.id,
      price: 12,
      desks: [nasdaq],
      limit: async () => 100_000,
      balance: async () => {
        throw new Error('wallet_down')
      },
      pay: async () => {
        throw new Error('should not send')
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('payout_failed')
    expect(await ledger.meta(payoutMarker(position))).toBeNull()
    expect(await ledger.paddingCents('nasdaq')).toBe(1000)
  })
})
