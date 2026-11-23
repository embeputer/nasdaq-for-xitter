import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileBuy, type Fill, type Order, type Position } from './book.ts'
import { ephemeralHost } from './env.ts'

export type PaymentStatus = 'processing' | 'filled' | 'refunded' | 'pending_refund' | 'pending_fill' | 'skipped' | 'donated'

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
  pendingPayments(now: number): Promise<PaymentRow[]>
  meta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
  session(id: string): Promise<SessionUser | null>
  saveSession(session: SessionUser): Promise<void>
  deleteSession(id: string): Promise<void>
}

type Doc = {
  positions: Position[]
  fills: Fill[]
  payments: Record<string, PaymentRow>
  sessions: Record<string, SessionUser>
  meta: Record<string, string>
}

const TERMINAL = new Set<PaymentStatus>(['filled', 'refunded', 'skipped', 'donated'])

export function memoryStore(): Store {
  const doc = emptyDoc()
  return storeFrom(
    () => doc,
    (next) => {
      doc.positions = next.positions
      doc.fills = next.fills
      doc.payments = next.payments
      doc.sessions = next.sessions
      doc.meta = next.meta
    },
  )
}

export function fileStore(path: string): Store {
  const doc = readDoc(path)
  let chain = Promise.resolve()
  return storeFrom(
    () => structuredClone(doc),
    (next) => {
      const run = chain.then(() => {
        doc.positions = next.positions
        doc.fills = next.fills
        doc.payments = next.payments
        doc.sessions = next.sessions
        doc.meta = next.meta
        writeDoc(path, doc)
      })
      chain = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
  )
}

function storeFrom(read: () => Doc, write: (doc: Doc) => void | Promise<void>): Store {
  async function edit(change: (doc: Doc) => void): Promise<Doc> {
    const doc = read()
    change(doc)
    await write(doc)
    return doc
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
        const next = change(doc.positions)
        doc.positions = next.positions
        if (next.fill) doc.fills = [next.fill, ...doc.fills].slice(0, 400)
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
    async pendingPayments(now) {
      return Object.values(read().payments).filter(
        (row) =>
          row.status === 'pending_refund' ||
          row.status === 'pending_fill' ||
          (row.status === 'processing' && now - row.updatedAt > 120_000),
      )
    },
    async meta(key) {
      return read().meta[key] ?? null
    },
    async setMeta(key, value) {
      await edit((doc) => {
        doc.meta[key] = value
      })
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
  `
  const positions = async () => {
    const rows = await sql<{ body: Position }[]>`select body from larp_positions`
    return rows.map((row) => row.body)
  }
  return {
    positions,
    async fills(limit) {
      const rows = await sql<{ body: Fill }[]>`select body from larp_fills order by time desc limit ${limit}`
      return rows.map((row) => row.body)
    },
    async updateBook(change) {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(847211)`
        const rows = await tx<{ body: Position }[]>`select body from larp_positions`
        const next = change(rows.map((row) => row.body))
        await tx`delete from larp_positions`
        for (const position of next.positions) {
          await tx`insert into larp_positions (id, body) values (${position.id}, ${tx.json(position as never)})`
        }
        if (next.fill) {
          await tx`insert into larp_fills (id, time, body) values (${next.fill.id}, ${next.fill.time}, ${tx.json(next.fill as never)}) on conflict (id) do nothing`
          await tx`delete from larp_fills where id in (select id from larp_fills order by time desc offset 400)`
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
    async pendingPayments(now) {
      const rows = await sql<{ body: PaymentRow }[]>`
        select body from larp_payments
        where status in ('pending_refund', 'pending_fill')
          or (status = 'processing' and updated_at < ${now - 120_000})
      `
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

function emptyDoc(): Doc {
  return { positions: [], fills: [], payments: {}, sessions: {}, meta: {} }
}

function readDoc(path: string): Doc {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Doc>
    return {
      positions: parsed.positions ?? [],
      fills: parsed.fills ?? [],
      payments: parsed.payments ?? {},
      sessions: parsed.sessions ?? {},
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
