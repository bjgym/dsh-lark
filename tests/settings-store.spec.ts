/**
 * The settings seam moved between host generations: an older host registered a
 * namespace against a schema and handed back a scope, while the host this
 * package declares writes a Loader row's volatile config by the row's own id.
 * This binding is what keeps managed state durable on either generation — or
 * says once, in the operator's console, that it cannot be durable at all.
 * These cases pin the three branches, the row id, and the refusal report.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createSettingsBinding, entryIdOf } from '../src/settings-store.ts'

const base = { chatWorkspaces: { oc_1: '/work' } }

describe('the row id a modern write names', () => {
  it('reads the Loader row id off the plugin fiber', () => {
    expect(entryIdOf({ fiber: { entry: { options: { id: 'lark-channel-support' } } } } as unknown as Context))
      .toBe('lark-channel-support')
  })

  it('answers nothing when the tree names no row', () => {
    expect(entryIdOf({} as unknown as Context)).toBeUndefined()
    expect(entryIdOf({ fiber: { entry: { options: { id: '' } } } } as unknown as Context)).toBeUndefined()
    expect(entryIdOf({ fiber: { entry: {} } } as unknown as Context)).toBeUndefined()
  })
})

describe('binding managed state to the settings seam', () => {
  it('writes through the modern seam, keyed by the row id', async () => {
    const update = vi.fn(async () => {})
    const lines: string[] = []
    const binding = createSettingsBinding({
      settings: { describe: () => [], update },
      entryId: 'lark-channel',
      namespace: 'lark-channel',
      schema: {},
      base,
      report: line => lines.push(line),
    })
    expect(binding.durable).toBe(true)
    // The modern seam has nothing to re-read: the Loader already handed this
    // plugin the resolved config.
    expect(binding.resolved).toBeUndefined()
    expect(await binding.persist({ chatWorkspaces: { oc_1: '/next' } })).toBe(true)
    expect(update).toHaveBeenCalledWith('lark-channel', { chatWorkspaces: { oc_1: '/next' } })
    expect(lines).toEqual([])
  })

  it("reports a refused write once, in the host's own words", async () => {
    // "not volatile" and "overridden by a home patch" are fixes the operator can
    // make; a channel that quietly kept the state in memory is the failure this
    // binding exists to end.
    const update = vi.fn(async () => {
      throw new Error('Config field "chatWorkspaces" is not volatile')
    })
    const lines: string[] = []
    const binding = createSettingsBinding({
      settings: { describe: () => [], update },
      entryId: 'lark-channel',
      namespace: 'lark-channel',
      schema: {},
      base,
      report: line => lines.push(line),
    })
    expect(await binding.persist({ chatWorkspaces: {} })).toBe(false)
    expect(await binding.persist({ chatWorkspaces: {} })).toBe(false)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('not volatile')
  })

  it('uses the older seam when it is the only one composed', async () => {
    const updates: object[] = []
    const registered: string[] = []
    const binding = createSettingsBinding({
      settings: {
        register: (ns: string, _schema: unknown, options?: { base?: unknown }) => {
          registered.push(ns)
          return {
            get: () => ({ ...(options?.base as object), chatModels: { oc_1: 'a/b' } }),
            update: async (patch: object) => { updates.push(patch) },
          }
        },
      },
      entryId: 'lark-channel',
      namespace: 'lark-channel',
      schema: {},
      base,
      report: () => {},
    })
    expect(registered).toEqual(['lark-channel'])
    expect(binding.resolved).toEqual({ ...base, chatModels: { oc_1: 'a/b' } })
    expect(binding.durable).toBe(true)
    expect(await binding.persist({ chatModels: { oc_1: 'c/d' } })).toBe(true)
    expect(updates).toEqual([{ chatModels: { oc_1: 'c/d' } }])
  })

  it('keeps the channel in memory and says so when no seam is usable', async () => {
    const lines: string[] = []
    const binding = createSettingsBinding({
      settings: {},
      entryId: 'lark-channel',
      namespace: 'lark-channel',
      schema: {},
      base,
      report: line => lines.push(line),
    })
    expect(binding.durable).toBe(false)
    expect(await binding.persist({ chatWorkspaces: {} })).toBe(false)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('in memory only')
  })

  it('says so when no settings service is composed at all', () => {
    const lines: string[] = []
    const binding = createSettingsBinding({
      settings: undefined,
      entryId: undefined,
      namespace: 'lark-channel',
      schema: {},
      base,
      report: line => lines.push(line),
    })
    expect(binding.durable).toBe(false)
    expect(lines).toEqual([expect.stringContaining('no settings service is composed')])
  })

  it('reports a namespace an older host refuses to register', () => {
    const lines: string[] = []
    const binding = createSettingsBinding({
      settings: {
        register: () => { throw new Error('duplicate namespace') },
      },
      entryId: 'lark-channel',
      namespace: 'lark-channel',
      schema: {},
      base,
      report: line => lines.push(line),
    })
    expect(binding.durable).toBe(false)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('duplicate namespace')
  })
})
