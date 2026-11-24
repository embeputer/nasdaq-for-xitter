import { describe, expect, it } from 'vitest'
import { ingest } from './ingest.ts'
import { addLikes, addPadding, coverClose, likeDeltas, setOpening } from './padding.ts'
import { memoryStore, type PaymentRow } from './store.ts'

const person = { id: '9', screenName: 'ada', name: 'Ada', avatarUrl: null }

function paid(id: string, desk: string, amountCents: number, note = 'NVDA'): PaymentRow {
  return {
    id,
    status: 'processing',
    amountCents,
    note,
    desk,
    senderId: person.id,
    senderName: person.name,
    senderScreen: person.screenName,
    avatarUrl: null,
    detail: '',
    updatedAt: 1,
  }
}

describe('padding math', () => {
  it('snapshots once and adds only new like cents', () => {
    const meta: Record<string, string> = {}
    expect(addLikes(meta, 'nasdaq', [{ day: '2026-11-25', cents: 50 }])).toBe(0)
    expect(addPadding(meta, 'nasdaq', 100)).toBe(false)
    expect(setOpening(meta, 'nasdaq', 25065, 5000, { '2026-11-24': 64 })).toBe(true)
    expect(meta['padding:nasdaq']).toBe('20065')
    expect(addLikes(meta, 'nasdaq', [{ day: '2026-11-24', cents: 64 }])).toBe(0)
    expect(meta['padding:nasdaq']).toBe('20065')
    expect(addLikes(meta, 'nasdaq', [{ day: '2026-11-24', cents: 40 }, { day: '2026-11-25', cents: 50 }])).toBe(50)
    expect(meta['padding:nasdaq']).toBe('20115')
    expect(JSON.parse(meta['likes:nasdaq'])).toEqual({ '2026-11-24': 64, '2026-11-25': 50 })
    expect(setOpening(meta, 'nasdaq', 1, 0, {})).toBe(false)
    expect(meta['padding:nasdaq']).toBe('20115')
    const shrunk = likeDeltas({ '2026-11-24': 100 }, [{ day: '2026-11-24', cents: 40 }])
    expect(shrunk.add).toBe(0)
    expect(shrunk.next['2026-11-24']).toBe(100)
  })

  it('pays the first desk and stops when the fund or the live balance is short', () => {
    const payments = [
      { desk: 'nasdaq', amountCents: 1000, updatedAt: 1, id: '1' },
      { desk: 'NYSE', amountCents: 500, updatedAt: 1, id: '2' },
    ]
    const sendable = new Set(['nasdaq', 'nyse'])
    const covered = coverClose({ cents: 3000, payments, padding: { nasdaq: 100, nyse: 5000 }, balances: null, sendable })
    expect(covered).toEqual({
      shares: [
        { desk: 'nasdaq', cents: 1100, own: 1000 },
        { desk: 'nyse', cents: 1900, own: 500 },
      ],
      reserves: [
        { desk: 'nasdaq', cents: 100 },
        { desk: 'nyse', cents: 1400 },
      ],
      credit: [],
    })
    const fallback = coverClose({ cents: 3000, payments, padding: { nasdaq: 0, nyse: 2000 }, balances: null, sendable })
    expect(fallback).toMatchObject({
      shares: [
        { desk: 'nasdaq', cents: 1000, own: 1000 },
        { desk: 'nyse', cents: 2000, own: 500 },
      ],
      reserves: [{ desk: 'nyse', cents: 1500 }],
    })
    expect(
      coverClose({
        cents: 3000,
        payments,
        padding: { nasdaq: 10_000, nyse: 5000 },
        balances: { nasdaq: 1000, nyse: 0 },
        sendable,
      }),
    ).toBe('short')
    expect(
      coverClose({
        cents: 1200,
        payments: [payments[0]!],
        padding: { nasdaq: 0 },
        balances: null,
        sendable: new Set(),
      }),
    ).toBe('no_account')
    const loss = coverClose({
      cents: 800,
      payments: [payments[0]!],
      padding: { nasdaq: 0 },
      balances: null,
      sendable,
    })
    expect(loss).toMatchObject({ shares: [{ desk: 'nasdaq', cents: 800, own: 1000 }], reserves: [], credit: [{ desk: 'nasdaq', cents: 200 }] })
  })
})

describe('padding ledger', () => {
  it('adds donations and launch liquidity only after the snapshot', async () => {
    const ledger = memoryStore()
    await ledger.donatePayment(paid('d1', 'nasdaq', 100, 'donate'))
    expect(await ledger.paddingCents('nasdaq')).toBe(0)
    expect((await ledger.payment('d1'))?.status).toBe('donated')
    await ledger.creditVault(paid('v1', 'nasdaq', 8000, 'vault'), person)
    const early = await ledger.openLaunch({
      person,
      symbol: 'YAMS',
      name: 'Yams',
      liquidityCents: 1000,
      investCents: 0,
      now: 2,
    })
    expect(early.ok).toBe(true)
    expect(await ledger.paddingCents('nasdaq')).toBe(0)
    await ledger.openPadding('nasdaq', 10_000, 0, { '2026-11-24': 64 })
    expect(await ledger.paddingCents('nasdaq')).toBe(10_000)
    expect(await ledger.applyLikes('nasdaq', [{ day: '2026-11-24', cents: 64 }, { day: '2026-11-25', cents: 50 }])).toBe(50)
    expect(await ledger.paddingCents('nasdaq')).toBe(10_050)
    await ledger.donatePayment(paid('d2', 'nasdaq', 100, 'donate'))
    await ledger.donatePayment(paid('d2', 'nasdaq', 100, 'donate'))
    expect(await ledger.paddingCents('nasdaq')).toBe(10_150)
    const opened = await ledger.openLaunch({
      person,
      symbol: 'SOUP',
      name: 'Soup',
      liquidityCents: 2500,
      investCents: 500,
      now: 3,
    })
    expect(opened.ok).toBe(true)
    expect(await ledger.paddingCents('nasdaq')).toBe(12_650)
    expect(await ledger.vaultCents('ada')).toBe(4000)
  })

  it('reserves vaults and open principal, and does not count a donation twice', async () => {
    const ledger = memoryStore()
    await ledger.creditVault(paid('v1', 'nasdaq', 500, 'vault'), person)
    await ledger.fillPayment(paid('1', 'nasdaq', 1000), {
      venue: 'stock',
      symbol: 'NVDA',
      name: 'NVIDIA',
      label: 'NVDA',
      person,
      amount: 10,
      price: 10,
      now: 5,
    })
    expect(await ledger.reservedCents('nasdaq')).toBe(1500)
    await ledger.setMeta('bootstrapped:nasdaq', '1')
    let walletCalls = 0
    const run = (rows: { id: string; note: string; amountCents: number }[], earnings: { day: string; likes: number; cents: number }[]) =>
      ingest({
        store: ledger,
        desks: [{ screenName: 'nasdaq', readToken: 'read', writeToken: '' }],
        now: 10,
        activity: async () => ({
          payments: rows.map((row) => ({
            id: row.id,
            amountCents: row.amountCents,
            note: row.note,
            direction: 'received' as const,
            reversed: false,
            sender: person,
          })),
          next: null,
          earnings,
        }),
        wallet: async () => {
          walletCalls += 1
          return { balanceCents: walletCalls === 1 ? 25_000 : 1 }
        },
        resolve: async () => {
          throw new Error('donation notes are not searched')
        },
        quote: async () => null,
        refund: async () => undefined,
      })
    const first = await run([{ id: '9', note: 'donate', amountCents: 100 }], [{ day: '2026-11-24', likes: 2, cents: 64 }])
    expect(first.donated).toBe(1)
    expect(await ledger.paddingCents('nasdaq')).toBe(23_500)
    expect(walletCalls).toBe(1)
    const second = await run(
      [{ id: '10', note: 'donate', amountCents: 50 }],
      [
        { day: '2026-11-24', likes: 2, cents: 64 },
        { day: '2026-11-25', likes: 1, cents: 50 },
      ],
    )
    expect(second.donated).toBe(1)
    expect(await ledger.paddingCents('nasdaq')).toBe(23_600)
    expect(walletCalls).toBe(1)
  })
})
