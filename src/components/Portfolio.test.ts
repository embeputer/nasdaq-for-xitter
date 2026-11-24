import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Portfolio } from './Portfolio.tsx'

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
    expect(signedIn).toContain('composer-toggle')
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
})
