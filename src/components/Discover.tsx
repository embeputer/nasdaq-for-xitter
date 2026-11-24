import { useState } from 'react'
import { formatPct, formatPrice, formatUsd, pnlClass } from '../lib/format'
import { marketValue, openPnl } from '../lib/account'
import type { Candle, Instrument, Position, Quote } from '../types'
import type { Viewer } from '../lib/api'
import { ChartPane } from './ChartPane'
import { AssetMark } from './AssetMark'
import { LogoMark } from './LogoMark'

export function positionGroups(positions: Position[]): { screenName: string; positions: Position[] }[] {
  const rows = new Map<string, Position[]>()
  const label = new Map<string, string>()
  for (const position of positions) {
    const key = position.person.screenName.toLowerCase()
    const group = rows.get(key)
    if (group) group.push(position)
    else {
      rows.set(key, [position])
      label.set(key, position.person.screenName)
    }
  }
  return [...rows.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({ screenName: label.get(key) ?? key, positions: rows.get(key) ?? [] }))
}

export function Discover({
  positions,
  quotes,
  viewer,
  desks,
  selected,
  onSelect,
  candles,
  chartError,
  onLogoSaved,
}: {
  positions: Position[]
  quotes: Record<string, Quote>
  viewer: Viewer | null
  desks: string[]
  selected: Position | null
  onSelect: (position: Position) => void
  candles: Candle[]
  chartError: string | null
  onLogoSaved?: () => void
}) {
  const instrument: Instrument | null = selected
    ? {
        id: `${selected.venue}:${selected.symbol}`,
        venue: selected.venue,
        symbol: selected.symbol,
        label: selected.label,
        name: selected.name,
      }
    : null
  const quote = instrument ? (quotes[instrument.id] ?? null) : null
  const [openNames, setOpenNames] = useState<Record<string, boolean>>({})
  const groups = positionGroups(positions)
  return (
    <div className="terminal">
      <aside className="book">
        <p className="feed-kicker">Discover</p>
        <ul className="names">
          {groups.map((group) => {
            const key = group.screenName.toLowerCase()
            const open = openNames[key] === true
            const mine = viewer ? viewer.screenName.toLowerCase() === key : false
            return (
              <li key={key} className="person-group">
                <button
                  type="button"
                  className="group-toggle"
                  aria-expanded={open}
                  onClick={() => setOpenNames((current) => ({ ...current, [key]: !current[key] }))}
                >
                  <span className="group-mark">
                    <span className="group-chev" aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                    <strong>
                      @{group.screenName}
                      {mine ? <i className="yours">Yours</i> : null}
                    </strong>
                  </span>
                  <span className="group-count">{group.positions.length}</span>
                </button>
                {open ? (
                  <ul className="group-positions">
                    {group.positions.map((position) => {
                      const mark = quotes[`${position.venue}:${position.symbol}`]
                      const gain = openPnl(position, mark?.price)
                      return (
                        <li key={position.id}>
                          <button
                            type="button"
                            className={position.id === selected?.id ? 'name selected' : 'name'}
                            onClick={() => onSelect(position)}
                          >
                            <span className="name-id">
                              {position.venue === 'launch' ? (
                                <AssetMark
                                  venue="launch"
                                  symbol={position.symbol}
                                  label={position.label}
                                  logo={mark?.logo}
                                />
                              ) : null}
                              <span>
                                <strong>{position.label}</strong>
                                <em>{position.name}</em>
                              </span>
                            </span>
                            <span className="name-px">
                              <strong>{formatUsd(marketValue(position, mark?.price))}</strong>
                              <em className={pnlClass(gain)}>
                                {mark && position.avgPrice > 0 ? formatPct(((mark.price - position.avgPrice) / position.avgPrice) * 100) : '—'}
                              </em>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
        {positions.length === 0 ? (
          <p className="hint pad">
            No open positions. Equicoins sent to {deskList(desks)} with a ticker in the note show up here.
          </p>
        ) : null}
      </aside>
      <section className="stage">
        {selected ? (
          <>
            <header className="quote-head">
              <div className="quote-title">
                {selected.venue === 'launch' ? (
                  <LogoMark
                    symbol={selected.symbol}
                    label={selected.label}
                    src={quote?.logo}
                    editable={Boolean(
                      viewer && quote?.creator && sameName(viewer.screenName, quote.creator),
                    )}
                    onSaved={() => onLogoSaved?.()}
                  />
                ) : null}
                <div>
                <h2>
                  {shortName(selected.name)} · {selected.label}
                  {selected.venue === 'crypto' || selected.venue === 'perpetual' ? <span className="all-day">Trades all day</span> : null}
                </h2>
                <p className="label-name">
                  <span>{selected.name}</span>
                  {selected.venue === 'launch' && quote?.creator && quote.creator.toLowerCase() !== selected.person.screenName.toLowerCase() ? (
                    <a className="creator" href={`https://xitter.space/${encodeURIComponent(quote.creator)}`}>
                      @{quote.creator}
                    </a>
                  ) : null}
                </p>
                </div>
              </div>
              <div className="last">
                <strong>{quote ? formatPrice(quote.price, selected.venue) : '—'}</strong>
                {quote ? (
                  <em className={pnlClass(quote.change)}>
                    {formatPrice(Math.abs(quote.change), selected.venue)} {formatPct(quote.changePct)}
                  </em>
                ) : (
                  <em>Waiting for a price</em>
                )}
              </div>
            </header>
            <div className="position-card">
              <p>
                <span>Username</span>
                <strong>
                  <a href={`https://xitter.space/${encodeURIComponent(selected.person.screenName)}`}>@{selected.person.screenName}</a>
                </strong>
              </p>
              <p>
                <span>Size</span>
                <strong>{formatUsd(marketValue(selected, quote?.price))}</strong>
              </p>
              <p>
                <span>Avg</span>
                <strong>{formatPrice(selected.avgPrice, selected.venue)}</strong>
              </p>
              <p>
                <span>P&L</span>
                <strong className={pnlClass(openPnl(selected, quote?.price))}>{formatUsd(openPnl(selected, quote?.price), true)}</strong>
              </p>
            </div>
            <div className="chart-wrap">
              <ChartPane candles={candles} quote={quote} seriesId={`${selected.venue}:${selected.symbol}`} />
              {chartError ? <p className="chart-error">{chartError}</p> : null}
              {candles.length === 0 && !chartError ? <p className="chart-error">Loading the chart…</p> : null}
            </div>
          </>
        ) : (
          <p className="hint pad">Pick a position to open its chart.</p>
        )}
      </section>
    </div>
  )
}

function sameName(a: string, b: string): boolean {
  return a.trim().replace(/^@/, '').toLowerCase() === b.trim().replace(/^@/, '').toLowerCase()
}

export function shortName(name: string): string {
  const head = (name.split(',')[0] ?? name).trim()
  const trimmed = head
    .replace(/\s+class\s+[a-z0-9]+\s+common\s+stock$/i, '')
    .replace(/\s+(common|preferred)\s+stock$/i, '')
    .replace(/\s+ordinary\s+shares$/i, '')
    .trim()
  return trimmed || name
}

function deskList(desks: string[]): string {
  const names = desks.filter(Boolean).map((desk) => `@${desk}`)
  if (names.length === 0) return 'the desk'
  if (names.length === 1) return names[0] ?? 'the desk'
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}
