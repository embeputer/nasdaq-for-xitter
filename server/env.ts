import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const fileValues = new Map<string, string>()
let loaded = false

export const XITTER_ORIGIN = 'https://xitter.space'
export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export function readEnv(name: string): string {
  const fromProcess = process.env[name]?.trim()
  if (fromProcess) return strip(fromProcess)
  loadFiles()
  return fileValues.get(name) ?? ''
}

/** Hosts with no durable disk. Local `npm run dev` is false. */
export function ephemeralHost(): boolean {
  return Boolean(process.env.VERCEL || process.env.NETLIFY)
}

export function sessionSecret(): string {
  const configured = readEnv('SESSION_SECRET')
  if (configured) return configured
  if (ephemeralHost()) return ''
  const path = '.data/session-secret'
  try {
    return strip(readFileSync(path, 'utf8'))
  } catch {
    const secret = randomBytes(32).toString('hex')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, secret, { mode: 0o600 })
    return secret
  }
}

function loadFiles() {
  if (loaded) return
  loaded = true
  for (const name of ['.env.local', '.env']) {
    let text = ''
    try {
      text = readFileSync(name, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const eq = trimmed.indexOf('=')
      const key = trimmed.slice(0, eq).replace(/^export\s+/, '')
      if (!fileValues.has(key)) fileValues.set(key, strip(trimmed.slice(eq + 1)))
    }
  }
}

function strip(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}
