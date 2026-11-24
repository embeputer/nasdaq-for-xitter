import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Discover, shortName } from './Discover.tsx'
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
})
