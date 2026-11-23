import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { readEnv, sessionSecret, UA, XITTER_ORIGIN } from './env.ts'

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function clientDocument(origin: string) {
  const clientId = `${origin}/api/oauth/client`
  return {
    client_id: clientId,
    client_name: 'Nasdaq for Xitter',
    redirect_uris: [`${origin}/api/oauth/callback`],
    token_endpoint_auth_method: 'none' as const,
  }
}

export function oauthSetup(origin: string): { clientId: string; redirectUri: string } | { error: 'local_app' | 'bad_origin' } {
  const registered = readEnv('XITTER_CLIENT_ID')
  if (registered) {
    return { clientId: registered, redirectUri: readEnv('XITTER_REDIRECT_URI') || `${origin}/api/oauth/callback` }
  }
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return { error: 'bad_origin' }
  }
  const local = url.protocol !== 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (local) return { error: 'local_app' }
  return { clientId: `${origin}/api/oauth/client`, redirectUri: `${origin}/api/oauth/callback` }
}

export function publicOrigin(req: IncomingMessage): string {
  const configured = readEnv('APP_ORIGIN').replace(/\/$/, '')
  if (configured) return configured
  const host = header(req, 'x-forwarded-host') || req.headers.host || 'localhost:5173'
  const hostname = host.split(',')[0]?.trim() || 'localhost:5173'
  const forwarded = header(req, 'x-forwarded-proto')
  const proto = forwarded || (hostname.startsWith('localhost') || hostname.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${hostname}`
}

export function secureOrigin(origin: string): boolean {
  return origin.startsWith('https://')
}

export function cookiesOf(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  const headerValue = req.headers.cookie ?? ''
  for (const part of headerValue.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

export function cookieHeader(name: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function signValue(id: string): string {
  const secret = sessionSecret()
  const mac = createHmac('sha256', secret).update(id).digest('base64url')
  return `${id}.${mac}`
}

export function verifyValue(value: string): string | null {
  const secret = sessionSecret()
  if (!secret) return null
  const split = value.indexOf('.')
  if (split < 0) return null
  const id = value.slice(0, split)
  const mac = value.slice(split + 1)
  const expected = createHmac('sha256', secret).update(id).digest('base64url')
  const actualBuf = Buffer.from(mac)
  const expectedBuf = Buffer.from(expected)
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) return null
  return id
}

export async function exchangeCode(code: string, verifier: string, clientId: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  })
  const res = await fetch(new URL('/oauth/token', XITTER_ORIGIN), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
    body,
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`token_${res.status}`)
  const payload = (await res.json()) as { access_token?: unknown }
  if (typeof payload.access_token !== 'string' || !payload.access_token) throw new Error('token_shape')
  return payload.access_token
}

export const LOCAL_APP_HELP = `Local sign-in needs a connected app.
Register one at ${XITTER_ORIGIN}/account/apps/developer
with redirect http://localhost:5173/api/oauth/callback
and set XITTER_CLIENT_ID in .env.
On HTTPS, Nasdaq for Xitter publishes its own client metadata and no client id is required.`

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}
