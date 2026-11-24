import { useEffect, useState } from 'react'
import { formatUsd } from '../lib/format'

export function WithdrawForm({
  nqfxCents,
  onClose,
  onWithdraw,
}: {
  nqfxCents: number
  onClose: () => void
  onWithdraw: (amount: number) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const cents = centsOf(text)
  const over = Number.isFinite(cents) && cents > nqfxCents
  const small = text.trim() !== '' && !(cents >= 100)
  const ready = cents >= 100 && cents <= nqfxCents && !busy

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit() {
    if (!ready) return
    setBusy(true)
    setNotice(null)
    void onWithdraw(cents / 100)
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : 'Could not withdraw.')
        setBusy(false)
      })
  }

  const problem = over ? "You don't have that much Cash." : small ? 'Withdraw at least $1.' : null

  return (
    <div className="toast-scrim" onMouseDown={onClose}>
      <form
        className="toast-card launch-form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="withdraw-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <button type="button" className="toast-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h2 id="withdraw-title">Withdraw</h2>
        <p className="hint">Cash {formatUsd(nqfxCents / 100)}. Equicoins go back to your account.</p>
        <label htmlFor="withdraw-amount">Amount</label>
        <input
          id="withdraw-amount"
          inputMode="decimal"
          autoFocus
          placeholder="10"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {problem ? <p className="notice">{problem}</p> : null}
        {notice ? <p className="notice">{notice}</p> : null}
        <div className="toast-actions">
          <button className="invest" type="submit" disabled={!ready}>
            {busy ? 'Sending…' : 'Withdraw'}
          </button>
        </div>
      </form>
    </div>
  )
}

function centsOf(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!cleaned) return Number.NaN
  const amount = Number(cleaned)
  if (!Number.isFinite(amount)) return Number.NaN
  return Math.round(amount * 100)
}
