import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const LOGO_MAX_BYTES = 1_000_000
export const LOGO_BAD = 'Use a PNG, JPEG, WEBP, or GIF under 1 MB.'
export const LOGO_MISSING = 'That stock does not exist.'
export const LOGO_FORBIDDEN = 'Only the creator can change this logo.'

export type LogoKind = 'png' | 'jpg' | 'webp' | 'gif'

const MIME: Record<LogoKind, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

const KINDS: LogoKind[] = ['png', 'jpg', 'webp', 'gif']

export function sniffLogo(bytes: Uint8Array): LogoKind | null {
  if (bytes.length < 12 || bytes.length > LOGO_MAX_BYTES) return null
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png'
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif'
  if (
    String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0) === 'RIFF' &&
    String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0) === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

function logoMime(kind: LogoKind): string {
  return MIME[kind]
}

export async function writeLogo(dir: string, symbol: string, bytes: Uint8Array): Promise<LogoKind> {
  const kind = sniffLogo(bytes)
  if (!kind || !/^[A-Z]{2,8}$/.test(symbol)) throw new Error(LOGO_BAD)
  await mkdir(dir, { recursive: true })
  const dest = join(dir, `${symbol}.${kind}`)
  const temp = `${dest}.${process.pid}.tmp`
  await writeFile(temp, bytes)
  await rename(temp, dest)
  await Promise.all(
    KINDS.filter((item) => item !== kind).map((item) => rm(join(dir, `${symbol}.${item}`), { force: true })),
  )
  return kind
}

export async function readLogo(dir: string, symbol: string): Promise<{ kind: LogoKind; type: string; bytes: Buffer } | null> {
  if (!/^[A-Z]{2,8}$/.test(symbol)) return null
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  const file = names.find((name) => KINDS.some((kind) => name === `${symbol}.${kind}`))
  if (!file) return null
  const kind = file.slice(symbol.length + 1) as LogoKind
  const bytes = await readFile(join(dir, file))
  if (!sniffLogo(bytes)) return null
  return { kind, type: logoMime(kind), bytes }
}
