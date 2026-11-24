import { useRef, useState } from 'react'
import { VENUE_LABEL } from '../data/universe'
import { formatClock, formatPct, formatPrice, formatQty, formatUsd, pnlClass } from '../lib/format'
import { marketValue, openPnl } from '../lib/account'
import type { Viewer } from '../lib/api'
import type { Fill, Position, Quote } from '../types'
import { AdminComposer } from './AdminComposer'

export function Portfolio({
  viewer,
  positions,
  fills,
  quotes,
  desks,
  nqfxCents,
  onClose,
  onOpened,
}: {
  viewer: Viewer | null
  positions: Position[]
  fills: Fill[]
  quotes: Record<string, Quote>
  desks: string[]
  nqfxCents: number
  onClose: (position: Position, cash: boolean) => Promise<void>
  onOpened: () => void
}) {
  if (!viewer) {
    return (
      <main className="sheet">
        <p className="value-label">Portfolio</p>
        <h1>Sign in</h1>
        <p className="hint login-copy">Log in with Xitter to see the positions filed under your name.</p>
        <a className="invest login-link" href="/api/oauth/start">
          Log in with Xitter
        </a>
      </main>
    )
  }

  const mine = viewer.admin
    ? positions
    : positions.filter((position) => position.person.screenName.toLowerCase() === viewer.screenName.toLowerCase())
  const invested = mine.reduce((sum, position) => sum + marketValue(position, quotes[`${position.venue}:${position.symbol}`]?.price), 0)
  const pnl = mine.reduce((sum, position) => sum + openPnl(position, quotes[`${position.venue}:${position.symbol}`]?.price), 0)
  const names = desks.length ? desks.map((desk) => `@${desk}`).join(' or ') : 'the desk'
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)

  async function close(position: Position, cash: boolean) {
    if (pending.current) return
    const price = quotes[`${position.venue}:${position.symbol}`]?.price
    if (cash) {
      const shown = price && price > 0 ? formatUsd(position.qty * price) : 'the current value'
      if (!window.confirm(`Send ${shown} to @${position.person.screenName} and close this position?`)) return
    } else if (!window.confirm(`Close @${position.person.screenName}'s ${position.label} without sending Equicoins?`)) {
      return
    }
    pending.current = true
    setBusy(true)
    try {
      await onClose(position, cash)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <main className="sheet">
      <p className="value-label">{viewer.admin ? 'Every position' : 'Your book'}</p>
      <h1>{formatUsd(invested)}</h1>
      <div className="stats">
        <Stat label="Open P&L" value={formatUsd(pnl, true)} tone={pnlClass(pnl)} />
        <Stat label="Cash" value={formatUsd(nqfxCents / 100)} />
        <Stat label="Positions" value={String(mine.length)} />
        <Stat label="Account" value={`@${viewer.screenName}`} />
        <Stat label="Role" value={viewer.admin ? 'Admin' : 'Member'} />
      </div>
      {viewer.admin ? <AdminComposer onOpened={onOpened} /> : null}
      <section className="holdings">
        <h2>{viewer.admin ? 'Book' : 'Positions'}</h2>
        {mine.length === 0 ? (
          <p className="hint pad">No open positions. Send Equicoins to {names} with the ticker in the note.</p>
        ) : null}
        {mine.map((position) => {
          const price = quotes[`${position.venue}:${position.symbol}`]?.price
          const gain = openPnl(position, price)
          const pct = position.avgPrice > 0 && price ? ((price - position.avgPrice) / position.avgPrice) * 100 : 0
          return (
            <article key={position.id} className="holding">
              <div>
                <h3>
                  {position.label}
                  <span>{position.name}</span>
                </h3>
                <p className="who">
                  {position.person.avatarUrl ? <img src={position.person.avatarUrl} alt="" /> : <span className="avatar-fallback" />}
                  <span>
                    @{position.person.screenName}
                    <span className="class-tag">{VENUE_LABEL[position.venue]}</span>
                  </span>
                </p>
                <p className="meta">
                  {formatQty(position.qty)} @ {formatPrice(position.avgPrice, position.venue)}
                </p>
              </div>
              <div className="holding-end">
                <strong>{formatUsd(marketValue(position, price))}</strong>
                <em className={pnlClass(gain)}>
                  {formatUsd(gain, true)} {formatPct(pct)}
                </em>
                <div className="close-row">
                  <button type="button" className="close" disabled={busy} onClick={() => void close(position, true)}>
                    Close
                  </button>
                  {viewer.admin ? (
                    <button type="button" className="close" disabled={busy} onClick={() => void close(position, false)}>
                      Without cash
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          )
        })}
      </section>
      {fills.length > 0 ? (
        <section className="fills">
          <h2>Fills</h2>
          <ul>
            {fills.slice(0, 8).map((fill) => (
              <li key={fill.id}>
                <span>
                  {fill.side === 'buy' ? 'Bought' : 'Closed'} {formatQty(fill.qty)} {fill.label} at{' '}
                  {formatPrice(fill.price, fill.venue)} for @{fill.person.screenName}
                </span>
                <span>{formatClock(fill.time)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <p>
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </p>
  )
}
