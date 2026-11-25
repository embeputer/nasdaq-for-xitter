import { cleanLaunchSymbol } from './launch.ts'
import { ALLOWED_CRYPTO, spotBase, type Venue } from './market.ts'

export const DELISTED_LAUNCHES_KEY = 'mod:delisted-launches'
export const RESTRICTED_MARKETS_KEY = 'mod:restricted-markets'
export const RESTRICTED_USERS_KEY = 'mod:restricted-users'

export type ModerationState = {
  delistedLaunches: string[]
  restrictedMarkets: string[]
  restrictedUsers: string[]
}

export type ModerationAction =
  | { kind: 'delist_launch'; target: string; active: boolean }
  | { kind: 'restrict_market'; target: string; active: boolean }
  | { kind: 'restrict_user'; target: string; active: boolean }

export function canModerate(viewer: { admin?: boolean; moderator?: boolean } | null | undefined): boolean {
  return Boolean(viewer && (viewer.admin || viewer.moderator))
}

export function cleanModUser(raw: string): string | null {
  const clean = raw.trim().replace(/^@+/, '').toLowerCase()
  if (!clean || clean.length > 64 || /\s/.test(clean)) return null
  if (!/^[a-z0-9._-]+$/.test(clean)) return null
  return clean
}

/**
 * Normalize a market target into a canonical `<venue>:<symbol>` key.
 * Accepts explicit `stock:SYM`, `crypto:BTC`, `crypto:BTCUSDT`, `launch:YAMS`,
 * or bare `NVDA`, `$NVDA`, `xitYAMS`, or an allowed crypto ticker like `BTC`.
 */
export function cleanModMarket(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const colon = trimmed.indexOf(':')
  if (colon > 0) {
    const venue = trimmed.slice(0, colon).trim().toLowerCase()
    const rest = trimmed.slice(colon + 1).trim()
    if (!rest) return null
    if (venue === 'stock') {
      const symbol = rest.replace(/^\$/, '').toUpperCase()
      return /^[A-Z0-9._=-]{1,24}$/.test(symbol) ? `stock:${symbol}` : null
    }
    if (venue === 'crypto') {
      const base = spotBase(rest)
      return /^[A-Z0-9._-]{1,24}$/.test(base) ? `crypto:${base}` : null
    }
    if (venue === 'launch') {
      const symbol = cleanLaunchSymbol(rest)
      return symbol ? `launch:${symbol}` : null
    }
    return null
  }
  if (trimmed.startsWith('$')) {
    const symbol = trimmed.slice(1).trim().toUpperCase()
    return /^[A-Z0-9._=-]{1,24}$/.test(symbol) ? `stock:${symbol}` : null
  }
  if (/^xit[A-Za-z]{2,8}$/i.test(trimmed)) {
    const symbol = cleanLaunchSymbol(trimmed)
    return symbol ? `launch:${symbol}` : null
  }
  const base = spotBase(trimmed)
  if (ALLOWED_CRYPTO.has(base)) return `crypto:${base}`
  const upper = trimmed.toUpperCase()
  return /^[A-Z0-9._=-]{1,24}$/.test(upper) ? `stock:${upper}` : null
}

function readList(raw: string | undefined, clean: (value: string) => string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out = new Set<string>()
    for (const item of parsed) {
      if (typeof item !== 'string') continue
      const normalized = clean(item)
      if (normalized) out.add(normalized)
    }
    return [...out].sort()
  } catch {
    return []
  }
}

export function readModeration(meta: Record<string, string>): ModerationState {
  return {
    delistedLaunches: readList(meta[DELISTED_LAUNCHES_KEY], cleanLaunchSymbol),
    restrictedMarkets: readList(meta[RESTRICTED_MARKETS_KEY], cleanModMarket),
    restrictedUsers: readList(meta[RESTRICTED_USERS_KEY], cleanModUser),
  }
}

function updateList(
  meta: Record<string, string>,
  key: string,
  value: string,
  active: boolean,
  clean: (item: string) => string | null,
): void {
  const next = new Set(readList(meta[key], clean))
  if (active) next.add(value)
  else next.delete(value)
  if (next.size === 0) delete meta[key]
  else meta[key] = JSON.stringify([...next].sort())
}

export function applyModeration(meta: Record<string, string>, action: ModerationAction): ModerationState | null {
  if (action.kind === 'delist_launch') {
    const symbol = cleanLaunchSymbol(action.target)
    if (!symbol) return null
    updateList(meta, DELISTED_LAUNCHES_KEY, symbol, action.active, cleanLaunchSymbol)
    return readModeration(meta)
  }
  if (action.kind === 'restrict_market') {
    const market = cleanModMarket(action.target)
    if (!market) return null
    updateList(meta, RESTRICTED_MARKETS_KEY, market, action.active, cleanModMarket)
    return readModeration(meta)
  }
  const user = cleanModUser(action.target)
  if (!user) return null
  updateList(meta, RESTRICTED_USERS_KEY, user, action.active, cleanModUser)
  return readModeration(meta)
}

export function isLaunchDelisted(stateOrMeta: ModerationState | Record<string, string>, symbol: string): boolean {
  const clean = cleanLaunchSymbol(symbol)
  if (!clean) return false
  const state = isState(stateOrMeta) ? stateOrMeta : readModeration(stateOrMeta)
  return state.delistedLaunches.includes(clean)
}

export function isMarketRestricted(stateOrMeta: ModerationState | Record<string, string>, venue: Venue, symbol: string): boolean {
  const state = isState(stateOrMeta) ? stateOrMeta : readModeration(stateOrMeta)
  if (venue === 'launch') {
    const clean = cleanLaunchSymbol(symbol)
    if (!clean) return false
    return state.delistedLaunches.includes(clean) || state.restrictedMarkets.includes(`launch:${clean}`)
  }
  if (venue === 'crypto') {
    const base = spotBase(symbol)
    const upper = symbol.trim().toUpperCase()
    return state.restrictedMarkets.includes(`crypto:${base}`) || state.restrictedMarkets.includes(`crypto:${upper}`)
  }
  if (venue === 'stock') {
    const upper = symbol.trim().toUpperCase()
    return state.restrictedMarkets.includes(`stock:${upper}`)
  }
  return false
}

export function isUserRestricted(stateOrMeta: ModerationState | Record<string, string>, screenName: string): boolean {
  const user = cleanModUser(screenName)
  if (!user) return false
  const state = isState(stateOrMeta) ? stateOrMeta : readModeration(stateOrMeta)
  return state.restrictedUsers.includes(user)
}

function isState(value: ModerationState | Record<string, string>): value is ModerationState {
  return Array.isArray((value as ModerationState).delistedLaunches)
}
