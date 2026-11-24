import { useEffect, useState } from 'react'
import { openOn } from '../data/universe'
import { fetchQuotes, openFor } from '../lib/api'
import type { Instrument, Quote, Venue } from '../types'
import type { Person } from '../types'
import { PersonField } from './PersonField'
import { SymbolBook } from './SymbolBook'

export function AdminComposer({ onOpened }: { onOpened: () => void }) {
  const [open, setOpen] = useState(false)
  const [venue, setVenue] = useState<Venue>('stock')
  const [instrument, setInstrument] = useState<Instrument>(openOn('stock'))
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [amountText, setAmountText] = useState('')
  const [person, setPerson] = useState<Person | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let stop = false
    void fetchQuotes([instrument.id]).then((rows) => {
      if (stop) return
      setQuotes((current) => {
        const next = { ...current }
        for (const row of rows) next[row.id] = row
        return next
      })
    })
    return () => {
      stop = true
    }
  }, [instrument.id, open])

  const amount = Number(amountText.replace(/[$,\s]/g, ''))
  const ready = person && amount >= 1 && !busy

  return (
    <>
      <button type="button" className="invest composer-toggle" onClick={() => setOpen((value) => !value)}>
        {open ? 'Close' : 'Open a position'}
      </button>
      {open ? (
        <div className="composer">
          <p className="ticket-kicker">Admin</p>
          <h2>File it under someone</h2>
          <p className="hint">Paper size. It shows up as their position. It does not spend Equicoins.</p>
          <div className="composer-grid">
            <SymbolBook
              venue={venue}
              onVenue={(next) => {
                setVenue(next)
                if (instrument.venue !== next) setInstrument(openOn(next))
              }}
              selectedId={instrument.id}
              onSelect={(next) => {
                setInstrument(next)
                setVenue(next.venue)
              }}
              quotes={quotes}
            />
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!person || !(amount >= 1)) return
                setBusy(true)
                setNotice(null)
                void openFor(instrument.id, amount, person.screenName)
                  .then((screenName) => {
                    setNotice(`Filed under @${screenName}.`)
                    setAmountText('')
                    onOpened()
                  })
                  .catch((error: unknown) => {
                    setNotice(error instanceof Error ? error.message : 'Could not open that position.')
                  })
                  .finally(() => setBusy(false))
              }}
            >
              <label htmlFor="admin-amount">Amount</label>
              <input
                id="admin-amount"
                inputMode="decimal"
                placeholder="100"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
              />
              <PersonField person={person} onChange={setPerson} />
              <button className="invest" type="submit" disabled={!ready}>
                {busy ? 'Filing…' : `File ${instrument.label}`}
              </button>
              {notice ? <p className="notice">{notice}</p> : null}
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
