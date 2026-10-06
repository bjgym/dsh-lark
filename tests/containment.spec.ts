import { describe, expect, it } from 'vitest'
import { isSamePath, isWithinContainer } from '../src/containment.ts'

/**
 * Whether this host's filesystem folds path case onto one directory.
 *
 * Not a convenience: it is the whole point of the cases below. Windows sees
 * `/srv/ALPHA` and `/srv/alpha` as one place and a POSIX host sees two, so the
 * correct answer to "is this inside that" differs per host, and a comparison
 * written for one of them is wrong on the other.
 */
const caseFolding = process.platform === 'win32'

describe('isWithinContainer', () => {
  it('accepts the container itself and its descendants, and nothing beside it', () => {
    expect(isWithinContainer('/srv/alpha', '/srv/alpha')).toBe(true)
    expect(isWithinContainer('/srv/alpha/sub', '/srv/alpha')).toBe(true)
    // Shares the prefix and shares nothing else: a string test says yes here.
    expect(isWithinContainer('/srv/alphabet', '/srv/alpha')).toBe(false)
    expect(isWithinContainer('/other', '/srv/alpha')).toBe(false)
  })

  it('reads the parent marker by component, not by prefix', () => {
    // A child whose NAME begins with two dots is still a child — and the file a
    // prefix test would refuse for "climbing out of the workspace".
    expect(isWithinContainer('/srv/alpha/..foo', '/srv/alpha')).toBe(true)
    expect(isWithinContainer('/srv/alpha/..', '/srv/alpha')).toBe(false)
    expect(isWithinContainer('/srv/alpha/../beta', '/srv/alpha')).toBe(false)
  })

  it('answers case the way the host filesystem does', () => {
    expect(isWithinContainer('/srv/alpha/sub', '/srv/ALPHA')).toBe(caseFolding)
  })

  it('refuses a path that never named a place', () => {
    // Neither side may be read against the process working directory: a
    // relative spelling that happens to sit under the cwd is not evidence.
    expect(isWithinContainer('sub/a.txt', '/srv/alpha')).toBe(false)
    expect(isWithinContainer('/srv/alpha', 'alpha')).toBe(false)
  })

  it.skipIf(process.platform !== 'win32')('refuses a container on another drive', () => {
    // No `..` reaches across a drive, and the comparison must not pretend one
    // does by treating a whole absolute path as a relative one.
    expect(isWithinContainer('D:\\work\\a.txt', 'C:\\work')).toBe(false)
  })
})

describe('isSamePath', () => {
  it('is true for one location spelled twice, and false for two', () => {
    expect(isSamePath('/srv/alpha', '/srv/alpha')).toBe(true)
    expect(isSamePath('/srv/alpha', '/srv/beta')).toBe(false)
    expect(isSamePath('/srv/alpha', '/srv/alpha/sub')).toBe(false)
  })

  it('answers case the way the host filesystem does', () => {
    expect(isSamePath('/srv/alpha', '/srv/ALPHA')).toBe(caseFolding)
  })

  it('refuses a spelling that named no absolute place', () => {
    expect(isSamePath('alpha', '/srv/alpha')).toBe(false)
    expect(isSamePath('/srv/alpha', 'alpha')).toBe(false)
  })
})
