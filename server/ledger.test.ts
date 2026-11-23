import { describe, expect, it } from 'vitest'
import { fileBuy, fileClose } from './book.ts'
import { ingest } from './ingest.ts'
import { ACTIVITY_LIMIT, adminNames, idempotencyKey, parseActivity, type Desk, type IncomingPayment } from './money.ts'
import { pkcePair } from './oauth.ts'
import { queriesFromNote, REFUND_NOTE, resolveNote } from './resolve.ts'
import { memoryStore } from './store.ts'
import type { Listing } from './market.ts'

const sender = { id: '9', screenName: 'ada', name: 'Ada', avatarUrl: null }

function payment(id: string, note: string, amount = 2500): IncomingPayment {
  return { id, amountCents: amount, note, direction: 'received', reversed: false, sender }
}

const desk: Desk = { screenName: 'nasdaq', readToken: 'read', writeToken: '' }

describe('admins', () => {
  it('includes the desk accounts, ember, and puppy', async () => {
    expect([...(await adminNames())].sort()).toEqual(['ember', 'nasdaq', 'nyse', 'puppy'])
  })
})

describe('refund note', () => {
  it('uses the desk wording and fits the Equicoin note limit', () => {
    expect(REFUND_NOTE).toBe(
      "Sorry, i couldn't find that! Make sure you specify an available stock, crypto coin, or perpetual market.",
    )
    expect(REFUND_NOTE.length).toBeLessThanOrEqual(140)
    expect(queriesFromNote(REFUND_NOTE)).toEqual([])
    expect(idempotencyKey('123456789')).toBe('refund-123456789')
  })
})

describe('ticker notes', () => {
  it('reads a ticker, a perp, and a cashtag', () => {
    expect(queriesFromNote('NVDA')).toEqual([{ venue: null, query: 'NVDA' }])
    expect(queriesFromNote('please buy $ORCL')).toEqual([{ venue: 'stock', query: 'ORCL' }])
    expect(queriesFromNote('perp:kPEPE')).toEqual([{ venue: 'perpetual', query: 'kPEPE' }])
  })

  it('prefers the stock, then the spot coin', async () => {
    const listings: Listing[] = [
      { id: 'stock:ORCL', venue: 'stock', symbol: 'ORCL', label: 'ORCL', name: 'Oracle Corporation' },
      { id: 'crypto:BTCUSDT', venue: 'crypto', symbol: 'BTCUSDT', label: 'BTC', name: 'Bitcoin' },
      { id: 'perpetual:BTC', venue: 'perpetual', symbol: 'BTC', label: 'BTC-PERP', name: 'BTC' },
    ]
    const search = async (venue: Listing['venue'], query: string) =>
      listings.filter((item) => item.venue === venue && `${item.symbol} ${item.name} ${item.label}`.toLowerCase().includes(query.toLowerCase()))
    expect((await resolveNote('oracle', search))?.id).toBe('stock:ORCL')
    expect((await resolveNote('BTC', search))?.id).toBe('crypto:BTCUSDT')
    expect((await resolveNote('BTC-PERP', search))?.id).toBe('perpetual:BTC')
    expect(await resolveNote('nope', search)).toBeNull()
  })
})

describe('book', () => {
  it('files an admin order under the other person', () => {
    const opened = fileBuy([], {
      venue: 'stock',
      symbol: 'NVDA',
      name: 'NVIDIA',
      label: 'NVDA',
      person: sender,
      amount: 100,
      price: 50,
      now: 5,
    })
    expect(opened.positions[0]?.person.screenName).toBe('ada')
    expect(opened.positions[0]?.qty).toBe(2)
    const again = fileBuy(opened.positions, {
      venue: 'stock',
      symbol: 'NVDA',
      name: 'NVIDIA',
      label: 'NVDA',
      person: sender,
      amount: 50,
      price: 100,
      now: 6,
    })
    expect(again.positions).toHaveLength(1)
    expect(again.positions[0]?.qty).toBeCloseTo(2.5)
    const closed = fileClose(again.positions, again.positions[0]!.id, 80, 7)
    expect(closed.positions).toHaveLength(0)
    expect(closed.fill.person.screenName).toBe('ada')
    expect(closed.fill.side).toBe('sell')
  })
})

describe('ingest', () => {
  it('skips history, files the sender, and refunds an unknown market once', async () => {
    const ledger = memoryStore()
    const sent: string[] = []
    let refunds = 0
    const run = (rows: IncomingPayment[]) =>
      ingest({
        store: ledger,
        desks: [desk],
        now: 10,
        activity: async () => ({ payments: rows, next: null }),
        resolve: async (note) =>
          note === 'NVDA' ? { id: 'stock:NVDA', venue: 'stock', symbol: 'NVDA', label: 'NVDA', name: 'NVIDIA' } : null,
        quote: async () => 25,
        refund: async (_token, to, amount, id) => {
          refunds += 1
          sent.push(`${to}:${amount}:${id}`)
          if (refunds === 1) {
            const error = new Error('read_only')
            error.name = 'ReadOnlyToken'
            throw error
          }
        },
      })

    const first = await run([payment('1', 'OLD')])
    expect(first.filled).toBe(0)
    expect(await ledger.positions()).toHaveLength(0)

    const second = await run([payment('1', 'NVDA'), payment('2', 'ZZZZ'), payment('3', 'NVDA', 5000)])
    expect(second.filled).toBe(1)
    expect(second.pending).toBe(1)
    const held = await ledger.positions()
    expect(held).toHaveLength(1)
    expect(held[0]?.person.screenName).toBe('ada')
    expect(held[0]?.qty).toBe(5000 / 100 / 25)

    const third = await run([payment('2', 'ZZZZ'), payment('3', 'NVDA', 5000)])
    expect(third.refunded).toBe(1)
    expect(sent).toEqual(['ada:2500:2', 'ada:2500:2'])
    expect(await ledger.positions()).toHaveLength(1)

    const fourth = await run([payment('3', 'NVDA', 5000)])
    expect(fourth.filled).toBe(0)
    expect((await ledger.positions())[0]?.qty).toBe(2)
  })

  it('keeps only the newest 10 payments in a run', async () => {
    const ledger = memoryStore()
    let calls = 0
    const rows = Array.from({ length: 12 }, (_, index) => payment(String(index + 1), 'NVDA'))
    await ingest({
      store: ledger,
      desks: [desk],
      now: 10,
      activity: async (_token, cursor) => {
        calls += 1
        expect(cursor).toBeNull()
        return { payments: rows, next: 'more' }
      },
      resolve: async () => ({ id: 'stock:NVDA', venue: 'stock', symbol: 'NVDA', label: 'NVDA', name: 'NVIDIA' }),
      quote: async () => 25,
      refund: async () => {
        throw new Error('no refund')
      },
    })
    expect(calls).toBe(1)
    expect(ACTIVITY_LIMIT).toBe(10)
    const stored: string[] = []
    for (const row of rows) {
      if (await ledger.payment(row.id)) stored.push(row.id)
    }
    expect(stored).toEqual(rows.slice(0, 10).map((row) => row.id))
    expect(await ledger.positions()).toHaveLength(0)
  })
})

describe('activity', () => {
  it('ignores earnings and keeps received notes', () => {
    const parsed = parseActivity({
      earnings: [{ amount_cents: 1 }],
      data: [{ id: '7', amount_cents: 100, note: 'AAPL', direction: 'received', reversed: false, sender: { id: '2', screen_name: 'ada', name: 'Ada' } }],
      next_cursor: null,
    })
    expect(parsed.payments).toHaveLength(1)
    expect(parsed.payments[0]?.sender.screenName).toBe('ada')
  })
})

describe('pkce', () => {
  it('builds a 43 character challenge', () => {
    const pair = pkcePair()
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
