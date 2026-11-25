import { describe, expect, it } from 'vitest'
import {
  applyCompliance,
  COMPLIANT_USERS_KEY,
  DISCLAIMER_NOTE,
  isCompliant,
  readCompliance,
} from './compliance.ts'

describe('compliance', () => {
  it('starts empty and marks a user compliant', () => {
    const meta: Record<string, string> = {}
    expect(isCompliant(meta, 'z1xus')).toBe(false)
    const state = applyCompliance(meta, '@Z1xus', true)
    expect(state?.compliantUsers).toEqual(['z1xus'])
    expect(isCompliant(meta, 'Z1XUS')).toBe(true)
    expect(isCompliant(meta, 'other')).toBe(false)
  })
  it('unmarks and drops the key when the last user is removed', () => {
    const meta: Record<string, string> = {}
    applyCompliance(meta, 'ada', true)
    applyCompliance(meta, 'ada', false)
    expect(COMPLIANT_USERS_KEY in meta).toBe(false)
    expect(isCompliant(readCompliance(meta), 'ada')).toBe(false)
  })
  it('rejects bad handles and survives corrupt JSON', () => {
    const meta: Record<string, string> = { [COMPLIANT_USERS_KEY]: 'nope' }
    expect(readCompliance(meta).compliantUsers).toEqual([])
    expect(applyCompliance(meta, 'bad handle!', true)).toBeNull()
    expect(isCompliant(meta, '')).toBe(false)
  })
  it('carries the disclaimer note pointing at the app', () => {
    expect(DISCLAIMER_NOTE).toBe('Please accept our disclaimer at nqfx.embie.tech/disclaimer')
  })
})
