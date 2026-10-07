/**
 * Where this channel's managed state persists, across the two host settings
 * generations.
 *
 * The state is the per-conversation facts a chat builds up: the directory it was
 * `/cd`-ed to, the model route it asked for, the session it continues, and how
 * many times it started over. The host owns the durable home for them, and that
 * home moved. An older host registered a namespace against a schema and handed
 * back a scope — `register(ns, schema, { base }) -> { get, update(patch) }` —
 * while the host this package declares projects each Loader row's volatile
 * Config fields and writes them by the row's own id: `update(ns, patch,
 * revision?)`, where `ns` is the row's `id:` in the configuration tree.
 *
 * Both are supported here, because a deployment may run either generation: the
 * modern seam is preferred, the older one is used when it is the only one
 * present, and a deployment with neither gets an in-memory channel plus one line
 * saying exactly that — which is the state this channel was in silently when the
 * host changed and the hand-copied contract in `host.ts` did not.
 *
 * A modern write lands only where the row's own Config marks the field volatile;
 * the host validates that and refuses the patch otherwise. A refusal is reported
 * once, with the host's own words, rather than being mistaken for durability.
 * @module dsh-lark-channel/settings-store
 */

import type { Context } from '@deepseek-ai/cordis'
import { failureDetail } from './format.ts'

/** One row's live volatile config, as the host's `describe()` publishes it. */
export interface SettingsDescriptorLike {
  readonly ns?: unknown
  readonly value?: unknown
}

/** The modern seam: per-row volatile config, written by the row's own id. */
export interface ModernSettings {
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

/** The older seam's namespace scope. */
export interface LegacySettingsScope {
  /** The resolved value: schema defaults, then composition base, then the document. */
  get(): unknown
  /** Deep-merge a patch into the namespace's stored section. */
  update(patch: object): Promise<unknown>
}

/** The older seam: a namespace registered against a schema. */
export interface LegacySettings {
  register(ns: string, schema: unknown, options?: { base?: unknown }): LegacySettingsScope
}

/** What one deployment's settings seam gives this plugin. */
export interface SettingsBinding {
  /**
   * The configuration as the seam resolved it, when the seam can hand one back.
   *
   * Absent on the modern seam: there the resolved config is already the value
   * the Loader passed this plugin, so there is nothing to re-read.
   */
  readonly resolved?: unknown
  /** Whether a managed-state patch can be persisted at all. */
  readonly durable: boolean
  /**
   * Write one managed-state patch.
   * @param patch - the section to merge, keyed as this channel's config names it.
   * @returns whether it reached durable storage.
   */
  persist(patch: object): Promise<boolean>
}

/**
 * The Loader row id this plugin is mounted as, when the tree names one.
 *
 * Read structurally: the id lives on the Loader's entry, which is an extension
 * of the Cordis fiber this package's `@deepseek-ai/cordis` does not type.
 * @param ctx - the plugin's scoped context.
 * @returns the row's id, or undefined when this deployment names none.
 */
export function entryIdOf(ctx: Context): string | undefined {
  const fiber = (ctx as { fiber?: { entry?: { options?: { id?: unknown } } } }).fiber
  const id = fiber?.entry?.options?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** Construction options for {@link createSettingsBinding}. */
export interface SettingsBindingOptions {
  /** The composed `settings` service, in whichever generation it is. */
  readonly settings: unknown
  /** The Loader row id a modern write names, when the tree names one. */
  readonly entryId: string | undefined
  /** The namespace an older host registers, and the fallback a modern one names. */
  readonly namespace: string
  /** This plugin's Config schema, for the older seam's registration. */
  readonly schema: unknown
  /** The composed config the older seam registers as its base. */
  readonly base: unknown
  /** Operator console line. */
  readonly report: (line: string) => void
}

/**
 * Bind this channel's managed state to the settings seam a deployment composed.
 * @param options - the service, the row identity, and the schema to register.
 * @returns the binding, whose `persist` is a no-op when nothing can store.
 */
export function createSettingsBinding(options: SettingsBindingOptions): SettingsBinding {
  const { settings, entryId, namespace, schema, base, report } = options
  const noStore = (reason: string): SettingsBinding => {
    report(`lark-channel: ${reason} — /cd workspaces, /model routes, session picks and epochs live in memory only`)
    return { durable: false, persist: async () => false }
  }
  if (settings === undefined || settings === null) {
    return noStore('no settings service is composed')
  }

  const modern = settings as Partial<ModernSettings>
  if (typeof modern.update === 'function' && entryId !== undefined) {
    const update = modern.update.bind(settings)
    let refused = false
    return {
      durable: true,
      async persist(patch) {
        try {
          await update(entryId, patch)
          return true
        } catch (error: unknown) {
          // Said once, with the host's own words: "not volatile" and "overridden
          // by a home patch" are fixes the operator can make, while a channel
          // that quietly kept the state in memory is the failure this whole
          // module exists to end.
          if (!refused) {
            refused = true
            report(`lark-channel: persisting managed state as "${entryId}" failed: ${failureDetail(error)}`)
          }
          return false
        }
      },
    }
  }

  const legacy = settings as Partial<LegacySettings>
  if (typeof legacy.register === 'function') {
    try {
      const scope = legacy.register.call(settings, namespace, schema, { base })
      let refused = false
      return {
        resolved: scope.get(),
        durable: true,
        async persist(patch) {
          try {
            await scope.update(patch)
            return true
          } catch (error: unknown) {
            if (!refused) {
              refused = true
              report(`lark-channel: persisting managed state as "${namespace}" failed: ${failureDetail(error)}`)
            }
            return false
          }
        },
      }
    } catch (error: unknown) {
      return noStore(`registering the settings namespace "${namespace}" failed: ${failureDetail(error)}`)
    }
  }

  return noStore("this host's settings service offers neither update() nor register()")
}
