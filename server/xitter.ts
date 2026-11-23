import { readEnv, UA, XITTER_ORIGIN } from './env.ts'

export type XitterPerson = {
  id: string
  screenName: string
  name: string
  avatarUrl: string | null
}

export function readToken(): string {
  return readEnv('XITTER_TOKEN') || readEnv('XITTER_NYSE_TOKEN')
}

export async function searchPeople(query: string): Promise<XitterPerson[]> {
  const token = readToken()
  if (!token) {
    const error = new Error('missing_token')
    error.name = 'MissingToken'
    throw error
  }
  const q = query.trim().replace(/^@/, '').slice(0, 40)
  if (q.length < 1) return []
  const url = new URL('/api/v1/search/users', XITTER_ORIGIN)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '8')
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': UA,
    },
    signal: AbortSignal.timeout(8000),
  })
  if (res.status === 401 || res.status === 403) {
    const error = new Error('unauthorized')
    error.name = 'Unauthorized'
    throw error
  }
  if (!res.ok) throw new Error(`Xitter search ${res.status}`)
  const body = (await res.json()) as { data?: unknown }
  const rows = Array.isArray(body.data) ? body.data : []
  return rows.flatMap(toPerson)
}

function toPerson(row: unknown): XitterPerson[] {
  if (!row || typeof row !== 'object') return []
  const record = row as Record<string, unknown>
  const screenName = stringField(record, 'screen_name', 'screenName', 'username')
  const id = stringField(record, 'id') || screenName
  const name = stringField(record, 'name') || screenName
  if (!screenName) return []
  const avatar = stringField(record, 'avatar_url', 'avatarUrl', 'profile_image_url_https', 'profile_image_url')
  return [
    {
      id,
      screenName,
      name,
      avatarUrl: avatar ? (avatar.startsWith('http') ? avatar : `${XITTER_ORIGIN}${avatar}`) : null,
    },
  ]
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}
