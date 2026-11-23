import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { signValue, storedVerifier } from './oauth.ts'
import { apiPath, handleRequest } from './netlify.ts'
import { durableStorage, store } from './store.ts'

process.env.LEDGER_FILE = join(mkdtempSync(join(tmpdir(), 'larp-netlify-')), 'ledger.json')
process.env.SESSION_SECRET = 'test-session-secret'

beforeAll(async () => {
  await (await store()).saveSession({
    id: 'sess-test',
    screenName: 'ada',
    name: 'Ada',
    avatarUrl: null,
    accessToken: 'tok',
    expiresAt: Date.now() + 60_000,
  })
})

describe('stored pkce', () => {
  it('accepts a fresh verifier and rejects a stale one', () => {
    const now = 1_000_000
    const verifier = 'a'.repeat(43)
    expect(storedVerifier(`${verifier}.${now - 1000}`, now)).toBe(verifier)
    expect(storedVerifier(`${verifier}.${now - 11 * 60 * 1000}`, now)).toBe('')
    expect(storedVerifier('', now)).toBe('')
  })
})

describe('api path', () => {
  it('keeps a public /api url', () => {
    expect(apiPath('https://nasdaq.test/api/quotes?ids=stock:AAPL')).toBe('/api/quotes?ids=stock:AAPL')
  })

  it('maps the internal function prefix back to /api', () => {
    expect(apiPath('https://nasdaq.test/.netlify/functions/api/oauth/callback?code=1')).toBe(
      '/api/oauth/callback?code=1',
    )
  })
})

describe('request adapter', () => {
  it('serves the oauth client document', async () => {
    const res = await handleRequest(new Request('https://nasdaq.test/api/oauth/client'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { client_name: string }
    expect(body.client_name).toBe('Nasdaq for Xitter')
  })

  it('reads a json body after the session lookup', async () => {
    const res = await handleRequest(
      new Request('https://nasdaq.test/api/positions/close', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `larp_session=${encodeURIComponent(signValue('sess-test'))}`,
        },
        body: JSON.stringify({ id: 'pos:stock:AAPL:ada' }),
      }),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('sends the login cookie on a redirect', async () => {
    const previousClient = process.env.XITTER_CLIENT_ID
    const previousOrigin = process.env.APP_ORIGIN
    process.env.XITTER_CLIENT_ID = 'client-test'
    process.env.APP_ORIGIN = 'https://nasdaq.test'
    try {
      const res = await handleRequest(new Request('https://nasdaq.test/api/oauth/start'))
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toContain('https://xitter.space/oauth/authorize?')
      expect(res.headers.getSetCookie().some((cookie) => cookie.startsWith('larp_pkce='))).toBe(true)
      const state = new URL(res.headers.get('location') ?? '').searchParams.get('state') ?? ''
      const saved = storedVerifier(await (await store()).meta(`pkce:${state}`), Date.now())
      expect(saved.length).toBeGreaterThanOrEqual(43)
      const callback = await handleRequest(
        new Request(`https://nasdaq.test/api/oauth/callback?code=${'a'.repeat(43)}&state=${state}`),
      )
      expect(callback.status).toBe(303)
      expect(callback.headers.get('location')).toContain('step=token')
    } finally {
      if (previousClient === undefined) delete process.env.XITTER_CLIENT_ID
      else process.env.XITTER_CLIENT_ID = previousClient
      if (previousOrigin === undefined) delete process.env.APP_ORIGIN
      else process.env.APP_ORIGIN = previousOrigin
    }
  }, 20_000)

  it('locks the cron route on Netlify unless the bearer matches', async () => {
    const previous = process.env.NETLIFY
    process.env.NETLIFY = 'true'
    try {
      const denied = await handleRequest(new Request('https://nasdaq.test/api/cron/payments'))
      expect(denied.status).toBe(401)
    } finally {
      if (previous === undefined) delete process.env.NETLIFY
      else process.env.NETLIFY = previous
    }
  })
})

describe('durable book', () => {
  it('is ephemeral on Netlify without Postgres', () => {
    const netlify = process.env.NETLIFY
    const postgres = process.env.POSTGRES_URL
    const database = process.env.DATABASE_URL
    delete process.env.POSTGRES_URL
    delete process.env.DATABASE_URL
    process.env.NETLIFY = 'true'
    try {
      expect(durableStorage()).toBe(false)
    } finally {
      if (netlify === undefined) delete process.env.NETLIFY
      else process.env.NETLIFY = netlify
      if (postgres === undefined) delete process.env.POSTGRES_URL
      else process.env.POSTGRES_URL = postgres
      if (database === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = database
    }
  })
})
