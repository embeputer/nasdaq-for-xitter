import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LaunchForm } from './LaunchForm.tsx'

describe('launch form', () => {
  it('asks for a symbol, a name, liquidity, and an optional invest', () => {
    const html = renderToStaticMarkup(createElement(LaunchForm, { nqfxCents: 2500, onLaunched: () => undefined }))
    expect(html).toContain('Launch a stock')
    expect(html).toContain('id="launch-symbol"')
    expect(html).toContain('id="launch-name"')
    expect(html).toContain('id="launch-liquidity"')
    expect(html).toContain('id="launch-invest"')
    expect(html).toContain('Launch xit…')
    expect(html).toContain('Liquidity stays in the fund')
    expect(html).toContain('buys shares now at $1')
  })
})
