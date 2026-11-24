import { formatUsd, pnlClass } from '../lib/format'
import { openPnl } from '../lib/account'
import type { Person, Position, Quote } from '../types'
import type { ScoreRow } from '../lib/api'

export function Leaderboard({
  positions,
  quotes,
  scores,
}: {
  positions: Position[]
  quotes: Record<string, Quote>
  scores: ScoreRow[]
}) {
  const leaders = leaderboard(positions, quotes, scores)
  if (leaders.length === 0) return null
  return (
    <main className="sheet">
      <p className="value-label">P&L</p>
      <ul className="names board">
        {leaders.map((row) => (
          <li key={row.person.screenName.toLowerCase()}>
            <a className="name" href={`https://xitter.space/${encodeURIComponent(row.person.screenName)}`}>
              <span>
                <strong>@{row.person.screenName}</strong>
              </span>
              <span className="name-px">
                <strong className={pnlClass(row.cents)}>{formatUsd(row.cents / 100, true)}</strong>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}

export function leaderboard(positions: Position[], quotes: Record<string, Quote>, scores: ScoreRow[]): { person: Person; cents: number }[] {
  const rows = new Map<string, { person: Person; cents: number; open: boolean }>()
  const keyOf = (person: Person) => person.screenName.trim().replace(/^@/, '').toLowerCase()
  const shown = (person: Person): Person => ({ ...person, screenName: person.screenName.trim().replace(/^@/, '') })
  for (const score of scores) {
    const key = keyOf(score.person)
    if (!key) continue
    const existing = rows.get(key)
    rows.set(key, {
      person: existing?.person ?? shown(score.person),
      cents: (existing?.cents ?? 0) + score.realizedCents,
      open: existing?.open ?? false,
    })
  }
  for (const position of positions) {
    const key = keyOf(position.person)
    if (!key) continue
    const mark = quotes[`${position.venue}:${position.symbol}`]
    const open = Math.round(openPnl(position, mark?.price) * 100)
    const existing = rows.get(key)
    rows.set(key, {
      person: existing?.person.screenName ? existing.person : shown(position.person),
      cents: (existing?.cents ?? 0) + open,
      open: true,
    })
  }
  return [...rows.values()]
    .filter((row) => row.open || row.cents !== 0)
    .sort((a, b) => b.cents - a.cents || a.person.screenName.localeCompare(b.person.screenName))
    .map(({ person, cents }) => ({ person, cents }))
}
