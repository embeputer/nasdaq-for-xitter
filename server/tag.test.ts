import { describe, expect, it } from 'vitest'
import { fileClose } from './book.ts'
import { REPLIES, parseCommand, withdrawKey } from './commands.ts'
import { ingest } from './ingest.ts'
import type { Listing } from './market.ts'
import { RESTRICTED_NOTE, RESTRICTED_STOCK_NOTE, type RestrictedHit } from './resolve.ts'
import { parseMentions } from './money.ts'
import { memoryStore, type PaymentRow } from './store.ts'
import { addScore, ensureScores, type TagInput, type TradeDoc } from './tag.ts'
import type { Person } from './book.ts'

async function compliantStore(screenName = 'z1xus') {
  const ledger = memoryStore()
  await ledger.acceptDisclaimer(screenName)
  return ledger
}

const person: Person = { id: 'u1', screenName: 'z1xus', name: 'z', avatarUrl: null }
const nvda: Listing = { id: 'stock:NVDA', venue: 'stock', symbol: 'NVDA', name: 'NVIDIA', label: 'NVDA' }

function pay(id: string, desk: string, amountCents: number): PaymentRow {
  return {
    id,
    status: 'processing',
    amountCents,
    note: 'vault',
    desk,
    senderId: person.id,
    senderName: person.name,
    senderScreen: person.screenName,
    avatarUrl: null,
    detail: '',
    updatedAt: 1,
  }
}

function order(postId: string, command: TagInput['command'], listing: TagInput['listing'], price: number | null, sendRoom: number | null): TagInput {
  return {
    post: { id: postId, text: `@nasdaq ${postId}`, author: person },
    desk: 'nasdaq',
    command,
    listing,
    price,
    sendRoom,
    now: 5,
  }
}

describe('tag commands', () => {
  it('parses a whole post and ignores anything else', () => {
    expect(parseCommand('@nasdaq buy NVDA 20', 'nasdaq')).toEqual({ kind: 'buy', query: 'NVDA', cents: 2000 })
    expect(parseCommand('@nasdaq buy SPY 5$', 'nasdaq')).toEqual({ kind: 'buy', query: 'SPY', cents: 500 })
    expect(parseCommand('@nasdaq withdraw 5$', 'nasdaq')).toEqual({ kind: 'withdraw', cents: 500 })
    expect(parseCommand('@NASDAQ BUY nvda $20.5', 'nasdaq')).toEqual({ kind: 'buy', query: 'nvda', cents: 2050 })
    expect(parseCommand('@nasdaq buy bitcoin cash 10', 'nasdaq')).toEqual({ kind: 'buy', query: 'bitcoin cash', cents: 1000 })
    expect(parseCommand('@nasdaq buy xitYAMS 5', 'nasdaq')).toEqual({ kind: 'buy', query: 'xitYAMS', cents: 500 })
    expect(parseCommand('@nasdaq sell NVDA', 'NYSE')).toBeNull()
    expect(parseCommand('@nyse sell NVDA', 'NYSE')).toEqual({ kind: 'sell', query: 'NVDA' })
    expect(parseCommand('@nasdaq sell NVDA 20', 'nasdaq')).toBeNull()
    expect(parseCommand('@nasdaq buy NVDA 20 please', 'nasdaq')).toBeNull()
    expect(parseCommand('@nasdaq withdraw $1.50', 'nasdaq')).toEqual({ kind: 'withdraw', cents: 150 })
    expect(parseCommand('@nasdaq withdraw $0.50', 'nasdaq')).toBeNull()
    expect(parseCommand('@nasdaq withdraw 20 extra', 'nasdaq')).toBeNull()
    expect(parseCommand('hello @nasdaq buy NVDA 20', 'nasdaq')).toBeNull()
    expect(withdrawKey('99', 0)).toMatch(/^[\w-]{8,64}$/)
  })

  it('replies with the disclaimer note until the author accepts it', async () => {
    const ledger = memoryStore()
    await ledger.creditVault(pay('a', 'nasdaq', 3000), person)
    const gated = await ledger.applyTag(order('p1', { kind: 'buy', query: 'NVDA', cents: 2000 }, nvda, 10, null))
    expect(gated).toEqual({ action: 'reply', text: REPLIES.disclaimer })
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(3000)
    expect(await ledger.positions()).toEqual([])
    await ledger.acceptDisclaimer('z1xus')
    const bought = await ledger.applyTag(order('p2', { kind: 'buy', query: 'NVDA', cents: 2000 }, nvda, 10, null))
    expect(bought).toEqual({ action: 'reply', text: REPLIES.opened })
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(1000)
  })

  it('spends only the tagged desk and does not buy twice', async () => {
    const ledger = await compliantStore()
    await ledger.creditVault(pay('a', 'nasdaq', 3000), person)
    await ledger.creditVault(pay('b', 'NYSE', 4000), person)
    const bought = await ledger.applyTag(order('p1', { kind: 'buy', query: 'NVDA', cents: 2000 }, nvda, 10, null))
    expect(bought).toEqual({ action: 'reply', text: REPLIES.opened })
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(1000)
    expect(await ledger.vaultDesk('z1xus', 'nyse')).toBe(4000)
    const row = await ledger.payment('tag:p1')
    expect(row?.status).toBe('filled')
    expect(row?.detail).toBe('stock:NVDA')
    expect(row?.amountCents).toBe(2000)
    expect((await ledger.positions())[0]?.qty).toBe(2)
    const again = await ledger.applyTag(order('p1', { kind: 'buy', query: 'NVDA', cents: 2000 }, nvda, 10, null))
    expect(again).toEqual({ action: 'reply', text: REPLIES.opened })
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(1000)
    await ledger.completeMention('p1')
    expect(await ledger.applyTag(order('p1', { kind: 'buy', query: 'NVDA', cents: 2000 }, nvda, 10, null))).toEqual({ action: 'idle' })
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(1000)
  })

  it('replies when the vault is short or the market does not resolve', async () => {
    const ledger = await compliantStore()
    await ledger.creditVault(pay('a', 'nasdaq', 50), person)
    const poor = await ledger.applyTag(order('p', { kind: 'buy', query: 'NVDA', cents: 100 }, nvda, 10, null))
    expect(poor).toEqual({ action: 'reply', text: REPLIES.poor })
    expect(await ledger.positions()).toEqual([])
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(50)
    const missed = await ledger.applyTag(order('q', { kind: 'buy', query: 'NOPE', cents: 100 }, null, null, null))
    expect(missed).toEqual({ action: 'reply', text: REPLIES.unresolved })
    const denied = await ledger.applyTag({ ...order('m', { kind: 'buy', query: 'DOGE', cents: 100 }, null, null, null), restricted: true })
    expect(denied).toEqual({ action: 'reply', text: REPLIES.restricted })
    expect(REPLIES.restricted).toBe(RESTRICTED_NOTE)
    const stock = await ledger.applyTag({
      ...order('b', { kind: 'buy', query: 'IBIT', cents: 100 }, null, null, null),
      restricted: true,
      restrictedStock: true,
    })
    expect(stock).toEqual({ action: 'reply', text: REPLIES.restrictedStock })
    expect(REPLIES.restrictedStock).toBe(RESTRICTED_STOCK_NOTE)
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(50)
    expect(await ledger.positions()).toEqual([])
    const none = await ledger.applyTag(order('s', { kind: 'sell', query: 'NVDA' }, nvda, 10, null))
    expect(none).toEqual({ action: 'reply', text: REPLIES.missing })
  })

  it('sells back into the tagged vault and keeps the position when padding is short', async () => {
    const gain = await compliantStore()
    await gain.fillPayment(pay('buy', 'nyse', 2000), { venue: 'stock', symbol: 'NVDA', name: 'NVIDIA', label: 'NVDA', person, amount: 20, price: 10, now: 1 })
    await gain.setMeta('padding:nasdaq', '5000')
    await gain.setMeta('padding:nyse', '0')
    const closed = await gain.applyTag(order('sell', { kind: 'sell', query: 'NVDA' }, nvda, 15, null))
    expect(closed).toEqual({ action: 'reply', text: REPLIES.closed })
    expect(await gain.positions()).toEqual([])
    expect(await gain.vaultDesk('z1xus', 'nasdaq')).toBe(3000)
    expect(await gain.paddingCents('nasdaq')).toBe(4000)
    expect(await gain.paddingCents('nyse')).toBe(0)
    expect((await gain.leaders())[0]?.realizedCents).toBe(1000)
    expect((await gain.leaders())[0]?.realizedCents).toBe(1000)

    const loss = await compliantStore()
    await loss.fillPayment(pay('buy', 'nasdaq', 2000), { venue: 'stock', symbol: 'NVDA', name: 'NVIDIA', label: 'NVDA', person, amount: 20, price: 10, now: 1 })
    await loss.setMeta('padding:nasdaq', '5000')
    await loss.applyTag(order('sell', { kind: 'sell', query: 'NVDA' }, nvda, 5, null))
    expect(await loss.vaultDesk('z1xus', 'nasdaq')).toBe(1000)
    expect(await loss.paddingCents('nasdaq')).toBe(6000)
    expect((await loss.leaders())[0]?.realizedCents).toBe(-1000)

    const short = await compliantStore()
    await short.fillPayment(pay('buy', 'nasdaq', 2000), { venue: 'stock', symbol: 'NVDA', name: 'NVIDIA', label: 'NVDA', person, amount: 20, price: 10, now: 1 })
    const held = await short.applyTag(order('sell', { kind: 'sell', query: 'NVDA' }, nvda, 15, null))
    expect(held).toEqual({ action: 'reply', text: REPLIES.short })
    expect(await short.positions()).toHaveLength(1)
    expect(await short.vaultDesk('z1xus', 'nasdaq')).toBe(0)
    expect(await short.paddingCents('nasdaq')).toBe(0)
  })

  it('buys a user stock at the price the deposit sets', async () => {
    const ledger = await compliantStore()
    await ledger.creditVault(pay('v', 'nasdaq', 20_000), person)
    const opened = await ledger.openLaunch({ person, symbol: 'YAMS', name: 'The Yams', liquidityCents: 10_000, investCents: 0, now: 1 })
    expect(opened.ok).toBe(true)
    const bought = await ledger.applyTag(
      order('p', { kind: 'buy', query: 'xitYAMS', cents: 10_000 }, { venue: 'launch', symbol: 'YAMS', name: 'The Yams', label: 'xitYAMS' }, null, null),
    )
    expect(bought).toEqual({ action: 'reply', text: REPLIES.opened })
    const held = (await ledger.positions())[0]
    expect(held?.qty).toBeCloseTo(50)
    expect(held?.avgPrice).toBeCloseTo(2)
    expect((await ledger.launchQuote('YAMS'))?.price).toBeCloseTo(4)
    expect(held!.qty * (await ledger.launchQuote('YAMS'))!.price).toBeCloseTo(200)
    expect((await ledger.payment('tag:p'))?.detail).toBe('launch:YAMS')
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(0)
    const sold = await ledger.applyTag(
      order('s', { kind: 'sell', query: 'xitYAMS' }, { venue: 'launch', symbol: 'YAMS', name: 'The Yams', label: 'xitYAMS' }, null, null),
    )
    expect(sold).toEqual({ action: 'reply', text: REPLIES.closed })
    expect(await ledger.positions()).toEqual([])
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(10_000)
    expect((await ledger.launchQuote('YAMS'))?.price).toBeCloseTo(1)
  })

  it('holds a withdrawal until the send lands, and restores it once if the token cannot send', async () => {
    const ledger = await compliantStore()
    await ledger.creditVault(pay('v', 'nasdaq', 5000), person)
    const held = await ledger.applyTag(order('w', { kind: 'withdraw', cents: 2000 }, null, null, 8000))
    expect(held).toEqual({ action: 'send', cents: 2000, text: REPLIES.withdrawn })
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(3000)
    expect((await ledger.mention('w'))?.status).toBe('sending')
    expect(await ledger.abortWithdraw('w')).toBe(REPLIES.short)
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(5000)
    expect(await ledger.abortWithdraw('w')).toBe(REPLIES.short)
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(5000)
    const poor = await ledger.applyTag(order('p', { kind: 'withdraw', cents: 6000 }, null, null, 8000))
    expect(poor).toEqual({ action: 'reply', text: REPLIES.poor })
    const fund = await ledger.applyTag(order('f', { kind: 'withdraw', cents: 2000 }, null, null, 100))
    expect(fund).toEqual({ action: 'reply', text: REPLIES.short })
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(5000)
  })

  it('counts each closed fill once', async () => {
    const doc: TradeDoc = {
      positions: [],
      fills: [
        {
          id: 'old',
          time: 1,
          venue: 'stock',
          symbol: 'NVDA',
          name: 'NVIDIA',
          label: 'NVDA',
          person,
          side: 'sell',
          qty: 1,
          price: 15,
          notional: 15,
          realized: 5,
        },
      ],
      payments: {},
      vaults: {},
      launches: {},
      mentions: {},
      scores: {},
      meta: {},
    }
    ensureScores(doc)
    ensureScores(doc)
    expect(doc.scores[person.id]?.cents).toBe(500)
    addScore(doc, { ...doc.fills[0]!, id: 'new', realized: 2 })
    expect(doc.scores[person.id]?.cents).toBe(700)

    const ledger = await compliantStore()
    await ledger.fillPayment(pay('buy', 'nasdaq', 1000), { venue: 'stock', symbol: 'NVDA', name: 'NVIDIA', label: 'NVDA', person, amount: 10, price: 10, now: 1 })
    await ledger.updateBook((positions) => fileClose(positions, positions[0]!.id, 12, 2))
    expect((await ledger.leaders())[0]?.realizedCents).toBe(200)
    expect((await ledger.leaders())[0]?.realizedCents).toBe(200)
    await ledger.fillPayment(pay('buy2', 'nasdaq', 1000), { venue: 'stock', symbol: 'ANT', name: 'Anthropic', label: 'ANT', person, amount: 10, price: 10, now: 3 })
    await ledger.updateBook((positions) => fileClose(positions, positions[0]!.id, 8, 4))
    expect((await ledger.leaders())[0]?.realizedCents).toBe(0)
  })
})

describe('tag ingest', () => {
  const desk = { screenName: 'nasdaq', readToken: 'read', writeToken: 'write' }

  async function book() {
    const ledger = await compliantStore()
    await ledger.setMeta('bootstrapped:nasdaq', '1')
    await ledger.setMeta('padding-ready:nasdaq', '1')
    await ledger.creditVault(pay('v', 'nasdaq', 10_000), person)
    return ledger
  }

  function run(
    ledger: ReturnType<typeof memoryStore>,
    posts: { id: string; text: string; author?: Person }[],
    hooks: {
      quote?: (id: string) => Promise<number | null>
      reply?: (text: string) => Promise<void>
      pay?: (cents: number, key: string) => Promise<void>
      wallet?: () => Promise<{ balanceCents: number; maxCents?: number } | null>
      resolve?: (note: string) => Promise<Listing | RestrictedHit | null>
    } = {},
  ) {
    const replies: string[] = []
    return ingest({
      store: ledger,
      desks: [desk],
      now: 5,
      activity: async () => ({ payments: [], next: null, earnings: [] }),
      resolve: hooks.resolve ?? (async (note) => (note.toLowerCase() === 'nvda' || note === '$NVDA' ? nvda : null)),
      quote: hooks.quote ?? (async () => 10),
      refund: async () => undefined,
      wallet: hooks.wallet ?? (async () => ({ balanceCents: 50_000, maxCents: 100_000 })),
      mentions: async () => posts.map((post) => ({ id: post.id, text: post.text, author: post.author ?? person })),
      reply: async (_token, _id, text) => {
        if (hooks.reply) await hooks.reply(text)
        replies.push(text)
      },
      pay: async (_token, _to, cents, _note, key) => {
        if (hooks.pay) await hooks.pay(cents, key)
      },
    }).then((summary) => ({ summary, replies }))
  }

  it('treats the first mention page as history', async () => {
    const ledger = await book()
    const first = await run(ledger, [{ id: 'old', text: '@nasdaq buy NVDA 20' }])
    expect(first.replies).toEqual([])
    expect(await ledger.positions()).toEqual([])
    expect((await ledger.mention('old'))?.status).toBe('skipped')
    const second = await run(ledger, [
      { id: 'old', text: '@nasdaq buy NVDA 20' },
      { id: 'new', text: '@nasdaq buy NVDA 20' },
    ])
    expect(second.replies).toEqual([REPLIES.opened])
    expect((await ledger.positions())[0]?.qty).toBe(2)
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(8000)
  })

  it('buys a skipped post whose dollars were written after the number', async () => {
    const ledger = await book()
    await ledger.setMeta('mentions-ready:nasdaq', '1')
    await ledger.seedMentions([
      { id: 'spy', desk: 'nasdaq', status: 'skipped', reply: '', cents: 0, person, updatedAt: 1 },
    ])
    const bought = await run(ledger, [{ id: 'spy', text: '@nasdaq buy NVDA 5$' }])
    expect(bought.replies).toEqual([REPLIES.opened])
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(9500)
    expect((await ledger.mention('spy'))?.status).toBe('done')
  })

  it('apologizes for a restricted coin and still closes one already held', async () => {
    const ledger = await book()
    await ledger.setMeta('mentions-ready:nasdaq', '1')
    await ledger.setMeta('padding:nasdaq', '5000')
    await ledger.fillPayment(pay('buy', 'nasdaq', 1000), {
      venue: 'crypto',
      symbol: 'DOGEUSDT',
      name: 'Dogecoin',
      label: 'DOGE',
      person,
      amount: 10,
      price: 10,
      now: 1,
    })
    const denied = await run(ledger, [{ id: 'doge', text: '@nasdaq buy DOGE 5' }], {
      resolve: async () => ({ restricted: true }),
    })
    expect(denied.replies).toEqual([REPLIES.restricted])
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(10_000)
    expect((await ledger.positions())[0]?.symbol).toBe('DOGEUSDT')
    const quoted: string[] = []
    const sold = await run(ledger, [{ id: 'sell', text: '@nasdaq sell DOGE' }], {
      resolve: async () => ({ restricted: true }),
      quote: async (id) => {
        quoted.push(id)
        return 12
      },
    })
    expect(quoted).toEqual(['crypto:DOGEUSDT'])
    expect(sold.replies).toEqual([REPLIES.closed])
    expect(await ledger.positions()).toEqual([])
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(11_200)
  })

  it('refuses a bitcoin trust and still closes one already held', async () => {
    const ledger = await book()
    await ledger.setMeta('mentions-ready:nasdaq', '1')
    await ledger.setMeta('padding:nasdaq', '5000')
    await ledger.fillPayment(pay('buy', 'nasdaq', 1000), {
      venue: 'stock',
      symbol: 'BTC',
      name: 'Grayscale Bitcoin Mini Trust ETF',
      label: 'BTC',
      person,
      amount: 10,
      price: 10,
      now: 1,
    })
    const denied = await run(ledger, [{ id: 'ibit', text: '@nasdaq buy $BTC 5' }], {
      resolve: async () => ({ restricted: true, stock: true }),
    })
    expect(denied.replies).toEqual([REPLIES.restrictedStock])
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(10_000)
    expect((await ledger.positions())[0]?.symbol).toBe('BTC')
    const quoted: string[] = []
    const sold = await run(ledger, [{ id: 'sell-btc', text: '@nasdaq sell $BTC' }], {
      resolve: async () => ({ restricted: true, stock: true }),
      quote: async (id) => {
        quoted.push(id)
        return 12
      },
    })
    expect(quoted).toEqual(['stock:BTC'])
    expect(sold.replies).toEqual([REPLIES.closed])
    expect(await ledger.positions()).toEqual([])
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(11_200)
  })

  it('stores a normal mention without replying, and retries a failed reply without buying again', async () => {
    const ledger = await book()
    await ledger.setMeta('mentions-ready:nasdaq', '1')
    const chat = await run(ledger, [{ id: 'chat', text: 'hey @nasdaq what is NVDA' }])
    expect(chat.replies).toEqual([])
    expect((await ledger.mention('chat'))?.status).toBe('skipped')
    let down = true
    const failed = await run(ledger, [{ id: 'p', text: '@nasdaq buy NVDA 5' }], {
      reply: async () => {
        if (down) throw new Error('reply_down')
      },
    })
    expect(failed.replies).toEqual([])
    expect((await ledger.mention('p'))?.status).toBe('reply')
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(9500)
    down = false
    const retried = await run(ledger, [{ id: 'p', text: '@nasdaq buy NVDA 5' }])
    expect(retried.replies).toEqual([REPLIES.opened])
    expect((await ledger.mention('p'))?.status).toBe('done')
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(9500)
  })

  it('waits for a price, then sends a withdrawal in chunks', async () => {
    const ledger = await book()
    await ledger.setMeta('mentions-ready:nasdaq', '1')
    const waiting = await run(ledger, [{ id: 'w', text: '@nasdaq buy NVDA 20' }], { quote: async () => null })
    expect(await ledger.mention('w')).toBeNull()
    expect(waiting.replies).toEqual([])
    const pays: { cents: number; key: string }[] = []
    const sent = await run(ledger, [{ id: 'out', text: '@nasdaq withdraw 30' }], {
      wallet: async () => ({ balanceCents: 50_000, maxCents: 1500 }),
      pay: async (cents, key) => {
        pays.push({ cents, key })
      },
    })
    expect(pays.map((row) => row.cents)).toEqual([1500, 1500])
    expect(new Set(pays.map((row) => row.key)).size).toBe(2)
    expect(sent.replies).toEqual([REPLIES.withdrawn])
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(7000)
    expect((await ledger.mention('out'))?.status).toBe('done')
  })

  it('puts the vault back when the write token is read-only', async () => {
    const ledger = await book()
    await ledger.setMeta('mentions-ready:nasdaq', '1')
    const result = await run(ledger, [{ id: 'out', text: '@nasdaq withdraw 20' }], {
      pay: async () => {
        const error = new Error('read_only')
        error.name = 'ReadOnlyToken'
        throw error
      },
    })
    expect(result.replies).toEqual([REPLIES.short])
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(10_000)
    expect((await ledger.mention('out'))?.status).toBe('done')
  })

  it('reads a mention page', () => {
    const posts = parseMentions({
      data: [{ id: 42, text: '@nasdaq buy NVDA 20', author: { id: 'u1', screen_name: 'z1xus', name: 'z' } }, { id: 'nope' }],
    })
    expect(posts).toEqual([{ id: '42', text: '@nasdaq buy NVDA 20', author: { id: 'u1', screenName: 'z1xus', name: 'z', avatarUrl: null } }])
  })
})
