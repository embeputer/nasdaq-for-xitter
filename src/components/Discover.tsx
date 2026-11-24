import { formatPct, formatPrice, formatUsd, pnlClass } from '../lib/format'
import { marketValue, openPnl } from '../lib/account'
import type { Candle, Instrument, Position, Quote } from '../types'
import type { Viewer } from '../lib/api'
import { ChartPane } from './ChartPane'

export function Discover({
  positions,
  quotes,
  viewer,
  desks,
  selected,
  onSelect,
  candles,
  chartError,
}: {
  positions: Position[]
  quotes: Record<string, Quote>
  viewer: Viewer | null
  desks: string[]
  selected: Position | null
  onSelect: (position: Position) => void
  candles: Candle[]
  chartError: string | null
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
  return (
    <div className="terminal">
      <aside className="book">
        <p className="feed-kicker">Discover</p>
        <ul className="names">
          {positions.map((position) => {
            const mark = quotes[`${position.venue}:${position.symbol}`]
            const gain = openPnl(position, mark?.price)
            const mine = viewer ? viewer.screenName.toLowerCase() === position.person.screenName.toLowerCase() : false
            return (
              <li key={position.id}>
                <button
                  type="button"
                  className={position.id === selected?.id ? 'name selected' : 'name'}
                  onClick={() => onSelect(position)}
                >
                  <span>
                    <strong>
                      @{position.person.screenName}
                      {mine ? <i className="yours">Yours</i> : null}
                    </strong>
                    <em>
                      {position.label} · {position.name}
                    </em>
                  </span>
                  <span className="name-px">
                    <strong>{formatUsd(marketValue(position, mark?.price))}</strong>
                    <em className={pnlClass(gain)}>{mark && position.avgPrice > 0 ? formatPct(((mark.price - position.avgPrice) / position.avgPrice) * 100) : '—'}</em>
                  </span>
                </button>
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
              <div>
                <h2>
                  {shortName(selected.name)} · {selected.label}
                  {selected.venue === 'crypto' || selected.venue === 'perpetual' ? <span className="all-day">Trades all day</span> : null}
                </h2>
                <p className="label-name">{selected.name}</p>
                {selected.venue === 'launch' && quote?.creator && quote.creator.toLowerCase() !== selected.person.screenName.toLowerCase() ? (
                  <a className="creator" href={`https://xitter.space/${encodeURIComponent(quote.creator)}`}>
                    @{quote.creator}
                  </a>
                ) : null}
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
              <ChartPane candles={candles} quote={quote} />
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
