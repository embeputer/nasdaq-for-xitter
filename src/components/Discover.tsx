import { formatPct, formatPrice, formatUsd, pnlClass } from '../lib/format'
import { marketValue, openPnl } from '../lib/account'
import type { Candle, Instrument, Interval, Position, Quote } from '../types'
import type { Viewer } from '../lib/api'
import { ChartPane } from './ChartPane'

const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '1d']

export function Discover({
  positions,
  quotes,
  viewer,
  desks,
  selected,
  onSelect,
  interval,
  onInterval,
  candles,
  chartError,
}: {
  positions: Position[]
  quotes: Record<string, Quote>
  viewer: Viewer | null
  desks: string[]
  selected: Position | null
  onSelect: (position: Position) => void
  interval: Interval
  onInterval: (interval: Interval) => void
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
                      {position.label}
                      {mine ? <i className="yours">Yours</i> : null}
                    </strong>
                    <em>
                      @{position.person.screenName} · {position.name}
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
        {instrument ? (
          <>
            <header className="quote-head">
              <div>
                <p className="label-name">{instrument.name}</p>
                <h2>{instrument.label}</h2>
              </div>
              <div className="last">
                <strong>{quote ? formatPrice(quote.price, instrument.venue) : '—'}</strong>
                {quote ? (
                  <em className={pnlClass(quote.change)}>
                    {formatPrice(Math.abs(quote.change), instrument.venue)} {formatPct(quote.changePct)}
                  </em>
                ) : (
                  <em>Waiting for a price</em>
                )}
              </div>
            </header>
            <div className="intervals">
              {INTERVALS.map((item) => (
                <button key={item} type="button" aria-pressed={item === interval} onClick={() => onInterval(item)}>
                  {item}
                </button>
              ))}
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
      <aside className="ticket">
        {selected ? (
          <>
            <p className="ticket-kicker">Position</p>
            <h2>@{selected.person.screenName}</h2>
            <p className="ticket-line">
              <span>Size</span>
              <span>{formatUsd(marketValue(selected, quote?.price))}</span>
            </p>
            <p className="ticket-line">
              <span>Average</span>
              <span>{formatPrice(selected.avgPrice, selected.venue)}</span>
            </p>
            <p className="ticket-line">
              <span>Open P&L</span>
              <span className={pnlClass(openPnl(selected, quote?.price))}>{formatUsd(openPnl(selected, quote?.price), true)}</span>
            </p>
          </>
        ) : (
          <p className="hint">Positions filed by {deskList(desks)} land on the person who paid.</p>
        )}
      </aside>
    </div>
  )
}

function deskList(desks: string[]): string {
  const names = desks.filter(Boolean).map((desk) => `@${desk}`)
  if (names.length === 0) return 'the desk'
  if (names.length === 1) return names[0] ?? 'the desk'
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}
