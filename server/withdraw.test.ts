import { describe, expect, it } from 'vitest'
import type { Person } from './book.ts'
import { WITHDRAW_NOTE } from './commands.ts'
import { memoryStore, type PaymentRow } from './store.ts'
import { withdrawCash } from './withdraw.ts'

const person: Person = { id: 'u1', screenName: 'z1xus', name: 'z', avatarUrl: null }
const other: Person = { id: 'u2', screenName: 'ada', name: 'Ada', avatarUrl: null }
const desk = { screenName: 'nasdaq', readToken: 'read', writeToken: 'write' }

function row(id: string, who: Person, cents: number): PaymentRow {
  return {
    id,
    status: 'processing',
    amountCents: cents,
    note: 'vault',
    desk: 'nasdaq',
    senderId: who.id,
    senderName: who.name,
    senderScreen: who.screenName,
    avatarUrl: null,
    detail: '',
    updatedAt: 1,
  }
}

describe('cash withdrawal', () => {
  it('sends the signed-in cash in chunks and leaves everyone else', async () => {
    const ledger = memoryStore()
    await ledger.creditVault(row('me', person, 2000), person)
    await ledger.creditVault(row('them', other, 3000), other)
    const pays: { cents: number; note: string; key: string }[] = []
    const result = await withdrawCash({
      ledger,
      person,
      desks: [desk],
      cents: 2000,
      now: 5,
      wallet: async () => ({ balanceCents: 10_000, maxCents: 1500 }),
      pay: async (_desk, _to, cents, note, key) => {
        pays.push({ cents, note, key })
      },
    })
    expect(result).toEqual({ ok: true, cents: 2000, screenName: 'z1xus', short: false })
    expect(pays.map((item) => item.cents)).toEqual([1500, 500])
    expect(new Set(pays.map((item) => item.key)).size).toBe(2)
    expect(pays.every((item) => item.note === WITHDRAW_NOTE)).toBe(true)
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(0)
    expect(await ledger.vaultDesk('ada', 'nasdaq')).toBe(3000)
  })

  it('does not debit when the desk cannot cover the cash', async () => {
    const ledger = memoryStore()
    await ledger.creditVault(row('me', person, 2000), person)
    await ledger.creditVault(row('them', other, 3000), other)
    const result = await withdrawCash({
      ledger,
      person,
      desks: [desk],
      cents: 2000,
      now: 5,
      wallet: async () => ({ balanceCents: 3000, maxCents: 100_000 }),
      pay: async () => {
        throw new Error('should not send')
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/can't cover/)
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(2000)
    expect(await ledger.vaultDesk('ada', 'nasdaq')).toBe(3000)
  })

  it('asks for a dollar and puts a read-only send back', async () => {
    const ledger = memoryStore()
    await ledger.creditVault(row('tiny', person, 50), person)
    const poor = await withdrawCash({
      ledger,
      person,
      desks: [desk],
      cents: 50,
      now: 5,
      wallet: async () => ({ balanceCents: 10_000, maxCents: 100_000 }),
      pay: async () => undefined,
    })
    expect(poor.ok).toBe(false)
    if (!poor.ok) expect(poor.message).toMatch(/at least \$1/)
    await ledger.creditVault(row('more', person, 2000), person)
    const blocked = await withdrawCash({
      ledger,
      person,
      desks: [desk],
      cents: 2000,
      now: 6,
      wallet: async () => ({ balanceCents: 10_000, maxCents: 100_000 }),
      pay: async () => {
        const error = new Error('read_only')
        error.name = 'ReadOnlyToken'
        throw error
      },
    })
    expect(blocked.ok).toBe(false)
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(2050)
  })

  it('sends only the chosen amount', async () => {
    const ledger = memoryStore()
    await ledger.creditVault(row('me', person, 2000), person)
    const pays: number[] = []
    const result = await withdrawCash({
      ledger,
      person,
      desks: [desk],
      cents: 500,
      now: 5,
      wallet: async () => ({ balanceCents: 10_000, maxCents: 100_000 }),
      pay: async (_desk, _to, cents) => {
        pays.push(cents)
      },
    })
    expect(result).toEqual({ ok: true, cents: 500, screenName: 'z1xus', short: true })
    expect(pays).toEqual([500])
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(1500)
    const over = await withdrawCash({
      ledger,
      person,
      desks: [desk],
      cents: 2000,
      now: 6,
      wallet: async () => ({ balanceCents: 10_000, maxCents: 100_000 }),
      pay: async () => {
        throw new Error('should not send')
      },
    })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.message).toMatch(/don't have that much/)
    expect(await ledger.vaultDesk('z1xus', 'nasdaq')).toBe(1500)
  })
})
