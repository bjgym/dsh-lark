/**
 * Session-surviving answer drafts for the question wizard this channel renders.
 *
 * The shipped composer keeps a request's in-progress answers in the Slot
 * registry's store seat, so a strict Session entry remount restores the same
 * request without exposing it to another one. This plugin cannot reuse that
 * seat (its store handle type lives in a package this channel does not
 * depend on), so it carries the same contract through its own registrant
 * face: one instance per `apply()`, handed to the panel through the
 * registration's `inject` compartment, disposed with the plugin. Drafts are
 * transient by definition — a plugin reload losing them matches the shipped
 * store's non-persisted semantics.
 * @module dsh-lark-channel/client/question-drafts
 */

/** One in-progress answer, including an explicit skip. */
export interface QuestionDraftAnswer {
  /** Offered labels currently selected. */
  selected: string[]
  /** Human-authored alternative or additional answer. */
  custom: string
  /** Whether the user explicitly skipped this question. */
  skipped: boolean
}

/** Navigation and answer drafts for one pending request. */
export interface QuestionDraftProgress {
  /** Current question index. */
  index: number
  /** One draft per question, in request order. */
  drafts: QuestionDraftAnswer[]
  /**
   * Local indefinite-wait choice restored with the draft, on the shipped
   * store's terms: `waiting` re-applies the user's "take time" decision to a
   * remounted panel, and `editing` re-applies the frozen countdown a first
   * edit already engaged.
   */
  wait?: 'editing' | 'waiting'
}

/**
 * The draft reads and writes one wizard renders from.
 *
 * `read` returns a deep copy: the component owns its state and the registry
 * must never alias it. A stored progress whose shape no longer matches the
 * request (a different question count, or an index past the end after the
 * asker shrank the batch) reads as absent rather than restoring garbage.
 */
export interface QuestionDraftsFace {
  /**
   * The stored progress for one request, when it matches the request's shape.
   * @param key - the request's render identity.
   * @param questionCount - how many questions the request currently carries.
   * @returns a copy of the stored progress, or undefined when none fits.
   */
  read(key: string, questionCount: number): QuestionDraftProgress | undefined
  /**
   * Store one request's progress.
   * @param key - the request's render identity.
   * @param progress - the progress to store; the registry takes ownership.
   */
  replace(key: string, progress: QuestionDraftProgress): void
  /**
   * Drop one request's progress, once it was answered or cancelled.
   * @param key - the request's render identity.
   */
  clear(key: string): void
  /**
   * Drop every stored progress a Session no longer presents. The live keys
   * come from the request object, which is the only party that knows which
   * sibling cards its Session still holds.
   * @param keep - request keys that are still live.
   */
  prune(keep: readonly string[]): void
  /** Drop every stored progress. */
  dispose(): void
}

/**
 * Create the draft face one Client assembly's question panels share.
 * @returns a per-apply draft registry.
 */
export function createQuestionDrafts(): QuestionDraftsFace {
  const stored = new Map<string, QuestionDraftProgress>()
  return {
    read(key, questionCount) {
      const progress = stored.get(key)
      if (progress === undefined || progress.drafts.length !== questionCount) return undefined
      return {
        index: Math.min(progress.index, questionCount - 1),
        drafts: progress.drafts.map(draft => ({ ...draft, selected: [...draft.selected] })),
        ...(progress.wait === undefined ? {} : { wait: progress.wait }),
      }
    },
    replace(key, progress) {
      stored.set(key, progress)
    },
    clear(key) {
      stored.delete(key)
    },
    prune(keep) {
      const live = new Set(keep)
      for (const key of [...stored.keys()]) {
        if (!live.has(key)) stored.delete(key)
      }
    },
    dispose() {
      stored.clear()
    },
  }
}
