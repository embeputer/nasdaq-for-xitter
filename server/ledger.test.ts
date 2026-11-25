import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileBuy, fileClose } from './book.ts'
import { ingest } from './ingest.ts'
import { ACTIVITY_LIMIT, adminNames, idempotencyKey, parseActivity, type Desk, type IncomingPayment } from './money.ts'
import { pkcePair } from './oauth.ts'
import { pickListing, isDonationNote, isRefundNote, isRestricted, isVaultNote, queriesFromNote, REFUND_NOTE, RESTRICTED_NOTE, resolveNote } from './resolve.ts'
import { fileStore, memoryStore } from './store.ts'
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
      'Sorry, i couldn\'t find that! Make sure you specify an available stock or crypto market. If donating, enter "donate" in the note.',
    )
    expect(REFUND_NOTE.length).toBeLessThanOrEqual(140)
    expect(RESTRICTED_NOTE).toBe("Sorry, that coin isn't available.")
    expect(RESTRICTED_NOTE.length).toBeLessThanOrEqual(140)
    expect(isRefundNote(RESTRICTED_NOTE)).toBe(true)
    expect(queriesFromNote(RESTRICTED_NOTE)).toEqual([])
    expect(isDonationNote(RESTRICTED_NOTE)).toBe(false)
    expect(isVaultNote(RESTRICTED_NOTE)).toBe(false)
    expect(
      isRefundNote(
        'Sorry, i couldn\'t find that! Make sure you specify an available stock, crypto, or perpetual market. If donating, enter "donate" in the note.',
      ),
    ).toBe(true)
    expect(queriesFromNote(REFUND_NOTE)).toEqual([])
    const gifts = ['donate', 'donation', 'TIP', 'for the fund', 'a gift', 'thanks for the charity', 'contribution']
    expect(gifts.filter((note) => !isDonationNote(note))).toEqual([])
    expect(isDonationNote('NVDA')).toBe(false)
    expect(isDonationNote('tip NVDA')).toBe(false)
    expect(isDonationNote('APPL')).toBe(false)
    expect(isDonationNote(REFUND_NOTE)).toBe(false)
    expect(isVaultNote('vault')).toBe(true)
    expect(isVaultNote('VAULT')).toBe(true)
    expect(isVaultNote('please vault')).toBe(true)
    expect(isVaultNote('enter vault')).toBe(false)
    expect(isVaultNote('vault NVDA')).toBe(false)
    expect(isVaultNote('NVDA')).toBe(false)
    expect(idempotencyKey('123456789')).toBe('refund-123456789')
  })
})

describe('ticker notes', () => {
  it('reads a ticker and a cashtag', () => {
    expect(queriesFromNote('NVDA')).toEqual([{ venue: null, query: 'NVDA' }])
    expect(queriesFromNote('please buy $ORCL')).toEqual([{ venue: 'stock', query: 'ORCL' }])
    expect(queriesFromNote('perp:kPEPE')).toEqual([])
    expect(queriesFromNote('BTC-PERP')).toEqual([])
    expect(queriesFromNote('perpetual BTC')).toEqual([])
    expect(queriesFromNote('buy BTC-PERP')).toEqual([])
    expect(queriesFromNote('NVDA perp')).toEqual([{ venue: null, query: 'NVDA' }])
    expect(queriesFromNote('$ORCL perp')).toEqual([{ venue: 'stock', query: 'ORCL' }])
    expect(queriesFromNote('xitYAMS')).toEqual([{ venue: 'launch', query: 'YAMS' }])
    expect(queriesFromNote('xityams')).toEqual([{ venue: 'launch', query: 'YAMS' }])
    expect(queriesFromNote('XITYAMS')).toEqual([{ venue: 'launch', query: 'YAMS' }])
    expect(queriesFromNote('xit:yams')).toEqual([{ venue: 'launch', query: 'YAMS' }])
    expect(queriesFromNote('please buy xit YAMS')).toEqual([{ venue: 'launch', query: 'YAMS' }])
    expect(queriesFromNote('YAMS')).toEqual([{ venue: null, query: 'YAMS' }])
    expect(queriesFromNote('xom')).toEqual([{ venue: null, query: 'xom' }])
    expect(queriesFromNote('xrp')).toEqual([{ venue: null, query: 'xrp' }])
    expect(queriesFromNote('xyams')).toEqual([{ venue: null, query: 'xyams' }])
    expect(queriesFromNote('xYAMS')).toEqual([{ venue: null, query: 'xYAMS' }])
  })

  it('prefers a crypto ticker over a stock trust, and a company name over a coin', async () => {
    const listings: Listing[] = [
      { id: 'stock:ORCL', venue: 'stock', symbol: 'ORCL', label: 'ORCL', name: 'Oracle Corporation' },
      { id: 'stock:BTC', venue: 'stock', symbol: 'BTC', label: 'BTC', name: 'Grayscale Bitcoin Mini Trust ETF' },
      { id: 'stock:ETH', venue: 'stock', symbol: 'ETH', label: 'ETH', name: 'Grayscale Ethereum Mini Trust ETF' },
      { id: 'stock:SOL', venue: 'stock', symbol: 'SOL', label: 'SOL', name: 'Solana Trust' },
      { id: 'stock:DOGE', venue: 'stock', symbol: 'DOGE', label: 'DOGE', name: 'Dogecoin Trust' },
      { id: 'stock:XRP', venue: 'stock', symbol: 'XRP', label: 'XRP', name: 'XRP Trust' },
      { id: 'stock:NVDA', venue: 'stock', symbol: 'NVDA', label: 'NVDA', name: 'NVIDIA Corporation' },
      { id: 'crypto:BTCUSDT', venue: 'crypto', symbol: 'BTCUSDT', label: 'BTC', name: 'Bitcoin' },
      { id: 'crypto:ETHUSDT', venue: 'crypto', symbol: 'ETHUSDT', label: 'ETH', name: 'Ethereum' },
      { id: 'crypto:SOLUSDT', venue: 'crypto', symbol: 'SOLUSDT', label: 'SOL', name: 'Solana' },
      { id: 'crypto:DOGEUSDT', venue: 'crypto', symbol: 'DOGEUSDT', label: 'DOGE', name: 'Dogecoin' },
      { id: 'crypto:XRPUSDC', venue: 'crypto', symbol: 'XRPUSDC', label: 'XRP-USDC', name: 'XRP' },
      { id: 'perpetual:BTC', venue: 'perpetual', symbol: 'BTC', label: 'BTC-PERP', name: 'BTC' },
    ]
    const search = async (venue: Listing['venue'], query: string) =>
      listings.filter((item) => item.venue === venue && `${item.symbol} ${item.name} ${item.label}`.toLowerCase().includes(query.toLowerCase()))
    const memes = new Set(['doge', 'dogecoin', 'pepe', 'shiba inu'])
    const restricted = (query: string) => memes.has(query.trim().toLowerCase())
    const id = async (note: string) => {
      const hit = await resolveNote(note, search, async () => null, restricted)
      return hit && 'id' in hit ? hit.id : null
    }
    expect(await id('oracle')).toBe('stock:ORCL')
    expect(await id('NVDA')).toBe('stock:NVDA')
    expect(await id('BTC')).toBe('crypto:BTCUSDT')
    expect(await id('ETH')).toBe('crypto:ETHUSDT')
    expect(await id('sol')).toBe('crypto:SOLUSDT')
    expect(isRestricted(await resolveNote('DOGE', search, async () => null, restricted))).toBe(true)
    expect(isRestricted(await resolveNote('Dogecoin', search, async () => null, restricted))).toBe(true)
    expect(isRestricted(await resolveNote('please DOGE', search, async () => null, restricted))).toBe(true)
    expect(isRestricted(await resolveNote('crypto:DOGE', search, async () => null, restricted))).toBe(true)
    expect(await id('XRP')).toBe('crypto:XRPUSDC')
    expect(await id('$BTC')).toBe('stock:BTC')
    expect(await id('$DOGE')).toBe('stock:DOGE')
    expect(await id('stock:DOGE')).toBe('stock:DOGE')
    expect(await id('stock:ETH')).toBe('stock:ETH')
    expect(await resolveNote('BTC-PERP', search, async () => null, restricted)).toBeNull()
    expect(await resolveNote('nope', search, async () => null, restricted)).toBeNull()
    expect(await resolveNote('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', search, async () => null, restricted)).toBeNull()
  })

  it('resolves a company name and a coin name, and ignores a contract address', async () => {
    const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    expect(queriesFromNote('Anthropic')).toEqual([{ venue: null, query: 'Anthropic' }])
    expect(queriesFromNote('Bitcoin')).toEqual([{ venue: null, query: 'Bitcoin' }])
    expect(queriesFromNote(usdc)).toEqual([])
    expect(queriesFromNote(`buy ${usdc}`)).toEqual([])
    const listings: Listing[] = [
      { id: 'stock:ANT', venue: 'stock', symbol: 'ANT', label: 'ANT', name: 'Anthropic, PBC Class A Common Stock' },
      { id: 'stock:ANTW', venue: 'stock', symbol: 'ANTW', label: 'ANTW', name: 'Anthropic AI Lab Ecosystem ETF' },
      { id: 'stock:BIXI', venue: 'stock', symbol: 'BIXI', label: 'BIXI', name: 'Bitcoin Infrastructure Acquisition Corp Ltd.' },
      { id: 'crypto:BTCUSDT', venue: 'crypto', symbol: 'BTCUSDT', label: 'BTC', name: 'Bitcoin' },
    ]
    expect(pickListing(listings.filter((item) => item.venue === 'stock'), 'Anthropic', 'stock')?.symbol).toBe('ANT')
    const search = async (venue: Listing['venue'], query: string) =>
      listings.filter((item) => item.venue === venue && (item.symbol === query || `${item.symbol} ${item.name} ${item.label}`.toLowerCase().includes(query.toLowerCase())))
    const id = async (note: string) => {
      const hit = await resolveNote(note, search)
      return hit && 'id' in hit ? hit.id : null
    }
    expect(await id('Anthropic')).toBe('stock:ANT')
    expect(await id('Bitcoin')).toBe('crypto:BTCUSDT')
    expect(await resolveNote(usdc, search)).toBeNull()
    expect(await resolveNote('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', search)).toBeNull()
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

  it('refunds a restricted coin with its own apology', async () => {
    const ledger = memoryStore()
    const notes: Array<string | undefined> = []
    const run = (rows: IncomingPayment[]) =>
      ingest({
        store: ledger,
        desks: [desk],
        now: 10,
        activity: async () => ({ payments: rows, next: null }),
        resolve: async (note) => {
          if (note === 'DOGE' || note === 'Dogecoin') return { restricted: true }
          if (note === '$DOGE') return { id: 'stock:DOGE', venue: 'stock', symbol: 'DOGE', label: 'DOGE', name: 'Dogecoin Trust' }
          return null
        },
        quote: async () => 25,
        refund: async (_token, _to, _amount, _id, note) => {
          notes.push(note)
        },
      })
    await run([payment('1', 'OLD')])
    const result = await run([payment('1', 'OLD'), payment('2', 'DOGE'), payment('3', 'ZZZZ'), payment('4', '$DOGE', 1000)])
    expect(result.refunded).toBe(2)
    expect(result.filled).toBe(1)
    expect(notes).toEqual([RESTRICTED_NOTE, REFUND_NOTE])
    expect((await ledger.payment('2'))?.status).toBe('refunded')
    expect((await ledger.payment('2'))?.detail).toBe('restricted')
    expect((await ledger.payment('3'))?.detail).toBe('refunded')
    expect((await ledger.positions()).map((position) => position.symbol)).toEqual(['DOGE'])
    expect(await ledger.vaultCents('ada')).toBe(0)
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

  it('keeps a donation instead of refunding it', async () => {
    const ledger = memoryStore()
    let refunds = 0
    const run = (rows: IncomingPayment[]) =>
      ingest({
        store: ledger,
        desks: [desk],
        now: 10,
        activity: async () => ({ payments: rows, next: null }),
        resolve: async () => {
          throw new Error('donation notes are not searched')
        },
        quote: async () => 25,
        refund: async () => {
          refunds += 1
        },
      })
    await run([payment('1', 'OLD')])
    const result = await run([payment('1', 'OLD'), payment('2', 'thanks for the tip')])
    expect(result.donated).toBe(1)
    expect(result.refunded).toBe(0)
    expect(refunds).toBe(0)
    expect((await ledger.payment('2'))?.status).toBe('donated')
    expect(await ledger.positions()).toHaveLength(0)
  })

  it('stores a vault note as that person\'s NQFX balance', async () => {
    const ledger = memoryStore()
    let refunds = 0
    let lookups = 0
    const run = (rows: IncomingPayment[], screenName = 'nasdaq') =>
      ingest({
        store: ledger,
        desks: [{ screenName, readToken: 'read', writeToken: '' }],
        now: 10,
        activity: async () => ({ payments: rows, next: null }),
        resolve: async () => {
          lookups += 1
          return { id: 'stock:NVDA', venue: 'stock', symbol: 'NVDA', label: 'NVDA', name: 'NVIDIA' }
        },
        quote: async () => 25,
        refund: async () => {
          refunds += 1
        },
      })
    await run([payment('1', 'OLD')])
    const result = await run([payment('1', 'OLD'), payment('2', 'vault', 2500), payment('3', 'please vault', 100)])
    expect(result.vaulted).toBe(2)
    expect(result.refunded).toBe(0)
    expect(refunds).toBe(0)
    expect(lookups).toBe(0)
    expect(await ledger.vaultCents('ada')).toBe(2600)
    expect(await ledger.vaultCents('Ada')).toBe(2600)
    expect((await ledger.payment('2'))?.status).toBe('vaulted')
    await run([payment('1', 'OLD'), payment('2', 'vault', 2500)])
    expect(await ledger.vaultCents('ada')).toBe(2600)
    expect(await ledger.positions()).toHaveLength(0)

    await run([payment('9', 'OLD')], 'nyse')
    await run([payment('9', 'OLD'), payment('4', 'VAULT', 50)], 'nyse')
    expect(await ledger.vaultCents('ada')).toBe(2650)

    const bought = await run([payment('5', 'vault NVDA', 400)])
    expect(bought.filled).toBe(1)
    expect(await ledger.vaultCents('ada')).toBe(2650)
  })

  it('reloads an NQFX balance from the ledger file', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'larp-vault-')), 'ledger.json')
    const run = (store: ReturnType<typeof fileStore>, rows: IncomingPayment[]) =>
      ingest({
        store,
        desks: [desk],
        now: 10,
        activity: async () => ({ payments: rows, next: null }),
        resolve: async () => null,
        quote: async () => null,
        refund: async () => undefined,
      })
    const ledger = fileStore(path)
    await run(ledger, [payment('1', 'OLD')])
    await run(ledger, [payment('1', 'OLD'), payment('2', 'vault', 1500)])
    expect(await fileStore(path).vaultCents('ada')).toBe(1500)
  })

  it('launches a user stock from NQFX and files a later xit note', async () => {
    const ledger = memoryStore()
    const bob = { id: '8', screenName: 'bob', name: 'Bob', avatarUrl: null }
    const run = (rows: IncomingPayment[], search: () => Promise<never[] | Listing[]> = async () => {
      throw new Error('stock search is not used for xit notes')
    }) =>
      ingest({
        store: ledger,
        desks: [desk],
        now: 10,
        activity: async () => ({ payments: rows, next: null }),
        resolve: (note) => resolveNote(note, search, (symbol) => ledger.launchListing(symbol)),
        quote: async () => 25,
        refund: async () => undefined,
      })
    await run([payment('1', 'OLD')])
    await run([payment('1', 'OLD'), payment('2', 'vault', 5000)])
    const opened = await ledger.openLaunch({
      person: sender,
      symbol: 'xitYAMS',
      name: '  Yams  ',
      liquidityCents: 1000,
      investCents: 1000,
      now: 10,
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.launch.label).toBe('xitYAMS')
    expect(opened.launch.name).toBe('Yams')
    expect(opened.launch.cashCents).toBe(2000)
    expect(opened.launch.supply).toBeCloseTo(5)
    expect(opened.launch.price).toBeCloseTo(4)
    expect(await ledger.vaultCents('ada')).toBe(3000)
    expect((await ledger.positions())[0]?.qty).toBeCloseTo(5)
    expect((await ledger.positions())[0]?.avgPrice).toBeCloseTo(2)
    expect((await ledger.payments()).find((row) => row.id === 'ugs-YAMS-nasdaq')?.amountCents).toBe(1000)
    const poor = await ledger.openLaunch({
      person: sender,
      symbol: 'NOPE',
      name: 'Nope',
      liquidityCents: 10_000,
      investCents: 0,
      now: 11,
    })
    expect(poor.ok).toBe(false)
    const taken = await ledger.openLaunch({
      person: sender,
      symbol: 'YAMS',
      name: 'Other',
      liquidityCents: 100,
      investCents: 0,
      now: 12,
    })
    expect(taken.ok).toBe(false)
    expect(await ledger.vaultCents('ada')).toBe(3000)

    const bought = await run([payment('1', 'OLD'), payment('2', 'vault', 5000), { ...payment('3', 'xitYAMS', 1000), sender: bob }])
    expect(bought.filled).toBe(1)
    expect(bought.refunded).toBe(0)
    const quote = await ledger.launchQuote('YAMS')
    expect(quote?.price).toBeCloseTo(9)
    expect(quote?.creator).toBe('ada')
    const bobPosition = (await ledger.positions()).find((position) => position.person.screenName === 'bob')
    expect(bobPosition?.qty).toBeCloseTo(5 / 3)
    expect(bobPosition?.avgPrice).toBeCloseTo(6)
    expect(bobPosition!.qty * quote!.price).toBeCloseTo(15)
    expect(bobPosition?.label).toBe('xitYAMS')

    const missed = await run(
      [
        payment('1', 'OLD'),
        payment('2', 'vault', 5000),
        { ...payment('3', 'xitYAMS', 1000), sender: bob },
        payment('4', 'xitNOPE', 500),
        payment('5', 'YAMS', 500),
      ],
      async () => [],
    )
    expect(missed.refunded).toBe(2)
    expect(missed.filled).toBe(0)
    expect((await ledger.launchQuote('YAMS'))?.price).toBeCloseTo(9)
    const ada = (await ledger.positions()).find((position) => position.person.screenName === 'ada')
    expect(ada?.qty).toBeCloseTo(5)
    if (!ada || !quote) return
    expect(ada.qty * quote.price).toBeCloseTo(45)
    const cents = Math.round(ada.qty * quote.price * 100)
    await ledger.settleLaunch(ada, cents)
    await ledger.settleLaunch(ada, cents)
    const left = await ledger.launchQuote('YAMS')
    expect(left?.price).toBeCloseTo(1.44)
  })

  it('locks liquidity without opening a position', async () => {
    const ledger = memoryStore()
    await ledger.creditVault(
      {
        id: 'v1',
        status: 'processing',
        amountCents: 5000,
        note: 'vault',
        desk: 'nasdaq',
        senderId: sender.id,
        senderName: sender.name,
        senderScreen: sender.screenName,
        avatarUrl: null,
        detail: '',
        updatedAt: 1,
      },
      sender,
    )
    const opened = await ledger.openLaunch({
      person: sender,
      symbol: 'YAMS',
      name: 'Yams',
      liquidityCents: 2500,
      investCents: 0,
      now: 2,
    })
    expect(opened.ok).toBe(true)
    expect(await ledger.vaultCents('ada')).toBe(2500)
    expect(await ledger.positions()).toHaveLength(0)
    expect((await ledger.payments()).some((row) => row.id.startsWith('ugs-'))).toBe(false)
    expect((await ledger.launchQuote('YAMS'))?.price).toBe(1)
  })

  it('refunds a perpetual note instead of opening one', async () => {
    const ledger = memoryStore()
    let refunds = 0
    const run = (rows: IncomingPayment[]) =>
      ingest({
        store: ledger,
        desks: [desk],
        now: 10,
        activity: async () => ({ payments: rows, next: null }),
        resolve: (note) => resolveNote(note, async () => {
          throw new Error('perp notes are not searched')
        }),
        quote: async () => 25,
        refund: async () => {
          refunds += 1
        },
      })
    await run([payment('1', 'OLD')])
    const result = await run([payment('1', 'OLD'), payment('2', 'BTC-PERP'), payment('3', 'perp:kPEPE')])
    expect(result.refunded).toBe(2)
    expect(result.filled).toBe(0)
    expect(refunds).toBe(2)
    expect(await ledger.positions()).toHaveLength(0)
  })
})

describe('activity', () => {
  it('keeps received notes and like-day earnings', () => {
    const parsed = parseActivity({
      earnings: [{ day: '2026-11-24', likes: 2, cents: 100 }, { amount_cents: 1 }, { day: 'nope', likes: 1, cents: 5 }],
      data: [{ id: '7', amount_cents: 100, note: 'AAPL', direction: 'received', reversed: false, sender: { id: '2', screen_name: 'ada', name: 'Ada' } }],
      next_cursor: null,
    })
    expect(parsed.payments).toHaveLength(1)
    expect(parsed.payments[0]?.sender.screenName).toBe('ada')
    expect(parsed.earnings).toEqual([{ day: '2026-11-24', likes: 2, cents: 100 }])
  })
})

describe('pkce', () => {
  it('builds a 43 character challenge', () => {
    const pair = pkcePair()
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
