import { createHash } from 'node:crypto'

export const REPLIES = {
  opened: 'your order has been successfully opened',
  closed: 'your order has been successfully closed',
  withdrawn: 'your withdrawal has been sent',
  unresolved: 'Sorry, that didnt resolve',
  poor: 'Seems like your vault is short on cash for that.... Send equicoins to this account with "vault" in the note to deposit money into your vault',
  missing: "Seems like that asset isn't something you own.... Did you write it correctly?",
  short: 'Sorry, seems like the NQFX fund is a bit short right now... Tagging @ember to help you',
} as const

export const WITHDRAW_NOTE = 'Vault withdrawal - paid out by Nasdaq for Xitter'

export type Command =
  | { kind: 'buy'; query: string; cents: number }
  | { kind: 'sell'; query: string }
  | { kind: 'withdraw'; cents: number }

/** The whole post is `@desk buy|sell|withdraw ...`. Anything else is not an order. */
export function parseCommand(text: string, desk: string): Command | null {
  const handle = desk.trim().replace(/^@/, '')
  if (!handle) return null
  const match = new RegExp(`^@${escapeReg(handle)}\\s+(buy|sell|withdraw)\\b\\s*([\\s\\S]*)$`, 'i').exec(text.trim())
  if (!match) return null
  const kind = match[1].toLowerCase()
  const rest = match[2].trim()
  const tokens = rest.split(/\s+/).filter(Boolean)
  if (kind === 'withdraw') {
    if (tokens.length !== 1) return null
    const cents = moneyCents(tokens[0] ?? '')
    return cents === null ? null : { kind: 'withdraw', cents }
  }
  if (kind === 'sell') {
    if (tokens.length !== 1) return null
    return { kind: 'sell', query: tokens[0] ?? '' }
  }
  if (tokens.length < 2) return null
  const cents = moneyCents(tokens[tokens.length - 1] ?? '')
  const query = tokens.slice(0, -1).join(' ')
  if (cents === null || !query) return null
  return { kind: 'buy', query, cents }
}

export function withdrawKey(postId: string, part: number): string {
  return `wd${createHash('sha256').update(postId).digest('hex').slice(0, 40)}-${part}`
}

export function moneyCents(token: string): number | null {
  const match = /^\$?(\d{1,7})(?:\.(\d{1,2}))?$/.exec(token.trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents < 100) return null
  return cents
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
