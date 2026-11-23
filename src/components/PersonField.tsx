import { useEffect, useId, useState } from 'react'
import { searchPeople } from '../lib/api'
import type { Person } from '../types'

export function PersonField({
  person,
  onChange,
}: {
  person: Person | null
  onChange: (person: Person | null) => void
}) {
  const listId = useId()
  const [text, setText] = useState(person?.screenName ?? '')
  const [people, setPeople] = useState<Person[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setText(person?.screenName ?? '')
  }, [person])

  useEffect(() => {
    const query = text.trim().replace(/^@/, '')
    if (person && query.toLowerCase() === person.screenName.toLowerCase()) {
      setPeople([])
      setMessage(null)
      setSearching(false)
      return
    }
    if (query.length < 1) {
      setPeople([])
      setMessage(null)
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      void searchPeople(query).then((result) => {
        if (controller.signal.aborted) return
        setPeople(result.people)
        setMessage(result.message)
        setSearching(false)
        setOpen(true)
      })
    }, 220)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [text, person])

  function pick(next: Person) {
    onChange(next)
    setText(next.screenName)
    setPeople([])
    setOpen(false)
  }

  function onText(value: string) {
    setText(value)
    if (!person || value.trim().replace(/^@/, '').toLowerCase() !== person.screenName.toLowerCase()) {
      onChange(null)
    }
    setOpen(true)
  }

  return (
    <div className="person">
      <label htmlFor="person">Person</label>
      <input
        id="person"
        autoComplete="off"
        spellCheck={false}
        placeholder="Username"
        value={text}
        aria-controls={listId}
        aria-expanded={open && (people.length > 0 || !!message)}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && people[0] && !person) {
            event.preventDefault()
            pick(people[0])
          }
        }}
      />
      {person ? (
        <p className="person-picked">
          {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : <span className="avatar-fallback" />}
          <span>
            {person.name} · @{person.screenName}
          </span>
        </p>
      ) : null}
      {open && !person ? (
        <div className="person-results" id={listId}>
          {searching ? <p className="hint">Searching Xitter…</p> : null}
          {message ? <p className="hint">{message}</p> : null}
          {!searching && !message && text.trim() && people.length === 0 ? (
            <p className="hint">No accounts match.</p>
          ) : null}
          {people.map((item) => (
            <button key={item.id} type="button" className="person-row" onClick={() => pick(item)}>
              {item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : <span className="avatar-fallback" />}
              <span>
                <strong>{item.name}</strong>
                <span>@{item.screenName}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
