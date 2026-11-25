import { describe, expect, it } from 'vitest'
import {
  applyModeration,
  canModerate,
  cleanModMarket,
  cleanModUser,
  isLaunchDelisted,
  isMarketRestricted,
  isUserRestricted,
  readModeration,
} from './moderation.ts'

describe('canModerate', () => {
  it('allows admins and moderators, rejects members and signed-out viewers', () => {
    expect(canModerate({ admin: true })).toBe(true)
    expect(canModerate({ moderator: true })).toBe(true)
    expect(canModerate({ admin: true, moderator: true })).toBe(true)
    expect(canModerate({ admin: false, moderator: false })).toBe(false)
    expect(canModerate(null)).toBe(false)
    expect(canModerate(undefined)).toBe(false)
  })
})

describe('cleanModUser', () => {
  it('normalizes handles and rejects junk', () => {
    expect(cleanModUser('@Z1xus')).toBe('z1xus')
    expect(cleanModUser('ray.man_2')).toBe('ray.man_2')
    expect(cleanModUser('has space')).toBeNull()
    expect(cleanModUser('')).toBeNull()
    expect(cleanModUser('bad!chars')).toBeNull()
  })
})

describe('cleanModMarket', () => {
  it('normalizes explicit venue keys', () => {
    expect(cleanModMarket('stock:nvda')).toBe('stock:NVDA')
    expect(cleanModMarket('$nvda')).toBe('stock:NVDA')
    expect(cleanModMarket('crypto:btcusdt')).toBe('crypto:BTC')
    expect(cleanModMarket('launch:xitYAMS')).toBe('launch:YAMS')
  })
  it('resolves bare tickers', () => {
    expect(cleanModMarket('BTC')).toBe('crypto:BTC')
    expect(cleanModMarket('eth')).toBe('crypto:ETH')
    expect(cleanModMarket('NVDA')).toBe('stock:NVDA')
    expect(cleanModMarket('xitPUP')).toBe('launch:PUP')
  })
  it('rejects empty input', () => {
    expect(cleanModMarket('')).toBeNull()
    expect(cleanModMarket('   ')).toBeNull()
    expect(cleanModMarket('stock:')).toBeNull()
  })
})

describe('applyModeration', () => {
  it('adds and removes delisted launches', () => {
    const meta: Record<string, string> = {}
    const added = applyModeration(meta, { kind: 'delist_launch', target: 'xitYAMS', active: true })
    expect(added?.delistedLaunches).toEqual(['YAMS'])
    expect(isLaunchDelisted(meta, 'YAMS')).toBe(true)
    const removed = applyModeration(meta, { kind: 'delist_launch', target: 'YAMS', active: false })
    expect(removed?.delistedLaunches).toEqual([])
    expect(isLaunchDelisted(meta, 'YAMS')).toBe(false)
  })
  it('adds and removes restricted markets', () => {
    const meta: Record<string, string> = {}
    applyModeration(meta, { kind: 'restrict_market', target: 'BTC', active: true })
    expect(isMarketRestricted(meta, 'crypto', 'BTCUSDT')).toBe(true)
    expect(isMarketRestricted(meta, 'crypto', 'ETH')).toBe(false)
    applyModeration(meta, { kind: 'restrict_market', target: 'stock:NVDA', active: true })
    expect(isMarketRestricted(meta, 'stock', 'nvda')).toBe(true)
    applyModeration(meta, { kind: 'restrict_market', target: 'xitYAMS', active: true })
    expect(isMarketRestricted(meta, 'launch', 'YAMS')).toBe(true)
  })
  it('adds and removes restricted users', () => {
    const meta: Record<string, string> = {}
    applyModeration(meta, { kind: 'restrict_user', target: '@Z1xus', active: true })
    expect(isUserRestricted(meta, 'z1xus')).toBe(true)
    expect(isUserRestricted(meta, 'other')).toBe(false)
    applyModeration(meta, { kind: 'restrict_user', target: 'z1xus', active: false })
    expect(isUserRestricted(meta, 'Z1XUS')).toBe(false)
  })
  it('rejects invalid targets without touching state', () => {
    const meta: Record<string, string> = { 'mod:restricted-users': '["z1xus"]' }
    expect(applyModeration(meta, { kind: 'restrict_user', target: 'bad handle!', active: true })).toBeNull()
    expect(applyModeration(meta, { kind: 'restrict_market', target: '', active: true })).toBeNull()
    expect(applyModeration(meta, { kind: 'delist_launch', target: '!!!', active: true })).toBeNull()
    expect(readModeration(meta).restrictedUsers).toEqual(['z1xus'])
  })
  it('drops the key when the last entry is removed', () => {
    const meta: Record<string, string> = {}
    applyModeration(meta, { kind: 'restrict_user', target: 'z1xus', active: true })
    applyModeration(meta, { kind: 'restrict_user', target: 'z1xus', active: false })
    expect('mod:restricted-users' in meta).toBe(false)
  })
  it('survives corrupt stored JSON', () => {
    const meta: Record<string, string> = { 'mod:restricted-markets': 'not json', 'mod:delisted-launches': '{"a":1}' }
    const state = readModeration(meta)
    expect(state.restrictedMarkets).toEqual([])
    expect(state.delistedLaunches).toEqual([])
  })
})
