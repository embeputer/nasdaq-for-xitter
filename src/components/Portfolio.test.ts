import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Portfolio } from './Portfolio.tsx'
import type { Position } from '../types'

function position(id: string, screenName: string, label: string): Position {
  return {
    id,
    venue: 'stock',
    symbol: label,
    name: label,
    label,
    person: { id, screenName, name: screenName, avatarUrl: null },
    qty: 1,
    avgPrice: 10,
    openedAt: 1,
  }
}

const viewer = { id: '1', screenName: 'ember', name: 'Ember', avatarUrl: null, admin: false }

describe('withdraw button', () => {
  it('shows Withdraw on a signed-in portfolio and hides it when logged out', () => {
    const signedIn = renderToStaticMarkup(
      createElement(Portfolio, {
        viewer,
        positions: [],
        fills: [],
        quotes: {},
        desks: ['nasdaq'],
        nqfxCents: 2500,
        onWithdraw: () => undefined,
        onClose: async () => undefined,
        onOpened: () => undefined,
      }),
    )
    expect(signedIn).toContain('>Withdraw<')
    expect(signedIn).toContain('pill-row')
    expect(signedIn).not.toContain('Open a position')
    const admin = renderToStaticMarkup(
      createElement(Portfolio, {
        viewer: { ...viewer, admin: true },
        positions: [],
        fills: [],
        quotes: {},
        desks: ['nasdaq'],
        nqfxCents: 2500,
        onWithdraw: () => undefined,
        onClose: async () => undefined,
        onOpened: () => undefined,
      }),
    )
    const row = admin.slice(admin.indexOf('pill-row'), admin.indexOf('class="holdings"'))
    expect(row.indexOf('>Withdraw<')).toBeGreaterThan(-1)
    expect(row.indexOf('>Withdraw<')).toBeLessThan(row.indexOf('Open a position'))
    const loggedOut = renderToStaticMarkup(
      createElement(Portfolio, {
        viewer: null,
        positions: [],
        fills: [],
        quotes: {},
        desks: ['nasdaq'],
        nqfxCents: 0,
        onWithdraw: () => undefined,
        onClose: async () => undefined,
        onOpened: () => undefined,
      }),
    )
    expect(loggedOut).not.toContain('Withdraw')
  })

  it('lifts an admin’s own positions out of the book', () => {
    const html = renderToStaticMarkup(
      createElement(Portfolio, {
        viewer: { ...viewer, admin: true },
        positions: [position('1', 'ember', 'SPY'), position('2', 'ada', 'NVDA')],
        fills: [],
        quotes: {},
        desks: ['nasdaq'],
        nqfxCents: 0,
        onWithdraw: () => undefined,
        onClose: async () => undefined,
        onOpened: () => undefined,
      }),
    )
    const yours = html.slice(html.indexOf('Your positions'), html.indexOf('>Book<'))
    const book = html.slice(html.indexOf('>Book<'))
    expect(yours).toContain('>SPY<')
    expect(yours).not.toContain('>NVDA<')
    expect(book).toContain('>NVDA<')
    expect(book).not.toContain('>SPY<')
    const member = renderToStaticMarkup(
      createElement(Portfolio, {
        viewer,
        positions: [position('1', 'ember', 'SPY')],
        fills: [],
        quotes: {},
        desks: ['nasdaq'],
        nqfxCents: 0,
        onWithdraw: () => undefined,
        onClose: async () => undefined,
        onOpened: () => undefined,
      }),
    )
    expect(member).not.toContain('Your positions')
    expect(member).toContain('>SPY<')
  })

  it('shows an admin their own book beside the whole book', () => {
    const quote = (symbol: string, price: number) => ({
      id: `stock:${symbol}`,
      venue: 'stock' as const,
      symbol,
      name: symbol,
      price,
      change: 0,
      changePct: 0,
      marketState: null,
      asOf: 1,
    })
    const html = renderToStaticMarkup(
      createElement(Portfolio, {
        viewer: { ...viewer, admin: true },
        positions: [position('1', 'ember', 'SPY'), position('2', 'ada', 'NVDA')],
        fills: [],
        quotes: { 'stock:SPY': quote('SPY', 15), 'stock:NVDA': quote('NVDA', 7) },
        desks: ['nasdaq'],
        nqfxCents: 0,
        onWithdraw: () => undefined,
        onClose: async () => undefined,
        onOpened: () => undefined,
      }),
    )
    const head = html.slice(0, html.indexOf('class="stats"'))
    expect(head).toContain('Your book')
    expect(head).toContain('>$15.00<')
    expect(head).toContain('Every position')
    expect(head).toContain('>$22.00<')
    expect(head).toContain('+$2.00')
    const stats = html.slice(html.indexOf('class="stats"'), html.indexOf('pill-row'))
    expect(stats).toContain('Open P&amp;L')
    expect(stats).toContain('+$5.00')
    expect(stats).not.toContain('+$2.00')
  })
})
