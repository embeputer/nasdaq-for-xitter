import { describe, expect, it } from 'vitest'
import { LOGO_MAX_BYTES, logoFileOk, sniffLogo } from './logo.ts'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])
const webp = new Uint8Array(12)
webp.set([0x52, 0x49, 0x46, 0x46], 0)
webp.set([0x57, 0x45, 0x42, 0x50], 8)

describe('logo files', () => {
  it('accepts png, jpeg, webp, and gif and rejects everything else', () => {
    expect(sniffLogo(png)).toBe('png')
    expect(sniffLogo(jpeg)).toBe('jpg')
    expect(sniffLogo(gif)).toBe('gif')
    expect(sniffLogo(webp)).toBe('webp')
    expect(sniffLogo(png.slice(0, 11))).toBeNull()
    expect(sniffLogo(Uint8Array.from(Array(12).fill(60)))).toBeNull()
    const html = new Uint8Array(12)
    html.set([0x3c, 0x73, 0x76, 0x67])
    expect(sniffLogo(html)).toBeNull()
    const huge = new Uint8Array(LOGO_MAX_BYTES + 1)
    huge.set(png)
    expect(sniffLogo(huge)).toBeNull()
  })

  it('lets the form accept those types by mime or extension', () => {
    expect(logoFileOk({ name: 'mark.png', type: 'image/png', size: 32 })).toBe(true)
    expect(logoFileOk({ name: 'mark.jpeg', type: '', size: 32 })).toBe(true)
    expect(logoFileOk({ name: 'mark.jpg', type: 'image/jpeg', size: 32 })).toBe(true)
    expect(logoFileOk({ name: 'mark.webp', type: 'image/webp', size: 32 })).toBe(true)
    expect(logoFileOk({ name: 'mark.gif', type: 'image/gif', size: 32 })).toBe(true)
    expect(logoFileOk({ name: 'mark.svg', type: 'image/svg+xml', size: 32 })).toBe(false)
    expect(logoFileOk({ name: 'mark.png', type: 'image/png', size: 11 })).toBe(false)
    expect(logoFileOk({ name: 'mark.png', type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toBe(false)
  })
})
