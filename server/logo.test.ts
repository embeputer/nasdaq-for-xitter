import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOGO_BAD, LOGO_FORBIDDEN, LOGO_MISSING, readLogo, sniffLogo, writeLogo } from './logo.ts'
import { fileStore, type PaymentRow } from './store.ts'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const gif = new TextEncoder().encode('GIF89a......')
const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBP')

const ada = { id: '9', screenName: 'ada', name: 'Ada', avatarUrl: null }
const bob = { id: '8', screenName: 'bob', name: 'Bob', avatarUrl: null }

function vault(person: typeof ada): PaymentRow {
  return {
    id: `v-${person.id}`,
    status: 'processing',
    amountCents: 5000,
    note: 'vault',
    desk: 'nasdaq',
    senderId: person.id,
    senderName: person.name,
    senderScreen: person.screenName,
    avatarUrl: null,
    detail: '',
    updatedAt: 1,
  }
}

describe('logo bytes', () => {
  it('sniffs the four image kinds and rejects markup', () => {
    expect(sniffLogo(png)).toBe('png')
    expect(sniffLogo(jpeg)).toBe('jpg')
    expect(sniffLogo(gif)).toBe('gif')
    expect(sniffLogo(webp)).toBe('webp')
    expect(sniffLogo(new TextEncoder().encode('<svg></svg>!!'))).toBeNull()
    expect(sniffLogo(new TextEncoder().encode('<!DOCTYPE html>'))).toBeNull()
    expect(sniffLogo(png.slice(0, 8))).toBeNull()
  })

  it('writes one file per symbol and drops the previous extension', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'larp-logo-'))
    expect(await writeLogo(dir, 'YAMS', png)).toBe('png')
    expect(await writeLogo(dir, 'YAMS', webp)).toBe('webp')
    expect(existsSync(join(dir, 'YAMS.webp'))).toBe(true)
    expect(existsSync(join(dir, 'YAMS.png'))).toBe(false)
    expect(await readLogo(dir, 'YAMS')).toMatchObject({ kind: 'webp', type: 'image/webp' })
    await expect(writeLogo(dir, '../YAMS', png)).rejects.toThrow(LOGO_BAD)
    expect(await readLogo(dir, '../YAMS')).toBeNull()
  })
})

describe('launch logos', () => {
  it('lets only the creator attach a picture, and a later buy keeps it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'larp-ledger-'))
    const path = join(root, 'ledger.json')
    const ledger = fileStore(path)
    await ledger.creditVault(vault(ada), ada)
    const opened = await ledger.openLaunch({
      person: ada,
      symbol: 'YAMS',
      name: 'Yams',
      liquidityCents: 1000,
      investCents: 0,
      now: 2,
    })
    expect(opened.ok).toBe(true)
    const price = (await ledger.launchQuote('YAMS'))?.price
    expect((await ledger.launchQuote('YAMS'))?.logo).toBeUndefined()

    const denied = await ledger.setLaunchLogo('YAMS', bob, png)
    expect(denied).toEqual({ ok: false, error: 'forbidden', message: LOGO_FORBIDDEN })
    expect(existsSync(join(root, 'logos', 'YAMS.png'))).toBe(false)

    const missing = await ledger.setLaunchLogo('NOPE', ada, png)
    expect(missing).toEqual({ ok: false, error: 'missing', message: LOGO_MISSING })

    const bad = await ledger.setLaunchLogo('YAMS', { ...ada, screenName: '@Ada' }, new TextEncoder().encode('<svg></svg>!!'))
    expect(bad).toEqual({ ok: false, error: 'bad_logo', message: LOGO_BAD })

    const saved = await ledger.setLaunchLogo('yams', { ...ada, screenName: '@Ada' }, png)
    expect(saved).toEqual({ ok: true, rev: 1 })
    expect((await ledger.launchQuote('YAMS'))?.price).toBe(price)
    expect((await ledger.launchQuote('YAMS'))?.logo).toBe('/api/logos/YAMS?v=1')
    expect(existsSync(join(root, 'logos', 'YAMS.png'))).toBe(true)

    const replaced = await ledger.setLaunchLogo('YAMS', ada, webp)
    expect(replaced).toEqual({ ok: true, rev: 2 })
    expect(existsSync(join(root, 'logos', 'YAMS.webp'))).toBe(true)
    expect(existsSync(join(root, 'logos', 'YAMS.png'))).toBe(false)
    expect((await ledger.launchQuote('YAMS'))?.logo).toBe('/api/logos/YAMS?v=2')
    expect((await ledger.launchQuote('YAMS'))?.price).toBe(price)

    const book = readFileSync(path, 'utf8')
    expect(book).toContain('"logo":"webp"')
    expect(book).not.toContain('RIFF')
    expect(book).not.toContain('PNG')

    await ledger.buyLaunch(
      {
        ...vault(bob),
        id: 'buy-1',
        amountCents: 1000,
        note: 'xitYAMS',
      },
      bob,
      'YAMS',
      3,
    )
    const after = await ledger.launchQuote('YAMS')
    expect(after?.logo).toBe('/api/logos/YAMS?v=2')
    expect(after?.price).toBeCloseTo(4)
    expect(after?.price).not.toBe(price)
    expect((await ledger.positions()).find((position) => position.person.screenName === 'bob')?.qty).toBeCloseTo(5)
  })
})
