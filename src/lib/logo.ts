export const LOGO_MAX_BYTES = 1_000_000

export const LOGO_BAD = 'Use a PNG, JPEG, WEBP, or GIF under 1 MB.'

export type LogoKind = 'png' | 'jpg' | 'webp' | 'gif'

const MIME: Record<LogoKind, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export function logoMime(kind: LogoKind): string {
  return MIME[kind]
}

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

export function logoFileOk(file: { name: string; type: string; size: number }): boolean {
  if (file.size < 12 || file.size > LOGO_MAX_BYTES) return false
  if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp' || file.type === 'image/gif') {
    return true
  }
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name)
}
