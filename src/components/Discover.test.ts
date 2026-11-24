import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Discover, shortName } from './Discover.tsx'
import { Leaderboard } from './Leaderboard.tsx'
import type { Position } from '../types'

const person = {
  id: '1',
  screenName: 'z1xus',
  name: 'z1xus',
  avatarUrl: null,
}

const ant: Position = {
  id: 'pos:stock:ANT:z1xus',
  venue: 'stock',
  symbol: 'ANT',
  name: 'Anthropic, PBC Class A Common Stock',
  label: 'ANT',
  person,
  qty: 1,
  avgPrice: 87.64,
  openedAt: 1,
}

describe('chart heading', () => {
  it('uses the company, then the ticker, and keeps the username in the list and the card', () => {
    expect(shortName(ant.name)).toBe('Anthropic')
    expect(shortName('NVIDIA Corporation Common Stock')).toBe('NVIDIA Corporation')
    expect(shortName('Palantir Technologies Inc. Class A Common Stock')).toBe('Palantir Technologies Inc.')
    const html = renderToStaticMarkup(
      createElement(Discover, {
        positions: [ant],
        quotes: {},
        viewer: null,
        desks: ['nasdaq'],
        selected: ant,
        onSelect: () => undefined,
        candles: [],
        chartError: null,
      }),
    )
    expect(html).toContain('Anthropic · ANT')
    expect(html).toContain('Anthropic, PBC Class A Common Stock')
    expect(html).toContain('@z1xus')
    expect(html).not.toContain('>@z1xus</a></h2>')
    const card = html.slice(html.indexOf('position-card'))
    expect(card).toContain('Username')
    expect(card).toContain('@z1xus')
    expect(card).toContain('https://xitter.space/z1xus')
  })

  it('places the xitStock creator on the name line', () => {
    const holder = { ...person, screenName: 'toejoke', name: 'toejoke' }
    const rayman: Position = {
      ...ant,
      id: 'pos:launch:RAYMAN:toejoke',
      venue: 'launch',
      symbol: 'RAYMAN',
      name: 'Rayman',
      label: 'xitRAYMAN',
      person: holder,
    }
    const html = renderToStaticMarkup(
      createElement(Discover, {
        positions: [rayman],
        quotes: {
          'launch:RAYMAN': {
            id: 'launch:RAYMAN',
            venue: 'launch',
            symbol: 'RAYMAN',
            name: 'Rayman',
            price: 1,
            change: 0,
            changePct: 0,
            marketState: null,
            asOf: 1,
            creator: 'Rayman',
          },
        },
        viewer: null,
        desks: ['nasdaq'],
        selected: rayman,
        onSelect: () => undefined,
        candles: [],
        chartError: null,
      }),
    )
    const start = html.indexOf('label-name')
    const nameLine = html.slice(start, html.indexOf('</p>', start))
    expect(nameLine).toContain('Rayman')
    expect(nameLine).toContain('https://xitter.space/Rayman')
    expect(nameLine).toContain('@Rayman')
    expect(html).toContain('Rayman · xitRAYMAN')
    expect(html).not.toContain('names board')
  })
})

describe('P&L tab', () => {
  it('ranks open and realized P&L and hides an empty board', () => {
    const empty = renderToStaticMarkup(createElement(Leaderboard, { positions: [], quotes: {}, scores: [] }))
    expect(empty).toBe('')
    const html = renderToStaticMarkup(
      createElement(Leaderboard, {
        positions: [ant],
        quotes: {
          'stock:ANT': {
            id: 'stock:ANT',
            venue: 'stock',
            symbol: 'ANT',
            name: ant.name,
            price: 100,
            change: 0,
            changePct: 0,
            marketState: null,
            asOf: 1,
          },
        },
        scores: [{ person: { id: '2', screenName: 'yams', name: 'Yams', avatarUrl: null }, realizedCents: -500 }],
      }),
    )
    expect(html.indexOf('https://xitter.space/z1xus')).toBeLessThan(html.indexOf('https://xitter.space/yams'))
    expect(html).toContain('class="up"')
    expect(html).toContain('class="down"')
    expect(html).toContain('names board')
    expect(html).not.toContain('https://xitter.space/@')
  })
})
