import { useEffect, useMemo, useState } from 'react'
import { closeFor, fetchBook, fetchCandles, fetchQuotes, fetchSession, logout, withdrawFor, type Book, type Viewer } from './lib/api'
import { marketValue } from './lib/account'
import { formatUsd } from './lib/format'
import { equitySession, sessionFromMarketState, shownSession, type EquitySession } from './lib/session'
import { noisePosition, NOISE_QUOTE } from './lib/noise'
import { CRYPTO_POLL_MS, STOCK_POLL_MS, candlePollMs, quoteGroups } from './lib/poll'
import { Discover } from './components/Discover'
import { SessionRibbon } from './components/SessionRibbon'
import { LaunchForm } from './components/LaunchForm'
import { WithdrawForm } from './components/WithdrawForm'
import { Portfolio } from './components/Portfolio'
import type { Candle, Position, Quote } from './types'

function liveSession(quotes: Record<string, Quote>, selected: Position | null, now: Date): EquitySession {
  const selectedQuote = selected ? quotes[`${selected.venue}:${selected.symbol}`] : undefined
  const fromSelected = selectedQuote?.venue === 'stock' ? sessionFromMarketState(selectedQuote.marketState) : null
  if (fromSelected) return fromSelected
  for (const quote of Object.values(quotes)) {
    if (quote.venue !== 'stock') continue
    const parsed = sessionFromMarketState(quote.marketState)
    if (parsed) return parsed
  }
  return equitySession(now)
}

function pollQuotes(ids: string[], ms: number, setQuotes: (update: (current: Record<string, Quote>) => Record<string, Quote>) => void) {
  if (!ids.length) return
  let stop = false
  const load = () => {
    void fetchQuotes(ids)
      .then((rows) => {
        if (stop) return
        setQuotes((current) => {
          const next = { ...current }
          for (const row of rows) next[row.id] = row
          return next
        })
      })
      .catch(() => {
        // the next tick tries again
      })
  }
  load()
  const timer = window.setInterval(load, ms)
  return () => {
    stop = true
    window.clearInterval(timer)
  }
}

function viewFromLocation(): 'discover' | 'portfolio' {
  if (window.location.hash === '#portfolio') return 'portfolio'
  return 'discover'
}

export default function App() {
  const [view, setView] = useState<'discover' | 'portfolio'>(viewFromLocation)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [book, setBook] = useState<Book>({ positions: [], fills: [], desks: [], durable: true, nqfxCents: 0 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [candles, setCandles] = useState<Candle[]>([])
  const [candleKey, setCandleKey] = useState('')
  const [chartError, setChartError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [launchOpen, setLaunchOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const hash = view === 'portfolio' ? '#portfolio' : '#discover'
    const next = `${window.location.pathname}${window.location.search}${hash}`
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
      window.history.replaceState(null, '', next)
    }
  }, [view])

  useEffect(() => {
    const sync = () => setView(viewFromLocation())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('login')) {
      const step = params.get('step')
      const detail =
        step === 'cookie'
          ? 'The login cookie did not come back.'
          : step === 'token'
            ? 'Xitter rejected the login code.'
            : step === 'profile'
              ? 'Xitter did not return the profile.'
              : step === 'book'
                ? 'The session did not save.'
                : ''
      setNotice(detail ? `Xitter sign-in did not finish. ${detail}` : 'Xitter sign-in did not finish.')
    }
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

  const house = noisePosition()
  const selected =
    selectedId === house.id
      ? house
      : (book.positions.find((position) => position.id === selectedId) ?? book.positions[0] ?? house)
  const nextCandleKey = selected ? `${selected.venue}:${selected.symbol}` : ''
  if (candleKey !== nextCandleKey) {
    setCandleKey(nextCandleKey)
    setCandles([])
  }
  const quoteIds = useMemo(() => {
    const ids = [NOISE_QUOTE, ...book.positions.map((position) => `${position.venue}:${position.symbol}`)]
    return [...new Set(ids)].slice(0, 40)
  }, [book.positions])

  const groupedQuotes = useMemo(() => quoteGroups(quoteIds), [quoteIds])

  useEffect(() => {
    return pollQuotes(groupedQuotes.fast, CRYPTO_POLL_MS, setQuotes)
  }, [groupedQuotes.fast])

  useEffect(() => {
    return pollQuotes(groupedQuotes.slow, STOCK_POLL_MS, setQuotes)
  }, [groupedQuotes.slow])

  useEffect(() => {
    if (!selected) return
    let stop = false
    const id = `${selected.venue}:${selected.symbol}`
    const load = () => {
      void fetchCandles(id, '1m')
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
    const timer = window.setInterval(load, candlePollMs(selected.venue, selected.symbol))
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [selected?.id, selected?.symbol, selected?.venue])

  const session = useMemo(() => liveSession(quotes, selected, now), [quotes, selected, now])
  const ribbon = shownSession(selected?.venue, session)

  const bookValue = book.positions.reduce(
    (sum, position) => sum + marketValue(position, quotes[`${position.venue}:${position.symbol}`]?.price),
    0,
  )

  async function refresh() {
    setBook(await fetchBook())
  }

  async function withdrawCash(amount: number) {
    const result = await withdrawFor(amount)
    setWithdrawOpen(false)
    setNotice(
      result.short
        ? `Sent ${formatUsd(result.cents / 100)} to @${result.screenName}. The rest is still in Cash.`
        : `Sent ${formatUsd(result.cents / 100)} to @${result.screenName}.`,
    )
    try {
      await refresh()
    } catch {
      // the book poll retries
    }
  }

  return (
    <div className={view === 'discover' ? 'app app-board' : 'app app-sheet'}>
      <div className="chrome">
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
            <button type="button" className="launch-open" onClick={() => setWithdrawOpen(true)}>
              Withdraw
            </button>
          ) : null}
          {viewer ? (
            <button type="button" className="launch-open" onClick={() => setLaunchOpen(true)}>
              Launch a stock
            </button>
          ) : null}
          {viewer ? (
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                void logout().then(() => {
                  setViewer(null)
                  setLaunchOpen(false)
                  setWithdrawOpen(false)
                })
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
      <SessionRibbon id={ribbon.id} label={ribbon.label} title={ribbon.title} now={now} />
      </div>
      {viewer && launchOpen ? (
        <LaunchForm
          nqfxCents={book.nqfxCents}
          onClose={() => setLaunchOpen(false)}
          onLaunched={() => {
            setLaunchOpen(false)
            void refresh()
          }}
        />
      ) : null}
      {viewer && withdrawOpen ? (
        <WithdrawForm nqfxCents={book.nqfxCents} onClose={() => setWithdrawOpen(false)} onWithdraw={withdrawCash} />
      ) : null}
      {!book.durable ? <p className="hint durable">This deploy has no database, so positions will not stick. Set POSTGRES_URL.</p> : null}
      {notice ? <p className="hint durable">{notice}</p> : null}
      {view === 'discover' ? (
        <Discover
          house={house}
          positions={book.positions}
          quotes={quotes}
          viewer={viewer}
          desks={book.desks}
          selected={selected}
          onSelect={(position: Position) => setSelectedId(position.id)}
          candles={candles}
          chartError={chartError}
          onLogoSaved={() => {
            if (!quoteIds.length) return
            void fetchQuotes(quoteIds).then((rows) => {
              setQuotes((current) => {
                const next = { ...current }
                for (const row of rows) next[row.id] = row
                return next
              })
            })
          }}
        />
      ) : (
        <Portfolio
          viewer={viewer}
          positions={book.positions}
          fills={viewer?.admin ? book.fills : book.fills.filter((fill) => fill.person.screenName.toLowerCase() === viewer?.screenName.toLowerCase())}
          quotes={quotes}
          desks={book.desks}
          nqfxCents={book.nqfxCents}
          onWithdraw={() => setWithdrawOpen(true)}
          onClose={async (position, cash) => {
            try {
              const result = await closeFor(position.id, cash)
              if (result.cash && result.screenName && typeof result.cents === 'number') {
                setNotice(`Sent ${formatUsd(result.cents / 100)} to @${result.screenName}.`)
              } else {
                setNotice('Closed without sending Equicoins.')
              }
            } catch (error: unknown) {
              setNotice(error instanceof Error ? error.message : 'Could not close.')
              return
            }
            try {
              await refresh()
            } catch {
              // the book poll retries
            }
          }}
          onOpened={() => {
            void refresh()
          }}
        />
      )}
    </div>
  )
}
