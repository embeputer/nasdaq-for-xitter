import { describe, expect, it } from 'vitest'
import { brandColor, brandLetter } from './brand.ts'

describe('brand marks', () => {
  it('uses known brand colors and stable fallbacks', () => {
    expect(brandColor('nvda')).toBe('#76b900')
    expect(brandColor('TSLA')).toBe('#e82127')
    expect(brandColor('ZZZZ')).toBe(brandColor('zzzz'))
    expect(brandColor('ZZZZ')).toMatch(/^hsl\(\d+ 65% 42%\)$/)
  })
  it('takes the letter from the company name when given', () => {
    expect(brandLetter('NVIDIA', 'NVDA', 'NVDA')).toBe('N')
    expect(brandLetter(undefined, 'NVDA', 'NVDA')).toBe('N')
    expect(brandLetter('  ', '$NVDA', 'NVDA')).toBe('N')
    expect(brandLetter(undefined, '', 'xitYAMS')).toBe('X')
  })
})
