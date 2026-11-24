import { formatCountdown, sessionSchedule, type EquitySession } from '../lib/session'

export function SessionRibbon({
  id,
  label,
  now,
}: {
  id: EquitySession | 'all'
  label: string
  now: Date
}) {
  const active = id === 'all' ? null : id
  const rows = active ? sessionSchedule(now) : []
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')?.value
  return (
    <div className="session-wrap">
      <button type="button" className={`session session-${id}`}>
        {label}
      </button>
      <div className="session-tip" role="tooltip">
        {active ? (
          <>
            <p className="session-zone">New York hours in your time{zone ? `, ${zone}` : ''}</p>
            {rows.map((row) => (
              <p className="session-row" key={row.id}>
                <span>{row.label}</span>
                <span>{localWhen(row.at, now)}</span>
                <span className="session-eta">{formatCountdown(now, row.at, row.id === active)}</span>
              </p>
            ))}
          </>
        ) : (
          <p className="session-zone">User stocks trade all day.</p>
        )}
      </div>
    </div>
  )
}

function localWhen(at: Date, now: Date): string {
  const day = (date: Date) =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at)
  if (day(at) === day(now)) return time
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(at)
  return `${weekday} ${time}`
}
