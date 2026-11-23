import { useEffect, useState } from 'react'
import { searchMarket } from '../lib/api'
import { formatPct, formatPrice, pnlClass } from '../lib/format'
import type { Instrument, Quote, Venue } from '../types'

const CLASSES: { venue: Venue; label: string }[] = [
  { venue: 'stock', label: 'Stocks' },
  { venue: 'crypto', label: 'Crypto' },
  { venue: 'perpetual', label: 'Perpetuals' },
]

export function SymbolBook({
  venue,
  onVenue,
  selectedId,
  onSelect,
  quotes,
}: {
  venue: Venue
  onVenue: (venue: Venue) => void
  selectedId: string
  onSelect: (instrument: Instrument) => void
  quotes: Record<string, Quote>
}) {
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<Instrument[]>([])
  const [hits, setHits] = useState<Instrument[]>([])
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    setQuery('')
    setHits([])
    setCatalog([])
    if (venue === 'stock') {
      setNote(null)
      return
    }
    let stop = false
    setNote('Loading the book…')
    void searchMarket(venue, '').then((rows) => {
      if (stop) return
      setCatalog(rows)
      setNote(rows.length ? null : 'Nothing listed.')
    })
    return () => {
      stop = true
    }
  }, [venue])

  useEffect(() => {
    if (venue !== 'stock') return
    const text = query.trim()
    if (text.length < 1) {
      setHits([])
      setNote(null)
      return
    }
    let stop = false
    setNote('Searching…')
    const timer = window.setTimeout(() => {
      void searchMarket('stock', text).then((rows) => {
        if (stop) return
        setHits(rows)
        setNote(rows.length ? null : 'Nothing matches.')
      })
    }, 220)
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [query, venue])

  const needle = query.trim().toLowerCase()
  const items =
    venue === 'stock'
      ? hits
      : catalog.filter((item) => `${item.label} ${item.name} ${item.symbol}`.toLowerCase().includes(needle))

  return (
    <aside className="book">
      <div className="classes" role="tablist" aria-label="Instrument class">
        {CLASSES.map((item) => (
          <button
            key={item.venue}
            type="button"
            role="tab"
            aria-selected={venue === item.venue}
            onClick={() => onVenue(item.venue)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className="finder">
        <span className="sr">Find an instrument</span>
        <input
          value={query}
          placeholder="Any name"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ul className="names">
        {items.map((item) => {
          const quote = quotes[item.id]
          return (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === selectedId ? 'name selected' : 'name'}
                onClick={() => onSelect(item)}
              >
                <span>
                  <strong>{item.label}</strong>
                  <em>{item.name}</em>
                </span>
                {quote ? (
                  <span className="name-px">
                    <strong>{formatPrice(quote.price, item.venue)}</strong>
                    <em className={pnlClass(quote.change)}>{formatPct(quote.changePct)}</em>
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
        {note ? <li className="hint pad">{note}</li> : null}
        {venue === 'stock' && !query.trim() && !note ? (
          <li className="hint pad">Search any listing. Oracle, Tomra, Anthropic, the rest.</li>
        ) : null}
      </ul>
    </aside>
  )
}
