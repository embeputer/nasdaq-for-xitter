import { useEffect, useRef, useState } from 'react'
import { saveLogo } from '../lib/api'
import { LOGO_BAD, logoFileOk } from '../lib/logo'

export function LogoMark({
  symbol,
  label,
  src,
  editable,
  onSaved,
}: {
  symbol: string
  label: string
  src?: string
  editable: boolean
  onSaved: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [broken, setBroken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    setBroken(false)
  }, [src])
  const picture = !broken && src ? <img src={src} alt="" onError={() => setBroken(true)} /> : <span className="avatar-fallback">{symbol.slice(0, 1)}</span>

  function pick(file: File | undefined) {
    if (!file) return
    if (!logoFileOk(file)) {
      setNotice(LOGO_BAD)
      return
    }
    setBusy(true)
    setNotice(null)
    void saveLogo(symbol, file)
      .then(() => {
        setBroken(false)
        onSaved()
      })
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : 'Could not save that logo.')
      })
      .finally(() => setBusy(false))
  }

  return (
    <span className="logo-mark">
      {editable ? (
        <button type="button" className="logo-hit" aria-label={`Change the logo for ${label}`} disabled={busy} onClick={() => input.current?.click()}>
          {picture}
        </button>
      ) : (
        picture
      )}
      {editable ? (
        <input
          ref={input}
          className="logo-file"
          type="file"
          aria-hidden="true"
          tabIndex={-1}
          accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            pick(file)
          }}
        />
      ) : null}
      {notice ? <p className="logo-note">{notice}</p> : null}
    </span>
  )
}
