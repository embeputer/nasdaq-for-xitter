import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileBuy, type Fill, type Order, type Person, type Position } from './book.ts'
import { ephemeralHost } from './env.ts'
import {
  cleanLaunchName,
  cleanLaunchSymbol,
  investShares,
  launchAmounts,
  launchCandles as toCandles,
  launchFailure,
  launchListing as toListing,
  launchQuote as toQuote,
  planBuy,
  planSell,
  planSpend,
  seedLaunch,
  type Launch,
  type LaunchFailure,
} from './launch.ts'
import {
  addLikes,
  addPadding,
  creditLiquidity,
  creditOnce,
  paddingKey,
  paddingReadyKey,
  readCents,
  reservedFor,
  setOpening,
  takePadding,
} from './padding.ts'
import {
  addScore,
  decideTag,
  deskVault,
  ensureScores,
  noteCash,
  placeCash,
  releaseCash,
  undoWithdraw,
  type CashHold,
  type Mention,
  type TagInput,
  type TagResult,
  type TradeDoc,
} from './tag.ts'
import type { Candle, Interval, Listing, Quote } from './market.ts'

export type PaymentStatus = 'processing' | 'filled' | 'refunded' | 'pending_refund' | 'pending_fill' | 'skipped' | 'donated' | 'vaulted'

export type Vault = {
  person: Person
  cents: number
  desks: Record<string, number>
}

export type PaymentRow = {
  id: string
  status: PaymentStatus
  amountCents: number
  note: string
  desk: string
  senderId: string
  senderName: string
  senderScreen: string
  avatarUrl: string | null
  detail: string
  updatedAt: number
}

export type SessionUser = {
  id: string
  screenName: string
  name: string
  avatarUrl: string | null
  accessToken: string
  expiresAt: number
}

export type BookUpdate = { positions: Position[]; fill: Fill | null }

export type Store = {
  positions(): Promise<Position[]>
  fills(limit: number): Promise<Fill[]>
  updateBook(change: (positions: Position[]) => BookUpdate): Promise<void>
  fillPayment(row: PaymentRow, order: Order): Promise<void>
  payment(id: string): Promise<PaymentRow | null>
  insertPayment(row: PaymentRow): Promise<boolean>
  takePayment(row: PaymentRow): Promise<'owned' | 'done' | 'busy'>
  finishPayment(row: PaymentRow): Promise<void>
  creditVault(row: PaymentRow, person: Person): Promise<void>
  vaultCents(screenName: string): Promise<number>
  launchListing(symbol: string): Promise<Listing | null>
  launchQuote(symbol: string): Promise<Quote | null>
  launchQuotes(symbols: string[]): Promise<Quote[]>
  launchCandles(symbol: string, interval: Interval): Promise<Candle[]>
  openLaunch(input: {
    person: Person
    symbol: string
    name: string
    liquidityCents: number
    investCents: number
    now: number
  }): Promise<
    { ok: true; launch: Launch } | LaunchFailure
  >
  buyLaunch(row: PaymentRow, person: Person, symbol: string, now: number): Promise<'filled' | 'missing'>
  settleLaunch(position: Position, cents: number): Promise<void>
  paddingCents(desk: string): Promise<number>
  paddingReady(desk: string): Promise<boolean>
  reservedCents(desk: string): Promise<number>
  openPadding(desk: string, balanceCents: number, reservedCents: number, likes: Record<string, number>): Promise<void>
  applyLikes(desk: string, rows: { day: string; cents: number }[]): Promise<number>
  donatePayment(row: PaymentRow): Promise<void>
  holdPayout(marker: string, plan: { reserves: { desk: string; cents: number }[] }): Promise<'held' | 'short' | 'saved'>
  creditPadding(onceKey: string, changes: { desk: string; cents: number }[]): Promise<void>
  pendingPayments(now: number): Promise<PaymentRow[]>
  payments(): Promise<PaymentRow[]>
  meta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
  mention(id: string): Promise<Mention | null>
  seedMentions(rows: Mention[]): Promise<void>
  openMentions(): Promise<Mention[]>
  applyTag(input: TagInput): Promise<TagResult>
  completeMention(id: string): Promise<void>
  ackSend(id: string): Promise<void>
  abortWithdraw(id: string): Promise<string>
  vaultDesk(screenName: string, desk: string): Promise<number>
  placeCash(person: Person, rooms: { desk: string; room: number; maxCents: number }[], cents: number, now: number): Promise<CashHold>
  noteCash(screenName: string, id: string): Promise<void>
  releaseCash(screenName: string): Promise<void>
  leaders(): Promise<{ person: Person; realizedCents: number }[]>
  session(id: string): Promise<SessionUser | null>
  saveSession(session: SessionUser): Promise<void>
  deleteSession(id: string): Promise<void>
}

type Doc = {
  positions: Position[]
  fills: Fill[]
  payments: Record<string, PaymentRow>
  vaults: Record<string, Vault>
  launches: Record<string, Launch>
  sessions: Record<string, SessionUser>
  mentions: Record<string, Mention>
  scores: Record<string, { person: Person; cents: number }>
  meta: Record<string, string>
}

const TERMINAL = new Set<PaymentStatus>(['filled', 'refunded', 'skipped', 'donated', 'vaulted'])

export function memoryStore(): Store {
  const doc = emptyDoc()
  return storeFrom(
    () => doc,
    (next) => {
      doc.positions = next.positions
      doc.fills = next.fills
      doc.payments = next.payments
      doc.vaults = next.vaults
      doc.launches = next.launches
      doc.sessions = next.sessions
      doc.mentions = next.mentions
      doc.scores = next.scores
      doc.meta = next.meta
    },
  )
}

export function fileStore(path: string): Store {
  const doc = readDoc(path)
  let chain = Promise.resolve()
  const lock = <T,>(run: () => Promise<T>): Promise<T> => {
    const result = chain.then(run, run)
    chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  return storeFrom(
    () => structuredClone(doc),
    (next) => {
      doc.positions = next.positions
      doc.fills = next.fills
      doc.payments = next.payments
      doc.vaults = next.vaults
      doc.launches = next.launches
      doc.sessions = next.sessions
      doc.mentions = next.mentions
      doc.scores = next.scores
      doc.meta = next.meta
      writeDoc(path, doc)
    },
    lock,
  )
}

function storeFrom(
  read: () => Doc,
  write: (doc: Doc) => void | Promise<void>,
  lock: <T>(run: () => Promise<T>) => Promise<T> = (run) => run(),
): Store {
  async function edit(change: (doc: Doc) => void): Promise<Doc> {
    return lock(async () => {
      const doc = read()
      change(doc)
      await write(doc)
      return doc
    })
  }
  return {
    async positions() {
      return read().positions
    },
    async fills(limit) {
      return read()
        .fills.slice()
        .sort((a, b) => b.time - a.time)
        .slice(0, limit)
    },
    async updateBook(change) {
      await edit((doc) => {
        ensureScores(doc)
        const next = change(doc.positions)
        doc.positions = next.positions
        const fill = next.fill
        if (fill && !doc.fills.some((item) => item.id === fill.id)) {
          doc.fills = [fill, ...doc.fills].slice(0, 400)
          addScore(doc, fill)
        }
      })
    },
    async fillPayment(row, order) {
      await edit((doc) => {
        const next = fileBuy(doc.positions, order)
        doc.positions = next.positions
        doc.fills = [next.fill, ...doc.fills].slice(0, 400)
        doc.payments[row.id] = {
          ...row,
          status: 'filled',
          detail: `${order.venue}:${order.symbol}`,
          updatedAt: row.updatedAt,
        }
      })
    },
    async payment(id) {
      return read().payments[id] ?? null
    },
    async insertPayment(row) {
      const doc = read()
      if (doc.payments[row.id]) return false
      await edit((current) => {
        if (!current.payments[row.id]) current.payments[row.id] = row
      })
      return read().payments[row.id]?.status === row.status
    },
    async takePayment(row) {
      const existing = read().payments[row.id]
      if (!existing) {
        await edit((doc) => {
          doc.payments[row.id] = { ...row, status: 'processing' }
        })
        return 'owned'
      }
      if (TERMINAL.has(existing.status)) return 'done'
      const stale = existing.status === 'processing' && row.updatedAt - existing.updatedAt > 120_000
      const retry = existing.status === 'pending_refund' || existing.status === 'pending_fill' || stale
      if (!retry) return 'busy'
      await edit((doc) => {
        const current = doc.payments[row.id]
        if (!current) return
        doc.payments[row.id] = { ...current, status: 'processing', updatedAt: row.updatedAt }
      })
      return 'owned'
    },
    async finishPayment(row) {
      await edit((doc) => {
        doc.payments[row.id] = row
      })
    },
    async creditVault(row, person) {
      await edit((doc) => {
        const current = doc.payments[row.id]
        if (current?.status === 'vaulted') return
        const key = person.id || person.screenName.toLowerCase()
        const existing = doc.vaults[key] ?? { person, cents: 0, desks: {} }
        const desk = row.desk.toLowerCase()
        doc.vaults[key] = {
          person,
          cents: existing.cents + row.amountCents,
          desks: { ...existing.desks, [desk]: (existing.desks[desk] ?? 0) + row.amountCents },
        }
        doc.payments[row.id] = { ...row, status: 'vaulted', detail: 'vault' }
      })
    },
    async vaultCents(screenName) {
      const name = screenName.toLowerCase()
      return Object.values(read().vaults).reduce(
        (sum, vault) => (vault.person.screenName.toLowerCase() === name ? sum + vault.cents : sum),
        0,
      )
    },
    async launchListing(symbol) {
      const launch = read().launches[symbol]
      return launch ? toListing(launch) : null
    },
    async launchQuote(symbol) {
      const launch = read().launches[symbol]
      return launch ? toQuote(launch, Date.now()) : null
    },
    async launchQuotes(symbols) {
      const now = Date.now()
      return symbols.flatMap((symbol) => {
        const launch = read().launches[symbol]
        const quote = launch ? toQuote(launch, now) : null
        return quote ? [quote] : []
      })
    },
    async launchCandles(symbol, interval) {
      const launch = read().launches[symbol]
      return launch ? toCandles(launch, interval) : []
    },
    async openLaunch(input) {
      let result: { ok: true; launch: Launch } | LaunchFailure = launchFailure('small')
      await edit((doc) => {
        const symbol = cleanLaunchSymbol(input.symbol)
        const name = cleanLaunchName(input.name)
        const screenName = input.person.screenName.trim().replace(/^@/, '')
        if (!symbol) {
          result = launchFailure('bad_symbol')
          return
        }
        if (!name || !screenName) {
          result = launchFailure('bad_name')
          return
        }
        const amounts = launchAmounts(input.liquidityCents, input.investCents)
        if (!('liquidityCents' in amounts)) {
          result = amounts
          return
        }
        if (doc.launches[symbol]) {
          result = launchFailure('taken')
          return
        }
        const spent = planSpend(vaultRecords(doc, screenName), amounts.liquidityCents + amounts.investCents)
        if (!spent) {
          result = launchFailure('poor')
          return
        }
        const person = { ...input.person, screenName }
        const launch = seedLaunch(person, symbol, name, amounts.liquidityCents, amounts.investCents, input.now)
        const bought =
          amounts.investCents > 0
            ? fileBuy(doc.positions, {
                venue: 'launch',
                symbol,
                name,
                label: launch.label,
                person,
                amount: amounts.investCents / 100,
                price: 1,
                now: input.now,
              })
            : null
        for (const row of spent.next) {
          const existing = doc.vaults[row.key]
          if (!existing) continue
          doc.vaults[row.key] = { ...existing, cents: row.cents, desks: row.desks }
        }
        doc.launches[symbol] = launch
        for (const spend of investShares(spent.spends, amounts.investCents)) {
          const id = `ugs-${symbol}-${spend.desk}`
          doc.payments[id] = {
            id,
            status: 'filled',
            amountCents: spend.cents,
            note: launch.label,
            desk: spend.desk,
            senderId: person.id,
            senderName: person.name,
            senderScreen: screenName,
            avatarUrl: person.avatarUrl,
            detail: `launch:${symbol}`,
            updatedAt: input.now,
          }
        }
        if (bought) {
          doc.positions = bought.positions
          doc.fills = [bought.fill, ...doc.fills].slice(0, 400)
        }
        creditLiquidity(doc.meta, spent.spends, amounts.liquidityCents, amounts.investCents)
        result = { ok: true, launch }
      })
      return result
    },
    async buyLaunch(row, person, symbol, now) {
      let result: 'filled' | 'missing' = 'missing'
      await edit((doc) => {
        if (doc.payments[row.id]?.status === 'filled') {
          result = 'filled'
          return
        }
        const launch = doc.launches[symbol]
        const planned = launch ? planBuy(launch, row.amountCents, now) : null
        if (!launch || !planned) {
          result = 'missing'
          return
        }
        const screenName = person.screenName.trim().replace(/^@/, '')
        const bought = fileBuy(doc.positions, {
          venue: 'launch',
          symbol,
          name: launch.name,
          label: launch.label,
          person: { ...person, screenName },
          amount: row.amountCents / 100,
          price: planned.fillPrice,
          now,
        })
        doc.launches[symbol] = planned.launch
        doc.positions = bought.positions
        doc.fills = [bought.fill, ...doc.fills].slice(0, 400)
        doc.payments[row.id] = { ...row, status: 'filled', detail: `launch:${symbol}`, updatedAt: now }
        result = 'filled'
      })
      return result
    },
    async settleLaunch(position, cents) {
      if (position.venue !== 'launch') return
      const key = `settled-launch:${position.id}:${position.openedAt}`
      await edit((doc) => {
        if (doc.meta[key]) return
        const launch = doc.launches[position.symbol]
        if (launch) doc.launches[position.symbol] = planSell(launch, position.qty, cents, Date.now())
        doc.meta[key] = '1'
      })
    },
    async paddingCents(desk) {
      return readCents(read().meta[paddingKey(desk)])
    },
    async paddingReady(desk) {
      return read().meta[paddingReadyKey(desk)] === '1'
    },
    async reservedCents(desk) {
      const doc = read()
      return reservedFor(desk, {
        vaults: Object.values(doc.vaults),
        positions: doc.positions.map((position) => ({
          venue: position.venue,
          symbol: position.symbol,
          screenName: position.person.screenName,
        })),
        payments: Object.values(doc.payments).map((row) => ({
          status: row.status,
          desk: row.desk,
          detail: row.detail,
          amountCents: row.amountCents,
          screenName: row.senderScreen,
        })),
      })
    },
    async openPadding(desk, balanceCents, reserved, likes) {
      await edit((doc) => {
        setOpening(doc.meta, desk, balanceCents, reserved, likes)
      })
    },
    async applyLikes(desk, rows) {
      let added = 0
      await edit((doc) => {
        added = addLikes(doc.meta, desk, rows)
      })
      return added
    },
    async donatePayment(row) {
      await edit((doc) => {
        if (doc.payments[row.id]?.status === 'donated') return
        doc.payments[row.id] = { ...row, status: 'donated', detail: 'donation' }
        addPadding(doc.meta, row.desk, row.amountCents)
      })
    },
    async holdPayout(marker, plan) {
      let result: 'held' | 'short' | 'saved' = 'short'
      await edit((doc) => {
        if (doc.meta[marker]) {
          result = 'saved'
          return
        }
        if (!takePadding(doc.meta, plan.reserves)) {
          result = 'short'
          return
        }
        doc.meta[marker] = JSON.stringify(plan)
        result = 'held'
      })
      return result
    },
    async creditPadding(onceKey, changes) {
      await edit((doc) => {
        creditOnce(doc.meta, onceKey, changes)
      })
    },
    async pendingPayments(now) {
      return Object.values(read().payments).filter(
        (row) =>
          row.status === 'pending_refund' ||
          row.status === 'pending_fill' ||
          (row.status === 'processing' && now - row.updatedAt > 120_000),
      )
    },
    async payments() {
      return Object.values(read().payments)
    },
    async meta(key) {
      return read().meta[key] ?? null
    },
    async setMeta(key, value) {
      await edit((doc) => {
        doc.meta[key] = value
      })
    },
    async mention(id) {
      return read().mentions[id] ?? null
    },
    async seedMentions(rows) {
      if (!rows.length) return
      await edit((doc) => {
        for (const row of rows) {
          if (!doc.mentions[row.id]) doc.mentions[row.id] = row
        }
      })
    },
    async openMentions() {
      return Object.values(read().mentions).filter((row) => row.status === 'reply' || row.status === 'sending')
    },
    async applyTag(input) {
      let result: TagResult = { action: 'idle' }
      await edit((doc) => {
        result = decideTag(doc, input)
      })
      return result
    },
    async completeMention(id) {
      await edit((doc) => {
        const row = doc.mentions[id]
        if (!row) return
        doc.mentions[id] = { ...row, status: 'done', updatedAt: Date.now() }
      })
    },
    async ackSend(id) {
      await edit((doc) => {
        const row = doc.mentions[id]
        if (!row || row.status !== 'sending') return
        doc.mentions[id] = { ...row, status: 'reply', updatedAt: Date.now() }
      })
    },
    async abortWithdraw(id) {
      let text = ''
      await edit((doc) => {
        text = undoWithdraw(doc, id, Date.now())
      })
      return text
    },
    async vaultDesk(screenName, desk) {
      return deskVault(read(), screenName, desk)
    },
    async placeCash(person, rooms, cents, now) {
      let result: CashHold = { action: 'poor' }
      await edit((doc) => {
        result = placeCash(doc, person, rooms, cents, now)
      })
      return result
    },
    async noteCash(screenName, id) {
      await edit((doc) => noteCash(doc, screenName, id))
    },
    async releaseCash(screenName) {
      await edit((doc) => releaseCash(doc, screenName))
    },
    async leaders() {
      if (read().meta['scores-ready'] !== '1') await edit((doc) => ensureScores(doc))
      return Object.values(read().scores).map((score) => ({ person: score.person, realizedCents: score.cents }))
    },
    async session(id) {
      const found = read().sessions[id]
      if (!found) return null
      if (found.expiresAt <= Date.now()) {
        await edit((doc) => {
          delete doc.sessions[id]
        })
        return null
      }
      return found
    },
    async saveSession(session) {
      await edit((doc) => {
        doc.sessions[session.id] = session
      })
    },
    async deleteSession(id) {
      await edit((doc) => {
        delete doc.sessions[id]
      })
    },
  }
}

let singleton: Promise<Store> | null = null

export function store(): Promise<Store> {
  if (!singleton) singleton = openStore()
  return singleton
}

export function durableStorage(): boolean {
  if (process.env.POSTGRES_URL || process.env.DATABASE_URL) return true
  return !ephemeralHost()
}

async function openStore(): Promise<Store> {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL || ''
  if (url) return postgresStore(url)
  return fileStore(process.env.LEDGER_FILE || '.data/ledger.json')
}

async function postgresStore(url: string): Promise<Store> {
  const postgres = (await import('postgres')).default
  const globalSql = globalThis as { larpSql?: ReturnType<typeof postgres> }
  const sql =
    globalSql.larpSql ??
    postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 15,
    })
  globalSql.larpSql = sql
  await sql`
    create table if not exists larp_positions (id text primary key, body jsonb not null);
    create table if not exists larp_fills (id text primary key, time bigint not null, body jsonb not null);
    create table if not exists larp_payments (
      id text primary key,
      status text not null,
      updated_at bigint not null,
      body jsonb not null
    );
    create table if not exists larp_sessions (id text primary key, expires_at bigint not null, body jsonb not null);
    create table if not exists larp_meta (key text primary key, value text not null);
    create table if not exists larp_vaults (id text primary key, body jsonb not null);
    create table if not exists larp_launches (id text primary key, body jsonb not null);
    create table if not exists larp_mentions (id text primary key, body jsonb not null);
    create table if not exists larp_scores (id text primary key, body jsonb not null);
  `
  const positions = async () => {
    const rows = await sql<{ body: Position }[]>`select body from larp_positions`
    return rows.map((row) => row.body)
  }
  async function changeMeta(change: (meta: Record<string, string>) => void): Promise<void> {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(847211)`
      const rows = await tx<{ key: string; value: string }[]>`select key, value from larp_meta`
      const meta: Record<string, string> = {}
      for (const row of rows) meta[row.key] = row.value
      const before = { ...meta }
      change(meta)
      for (const [key, value] of Object.entries(meta)) {
        if (before[key] === value) continue
        await tx`
          insert into larp_meta (key, value) values (${key}, ${value})
          on conflict (key) do update set value = excluded.value
        `
      }
    })
  }
  async function editTrade(change: (doc: TradeDoc) => void): Promise<void> {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(847211)`
      const before = await readTrade()
      const after = structuredClone(before)
      change(after)
      await writeTrade(before, after)

      async function readTrade(): Promise<TradeDoc> {
        const positionRows = await tx<{ body: Position }[]>`select body from larp_positions`
        const fillRows = await tx<{ body: Fill }[]>`select body from larp_fills`
        const paymentRows = await tx<{ body: PaymentRow }[]>`select body from larp_payments`
        const vaultRows = await tx<{ id: string; body: Vault }[]>`select id, body from larp_vaults`
        const launchRows = await tx<{ id: string; body: Launch }[]>`select id, body from larp_launches`
        const mentionRows = await tx<{ body: Mention }[]>`select body from larp_mentions`
        const scoreRows = await tx<{ id: string; body: { person: Person; cents: number } }[]>`select id, body from larp_scores`
        const metaRows = await tx<{ key: string; value: string }[]>`select key, value from larp_meta`
        const payments: TradeDoc['payments'] = {}
        for (const row of paymentRows) payments[row.body.id] = row.body
        const vaults: TradeDoc['vaults'] = {}
        for (const row of vaultRows) vaults[row.id] = row.body
        const launches: TradeDoc['launches'] = {}
        for (const row of launchRows) launches[row.id] = row.body
        const mentions: TradeDoc['mentions'] = {}
        for (const row of mentionRows) mentions[row.body.id] = row.body
        const scores: TradeDoc['scores'] = {}
        for (const row of scoreRows) scores[row.id] = row.body
        const meta: Record<string, string> = {}
        for (const row of metaRows) meta[row.key] = row.value
        return {
          positions: positionRows.map((row) => row.body),
          fills: fillRows.map((row) => row.body),
          payments,
          vaults,
          launches,
          mentions,
          scores,
          meta,
        }
      }

      async function writeTrade(prev: TradeDoc, next: TradeDoc) {
        if (JSON.stringify(prev.positions) !== JSON.stringify(next.positions)) {
          await tx`delete from larp_positions`
          for (const position of next.positions) {
            await tx`insert into larp_positions (id, body) values (${position.id}, ${tx.json(position as never)})`
          }
        }
        if (JSON.stringify(prev.fills) !== JSON.stringify(next.fills)) {
          const kept = new Set(next.fills.map((fill) => fill.id))
          for (const fill of prev.fills) {
            if (!kept.has(fill.id)) await tx`delete from larp_fills where id = ${fill.id}`
          }
          const prior = new Map(prev.fills.map((fill) => [fill.id, fill]))
          for (const fill of next.fills) {
            if (JSON.stringify(prior.get(fill.id)) === JSON.stringify(fill)) continue
            await tx`
              insert into larp_fills (id, time, body) values (${fill.id}, ${fill.time}, ${tx.json(fill as never)})
              on conflict (id) do update set time = excluded.time, body = excluded.body
            `
          }
        }
        for (const row of Object.values(next.payments)) {
          if (JSON.stringify(prev.payments[row.id]) === JSON.stringify(row)) continue
          await tx`
            insert into larp_payments (id, status, updated_at, body)
            values (${row.id}, ${row.status}, ${row.updatedAt}, ${tx.json(row as never)})
            on conflict (id) do update set status = excluded.status, updated_at = excluded.updated_at, body = excluded.body
          `
        }
        for (const [id, vault] of Object.entries(next.vaults)) {
          if (JSON.stringify(prev.vaults[id]) === JSON.stringify(vault)) continue
          await tx`
            insert into larp_vaults (id, body) values (${id}, ${tx.json(vault as never)})
            on conflict (id) do update set body = excluded.body
          `
        }
        for (const id of Object.keys(prev.vaults)) {
          if (!next.vaults[id]) await tx`delete from larp_vaults where id = ${id}`
        }
        for (const [id, launch] of Object.entries(next.launches)) {
          if (JSON.stringify(prev.launches[id]) === JSON.stringify(launch)) continue
          await tx`
            insert into larp_launches (id, body) values (${id}, ${tx.json(launch as never)})
            on conflict (id) do update set body = excluded.body
          `
        }
        for (const id of Object.keys(prev.launches)) {
          if (!next.launches[id]) await tx`delete from larp_launches where id = ${id}`
        }
        for (const mention of Object.values(next.mentions)) {
          if (JSON.stringify(prev.mentions[mention.id]) === JSON.stringify(mention)) continue
          await tx`
            insert into larp_mentions (id, body) values (${mention.id}, ${tx.json(mention as never)})
            on conflict (id) do update set body = excluded.body
          `
        }
        for (const scoreId of Object.keys(prev.scores)) {
          if (!next.scores[scoreId]) await tx`delete from larp_scores where id = ${scoreId}`
        }
        for (const [id, score] of Object.entries(next.scores)) {
          if (JSON.stringify(prev.scores[id]) === JSON.stringify(score)) continue
          await tx`
            insert into larp_scores (id, body) values (${id}, ${tx.json(score as never)})
            on conflict (id) do update set body = excluded.body
          `
        }
        for (const [key, value] of Object.entries(next.meta)) {
          if (prev.meta[key] === value) continue
          await tx`
            insert into larp_meta (key, value) values (${key}, ${value})
            on conflict (key) do update set value = excluded.value
          `
        }
        for (const key of Object.keys(prev.meta)) {
          if (!(key in next.meta)) await tx`delete from larp_meta where key = ${key}`
        }
      }
    })
  }
  return {
    positions,
    async fills(limit) {
      const rows = await sql<{ body: Fill }[]>`select body from larp_fills order by time desc limit ${limit}`
      return rows.map((row) => row.body)
    },
    async updateBook(change) {
      await editTrade((doc) => {
        ensureScores(doc)
        const next = change(doc.positions)
        doc.positions = next.positions
        const fill = next.fill
        if (fill && !doc.fills.some((item) => item.id === fill.id)) {
          doc.fills = [fill, ...doc.fills].slice(0, 400)
          addScore(doc, fill)
        }
      })
    },
    async fillPayment(row, order) {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(847211)`
        const rows = await tx<{ body: Position }[]>`select body from larp_positions`
        const next = fileBuy(rows.map((item) => item.body), order)
        await tx`delete from larp_positions`
        for (const position of next.positions) {
          await tx`insert into larp_positions (id, body) values (${position.id}, ${tx.json(position as never)})`
        }
        await tx`insert into larp_fills (id, time, body) values (${next.fill.id}, ${next.fill.time}, ${tx.json(next.fill as never)}) on conflict (id) do nothing`
        const filled = { ...row, status: 'filled' as const, detail: `${order.venue}:${order.symbol}` }
        await tx`
          insert into larp_payments (id, status, updated_at, body)
          values (${filled.id}, ${filled.status}, ${filled.updatedAt}, ${tx.json(filled as never)})
          on conflict (id) do update set status = excluded.status, updated_at = excluded.updated_at, body = excluded.body
        `
      })
    },
    async payment(id) {
      const rows = await sql<{ body: PaymentRow }[]>`select body from larp_payments where id = ${id}`
      return rows[0]?.body ?? null
    },
    async insertPayment(row) {
      const rows = await sql<{ id: string }[]>`
        insert into larp_payments (id, status, updated_at, body)
        values (${row.id}, ${row.status}, ${row.updatedAt}, ${sql.json(row as never)})
        on conflict (id) do nothing
        returning id
      `
      return rows.length > 0
    },
    async takePayment(row) {
      return sql.begin(async (tx) => {
        const rows = await tx<{ body: PaymentRow }[]>`select body from larp_payments where id = ${row.id} for update`
        const existing = rows[0]?.body
        if (!existing) {
          const owned = { ...row, status: 'processing' as const }
          await tx`
            insert into larp_payments (id, status, updated_at, body)
            values (${owned.id}, ${owned.status}, ${owned.updatedAt}, ${tx.json(owned as never)})
          `
          return 'owned' as const
        }
        if (TERMINAL.has(existing.status)) return 'done' as const
        const stale = existing.status === 'processing' && row.updatedAt - existing.updatedAt > 120_000
        const retry = existing.status === 'pending_refund' || existing.status === 'pending_fill' || stale
        if (!retry) return 'busy' as const
        const owned = { ...existing, status: 'processing' as const, updatedAt: row.updatedAt }
        await tx`update larp_payments set status = ${owned.status}, updated_at = ${owned.updatedAt}, body = ${tx.json(owned as never)} where id = ${owned.id}`
        return 'owned' as const
      })
    },
    async finishPayment(row) {
      await sql`
        insert into larp_payments (id, status, updated_at, body)
        values (${row.id}, ${row.status}, ${row.updatedAt}, ${sql.json(row as never)})
        on conflict (id) do update set status = excluded.status, updated_at = excluded.updated_at, body = excluded.body
      `
    },
    async creditVault(row, person) {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(847211)`
        const rows = await tx<{ body: PaymentRow }[]>`select body from larp_payments where id = ${row.id} for update`
        if (rows[0]?.body.status === 'vaulted') return
        const key = person.id || person.screenName.toLowerCase()
        const found = await tx<{ body: Vault }[]>`select body from larp_vaults where id = ${key} for update`
        const existing = found[0]?.body ?? { person, cents: 0, desks: {} }
        const desk = row.desk.toLowerCase()
        const next: Vault = {
          person,
          cents: existing.cents + row.amountCents,
          desks: { ...existing.desks, [desk]: (existing.desks[desk] ?? 0) + row.amountCents },
        }
        await tx`
          insert into larp_vaults (id, body) values (${key}, ${tx.json(next as never)})
          on conflict (id) do update set body = excluded.body
        `
        const saved = { ...row, status: 'vaulted' as const, detail: 'vault' }
        await tx`
          insert into larp_payments (id, status, updated_at, body)
          values (${saved.id}, ${saved.status}, ${saved.updatedAt}, ${tx.json(saved as never)})
          on conflict (id) do update set status = excluded.status, updated_at = excluded.updated_at, body = excluded.body
        `
      })
    },
    async vaultCents(screenName) {
      const rows = await sql<{ body: Vault }[]>`select body from larp_vaults`
      const name = screenName.toLowerCase()
      return rows.reduce((sum, row) => (row.body.person.screenName.toLowerCase() === name ? sum + row.body.cents : sum), 0)
    },
    async launchListing(symbol) {
      const rows = await sql<{ body: Launch }[]>`select body from larp_launches where id = ${symbol}`
      return rows[0] ? toListing(rows[0].body) : null
    },
    async launchQuote(symbol) {
      const rows = await sql<{ body: Launch }[]>`select body from larp_launches where id = ${symbol}`
      return rows[0] ? toQuote(rows[0].body, Date.now()) : null
    },
    async launchQuotes(symbols) {
      if (!symbols.length) return []
      const rows = await sql<{ body: Launch }[]>`select body from larp_launches where id in ${sql(symbols)}`
      const now = Date.now()
      return rows.flatMap((row) => {
        const quote = toQuote(row.body, now)
        return quote ? [quote] : []
      })
    },
    async launchCandles(symbol, interval) {
      const rows = await sql<{ body: Launch }[]>`select body from larp_launches where id = ${symbol}`
      return rows[0] ? toCandles(rows[0].body, interval) : []
    },
    async openLaunch(input) {
      const symbol = cleanLaunchSymbol(input.symbol)
      const name = cleanLaunchName(input.name)
      const screenName = input.person.screenName.trim().replace(/^@/, '')
      if (!symbol) return launchFailure('bad_symbol')
      if (!name || !screenName) return launchFailure('bad_name')
      const amounts = launchAmounts(input.liquidityCents, input.investCents)
      if (!('liquidityCents' in amounts)) return amounts
      return sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(847211)`
        const existing = await tx<{ body: Launch }[]>`select body from larp_launches where id = ${symbol} for update`
        if (existing[0]) return launchFailure('taken')
        const vaultRows = await tx<{ id: string; body: Vault }[]>`select id, body from larp_vaults for update`
        const records = vaultRows
          .filter((row) => row.body.person.screenName.toLowerCase() === screenName.toLowerCase())
          .map((row) => ({ key: row.id, desks: row.body.desks }))
        const spent = planSpend(records, amounts.liquidityCents + amounts.investCents)
        if (!spent) return launchFailure('poor')
        const person = { ...input.person, screenName }
        const launch = seedLaunch(person, symbol, name, amounts.liquidityCents, amounts.investCents, input.now)
        const positions = await tx<{ body: Position }[]>`select body from larp_positions`
        const bought =
          amounts.investCents > 0
            ? fileBuy(positions.map((row) => row.body), {
                venue: 'launch',
                symbol,
                name,
                label: launch.label,
                person,
                amount: amounts.investCents / 100,
                price: 1,
                now: input.now,
              })
            : null
        for (const row of spent.next) {
          const body = vaultRows.find((item) => item.id === row.key)?.body
          if (!body) continue
          const next = { ...body, cents: row.cents, desks: row.desks }
          await tx`update larp_vaults set body = ${tx.json(next as never)} where id = ${row.key}`
        }
        await tx`insert into larp_launches (id, body) values (${symbol}, ${tx.json(launch as never)})`
        for (const spend of investShares(spent.spends, amounts.investCents)) {
          const id = `ugs-${symbol}-${spend.desk}`
          const payment: PaymentRow = {
            id,
            status: 'filled',
            amountCents: spend.cents,
            note: launch.label,
            desk: spend.desk,
            senderId: person.id,
            senderName: person.name,
            senderScreen: screenName,
            avatarUrl: person.avatarUrl,
            detail: `launch:${symbol}`,
            updatedAt: input.now,
          }
          await tx`
            insert into larp_payments (id, status, updated_at, body)
            values (${payment.id}, ${payment.status}, ${payment.updatedAt}, ${tx.json(payment as never)})
            on conflict (id) do update set status = excluded.status, updated_at = excluded.updated_at, body = excluded.body
          `
        }
        if (bought) {
          await tx`delete from larp_positions`
          for (const position of bought.positions) {
            await tx`insert into larp_positions (id, body) values (${position.id}, ${tx.json(position as never)})`
          }
          await tx`insert into larp_fills (id, time, body) values (${bought.fill.id}, ${bought.fill.time}, ${tx.json(bought.fill as never)}) on conflict (id) do nothing`
        }
        const metaRows = await tx<{ key: string; value: string }[]>`select key, value from larp_meta`
        const meta: Record<string, string> = {}
        for (const row of metaRows) meta[row.key] = row.value
        const before = { ...meta }
        creditLiquidity(meta, spent.spends, amounts.liquidityCents, amounts.investCents)
        for (const [key, value] of Object.entries(meta)) {
          if (before[key] === value) continue
          await tx`
            insert into larp_meta (key, value) values (${key}, ${value})
            on conflict (key) do update set value = excluded.value
          `
        }
        return { ok: true as const, launch }
      })
    },
    async buyLaunch(row, person, symbol, now) {
      return sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(847211)`
        const payments = await tx<{ body: PaymentRow }[]>`select body from larp_payments where id = ${row.id} for update`
        if (payments[0]?.body.status === 'filled') return 'filled' as const
        const found = await tx<{ body: Launch }[]>`select body from larp_launches where id = ${symbol} for update`
        const launch = found[0]?.body
        const planned = launch ? planBuy(launch, row.amountCents, now) : null
        if (!launch || !planned) return 'missing' as const
        const screenName = person.screenName.trim().replace(/^@/, '')
        const positions = await tx<{ body: Position }[]>`select body from larp_positions`
        const bought = fileBuy(positions.map((item) => item.body), {
          venue: 'launch',
          symbol,
          name: launch.name,
          label: launch.label,
          person: { ...person, screenName },
          amount: row.amountCents / 100,
          price: planned.fillPrice,
          now,
        })
        await tx`update larp_launches set body = ${tx.json(planned.launch as never)} where id = ${symbol}`
        await tx`delete from larp_positions`
        for (const position of bought.positions) {
          await tx`insert into larp_positions (id, body) values (${position.id}, ${tx.json(position as never)})`
        }
        await tx`insert into larp_fills (id, time, body) values (${bought.fill.id}, ${bought.fill.time}, ${tx.json(bought.fill as never)}) on conflict (id) do nothing`
        const filled = { ...row, status: 'filled' as const, detail: `launch:${symbol}`, updatedAt: now }
        await tx`
          insert into larp_payments (id, status, updated_at, body)
          values (${filled.id}, ${filled.status}, ${filled.updatedAt}, ${tx.json(filled as never)})
          on conflict (id) do update set status = excluded.status, updated_at = excluded.updated_at, body = excluded.body
        `
        return 'filled' as const
      })
    },
    async settleLaunch(position, cents) {
      if (position.venue !== 'launch') return
      const key = `settled-launch:${position.id}:${position.openedAt}`
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(847211)`
        const marked = await tx<{ value: string }[]>`select value from larp_meta where key = ${key}`
        if (marked[0]) return
        const found = await tx<{ body: Launch }[]>`select body from larp_launches where id = ${position.symbol} for update`
        const launch = found[0]?.body
        if (launch) {
          const next = planSell(launch, position.qty, cents, Date.now())
          await tx`update larp_launches set body = ${tx.json(next as never)} where id = ${position.symbol}`
        }
        await tx`
          insert into larp_meta (key, value) values (${key}, '1')
          on conflict (key) do update set value = excluded.value
        `
      })
    },
    async paddingCents(desk) {
      const rows = await sql<{ value: string }[]>`select value from larp_meta where key = ${paddingKey(desk)}`
      return readCents(rows[0]?.value)
    },
    async paddingReady(desk) {
      const rows = await sql<{ value: string }[]>`select value from larp_meta where key = ${paddingReadyKey(desk)}`
      return rows[0]?.value === '1'
    },
    async reservedCents(desk) {
      const [vaults, positions, payments] = await Promise.all([
        sql<{ body: Vault }[]>`select body from larp_vaults`,
        sql<{ body: Position }[]>`select body from larp_positions`,
        sql<{ body: PaymentRow }[]>`select body from larp_payments`,
      ])
      return reservedFor(desk, {
        vaults: vaults.map((row) => row.body),
        positions: positions.map((row) => ({
          venue: row.body.venue,
          symbol: row.body.symbol,
          screenName: row.body.person.screenName,
        })),
        payments: payments.map((row) => ({
          status: row.body.status,
          desk: row.body.desk,
          detail: row.body.detail,
          amountCents: row.body.amountCents,
          screenName: row.body.senderScreen,
        })),
      })
    },
    async openPadding(desk, balanceCents, reserved, likes) {
      await changeMeta((meta) => {
        setOpening(meta, desk, balanceCents, reserved, likes)
      })
    },
    async applyLikes(desk, rows) {
      let added = 0
      await changeMeta((meta) => {
        added = addLikes(meta, desk, rows)
      })
      return added
    },
    async donatePayment(row) {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(847211)`
        const found = await tx<{ body: PaymentRow }[]>`select body from larp_payments where id = ${row.id} for update`
        if (found[0]?.body.status === 'donated') return
        const saved = { ...row, status: 'donated' as const, detail: 'donation' }
        await tx`
          insert into larp_payments (id, status, updated_at, body)
          values (${saved.id}, ${saved.status}, ${saved.updatedAt}, ${tx.json(saved as never)})
          on conflict (id) do update set status = excluded.status, updated_at = excluded.updated_at, body = excluded.body
        `
        const metaRows = await tx<{ key: string; value: string }[]>`select key, value from larp_meta`
        const meta: Record<string, string> = {}
        for (const item of metaRows) meta[item.key] = item.value
        const before = { ...meta }
        addPadding(meta, row.desk, row.amountCents)
        for (const [key, value] of Object.entries(meta)) {
          if (before[key] === value) continue
          await tx`
            insert into larp_meta (key, value) values (${key}, ${value})
            on conflict (key) do update set value = excluded.value
          `
        }
      })
    },
    async holdPayout(marker, plan) {
      let result: 'held' | 'short' | 'saved' = 'short'
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(847211)`
        const marked = await tx<{ value: string }[]>`select value from larp_meta where key = ${marker}`
        if (marked[0]) {
          result = 'saved'
          return
        }
        const metaRows = await tx<{ key: string; value: string }[]>`select key, value from larp_meta`
        const meta: Record<string, string> = {}
        for (const item of metaRows) meta[item.key] = item.value
        const before = { ...meta }
        if (!takePadding(meta, plan.reserves)) {
          result = 'short'
          return
        }
        meta[marker] = JSON.stringify(plan)
        for (const [key, value] of Object.entries(meta)) {
          if (before[key] === value) continue
          await tx`
            insert into larp_meta (key, value) values (${key}, ${value})
            on conflict (key) do update set value = excluded.value
          `
        }
        result = 'held'
      })
      return result
    },
    async creditPadding(onceKey, changes) {
      await changeMeta((meta) => {
        creditOnce(meta, onceKey, changes)
      })
    },
    async pendingPayments(now) {
      const rows = await sql<{ body: PaymentRow }[]>`
        select body from larp_payments
        where status in ('pending_refund', 'pending_fill')
          or (status = 'processing' and updated_at < ${now - 120_000})
      `
      return rows.map((row) => row.body)
    },
    async payments() {
      const rows = await sql<{ body: PaymentRow }[]>`select body from larp_payments`
      return rows.map((row) => row.body)
    },
    async meta(key) {
      const rows = await sql<{ value: string }[]>`select value from larp_meta where key = ${key}`
      return rows[0]?.value ?? null
    },
    async setMeta(key, value) {
      await sql`
        insert into larp_meta (key, value) values (${key}, ${value})
        on conflict (key) do update set value = excluded.value
      `
    },
    async mention(id) {
      const rows = await sql<{ body: Mention }[]>`select body from larp_mentions where id = ${id}`
      return rows[0]?.body ?? null
    },
    async seedMentions(rows) {
      if (!rows.length) return
      await sql.begin(async (tx) => {
        for (const row of rows) {
          await tx`
            insert into larp_mentions (id, body) values (${row.id}, ${tx.json(row as never)})
            on conflict (id) do nothing
          `
        }
      })
    },
    async openMentions() {
      const rows = await sql<{ body: Mention }[]>`select body from larp_mentions where body->>'status' in ('reply', 'sending')`
      return rows.map((row) => row.body)
    },
    async applyTag(input) {
      let result: TagResult = { action: 'idle' }
      await editTrade((doc) => {
        result = decideTag(doc, input)
      })
      return result
    },
    async completeMention(id) {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(847211)`
        const rows = await tx<{ body: Mention }[]>`select body from larp_mentions where id = ${id} for update`
        const row = rows[0]?.body
        if (!row) return
        const next = { ...row, status: 'done' as const, updatedAt: Date.now() }
        await tx`update larp_mentions set body = ${tx.json(next as never)} where id = ${id}`
      })
    },
    async ackSend(id) {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(847211)`
        const rows = await tx<{ body: Mention }[]>`select body from larp_mentions where id = ${id} for update`
        const row = rows[0]?.body
        if (!row || row.status !== 'sending') return
        const next = { ...row, status: 'reply' as const, updatedAt: Date.now() }
        await tx`update larp_mentions set body = ${tx.json(next as never)} where id = ${id}`
      })
    },
    async abortWithdraw(id) {
      let text = ''
      await editTrade((doc) => {
        text = undoWithdraw(doc, id, Date.now())
      })
      return text
    },
    async placeCash(person, rooms, cents, now) {
      let result: CashHold = { action: 'poor' }
      await editTrade((doc) => {
        result = placeCash(doc, person, rooms, cents, now)
      })
      return result
    },
    async noteCash(screenName, id) {
      await editTrade((doc) => noteCash(doc, screenName, id))
    },
    async releaseCash(screenName) {
      await editTrade((doc) => releaseCash(doc, screenName))
    },
    async vaultDesk(screenName, desk) {
      const rows = await sql<{ body: Vault }[]>`select body from larp_vaults`
      const vaults: TradeDoc['vaults'] = {}
      rows.forEach((row, index) => {
        vaults[`v${index}`] = row.body
      })
      return deskVault({ positions: [], fills: [], payments: {}, vaults, launches: {}, mentions: {}, scores: {}, meta: {} }, screenName, desk)
    },
    async leaders() {
      const ready = await sql<{ value: string }[]>`select value from larp_meta where key = 'scores-ready'`
      if (ready[0]?.value !== '1') await editTrade((doc) => ensureScores(doc))
      const rows = await sql<{ body: { person: Person; cents: number } }[]>`select body from larp_scores`
      return rows.map((row) => ({ person: row.body.person, realizedCents: row.body.cents }))
    },
    async session(id) {
      const rows = await sql<{ body: SessionUser }[]>`select body from larp_sessions where id = ${id} and expires_at > ${Date.now()}`
      return rows[0]?.body ?? null
    },
    async saveSession(session) {
      await sql`
        insert into larp_sessions (id, expires_at, body)
        values (${session.id}, ${session.expiresAt}, ${sql.json(session as never)})
        on conflict (id) do update set expires_at = excluded.expires_at, body = excluded.body
      `
    },
    async deleteSession(id) {
      await sql`delete from larp_sessions where id = ${id}`
    },
  }
}

function vaultRecords(doc: Doc, screenName: string): { key: string; desks: Record<string, number> }[] {
  const name = screenName.trim().replace(/^@/, '').toLowerCase()
  return Object.entries(doc.vaults)
    .filter(([, vault]) => vault.person.screenName.toLowerCase() === name)
    .map(([key, vault]) => ({ key, desks: vault.desks }))
}

function emptyDoc(): Doc {
  return { positions: [], fills: [], payments: {}, vaults: {}, launches: {}, sessions: {}, mentions: {}, scores: {}, meta: {} }
}

function readDoc(path: string): Doc {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Doc>
    return {
      positions: parsed.positions ?? [],
      fills: parsed.fills ?? [],
      payments: parsed.payments ?? {},
      vaults: parsed.vaults ?? {},
      launches: parsed.launches ?? {},
      sessions: parsed.sessions ?? {},
      mentions: parsed.mentions ?? {},
      scores: parsed.scores ?? {},
      meta: parsed.meta ?? {},
    }
  } catch {
    return emptyDoc()
  }
}

function writeDoc(path: string, doc: Doc) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(doc))
  renameSync(temp, path)
}
