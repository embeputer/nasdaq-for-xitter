import { cleanModUser } from './moderation.ts'

export const COMPLIANT_USERS_KEY = 'compliance:disclaimer'
export const DISCLAIMER_URL = 'nqfx.embie.tech/disclaimer'
export const DISCLAIMER_NOTE = `Please accept our disclaimer at ${DISCLAIMER_URL}`

export type ComplianceState = {
  compliantUsers: string[]
}

function readList(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out = new Set<string>()
    for (const item of parsed) {
      if (typeof item !== 'string') continue
      const user = cleanModUser(item)
      if (user) out.add(user)
    }
    return [...out].sort()
  } catch {
    return []
  }
}

export function readCompliance(meta: Record<string, string>): ComplianceState {
  return { compliantUsers: readList(meta[COMPLIANT_USERS_KEY]) }
}

/** Marks (or unmarks) a user as having accepted the disclaimer. Returns null for a bad handle. */
export function applyCompliance(meta: Record<string, string>, screenName: string, accepted: boolean): ComplianceState | null {
  const user = cleanModUser(screenName)
  if (!user) return null
  const next = new Set(readList(meta[COMPLIANT_USERS_KEY]))
  if (accepted) next.add(user)
  else next.delete(user)
  if (next.size === 0) delete meta[COMPLIANT_USERS_KEY]
  else meta[COMPLIANT_USERS_KEY] = JSON.stringify([...next].sort())
  return readCompliance(meta)
}

export function isCompliant(stateOrMeta: ComplianceState | Record<string, string>, screenName: string): boolean {
  const user = cleanModUser(screenName)
  if (!user) return false
  const state = Array.isArray((stateOrMeta as ComplianceState).compliantUsers)
    ? (stateOrMeta as ComplianceState)
    : readCompliance(stateOrMeta as Record<string, string>)
  return state.compliantUsers.includes(user)
}
