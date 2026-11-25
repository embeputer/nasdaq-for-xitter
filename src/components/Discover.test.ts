import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { noisePosition } from '../lib/noise.ts'
import { Discover, positionGroups, shortName } from './Discover.tsx'
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
    expect(html).toContain('aria-expanded="false"')
    const aside = html.slice(html.indexOf('class="book"'), html.indexOf('class="stage"'))
    expect(aside).toContain('@z1xus')
    expect(aside).not.toContain('class="name"')
    expect(aside).not.toContain('class="name ')
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
    expect(html).not.toContain('Change the logo')
  })

  it('lets the creator replace the logo from the chart mark', () => {
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
    const quote = {
      id: 'launch:RAYMAN',
      venue: 'launch' as const,
      symbol: 'RAYMAN',
      name: 'Rayman',
      price: 1,
      change: 0,
      changePct: 0,
      marketState: null,
      asOf: 1,
      creator: 'Rayman',
      logo: '/api/logos/RAYMAN?v=2',
    }
    const owned = renderToStaticMarkup(
      createElement(Discover, {
        positions: [rayman],
        quotes: { 'launch:RAYMAN': quote },
        viewer: { screenName: '@rayman', name: 'Rayman', avatarUrl: null, admin: false },
        desks: ['nasdaq'],
        selected: rayman,
        onSelect: () => undefined,
        candles: [],
        chartError: null,
      }),
    )
    expect(owned).toContain('aria-label="Change the logo for xitRAYMAN"')
    expect(owned).toContain('/api/logos/RAYMAN?v=2')
    const stranger = renderToStaticMarkup(
      createElement(Discover, {
        positions: [rayman],
        quotes: { 'launch:RAYMAN': { ...quote, logo: undefined } },
        viewer: { screenName: 'toejoke', name: 'toejoke', avatarUrl: null, admin: false },
        desks: ['nasdaq'],
        selected: rayman,
        onSelect: () => undefined,
        candles: [],
        chartError: null,
      }),
    )
    expect(stranger).not.toContain('Change the logo')
    expect(stranger).toContain('>R<')
    const stock = renderToStaticMarkup(
      createElement(Discover, {
        positions: [ant],
        quotes: {},
        viewer: { screenName: 'z1xus', name: 'z1xus', avatarUrl: null, admin: false },
        desks: ['nasdaq'],
        selected: ant,
        onSelect: () => undefined,
        candles: [],
        chartError: null,
      }),
    )
    expect(stock).not.toContain('Change the logo')
  })
})

describe('Noise', () => {
  it('lists the house stock without a holder card', () => {
    const house = noisePosition()
    const html = renderToStaticMarkup(
      createElement(Discover, {
        house,
        positions: [ant],
        quotes: {
          'launch:NOISE': {
            id: 'launch:NOISE',
            venue: 'launch',
            symbol: 'NOISE',
            name: 'Noise',
            price: 1.2,
            change: 0.2,
            changePct: 20,
            marketState: null,
            asOf: 1,
          },
        },
        viewer: null,
        desks: ['nasdaq'],
        selected: house,
        onSelect: () => undefined,
        candles: [],
        chartError: null,
      }),
    )
    expect(html).toContain('xitNOISE')
    expect(html).toContain('Noise')
    expect(html).not.toContain('Username')
    expect(html).toContain('@z1xus')
  })
})

describe('discover groups', () => {
  it('groups positions by account and starts collapsed', () => {
    const other: Position = {
      ...ant,
      id: 'pos:stock:NVDA:ada',
      symbol: 'NVDA',
      name: 'NVIDIA',
      label: 'NVDA',
      person: { id: '2', screenName: 'Ada', name: 'Ada', avatarUrl: null },
    }
    expect(positionGroups([ant, other]).map((group) => group.screenName)).toEqual(['Ada', 'z1xus'])
    const html = renderToStaticMarkup(
      createElement(Discover, {
        positions: [ant, other],
        quotes: {},
        viewer: { screenName: 'z1xus', name: 'z1xus', avatarUrl: null, admin: false },
        desks: ['nasdaq'],
        selected: null,
        onSelect: () => undefined,
        candles: [],
        chartError: null,
      }),
    )
    const aside = html.slice(html.indexOf('class="book"'), html.indexOf('class="stage"'))
    expect(aside.indexOf('@Ada')).toBeLessThan(aside.indexOf('@z1xus'))
    expect(aside).toContain('Yours')
    expect(aside.match(/aria-expanded="false"/g)?.length).toBe(2)
    expect(aside).not.toContain('>NVDA<')
    expect(aside).not.toContain('>ANT<')
  })
})
