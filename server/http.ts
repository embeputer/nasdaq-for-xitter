import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileBuy, fileClose, samePerson, type Person } from './book.ts'
import { getCandles, getQuotes, isInterval, parseId, searchMarket } from './market.ts'
import { cashOut } from './close.ts'
import { adminNames, findPerson, fetchMe, loadDesks, sendPayout, transferLimit } from './money.ts'
import { runIngest } from './ingest.ts'
import {
  clientDocument,
  cookieHeader,
  cookiesOf,
  exchangeCode,
  LOCAL_APP_HELP,
  oauthSetup,
  pkcePair,
  publicOrigin,
  secureOrigin,
  signValue,
  storedVerifier,
  verifyValue,
} from './oauth.ts'
import { ephemeralHost, readEnv } from './env.ts'
import { durableStorage, store as openLedger, type SessionUser } from './store.ts'
import { searchPeople } from './xitter.ts'

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ensureSessionSecret()
  const url = new URL(req.url ?? '/', 'http://localhost')
  const origin = publicOrigin(req)
  const secure = secureOrigin(origin)
  try {
    if (url.pathname === '/api/quotes') {
      const ids = (url.searchParams.get('ids') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 40)
      send(res, 200, { quotes: await getQuotes(ids) })
      return
    }
    if (url.pathname === '/api/candles') {
      const id = url.searchParams.get('id') ?? ''
      const interval = url.searchParams.get('interval') ?? '1m'
      if (!isInterval(interval)) {
        send(res, 400, { error: 'bad_interval' })
        return
      }
      send(res, 200, { candles: await getCandles(id, interval) })
      return
    }
    if (url.pathname === '/api/search') {
      const venue = url.searchParams.get('venue') ?? 'stock'
      if (venue !== 'stock' && venue !== 'crypto' && venue !== 'perpetual') {
        send(res, 400, { error: 'bad_venue' })
        return
      }
      send(res, 200, { hits: await searchMarket(venue, url.searchParams.get('q') ?? '') })
      return
    }
    if (url.pathname === '/api/xitter/users') {
      try {
        send(res, 200, { people: await searchPeople(url.searchParams.get('q') ?? '') })
      } catch (error) {
        if (error instanceof Error && error.name === 'MissingToken') {
          send(res, 503, {
            error: 'missing_token',
            message: 'Xitter needs a read token. Make one at xitter.space/account/api and set XITTER_TOKEN.',
          })
          return
        }
        if (error instanceof Error && error.name === 'Unauthorized') {
          send(res, 401, {
            error: 'unauthorized',
            message: 'Xitter refused that token. Make a new read token at xitter.space/account/api.',
          })
          return
        }
        throw error
      }
      return
    }
    if (url.pathname === '/api/oauth/client') {
      send(res, 200, clientDocument(origin))
      return
    }
    if (url.pathname === '/api/oauth/start') {
      await startLogin(res, origin, secure)
      return
    }
    if (url.pathname === '/api/oauth/callback') {
      await finishLogin(req, res, url, origin, secure)
      return
    }
    if (url.pathname === '/api/session') {
      const viewer = await viewerFrom(req)
      send(res, 200, { user: viewer })
      return
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      await logout(req, res, secure)
      return
    }
    if (url.pathname === '/api/book') {
      const ledger = await openLedger()
      const desks = (await loadDesks()).map((desk) => desk.screenName)
      send(res, 200, {
        positions: await ledger.positions(),
        fills: await ledger.fills(40),
        desks,
        durable: durableStorage(),
      })
      return
    }
    if (url.pathname === '/api/positions/open' && req.method === 'POST') {
      await openPosition(req, res)
      return
    }
    if (url.pathname === '/api/positions/close' && req.method === 'POST') {
      await closePosition(req, res)
      return
    }
    if (url.pathname === '/api/cron/payments') {
      if (!cronAllowed(req)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      send(res, 200, await runIngest())
      return
    }
    send(res, 404, { error: 'not_found' })
  } catch (error) {
    send(res, 502, { error: error instanceof Error ? error.message : 'Market data failed' })
  }
}

async function startLogin(res: ServerResponse, origin: string, secure: boolean) {
  const setup = oauthSetup(origin)
  if ('error' in setup) {
    res.statusCode = 400
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end(LOCAL_APP_HELP)
    return
  }
  const { verifier, challenge } = pkcePair()
  const state = randomBytes(16).toString('base64url')
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: setup.clientId,
    redirect_uri: setup.redirectUri,
    state,
    scope: 'read',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  try {
    await (await openLedger()).setMeta(`pkce:${state}`, `${verifier}.${Date.now()}`)
  } catch (error) {
    console.error('pkce', error instanceof Error ? error.message : 'failed')
  }
  redirect(res, `https://xitter.space/oauth/authorize?${params}`, [
    cookieHeader('larp_pkce', `${state}.${verifier}`, 600, secure),
  ])
}

async function finishLogin(req: IncomingMessage, res: ServerResponse, url: URL, origin: string, secure: boolean) {
  const setup = oauthSetup(origin)
  const failed = (step: string) => `${origin}/?login=failed&step=${step}#portfolio`
  if ('error' in setup) {
    redirect(res, failed('setup'), [])
    return
  }
  const code = url.searchParams.get('code') ?? ''
  const queryState = url.searchParams.get('state') ?? ''
  const pkce = cookiesOf(req).larp_pkce ?? ''
  const split = pkce.indexOf('.')
  const cookieState = split >= 0 ? pkce.slice(0, split) : ''
  const cookieVerifier = split >= 0 ? pkce.slice(split + 1) : ''
  const ledger = await openLedger()
  const saved = storedVerifier(queryState ? await ledger.meta(`pkce:${queryState}`) : null, Date.now())
  if (queryState) {
    try {
      await ledger.setMeta(`pkce:${queryState}`, '')
    } catch (error) {
      console.error('pkce', error instanceof Error ? error.message : 'failed')
    }
  }
  const verifier = cookieState === queryState && cookieVerifier ? cookieVerifier : saved
  if (!code || !queryState || !verifier) {
    redirect(res, failed('cookie'), [cookieHeader('larp_pkce', '', 0, secure)])
    return
  }
  try {
    const accessToken = await exchangeCode(code, verifier, setup.clientId, setup.redirectUri)
    const person = await fetchMe(accessToken)
    const session: SessionUser = {
      id: randomBytes(24).toString('base64url'),
      screenName: person.screenName,
      name: person.name,
      avatarUrl: person.avatarUrl,
      accessToken,
      expiresAt: Date.now() + 30 * 24 * 3600 * 1000,
    }
    await ledger.saveSession(session)
    redirect(res, `${origin}/#portfolio`, [cookieHeader('larp_session', signValue(session.id), 30 * 24 * 3600, secure)])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed'
    console.error('login', message)
    const step = message.startsWith('me_') ? 'profile' : message.startsWith('token_') ? 'token' : 'book'
    redirect(res, failed(step), [cookieHeader('larp_pkce', '', 0, secure)])
  }
}

async function logout(req: IncomingMessage, res: ServerResponse, secure: boolean) {
  const id = verifyValue(cookiesOf(req).larp_session ?? '')
  if (id) await (await openLedger()).deleteSession(id)
  send(res, 200, { ok: true }, [cookieHeader('larp_session', '', 0, secure)])
}

async function openPosition(req: IncomingMessage, res: ServerResponse) {
  const viewer = await viewerFrom(req)
  if (!viewer) {
    send(res, 401, { error: 'unauthorized' })
    return
  }
  if (!viewer.admin) {
    send(res, 403, { error: 'forbidden' })
    return
  }
  const body = await readJson(req)
  const id = text(body.id)
  const screenName = text(body.screenName).replace(/^@/, '')
  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount)
  const parsed = parseId(id)
  if (!parsed || !(amount >= 1)) {
    send(res, 400, { error: 'bad_order' })
    return
  }
  const person = await findPerson(screenName)
  if (!person) {
    send(res, 400, { error: 'no_person' })
    return
  }
  const [quote] = await getQuotes([id])
  if (!quote || !(quote.price > 0)) {
    send(res, 502, { error: 'no_price' })
    return
  }
  const ledger = await openLedger()
  await ledger.updateBook((positions) =>
    fileBuy(positions, {
      venue: parsed.venue,
      symbol: parsed.symbol,
      name: quote.name || parsed.symbol,
      label: labelFor(parsed.venue, parsed.symbol),
      person,
      amount,
      price: quote.price,
    }),
  )
  send(res, 200, { ok: true, screenName: person.screenName })
}

async function closePosition(req: IncomingMessage, res: ServerResponse) {
  const viewer = await viewerFrom(req)
  if (!viewer) {
    send(res, 401, { error: 'unauthorized', message: 'Log in to close a position.' })
    return
  }
  const body = await readJson(req)
  const id = text(body.id)
  const cash = body.cash !== false
  if (!cash && !viewer.admin) {
    send(res, 403, { error: 'forbidden', message: 'Only an admin can close without sending cash.' })
    return
  }
  const ledger = await openLedger()
  const position = (await ledger.positions()).find((item) => item.id === id)
  if (!position) {
    send(res, 404, { error: 'not_found', message: 'That position is already closed.' })
    return
  }
  if (!viewer.admin && !samePerson(viewer.screenName, position.person.screenName)) {
    send(res, 403, { error: 'forbidden', message: 'You can only close your own position.' })
    return
  }
  const [quote] = await getQuotes([`${position.venue}:${position.symbol}`])
  if (!quote || !(quote.price > 0)) {
    send(res, 502, { error: 'no_price', message: "There's no price for this yet, so it can't be closed." })
    return
  }
  if (!cash) {
    await ledger.updateBook((positions) => fileClose(positions, id, quote.price))
    send(res, 200, { ok: true, cash: false })
    return
  }
  await withCloseLock(id, async () => {
    const result = await cashOut({
      ledger,
      id,
      price: quote.price,
      desks: await loadDesks(),
      limit: (desk) => transferLimit(desk.writeToken),
      pay: (desk, to, cents, note, key) => sendPayout(desk.writeToken, to, cents, note, key),
    })
    if (!result.ok) {
      send(res, result.status, { error: result.error, message: result.message })
      return
    }
    send(res, 200, { ok: true, cash: true, cents: result.cents, screenName: result.screenName })
  })
}

const closeLocks = new Map<string, Promise<void>>()

function withCloseLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = closeLocks.get(id) ?? Promise.resolve()
  const result = previous.then(run, run)
  const settled = result.then(
    () => undefined,
    () => undefined,
  )
  closeLocks.set(id, settled)
  void settled.then(() => {
    if (closeLocks.get(id) === settled) closeLocks.delete(id)
  })
  return result
}

async function viewerFrom(req: IncomingMessage): Promise<(Person & { admin: boolean }) | null> {
  const id = verifyValue(cookiesOf(req).larp_session ?? '')
  if (!id) return null
  const session = await (await openLedger()).session(id)
  if (!session) return null
  const admins = await adminNames()
  return {
    id: session.id,
    screenName: session.screenName,
    name: session.name,
    avatarUrl: session.avatarUrl,
    admin: admins.has(session.screenName.toLowerCase()),
  }
}

async function ensureSessionSecret() {
  if (readEnv('SESSION_SECRET') || !ephemeralHost()) return
  try {
    const ledger = await openLedger()
    const existing = await ledger.meta('session-secret')
    if (existing) {
      process.env.SESSION_SECRET = existing
      return
    }
    const created = randomBytes(32).toString('hex')
    await ledger.setMeta('session-secret', created)
    process.env.SESSION_SECRET = (await ledger.meta('session-secret')) || created
  } catch (error) {
    console.error('session-secret', error instanceof Error ? error.message : 'failed')
  }
}

function labelFor(venue: 'stock' | 'crypto' | 'perpetual', symbol: string): string {
  if (venue === 'perpetual') return `${symbol}-PERP`
  if (venue === 'crypto' && symbol.endsWith('USDC')) return `${symbol.slice(0, -4)}-USDC`
  if (venue === 'crypto' && symbol.endsWith('USDT')) return symbol.slice(0, -4)
  return symbol
}

function cronAllowed(req: IncomingMessage): boolean {
  const secret = readEnv('CRON_SECRET')
  const header = req.headers.authorization ?? ''
  if (secret && header === `Bearer ${secret}`) return true
  return !ephemeralHost()
}

function send(res: ServerResponse, status: number, body: unknown, cookies: string[] = []) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  if (cookies.length) res.setHeader('set-cookie', cookies)
  res.end(JSON.stringify(body))
}

function redirect(res: ServerResponse, location: string, cookies: string[]) {
  res.statusCode = 303
  res.setHeader('location', location)
  res.setHeader('cache-control', 'no-store')
  if (cookies.length) res.setHeader('set-cookie', cookies)
  res.end()
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 100_000) {
        reject(new Error('body'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(text) as unknown
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
