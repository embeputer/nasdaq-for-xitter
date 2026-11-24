import { useState } from 'react'
import { launchFor } from '../lib/api'
import { formatUsd } from '../lib/format'

export function LaunchForm({ nqfxCents, onLaunched }: { nqfxCents: number; onLaunched: () => void }) {
  const [symbolText, setSymbolText] = useState('')
  const [name, setName] = useState('')
  const [liquidityText, setLiquidityText] = useState('')
  const [investText, setInvestText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const symbol = symbolText.trim().replace(/\s+/g, '')
  const prefixed = symbol.match(/^xit([A-Za-z]{2,8})$/i)
  const ticker = (prefixed?.[1] ?? symbol).toUpperCase()
  const validSymbol = /^[A-Z]{2,8}$/.test(ticker)
  const label = validSymbol ? `xit${ticker}` : 'xit…'
  const liquidityCents = centsOf(liquidityText)
  const investCents = investText.trim() === '' ? 0 : centsOf(investText)
  const ready =
    validSymbol &&
    name.trim().length > 0 &&
    name.trim().length <= 40 &&
    liquidityCents >= 100 &&
    (investCents === 0 || investCents >= 100) &&
    liquidityCents + investCents <= nqfxCents &&
    !busy

  return (
    <section className="composer-wrap">
      <h2>Launch a stock</h2>
      <p className="hint">
        Liquidity stays in the fund and covers closes. Invest is optional and buys shares now at $1. Buyers write {label} in the note.
      </p>
      <form
        className="launch-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready) return
          const locked = formatUsd(liquidityCents / 100)
          const question =
            investCents > 0
              ? `Lock ${locked} in the fund and invest ${formatUsd(investCents / 100)} in ${label}?`
              : `Lock ${locked} in the fund and launch ${label}?`
          if (!window.confirm(question)) return
          setBusy(true)
          setNotice(null)
          void launchFor(ticker, name.trim(), liquidityCents / 100, investCents / 100)
            .then((launched) => {
              setNotice(`Launched ${launched}.`)
              setSymbolText('')
              setName('')
              setLiquidityText('')
              setInvestText('')
              onLaunched()
            })
            .catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : 'Could not launch that stock.')
            })
            .finally(() => setBusy(false))
        }}
      >
        <label htmlFor="launch-symbol">Symbol</label>
        <input
          id="launch-symbol"
          value={symbolText}
          maxLength={12}
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="YAMS"
          onChange={(event) => setSymbolText(event.target.value)}
        />
        <label htmlFor="launch-name">Name</label>
        <input
          id="launch-name"
          value={name}
          maxLength={40}
          placeholder="Yams"
          onChange={(event) => setName(event.target.value)}
        />
        <label htmlFor="launch-liquidity">Liquidity</label>
        <input
          id="launch-liquidity"
          inputMode="decimal"
          placeholder="100"
          value={liquidityText}
          onChange={(event) => setLiquidityText(event.target.value)}
        />
        <label htmlFor="launch-invest">Invest</label>
        <input
          id="launch-invest"
          inputMode="decimal"
          placeholder="optional"
          value={investText}
          onChange={(event) => setInvestText(event.target.value)}
        />
        <button className="invest" type="submit" disabled={!ready}>
          {busy ? 'Launching…' : `Launch ${label}`}
        </button>
        {notice ? <p className="notice">{notice}</p> : null}
      </form>
    </section>
  )
}

function centsOf(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!cleaned) return Number.NaN
  const amount = Number(cleaned)
  if (!Number.isFinite(amount)) return Number.NaN
  return Math.round(amount * 100)
}
