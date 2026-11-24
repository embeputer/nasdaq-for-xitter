export type EquitySession = 'pre' | 'open' | 'post' | 'closed'

export const SESSION_LABEL: Record<EquitySession, string> = {
  pre: 'Pre-market',
  open: 'Market open',
  post: 'Post-market',
  closed: 'Market closed',
}

export function shownSession(
  venue: string | null | undefined,
  clock: EquitySession,
): { id: EquitySession | 'all'; label: string; title: string } {
  if (venue === 'launch') return { id: 'all', label: 'Trades all day', title: 'User stocks trade all day' }
  return { id: clock, label: SESSION_LABEL[clock], title: 'US stocks, New York time' }
}

const PRE = 4 * 60
const OPEN = 9 * 60 + 30
const CLOSE = 16 * 60
const POST_END = 20 * 60
const EARLY_CLOSE = 13 * 60
const EARLY_POST_END = 17 * 60

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const holidaysByYear = new Map<number, Set<string>>()
const earlyByYear = new Map<number, Set<string>>()

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

function stamp(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const last = new Date(Date.UTC(year, month, 0))
  return last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)
}

/** Anonymous Gregorian algorithm. Month is 1–12. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

/**
 * Weekday the exchange observes a fixed-date holiday.
 * Saturday moves to Friday, Sunday to Monday.
 * New Year's Day on Saturday does not close the prior Friday.
 */
function observed(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = date.getUTCDay()
  if (weekday === 6) {
    if (month === 1 && day === 1) return null
    date.setUTCDate(date.getUTCDate() - 1)
  } else if (weekday === 0) {
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function holidaySet(year: number): Set<string> {
  const easter = easterSunday(year)
  const dates = [
    observed(year, 1, 1),
    ymd(year, 1, nthWeekday(year, 1, 1, 3)),
    ymd(year, 2, nthWeekday(year, 2, 1, 3)),
    stamp(year, easter.month, easter.day - 2),
    ymd(year, 5, lastWeekday(year, 5, 1)),
    observed(year, 6, 19),
    observed(year, 7, 4),
    ymd(year, 9, nthWeekday(year, 9, 1, 1)),
    ymd(year, 11, nthWeekday(year, 11, 4, 4)),
    observed(year, 12, 25),
  ].filter((item): item is string => item != null)
  return new Set(dates)
}

function earlySet(year: number): Set<string> {
  const closed = holidays(year)
  const set = new Set<string>()
  set.add(ymd(year, 11, nthWeekday(year, 11, 4, 4) + 1))
  const july4 = new Date(Date.UTC(year, 6, 4)).getUTCDay()
  if (july4 >= 2 && july4 <= 5) set.add(ymd(year, 7, 3))
  const eve = ymd(year, 12, 24)
  const eveWeekday = new Date(Date.UTC(year, 11, 24)).getUTCDay()
  if (eveWeekday >= 1 && eveWeekday <= 5 && !closed.has(eve)) set.add(eve)
  return set
}

function holidays(year: number): Set<string> {
  let set = holidaysByYear.get(year)
  if (!set) {
    set = holidaySet(year)
    holidaysByYear.set(year, set)
  }
  return set
}

function earlyCloses(year: number): Set<string> {
  let set = earlyByYear.get(year)
  if (!set) {
    set = earlySet(year)
    earlyByYear.set(year, set)
  }
  return set
}

function nyWall(now: Date): { ymd: string; weekday: number; minutes: number } {
  const bag: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  let hour = Number(bag.hour)
  if (hour === 24) hour = 0
  return {
    ymd: `${bag.year}-${bag.month}-${bag.day}`,
    weekday: WEEKDAY[bag.weekday] ?? 0,
    minutes: hour * 60 + Number(bag.minute),
  }
}

/** US equity session in New York. Pre 4:00, open 9:30, post until 20:00. Early days close at 13:00 and post until 17:00. */
export function equitySession(now: Date): EquitySession {
  const wall = nyWall(now)
  if (wall.weekday === 0 || wall.weekday === 6) return 'closed'
  const year = Number(wall.ymd.slice(0, 4))
  if (holidays(year).has(wall.ymd)) return 'closed'
  const early = earlyCloses(year).has(wall.ymd)
  const close = early ? EARLY_CLOSE : CLOSE
  const postEnd = early ? EARLY_POST_END : POST_END
  if (wall.minutes >= PRE && wall.minutes < OPEN) return 'pre'
  if (wall.minutes >= OPEN && wall.minutes < close) return 'open'
  if (wall.minutes >= close && wall.minutes < postEnd) return 'post'
  return 'closed'
}

export type SessionWhen = { id: EquitySession; label: string; at: Date }

const PHASES: EquitySession[] = ['pre', 'open', 'post', 'closed']

function phaseMinute(id: EquitySession, early: boolean): number {
  if (id === 'pre') return PRE
  if (id === 'open') return OPEN
  if (id === 'post') return early ? EARLY_CLOSE : CLOSE
  return early ? EARLY_POST_END : POST_END
}

function nyInstant(day: string, minutes: number): Date {
  const [year, month, date] = day.split('-').map(Number)
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const utc = new Date(Date.UTC(year, month - 1, date, hour, minute))
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

function tradingDay(day: string): boolean {
  const wall = nyWall(nyInstant(day, 12 * 60))
  if (wall.weekday === 0 || wall.weekday === 6) return false
  return !holidays(Number(day.slice(0, 4))).has(day)
}

function walkDay(day: string, dir: 1 | -1): string {
  const noon = nyInstant(day, 12 * 60)
  return nyWall(new Date(noon.getTime() + dir * 20 * 60 * 60 * 1000)).ymd
}

function onDay(id: EquitySession, day: string): Date {
  const early = earlyCloses(Number(day.slice(0, 4))).has(day)
  return nyInstant(day, phaseMinute(id, early))
}

function nextStart(id: EquitySession, now: Date): Date {
  let day = nyWall(now).ymd
  for (let i = 0; i < 14; i += 1) {
    if (tradingDay(day)) {
      const at = onDay(id, day)
      if (at.getTime() > now.getTime()) return at
    }
    day = walkDay(day, 1)
  }
  return now
}

function currentStart(id: EquitySession, now: Date): Date {
  if (id === 'closed') {
    let day = nyWall(now).ymd
    for (let i = 0; i < 14; i += 1) {
      if (tradingDay(day)) {
        const at = onDay(id, day)
        if (at.getTime() <= now.getTime()) return at
      }
      day = walkDay(day, -1)
    }
    return now
  }
  const day = nyWall(now).ymd
  return tradingDay(day) ? onDay(id, day) : nextStart(id, now)
}

/** Next time each session starts. The active one keeps the start that is already underway. */
export function sessionSchedule(now: Date): SessionWhen[] {
  const active = equitySession(now)
  return PHASES.map((id) => ({
    id,
    label: SESSION_LABEL[id],
    at: active === id ? currentStart(id, now) : nextStart(id, now),
  }))
}

export function formatCountdown(now: Date, at: Date, active: boolean): string {
  if (active) return 'now'
  const minutes = Math.max(1, Math.round((at.getTime() - now.getTime()) / 60_000))
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 36) return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`
  const days = Math.floor(hours / 24)
  const left = hours % 24
  return left ? `in ${days}d ${left}h` : `in ${days}d`
}

/** Yahoo spark `marketState`. Unknown values fall through to the clock. */
export function sessionFromMarketState(state: string | null | undefined): EquitySession | null {
  switch (state?.toUpperCase()) {
    case 'PRE':
      return 'pre'
    case 'REGULAR':
      return 'open'
    case 'POST':
      return 'post'
    case 'PREPRE':
    case 'POSTPOST':
    case 'CLOSED':
      return 'closed'
    default:
      return null
  }
}
