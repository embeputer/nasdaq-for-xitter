import { useEffect, useState } from 'react'
import { fetchModeration, saveModeration, type ModerationKind, type ModerationState } from '../lib/api'

export function ModerationPanel({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ModerationState | null>(null)
  const [launchText, setLaunchText] = useState('')
  const [marketVenue, setMarketVenue] = useState<'stock' | 'crypto'>('stock')
  const [marketText, setMarketText] = useState('')
  const [userText, setUserText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let stop = false
    void fetchModeration()
      .then((next) => {
        if (!stop) setState(next)
      })
      .catch((error: unknown) => {
        if (!stop) setNotice(error instanceof Error ? error.message : 'Could not load moderation controls.')
      })
    return () => {
      stop = true
    }
  }, [open])

  function apply(kind: ModerationKind, target: string, active: boolean, clear?: () => void) {
    const clean = target.trim()
    if (!clean || busy) return
    setBusy(true)
    setNotice(null)
    void saveModeration(kind, clean, active)
      .then((next) => {
        setState(next)
        clear?.()
        onChanged()
      })
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : 'Could not update moderation.')
      })
      .finally(() => setBusy(false))
  }

  return (
    <>
      <button
        type="button"
        className="invest composer-toggle"
        onClick={() => {
          setNotice(null)
          setOpen((value) => !value)
        }}
      >
        {open ? 'Close mod' : 'Moderate'}
      </button>
      {open ? (
        <div className="composer mod-panel">
          <p className="ticket-kicker">Moderator</p>
          <h2>Delist or restrict</h2>
          <p className="hint">Existing holders can still close positions and withdraw.</p>
          {notice ? <p className="notice">{notice}</p> : null}

          <section className="mod-group">
            <h3>xitStocks</h3>
            <form
              className="mod-row"
              onSubmit={(event) => {
                event.preventDefault()
                apply('delist_launch', launchText, true, () => setLaunchText(''))
              }}
            >
              <input
                aria-label="xitStock symbol to delist"
                placeholder="xitYAMS or YAMS"
                value={launchText}
                onChange={(event) => setLaunchText(event.target.value)}
              />
              <button type="submit" className="close" disabled={busy || !launchText.trim()}>
                Delist
              </button>
            </form>
            {state?.launches.length ? (
              <ul className="mod-list">
                {state.launches.map((launch) => (
                  <li key={launch.symbol}>
                    <span>
                      <strong>{launch.label}</strong> {launch.name}
                      {launch.creator ? <em> by @{launch.creator}</em> : null}
                      {launch.delisted ? <i className="mod-tag">Delisted</i> : null}
                    </span>
                    <button
                      type="button"
                      className="close"
                      disabled={busy}
                      onClick={() => apply('delist_launch', launch.symbol, !launch.delisted)}
                    >
                      {launch.delisted ? 'Restore' : 'Delist'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No launched xitStocks yet.</p>
            )}
          </section>

          <section className="mod-group">
            <h3>Markets</h3>
            <form
              className="mod-row"
              onSubmit={(event) => {
                event.preventDefault()
                const clean = marketText.trim()
                if (!clean) return
                const target = clean.includes(':') ? clean : `${marketVenue}:${clean}`
                apply('restrict_market', target, true, () => setMarketText(''))
              }}
            >
              <select
                aria-label="Market class"
                value={marketVenue}
                onChange={(event) => setMarketVenue(event.target.value === 'crypto' ? 'crypto' : 'stock')}
              >
                <option value="stock">Stock</option>
                <option value="crypto">Crypto</option>
              </select>
              <input
                aria-label="Market symbol to restrict"
                placeholder={marketVenue === 'crypto' ? 'BTC' : 'TQQQ'}
                value={marketText}
                onChange={(event) => setMarketText(event.target.value)}
              />
              <button type="submit" className="close" disabled={busy || !marketText.trim()}>
                Restrict
              </button>
            </form>
            {state?.restrictedMarkets.length ? (
              <ul className="mod-list">
                {state.restrictedMarkets.map((market) => (
                  <li key={market}>
                    <span>
                      <strong>{market}</strong>
                    </span>
                    <button
                      type="button"
                      className="close"
                      disabled={busy}
                      onClick={() => apply('restrict_market', market, false)}
                    >
                      Unrestrict
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No restricted markets.</p>
            )}
          </section>

          <section className="mod-group">
            <h3>Users</h3>
            <form
              className="mod-row"
              onSubmit={(event) => {
                event.preventDefault()
                apply('restrict_user', userText, true, () => setUserText(''))
              }}
            >
              <input
                aria-label="Username to restrict"
                placeholder="@username"
                value={userText}
                onChange={(event) => setUserText(event.target.value)}
              />
              <button type="submit" className="close" disabled={busy || !userText.trim()}>
                Restrict
              </button>
            </form>
            {state?.restrictedUsers.length ? (
              <ul className="mod-list">
                {state.restrictedUsers.map((user) => (
                  <li key={user}>
                    <span>
                      <strong>@{user}</strong>
                    </span>
                    <button
                      type="button"
                      className="close"
                      disabled={busy}
                      onClick={() => apply('restrict_user', user, false)}
                    >
                      Unrestrict
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No restricted users.</p>
            )}
          </section>
        </div>
      ) : null}
    </>
  )
}
