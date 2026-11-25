import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DisclaimerPage } from './DisclaimerPage.tsx'

describe('DisclaimerPage', () => {
  it('states the simulation, affiliation, and restriction clauses', () => {
    const html = renderToStaticMarkup(createElement(DisclaimerPage))
    expect(html).toContain('play money')
    expect(html).toContain('not affiliated with, endorsed by')
    expect(html).toContain('Access to NQFX may be restricted')
    expect(html).toContain('harmful patterns')
    expect(html).toContain('nqfx.embie.tech/disclaimer')
  })
})
