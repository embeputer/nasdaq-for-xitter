import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LaunchForm, stepReady } from './LaunchForm.tsx'

const blank = { symbol: '', name: '', liquidity: '', invest: '' }

describe('launch form', () => {
  it('starts on the symbol and keeps Next off until each required step is filled', () => {
    const html = renderToStaticMarkup(
      createElement(LaunchForm, { nqfxCents: 2500, onLaunched: () => undefined, onClose: () => undefined }),
    )
    expect(html).toContain('Launch a stock')
    expect(html).toContain('id="launch-symbol"')
    expect(html).not.toContain('id="launch-name"')
    expect(html).not.toContain('id="launch-liquidity"')
    expect(html).not.toContain('id="launch-invest"')
    expect(html).toContain('Next')
    expect(html).toContain('disabled')
    expect(html).toContain('Buyers write')
    expect(stepReady('symbol', blank)).toBe(false)
    expect(stepReady('symbol', { ...blank, symbol: 'YAMS' })).toBe(true)
    expect(stepReady('symbol', { ...blank, symbol: 'A' })).toBe(false)
    expect(stepReady('name', { ...blank, name: 'Yams' })).toBe(true)
    expect(stepReady('name', blank)).toBe(false)
    expect(stepReady('liquidity', { ...blank, liquidity: '100' })).toBe(true)
    expect(stepReady('liquidity', { ...blank, liquidity: '0.50' })).toBe(false)
    expect(stepReady('invest', blank)).toBe(true)
    expect(stepReady('invest', { ...blank, invest: 'nope' })).toBe(true)
  })

  it('shows the summary and the launch button after the steps', () => {
    const html = renderToStaticMarkup(
      createElement(LaunchForm, {
        nqfxCents: 25_000,
        onLaunched: () => undefined,
        onClose: () => undefined,
        start: { step: 'summary', symbol: 'YAMS', name: 'Yams', liquidity: '100', invest: '' },
      }),
    )
    expect(html).toContain('xitYAMS')
    expect(html).toContain('Yams')
    expect(html).toContain('$100.00')
    expect(html).toContain('None')
    expect(html).toContain('Launch xitYAMS')
    expect(html).not.toContain('disabled')
  })
})