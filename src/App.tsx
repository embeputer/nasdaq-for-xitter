import { useEffect, useMemo, useState } from 'react'
import { closeFor, fetchBook, fetchCandles, fetchQuotes, fetchSession, logout, type Book, type Viewer } from './lib/api'
import { marketValue } from './lib/account'
import { formatUsd } from './lib/format'
import { Discover } from './components/Discover'
import { Portfolio } from './components/Portfolio'
import type { Candle, Interval, Position, Quote } from './types'

function viewFromLocation(): 'discover' | 'portfolio' {
  return window.location.hash === '#portfolio' ? 'portfolio' : 'discover'
}

export default function App() {
  const [view, setView] = useState<'discover' | 'portfolio'>(viewFromLocation)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [book, setBook] = useState<Book>({ positions: [], fills: [], desks: [], durable: true })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [interval, setInterval] = useState<Interval>('1m')
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [candles, setCandles] = useState<Candle[]>([])
  const [chartError, setChartError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const hash = view === 'portfolio' ? '#portfolio' : '#discover'
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
  }, [view])

  useEffect(() => {
    const sync = () => setView(viewFromLocation())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    const failed = new URLSearchParams(window.location.search).get('login')
    if (failed) setNotice('Xitter sign-in did not finish.')
    void fetchSession().then(setViewer)
  }, [])

  useEffect(() => {
    let stop = false
    const load = () => {
      void fetchBook()
        .then((next) => {
          if (!stop) setBook(next)
        })
        .catch(() => {
          if (!stop) setNotice('The book did not load.')
        })
    }
    load()
    const timer = window.setInterval(load, 4000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [])

  const selected = book.positions.find((position) => position.id === selectedId) ?? book.positions[0] ?? null
  const quoteIds = useMemo(() => {
    const ids = book.positions.map((position) => `${position.venue}:${position.symbol}`)
    return [...new Set(ids)].slice(0, 40)
  }, [book.positions])

  useEffect(() => {
    if (!quoteIds.length) return
    let stop = false
    const load = () => {
      void fetchQuotes(quoteIds).then((rows) => {
        if (stop) return
        setQuotes((current) => {
          const next = { ...current }
          for (const row of rows) next[row.id] = row
          return next
        })
      })
    }
    load()
    const timer = window.setInterval(load, view === 'discover' ? 2000 : 4000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [quoteIds, view])

  useEffect(() => {
    if (!selected) return
    let stop = false
    const id = `${selected.venue}:${selected.symbol}`
    const load = () => {
      void fetchCandles(id, interval)
        .then((rows) => {
          if (stop) return
          setCandles(rows)
          setChartError(rows.length ? null : 'No candles for that market.')
        })
        .catch(() => {
          if (!stop) setChartError('The chart did not load.')
        })
    }
    load()
    const timer = window.setInterval(load, 20_000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [selected?.id, selected?.symbol, selected?.venue, interval])

  const bookValue = book.positions.reduce(
    (sum, position) => sum + marketValue(position, quotes[`${position.venue}:${position.symbol}`]?.price),
    0,
  )

  async function refresh() {
    setBook(await fetchBook())
  }

  return (
    <div className={view === 'discover' ? 'app app-board' : 'app app-sheet'}>
      <header className="topbar">
        <p className="mark">Nasdaq for Xitter</p>
        <nav>
          <button type="button" aria-current={view === 'discover' ? 'page' : undefined} onClick={() => setView('discover')}>
            Discover
          </button>
          <button type="button" aria-current={view === 'portfolio' ? 'page' : undefined} onClick={() => setView('portfolio')}>
            Portfolio
          </button>
        </nav>
        <div className="snap">
          {viewer ? (
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                void logout().then(() => setViewer(null))
              }}
            >
              @{viewer.screenName}
            </button>
          ) : (
            <a className="login-mini" href="/api/oauth/start">
              Log in
            </a>
          )}
          <p>
            <span>Book</span>
            <strong>{formatUsd(bookValue)}</strong>
          </p>
        </div>
      </header>
      {!book.durable ? <p className="hint durable">This deploy has no database, so positions will not stick. Set POSTGRES_URL.</p> : null}
      {notice ? <p className="hint durable">{notice}</p> : null}
      {view === 'discover' ? (
        <Discover
          positions={book.positions}
          quotes={quotes}
          viewer={viewer}
          desks={book.desks}
          selected={selected}
          onSelect={(position: Position) => setSelectedId(position.id)}
          interval={interval}
          onInterval={setInterval}
          candles={candles}
          chartError={chartError}
        />
      ) : (
        <Portfolio
          viewer={viewer}
          positions={book.positions}
          fills={viewer?.admin ? book.fills : book.fills.filter((fill) => fill.person.screenName.toLowerCase() === viewer?.screenName.toLowerCase())}
          quotes={quotes}
          desks={book.desks}
          onClose={(position) => {
            void closeFor(position.id).then(refresh).catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : 'Could not close.')
            })
          }}
          onOpened={() => {
            void refresh()
          }}
        />
      )}
    </div>
  )
}
