import { useEffect, useState } from 'react'
import { launchFor } from '../lib/api'
import { formatUsd } from '../lib/format'

const STEPS = ['symbol', 'name', 'liquidity', 'invest', 'summary'] as const
type Step = (typeof STEPS)[number]

export function LaunchForm({
  nqfxCents,
  onLaunched,
  onClose,
  start,
}: {
  nqfxCents: number
  onLaunched: () => void
  onClose: () => void
  start?: { step?: Step; symbol?: string; name?: string; liquidity?: string; invest?: string }
}) {
  const [step, setStep] = useState<Step>(start?.step ?? 'symbol')
  const [symbolText, setSymbolText] = useState(start?.symbol ?? '')
  const [name, setName] = useState(start?.name ?? '')
  const [liquidityText, setLiquidityText] = useState(start?.liquidity ?? '')
  const [investText, setInvestText] = useState(start?.invest ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const ticker = cleanSymbol(symbolText)
  const cleanedName = cleanName(name)
  const label = ticker ? `xit${ticker}` : 'xit…'
  const liquidityCents = centsOf(liquidityText)
  const investCents = investText.trim() === '' ? 0 : centsOf(investText)
  const fields = { symbol: symbolText, name, liquidity: liquidityText, invest: investText }
  const nextOk = stepReady(step, fields)
  const short = Number.isFinite(liquidityCents) && Number.isFinite(investCents) && liquidityCents + investCents > nqfxCents
  const badInvest = investText.trim() !== '' && !(investCents === 0 || investCents >= 100)
  const launchReady = Boolean(ticker && cleanedName && liquidityCents >= 100 && !badInvest && !short && !busy)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function go(forward: boolean) {
    const index = STEPS.indexOf(step)
    const next = STEPS[index + (forward ? 1 : -1)]
    if (!next) return
    if (forward && !nextOk) return
    setNotice(null)
    setStep(next)
  }

  function launch() {
    if (!launchReady || !ticker || !cleanedName) return
    setBusy(true)
    setNotice(null)
    void launchFor(ticker, cleanedName, liquidityCents / 100, investCents / 100)
      .then(() => {
        onLaunched()
      })
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : 'Could not launch that stock.')
        setBusy(false)
      })
  }

  const problem = short
    ? "You don't have enough Cash. Send Equicoins with the note vault."
    : badInvest
      ? 'Invest at least $1, or leave it blank.'
      : null

  return (
    <div className="toast-scrim" onMouseDown={onClose}>
      <form
        className="toast-card launch-form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (step === 'summary') launch()
          else go(true)
        }}
      >
        <button type="button" className="toast-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h2 id="launch-title">Launch a stock</h2>
        {step === 'symbol' ? (
          <>
            <label htmlFor="launch-symbol">Symbol</label>
            <input
              id="launch-symbol"
              key="symbol"
              value={symbolText}
              maxLength={12}
              autoFocus
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="YAMS"
              onChange={(event) => setSymbolText(event.target.value)}
            />
            <p className="hint">Buyers write {label} in the note. It trades all day.</p>
          </>
        ) : null}
        {step === 'name' ? (
          <>
            <label htmlFor="launch-name">Name</label>
            <input
              id="launch-name"
              key="name"
              value={name}
              maxLength={40}
              autoFocus
              placeholder="Yams"
              onChange={(event) => setName(event.target.value)}
            />
          </>
        ) : null}
        {step === 'liquidity' ? (
          <>
            <label htmlFor="launch-liquidity">Liquidity</label>
            <input
              id="launch-liquidity"
              key="liquidity"
              inputMode="decimal"
              autoFocus
              placeholder="100"
              value={liquidityText}
              onChange={(event) => setLiquidityText(event.target.value)}
            />
            <p className="hint">Liquidity stays in the fund and covers closes. At least $1.</p>
          </>
        ) : null}
        {step === 'invest' ? (
          <>
            <label htmlFor="launch-invest">Invest</label>
            <input
              id="launch-invest"
              key="invest"
              inputMode="decimal"
              autoFocus
              placeholder="optional"
              value={investText}
              onChange={(event) => setInvestText(event.target.value)}
            />
            <p className="hint">Optional. Buys shares now at $1.</p>
          </>
        ) : null}
        {step === 'summary' ? (
          <dl className="toast-summary">
            <div>
              <dt>Symbol</dt>
              <dd>{label}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{cleanedName ?? name}</dd>
            </div>
            <div>
              <dt>Liquidity</dt>
              <dd>{Number.isFinite(liquidityCents) ? formatUsd(liquidityCents / 100) : '—'}</dd>
            </div>
            <div>
              <dt>Invest</dt>
              <dd>{investCents > 0 ? formatUsd(investCents / 100) : 'None'}</dd>
            </div>
          </dl>
        ) : null}
        {step === 'summary' && problem ? <p className="notice">{problem}</p> : null}
        {notice ? <p className="notice">{notice}</p> : null}
        <div className="toast-actions">
          {step === 'symbol' ? <span /> : (
            <button type="button" className="text-btn" onClick={() => go(false)}>
              Back
            </button>
          )}
          {step === 'summary' ? (
            <button className="invest" type="submit" disabled={!launchReady}>
              {busy ? 'Launching…' : `Launch ${label}`}
            </button>
          ) : (
            <button className="invest" type="submit" disabled={!nextOk}>
              Next
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

export function stepReady(
  step: Step,
  input: { symbol: string; name: string; liquidity: string; invest: string },
): boolean {
  if (step === 'symbol') return cleanSymbol(input.symbol) !== null
  if (step === 'name') return cleanName(input.name) !== null
  if (step === 'liquidity') return centsOf(input.liquidity) >= 100
  return true
}

function cleanSymbol(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, '')
  const prefixed = trimmed.match(/^xit([A-Za-z]{2,8})$/i)
  const symbol = (prefixed?.[1] ?? trimmed).toUpperCase()
  if (!/^[A-Z]{2,8}$/.test(symbol)) return null
  return symbol
}

function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim()
  const length = [...name].length
  if (length < 1 || length > 40) return null
  if (/[\u0000-\u001f]/.test(name)) return null
  return name
}

function centsOf(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!cleaned) return Number.NaN
  const amount = Number(cleaned)
  if (!Number.isFinite(amount)) return Number.NaN
  return Math.round(amount * 100)
}
