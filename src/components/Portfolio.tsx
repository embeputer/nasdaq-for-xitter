import { useRef, useState } from 'react'
import { VENUE_LABEL } from '../data/universe'
import { AssetMark } from './AssetMark'
import { AdminComposer } from './AdminComposer'
import { ModerationPanel } from './ModerationPanel'
import { formatClock, formatPct, formatPrice, formatQty, formatUsd, pnlClass } from '../lib/format'
import { marketValue, openPnl } from '../lib/account'
import { saleFor, type Viewer } from '../lib/api'
import type { Fill, Position, Quote } from '../types'

function ownedBy(position: Position, screenName: string): boolean {
  return position.person.screenName.toLowerCase() === screenName.toLowerCase()
}

export function Portfolio({
  viewer,
  positions,
  fills,
  quotes,
  desks,
  nqfxCents,
  onWithdraw,
  onClose,
  onOpened,
}: {
  viewer: Viewer | null
  positions: Position[]
  fills: Fill[]
  quotes: Record<string, Quote>
  desks: string[]
  nqfxCents: number
  onWithdraw: () => void
  onClose: (position: Position, cash: boolean) => Promise<void>
  onOpened: () => void
}) {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)

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

  const account = viewer
  const own = positions.filter((position) => ownedBy(position, account.screenName))
  const listed = viewer.admin ? positions.filter((position) => !ownedBy(position, viewer.screenName)) : own
  const counted = viewer.admin ? positions : own
  const valueOf = (rows: Position[]) =>
    rows.reduce((sum, position) => sum + marketValue(position, quotes[`${position.venue}:${position.symbol}`]?.price), 0)
  const pnlOf = (rows: Position[]) =>
    rows.reduce((sum, position) => sum + openPnl(position, quotes[`${position.venue}:${position.symbol}`]?.price), 0)
  const canModerate = viewer.admin || viewer.moderator
  const ownValue = valueOf(own)
  const ownPnl = pnlOf(own)
  const bookValue = valueOf(positions)
  const bookPnl = pnlOf(positions)
  const names = desks.length ? desks.map((desk) => `@${desk}`).join(' or ') : 'the desk'

  async function close(position: Position, cash: boolean) {
    if (pending.current) return
    const price = quotes[`${position.venue}:${position.symbol}`]?.price
    if (cash) {
      const proceeds = position.venue === 'launch' ? await saleFor(position.symbol, position.qty) : null
      const dollars = proceeds ?? (price && price > 0 ? position.qty * price : 0)
      const shown = dollars > 0 ? formatUsd(dollars) : 'the current value'
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

  function renderHolding(position: Position) {
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
            <AssetMark
              venue={position.venue}
              symbol={position.symbol}
              label={position.label}
              name={position.name}
              logo={quotes[`${position.venue}:${position.symbol}`]?.logo}
            />
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
            {account.admin ? (
              <button type="button" className="close" disabled={busy} onClick={() => void close(position, false)}>
                Without cash
              </button>
            ) : null}
          </div>
        </div>
      </article>
    )
  }

  return (
    <main className="sheet">
      {viewer.admin ? (
        <div className="totals">
          <div>
            <p className="value-label">Your book</p>
            <h1>{formatUsd(ownValue)}</h1>
          </div>
          <div>
            <p className="value-label">Every position</p>
            <h1>
              {formatUsd(bookValue)}
              <em className={pnlClass(bookPnl)}>{formatUsd(bookPnl, true)}</em>
            </h1>
          </div>
        </div>
      ) : (
        <>
          <p className="value-label">Your book</p>
          <h1>{formatUsd(ownValue)}</h1>
        </>
      )}
      <div className="stats">
        <Stat label="Open P&L" value={formatUsd(ownPnl, true)} tone={pnlClass(ownPnl)} />
        <Stat label="Cash" value={formatUsd(nqfxCents / 100)} />
        <Stat label="Positions" value={String(counted.length)} />
        <Stat label="Account" value={`@${viewer.screenName}`} />
        <Stat label="Role" value={viewer.admin ? 'Admin' : viewer.moderator ? 'Moderator' : 'Member'} />
      </div>
      <div className="pill-row">
        <button type="button" className="invest composer-toggle" disabled={busy} onClick={onWithdraw}>
          Withdraw
        </button>
        {viewer.admin ? <AdminComposer onOpened={onOpened} /> : null}
        {canModerate ? <ModerationPanel onChanged={onOpened} /> : null}
      </div>
      {viewer.admin ? (
        <section className="holdings">
          <h2>Your positions</h2>
          {own.length === 0 ? <p className="hint pad">No positions under your name.</p> : null}
          {own.map(renderHolding)}
        </section>
      ) : null}
      <section className="holdings">
        <h2>{viewer.admin ? 'Book' : 'Positions'}</h2>
        {listed.length === 0 ? (
          <p className="hint pad">
            {positions.length === 0
              ? `No open positions. Send Equicoins to ${names} with the ticker in the note.`
              : 'No other open positions.'}
          </p>
        ) : null}
        {listed.map(renderHolding)}
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
