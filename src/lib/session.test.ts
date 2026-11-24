import { describe, expect, it } from 'vitest'
import { equitySession, formatCountdown, sessionFromMarketState, sessionSchedule, shownSession } from './session'

function ny(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute))
  const bag: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utc)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  let h = Number(bag.hour)
  if (h === 24) h = 0
  const asUtc = Date.UTC(Number(bag.year), Number(bag.month) - 1, Number(bag.day), h, Number(bag.minute), Number(bag.second))
  return new Date(utc.getTime() - (asUtc - utc.getTime()))
}

describe('equity session', () => {
  it('reads a New York wall clock through daylight saving', () => {
    expect(ny(2026, 11, 24, 10, 0).toISOString()).toBe('2026-11-24T15:00:00.000Z')
    expect(ny(2026, 7, 6, 9, 30).toISOString()).toBe('2026-07-06T13:30:00.000Z')
  })

  it('splits a normal weekday into pre, open, post, and closed', () => {
    expect(equitySession(ny(2026, 11, 24, 3, 59))).toBe('closed')
    expect(equitySession(ny(2026, 11, 24, 4, 0))).toBe('pre')
    expect(equitySession(ny(2026, 11, 24, 9, 29))).toBe('pre')
    expect(equitySession(ny(2026, 11, 24, 9, 30))).toBe('open')
    expect(equitySession(ny(2026, 11, 24, 15, 59))).toBe('open')
    expect(equitySession(ny(2026, 11, 24, 16, 0))).toBe('post')
    expect(equitySession(ny(2026, 11, 24, 19, 59))).toBe('post')
    expect(equitySession(ny(2026, 11, 24, 20, 0))).toBe('closed')
  })

  it('stays closed over the weekend', () => {
    expect(equitySession(ny(2026, 11, 28, 12, 0))).toBe('closed')
    expect(equitySession(ny(2026, 11, 22, 20, 0))).toBe('closed')
    expect(equitySession(ny(2026, 11, 23, 4, 0))).toBe('pre')
  })

  it('closes for the published 2026 holidays', () => {
    for (const [month, day] of [
      [1, 1],
      [1, 19],
      [2, 16],
      [4, 3],
      [5, 25],
      [6, 19],
      [7, 3],
      [9, 7],
      [11, 26],
      [12, 25],
    ]) {
      expect(equitySession(ny(2026, month, day, 10, 0))).toBe('closed')
    }
    expect(equitySession(ny(2026, 7, 2, 10, 0))).toBe('open')
    expect(equitySession(ny(2026, 4, 2, 10, 0))).toBe('open')
  })

  it('closes early the day after Thanksgiving and on Christmas Eve', () => {
    expect(equitySession(ny(2026, 11, 27, 12, 59))).toBe('open')
    expect(equitySession(ny(2026, 11, 27, 13, 0))).toBe('post')
    expect(equitySession(ny(2026, 11, 27, 16, 59))).toBe('post')
    expect(equitySession(ny(2026, 11, 27, 17, 0))).toBe('closed')
    expect(equitySession(ny(2026, 12, 24, 12, 30))).toBe('open')
    expect(equitySession(ny(2026, 12, 24, 13, 0))).toBe('post')
  })

  it('follows the 2027 observed dates', () => {
    expect(equitySession(ny(2027, 3, 26, 11, 0))).toBe('closed')
    expect(equitySession(ny(2027, 6, 18, 11, 0))).toBe('closed')
    expect(equitySession(ny(2027, 7, 5, 11, 0))).toBe('closed')
    expect(equitySession(ny(2027, 12, 24, 11, 0))).toBe('closed')
    expect(equitySession(ny(2027, 11, 26, 12, 0))).toBe('open')
    expect(equitySession(ny(2027, 11, 26, 13, 0))).toBe('post')
    expect(equitySession(ny(2027, 7, 2, 11, 0))).toBe('open')
  })

  it('keeps the Friday open when New Year falls on Saturday', () => {
    expect(equitySession(ny(2027, 12, 31, 10, 0))).toBe('open')
    expect(equitySession(ny(2021, 12, 31, 10, 0))).toBe('open')
    expect(equitySession(ny(2017, 1, 2, 10, 0))).toBe('closed')
  })

  it('closes early on July 3 only when July 4 is a weekday session', () => {
    expect(equitySession(ny(2025, 7, 3, 12, 0))).toBe('open')
    expect(equitySession(ny(2025, 7, 3, 13, 0))).toBe('post')
    expect(equitySession(ny(2025, 7, 4, 10, 0))).toBe('closed')
  })

  it('reads a Yahoo market state', () => {
    expect(sessionFromMarketState('PRE')).toBe('pre')
    expect(sessionFromMarketState('REGULAR')).toBe('open')
    expect(sessionFromMarketState('POST')).toBe('post')
    expect(sessionFromMarketState('PREPRE')).toBe('closed')
    expect(sessionFromMarketState('POSTPOST')).toBe('closed')
    expect(sessionFromMarketState('CLOSED')).toBe('closed')
    expect(sessionFromMarketState(null)).toBeNull()
    expect(sessionFromMarketState('HALTED')).toBeNull()
  })

  it('counts down to each New York session in absolute time', () => {
    const premarket = ny(2026, 11, 24, 8, 45)
    const rows = sessionSchedule(premarket)
    expect(rows.map((row) => [row.id, row.at.toISOString()])).toEqual([
      ['pre', '2026-11-24T09:00:00.000Z'],
      ['open', '2026-11-24T14:30:00.000Z'],
      ['post', '2026-11-24T21:00:00.000Z'],
      ['closed', '2026-11-25T01:00:00.000Z'],
    ])
    expect(formatCountdown(premarket, rows[0]!.at, true)).toBe('now')
    expect(formatCountdown(premarket, rows[1]!.at, false)).toBe('in 45m')
    const open = sessionSchedule(ny(2026, 11, 24, 10, 0))
    expect(open.find((row) => row.id === 'pre')?.at.toISOString()).toBe('2026-11-25T09:00:00.000Z')
    const early = sessionSchedule(ny(2026, 11, 27, 12, 0))
    expect(early.find((row) => row.id === 'post')?.at.toISOString()).toBe('2026-11-27T18:00:00.000Z')
    expect(early.find((row) => row.id === 'closed')?.at.toISOString()).toBe('2026-11-27T22:00:00.000Z')
    const weekend = sessionSchedule(ny(2026, 11, 28, 12, 0))
    expect(weekend.find((row) => row.id === 'open')?.at.toISOString()).toBe('2026-11-30T14:30:00.000Z')
    expect(weekend.find((row) => row.id === 'closed')?.at.toISOString()).toBe('2026-11-27T22:00:00.000Z')
  })

  it('keeps a user stock open when the stock market is closed', () => {
    expect(shownSession('launch', 'closed')).toEqual({
      id: 'all',
      label: 'Trades all day',
      title: 'User stocks trade all day',
    })
    expect(shownSession('stock', 'closed').label).toBe('Market closed')
    expect(shownSession('crypto', 'pre').label).toBe('Pre-market')
  })
})
